import type { Cache } from "./cache";
import { breakingChanges, sectionFor, splitChangelog } from "./changelog";
import { USER_AGENT, pooled } from "./npm";
import { type Repo, repoUrl } from "./repo";
import { versionFromTag } from "./tags";

export type ReleaseNote = {
  version: string;
  /** Markdown body of the release notes, empty when only a heading existed. */
  body: string;
  breaking: string[];
  /** Where the text came from, so the report can link to it. */
  sourceUrl?: string;
  source: "changelog" | "releases";
};

export type NotesLookup = {
  notes: ReleaseNote[];
  /** Versions we looked for but found nothing for. */
  missing: string[];
  changelogUrl?: string;
};

/**
 * raw.githubusercontent.com does not consume the GitHub API rate limit, so the
 * changelog file is always tried first. `HEAD` resolves the default branch
 * without an extra lookup.
 */
const RAW = "https://raw.githubusercontent.com";
const API = "https://api.github.com";

const NOTE_TTL = 30 * 24 * 60 * 60;
/** A version that genuinely has no notes rarely gains them, but it can. */
const MISS_TTL = 7 * 24 * 60 * 60;
const SOURCE_TTL = 7 * 24 * 60 * 60;
const DOC_TTL = 12 * 60 * 60;
const MAX_DOC_BYTES = 3_000_000;

const CHANGELOG_FILES = ["CHANGELOG.md", "CHANGES.md", "HISTORY.md", "changelog.md"];
/** Workers allow six connections waiting on response headers at a time. */
const PROBE_CONCURRENCY = 4;

export type Deps = {
  cache: Cache;
  fetcher?: typeof fetch;
  githubToken?: string;
};

export async function fetchNotes(
  pkg: string,
  repo: Repo,
  versions: string[],
  deps: Deps,
): Promise<NotesLookup> {
  if (versions.length === 0) return { notes: [], missing: [] };

  // Wrapped so that "cached, and there are no notes" is distinguishable from
  // "not cached" — both would otherwise read back as null.
  const known = new Map<string, ReleaseNote | null>();
  await Promise.all(
    versions.map(async (version) => {
      const hit = await deps.cache.get<{ note: ReleaseNote | null }>(noteKey(pkg, version));
      if (hit) known.set(version, hit.note);
    }),
  );

  const wanted = versions.filter((v) => !known.has(v));
  if (wanted.length > 0) {
    const found = await loadFromSource(pkg, repo, wanted, deps);
    for (const version of wanted) known.set(version, found.get(version) ?? null);

    // A release's notes never change, so a hit is cached for a long time. A
    // miss might only mean GitHub was rate limiting us just now, and caching
    // that for a month would turn a bad minute into a bad month.
    const degraded = await rateLimited(deps);
    await Promise.all(
      wanted.map((version) => {
        const note = known.get(version) ?? null;
        const ttl = note ? NOTE_TTL : degraded ? LIMIT_TTL : MISS_TTL;
        return deps.cache.put(noteKey(pkg, version), { note }, ttl);
      }),
    );
  }

  const notes: ReleaseNote[] = [];
  const missing: string[] = [];
  for (const version of versions) {
    const note = known.get(version);
    if (note) notes.push(note);
    else missing.push(version);
  }

  return { notes, missing, changelogUrl: notes[0]?.sourceUrl };
}

async function loadFromSource(
  pkg: string,
  repo: Repo,
  versions: string[],
  deps: Deps,
): Promise<Map<string, ReleaseNote | null>> {
  const found = new Map<string, ReleaseNote | null>();

  const doc = await loadChangelogDoc(repo, deps);
  if (doc) {
    const sections = splitChangelog(doc.text);
    for (const version of versions) {
      const section = sectionFor(sections, version);
      if (!section) continue;
      found.set(version, {
        version,
        body: section.body,
        breaking: breakingChanges(section.body),
        sourceUrl: doc.url,
        source: "changelog",
      });
    }
  }

  const afterChangelog = versions.filter((v) => !found.has(v));
  if (afterChangelog.length === 0) return found;

  const releases = await loadReleases(pkg, repo, deps);
  for (const version of afterChangelog) {
    const release = releases.get(version);
    if (release) found.set(version, noteFrom(version, release));
  }

  // Projects rotate old entries out of CHANGELOG.md, and a monorepo's 100 most
  // recent releases can span only days. Ask for the exact tags still missing.
  const afterList = versions.filter((v) => !found.has(v)).slice(0, MAX_TAG_LOOKUPS);
  if (afterList.length === 0) return found;

  const shapes = tagShapes(pkg, [...releases.values()]);

  // One lookup has to go first to learn which tag shape this repo uses, and
  // the newest version is the likeliest to actually have a release to learn
  // from. Once the shape is cached the rest cost one request each and can run
  // together, which is the difference between six seconds and two.
  const probe = afterList[afterList.length - 1];
  const probed = await fetchReleaseByTag(pkg, repo, probe, shapes, deps);
  if (probed) found.set(probe, noteFrom(probe, probed));

  const rest = afterList.slice(0, -1);
  if (rest.length > 0) {
    const results = await pooled(rest, TAG_CONCURRENCY, (version) =>
      fetchReleaseByTag(pkg, repo, version, shapes, deps),
    );
    rest.forEach((version, index) => {
      const release = results[index];
      if (release) found.set(version, noteFrom(version, release));
    });
  }

  return found;
}

