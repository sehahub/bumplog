import { Hono } from "hono";
import semver from "semver";
import { kvCache } from "./lib/cache";
import { ManifestError } from "./lib/manifest";
import { fetchNotes } from "./lib/notes";
import { fetchPackageFacts, isValidPackageName } from "./lib/npm";
import { notableReleases } from "./lib/version";
import { type Report, buildReport, newReportId } from "./report";
import { AboutView, HomeView } from "./views/home";
import { page } from "./views/layout";
import { NotesView } from "./views/notes";
import { PackageView, PopularView } from "./views/package";
import { ReportView } from "./views/report";

export type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
  /** Optional. Without it GitHub allows 60 API calls an hour for the whole site. */
  GITHUB_TOKEN?: string;
};

const app = new Hono<{ Bindings: Env }>();

/** Reports are addressed by an unguessable id, capped so the table stays small. */
const MAX_MANIFEST_BYTES = 200_000;
const REPORT_TTL_DAYS = 90;

app.get("/", (c) =>
  page(
    c,
    {
      title: "Bumplog — see what changed before you bump a dependency",
      description:
        "Paste a package.json and get every dependency's real release notes and breaking changes between the version you declare and the latest published.",
      canonical: origin(c.req.url),
    },
    <HomeView />,
  ),
);

app.get("/about", (c) =>
  page(
    c,
    {
      title: "About Bumplog",
      description: "Where Bumplog's version data and release notes come from.",
      canonical: `${origin(c.req.url)}/about`,
    },
    <AboutView />,
  ),
);

app.post("/analyze", async (c) => {
  const form = await c.req.formData();
  const manifest = String(form.get("manifest") ?? "");

  if (manifest.length > MAX_MANIFEST_BYTES) {
    return page(
      c,
      homeMeta(),
      <HomeView error="That file is too large. Paste just the package.json." />,
      413,
    );
  }

  const cache = kvCache(c.env.CACHE, (p) => c.executionCtx.waitUntil(p));

  let report: Report;
  try {
    report = await buildReport(manifest, cache);
  } catch (error) {
    if (error instanceof ManifestError) {
      return page(c, homeMeta(), <HomeView error={error.message} value={manifest} />, 400);
    }
    throw error;
  }

  const id = newReportId();
  await c.env.DB.prepare("INSERT INTO reports (id, created_at, payload) VALUES (?, ?, ?)")
    .bind(id, report.createdAt, JSON.stringify(report))
    .run();

  c.executionCtx.waitUntil(recordLookups(c.env.DB, report));

  return c.redirect(`/r/${id}`, 303);
});

app.get("/r/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT payload FROM reports WHERE id = ?")
    .bind(id)
    .first<{ payload: string }>();

  if (!row) return c.notFound();

  const report = JSON.parse(row.payload) as Report;
  const shareUrl = `${origin(c.req.url)}/r/${id}`;

  return page(
    c,
    {
      title: report.packageName
        ? `${report.packageName} dependency report — Bumplog`
        : "Dependency report — Bumplog",
      description: `${report.summary.major} major, ${report.summary.minor} minor and ${report.summary.patch} patch updates across ${report.summary.total} dependencies.`,
      // A report reflects one person's manifest; it is not search material.
      noindex: true,
    },
    <ReportView report={report} shareUrl={shareUrl} />,
  );
});

app.get("/notes", async (c) => {
  const pkg = c.req.query("pkg") ?? "";
  const from = c.req.query("from") ?? "";
  const to = c.req.query("to") ?? "";

  // semver throws on a malformed version, and these arrive from the query.
  if (!isValidPackageName(pkg) || !semver.valid(from) || !semver.valid(to)) {
    return c.text("bad request", 400);
  }

  const cache = kvCache(c.env.CACHE, (p) => c.executionCtx.waitUntil(p));
  const result = await fetchPackageFacts(pkg, cache);
  if (!result.ok || !result.facts.repo) {
    return c.html('<p class="empty">No repository is linked from this package.</p>');
  }

  const versions = notableReleases(result.facts.stable, from, to);
  const lookup = await fetchNotes(pkg, result.facts.repo, versions, {
    cache,
    githubToken: c.env.GITHUB_TOKEN,
  });

  return c.html(
    String(
      <NotesView
        lookup={lookup}
        repoUrl={`https://github.com/${result.facts.repo.owner}/${result.facts.repo.name}`}
      />,
    ),
  );
});

app.get("/npm/:name{.+}", async (c) => {
  const name = c.req.param("name");
  if (!isValidPackageName(name)) return c.notFound();

  const cache = kvCache(c.env.CACHE, (p) => c.executionCtx.waitUntil(p));
  const result = await fetchPackageFacts(name, cache);
  if (!result.ok) return c.notFound();

  const { facts } = result;
  const latest = facts.stable[facts.stable.length - 1];

  return page(
    c,
    {
      title: `${name} versions and changelog — Bumplog`,
      description:
        facts.description ??
        `Every published version of ${name}, with release dates and links to its changelog.`,
      canonical: `${origin(c.req.url)}/npm/${name}`,
    },
    <PackageView facts={facts} latest={latest} />,
  );
});

app.get("/popular", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT name, hits FROM package_lookups ORDER BY hits DESC LIMIT 100",
  ).all<{ name: string; hits: number }>();

  return page(
    c,
    {
      title: "Most checked packages — Bumplog",
      description: "The npm packages people look up most often on Bumplog.",
      canonical: `${origin(c.req.url)}/popular`,
    },
    <PopularView packages={results ?? []} />,
  );
});

app.get("/sitemap.xml", async (c) => {
  const base = origin(c.req.url);
  const { results } = await c.env.DB.prepare(
    "SELECT name FROM package_lookups ORDER BY hits DESC LIMIT 5000",
  ).all<{ name: string }>();

  const urls = [
    `${base}/`,
    `${base}/about`,
    `${base}/popular`,
    ...(results ?? []).map((row) => `${base}/npm/${encodeURI(row.name)}`),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n")}
</urlset>`;

  return c.body(body, 200, { "content-type": "application/xml; charset=utf-8" });
});

app.get("/healthz", (c) => c.json({ ok: true }));

app.notFound((c) =>
  page(
    c,
    { title: "Not found — Bumplog", description: "That page does not exist.", noindex: true },
    <div class="hero">
      <h1>Not found</h1>
      <p>
        That page does not exist. <a href="/">Start a new report</a>.
      </p>
    </div>,
    404,
  ),
);

/**
 * Nightly cleanup. Reports are a convenience for sharing a link, not storage,
 * so they expire.
 */
async function purgeOldReports(env: Env): Promise<void> {
  const cutoff = Date.now() - REPORT_TTL_DAYS * 24 * 60 * 60 * 1000;
  await env.DB.prepare("DELETE FROM reports WHERE created_at < ?").bind(cutoff).run();
}

async function recordLookups(db: D1Database, report: Report): Promise<void> {
  const resolved = report.rows.filter((row) => !row.error);
  if (resolved.length === 0) return;

  const now = Date.now();
  const statement = db.prepare(
    `INSERT INTO package_lookups (name, hits, last_seen) VALUES (?, 1, ?)
     ON CONFLICT(name) DO UPDATE SET hits = hits + 1, last_seen = excluded.last_seen`,
  );

  await db.batch(resolved.map((row) => statement.bind(row.name, now)));
}

function homeMeta() {
  return {
    title: "Bumplog — see what changed before you bump a dependency",
    description: "Paste a package.json and read the release notes that matter.",
    noindex: true,
  };
}

function origin(url: string): string {
  return new URL(url).origin;
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await purgeOldReports(env);
  },
};