function noteFrom(version: string, release: ReleaseEntry): ReleaseNote {
  return {
    version,
    body: release.body,
    breaking: breakingChanges(release.body),
    sourceUrl: release.url,
    source: "releases",
  };
}

type ChangelogDoc = { text: string; url: string };

/** Find and read the repo's changelog file, remembering which path worked. */
async function loadChangelogDoc(repo: Repo, deps: Deps): Promise<ChangelogDoc | null> {
  const sourceKey = `clsrc:v1:${repo.owner}/${repo.name}:${repo.directory ?? ""}`;
  const known = await deps.cache.get<string | null>(sourceKey);

  // "" means we have looked and this repo has no changelog file.
  if (known === "") return null;

  if (known) {
    const cachedText = await deps.cache.get<string>(docKey(repo, known));
    if (cachedText !== null) return { text: cachedText, url: viewUrl(repo, known) };
    const doc = await readChangelog(repo, known, deps);
    if (doc) return doc;
    // The file moved or went away; fall through and look again.
  }

  // Nothing known yet. Most repos answer 404 for most candidates, and doing
  // that one at a time cost over a second for a repo with no changelog, so
  // every candidate is tried at once and the best one wins.
  const candidates = candidatePaths(repo);
  const responses = await pooled(candidates, PROBE_CONCURRENCY, async (path) => {
    try {
      const response = await (deps.fetcher ?? fetch)(rawUrl(repo, path), {
        headers: { "user-agent": USER_AGENT },
      });
      return { path, response };
    } catch {
      return { path, response: null };
    }
  });

  let winner: { path: string; response: Response } | null = null;
  for (const item of responses) {
    const usable =
      item.response?.ok &&
      Number(item.response.headers.get("content-length") ?? "0") <= MAX_DOC_BYTES;
    if (usable && !winner) winner = { path: item.path, response: item.response as Response };
    // Nothing reads the losing bodies, so let them go rather than leaving
    // half-read responses open.
    else item.response?.body?.cancel().catch(() => {});
  }

  if (!winner) {
    await deps.cache.put(sourceKey, "", SOURCE_TTL);
    return null;
  }

  const text = await winner.response.text();
  if (text.length > MAX_DOC_BYTES) {
    await deps.cache.put(sourceKey, "", SOURCE_TTL);
    return null;
  }

  await deps.cache.put(docKey(repo, winner.path), text, DOC_TTL);
  await deps.cache.put(sourceKey, winner.path, SOURCE_TTL);
  return { text, url: viewUrl(repo, winner.path) };
}

/** Read one known changelog path, or null if it is no longer there. */
async function readChangelog(
  repo: Repo,
  path: string,
  deps: Deps,
): Promise<ChangelogDoc | null> {
  let response: Response;
  try {
    response = await (deps.fetcher ?? fetch)(rawUrl(repo, path), {
      headers: { "user-agent": USER_AGENT },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  if (Number(response.headers.get("content-length") ?? "0") > MAX_DOC_BYTES) return null;

  const text = await response.text();
  if (text.length > MAX_DOC_BYTES) return null;

  await deps.cache.put(docKey(repo, path), text, DOC_TTL);
  return { text, url: viewUrl(repo, path) };
}

function rawUrl(repo: Repo, path: string): string {
  return `${RAW}/${repo.owner}/${repo.name}/HEAD/${path}`;
}

function docKey(repo: Repo, path: string): string {
  return `cldoc:v1:${repo.owner}/${repo.name}:${path}`;
}

function candidatePaths(repo: Repo): string[] {
  const paths: string[] = [];
  if (repo.directory) paths.push(`${repo.directory}/CHANGELOG.md`);
  paths.push(...CHANGELOG_FILES);
  if (repo.directory) paths.push(`${repo.directory}/CHANGES.md`);
  return paths;
}

function viewUrl(repo: Repo, path: string): string {
  return `${repoUrl(repo)}/blob/HEAD/${path}`;
}

type ReleaseEntry = { body: string; url: string; tag: string };

function apiHeaders(deps: Deps): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": USER_AGENT,
    "x-github-api-version": "2022-11-28",
  };
  if (deps.githubToken) headers.authorization = `Bearer ${deps.githubToken}`;
  return headers;
}

/**
 * GitHub answers a rate-limited request with 403/429. Remember that for a few
 * minutes so a burst of reports does not keep hammering a closed door.
 */
const LIMIT_KEY = "ghlimit:v1";
const LIMIT_TTL = 5 * 60;

async function rateLimited(deps: Deps): Promise<boolean> {
  return (await deps.cache.get<boolean>(LIMIT_KEY)) === true;
}

async function callApi(url: string, deps: Deps): Promise<Response | null> {
  if (await rateLimited(deps)) return null;
  try {
    const response = await (deps.fetcher ?? fetch)(url, { headers: apiHeaders(deps) });
    if (response.status === 403 || response.status === 429) {
      await deps.cache.put(LIMIT_KEY, true, LIMIT_TTL);
      return null;
    }
    return response;
  } catch {
    return null;
  }
}

function toEntry(release: Record<string, unknown>, repo: Repo): ReleaseEntry | null {
  if (release.draft === true) return null;
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  if (!tag) return null;
  return {
    tag,
    body: typeof release.body === "string" ? release.body.replace(/\r\n/g, "\n") : "",
    url:
      typeof release.html_url === "string"
        ? release.html_url
        : `${repoUrl(repo)}/releases/tag/${tag}`,
  };
}

/** The most recent releases, keyed by the version their tag refers to. */
async function loadReleases(
  pkg: string,
  repo: Repo,
  deps: Deps,
): Promise<Map<string, ReleaseEntry>> {
  const key = `ghrel:v1:${repo.owner}/${repo.name}:${pkg}`;
  const hit = await deps.cache.get<Record<string, ReleaseEntry>>(key);
  if (hit) return new Map(Object.entries(hit));

  const entries: Record<string, ReleaseEntry> = {};
  const response = await callApi(
    `${API}/repos/${repo.owner}/${repo.name}/releases?per_page=100`,
    deps,
  );

  if (response?.ok) {
    const list = await response.json().catch(() => null);
    if (Array.isArray(list)) {
      for (const item of list) {
        const release = item as Record<string, unknown>;
        if (release.prerelease === true) continue;
        const entry = toEntry(release, repo);
        if (!entry) continue;
        const version = versionFromTag(entry.tag, pkg);
        if (version && !entries[version]) entries[version] = entry;
      }
    }
  }

  // Short TTL on an empty result so a rate-limited minute is not cached for
  // hours, long TTL once we actually have releases.
  await deps.cache.put(key, entries, Object.keys(entries).length > 0 ? DOC_TTL : 15 * 60);
  return new Map(Object.entries(entries));
}

const MAX_TAG_LOOKUPS = 6;
/** Workers allow six connections waiting on response headers at a time. */
const TAG_CONCURRENCY = 4;

/**
 * Templates to try when asking for one specific release, `{v}` standing in for
 * the version. A tag already seen in this repo is by far the best guess.
 */
function tagShapes(pkg: string, seen: ReleaseEntry[]): string[] {
  const shapes: string[] = [];
  for (const entry of seen) {
    const version = versionFromTag(entry.tag, pkg);
    if (!version) continue;
    const shape = entry.tag.replace(version, "{v}");
    if (shape.includes("{v}") && !shapes.includes(shape)) shapes.push(shape);
    if (shapes.length >= 2) break;
  }
  const unscoped = pkg.includes("/") ? pkg.slice(pkg.indexOf("/") + 1) : pkg;
  for (const fallback of ["v{v}", "{v}", `${pkg}@{v}`, `${unscoped}@{v}`]) {
    if (!shapes.includes(fallback)) shapes.push(fallback);
  }
  return shapes;
}

/**
 * Look up a single release by tag, learning which tag shape this repo uses so
 * later versions cost one request instead of four.
 */
async function fetchReleaseByTag(
  pkg: string,
  repo: Repo,
  version: string,
  shapes: string[],
  deps: Deps,
): Promise<ReleaseEntry | null> {
  const shapeKey = `ghtag:v1:${repo.owner}/${repo.name}:${pkg}`;
  const learned = await deps.cache.get<string>(shapeKey);
  const ordered = learned ? [learned, ...shapes.filter((s) => s !== learned)] : shapes;
  const attempts = learned ? ordered.slice(0, 1) : ordered;

  for (const shape of attempts) {
    const tag = shape.replace("{v}", version);
    const response = await callApi(
      `${API}/repos/${repo.owner}/${repo.name}/releases/tags/${encodeURIComponent(tag)}`,
      deps,
    );
    if (!response) return null; // rate limited; stop trying
    if (!response.ok) continue;

    const body = await response.json().catch(() => null);
    if (!body || typeof body !== "object") continue;
    const entry = toEntry(body as Record<string, unknown>, repo);
    if (!entry) continue;

    await deps.cache.put(shapeKey, shape, SOURCE_TTL);
    return entry;
  }
  return null;
}

function noteKey(pkg: string, version: string): string {
  return `note:v1:${pkg}:${version}`;
}
