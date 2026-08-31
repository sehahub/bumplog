import type { Cache } from "./cache";
import { type Repo, parseRepository } from "./repo";
import { sortStable } from "./version";

const REGISTRY = "https://registry.npmjs.org";
export const USER_AGENT = "bumplog/0.1 (dependency changelog reader)";

/** Full metadata is up to ~7MB, so a reduced form is what gets cached. */
export type PackageFacts = {
  name: string;
  description?: string;
  homepage?: string;
  /** Published stable versions, ascending. */
  stable: string[];
  /** Publish time per stable version. */
  time: Record<string, string>;
  latestTag?: string;
  /** Only the versions that carry a deprecation message. */
  deprecations: Record<string, string>;
  repo: Repo | null;
};

export type FactsResult =
  | { ok: true; facts: PackageFacts }
  | { ok: false; reason: "not_found" | "no_releases" | "upstream_error" };

const FACTS_TTL = 6 * 60 * 60;
const MISS_TTL = 15 * 60;

/**
 * npm package names: optional `@scope/`, then a name of URL-safe characters.
 * Validated before it reaches a URL or a cache key.
 */
const VALID_NAME = /^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/;

export function isValidPackageName(name: string): boolean {
  return name.length > 0 && name.length <= 214 && VALID_NAME.test(name);
}

export async function fetchPackageFacts(
  name: string,
  cache: Cache,
  fetcher: typeof fetch = fetch,
): Promise<FactsResult> {
  if (!isValidPackageName(name)) return { ok: false, reason: "not_found" };

  const key = `npm:v1:${name}`;
  const hit = await cache.get<FactsResult>(key);
  if (hit) return hit;

  const result = await loadFacts(name, fetcher);
  // Cache misses too, so a typo'd name in a big manifest is not re-fetched.
  await cache.put(key, result, result.ok ? FACTS_TTL : MISS_TTL);
  return result;
}

async function loadFacts(name: string, fetcher: typeof fetch): Promise<FactsResult> {
  let response: Response;
  try {
    response = await fetcher(`${REGISTRY}/${encodeURIComponent(name)}`, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
    });
  } catch {
    return { ok: false, reason: "upstream_error" };
  }

  if (response.status === 404) return { ok: false, reason: "not_found" };
  if (!response.ok) return { ok: false, reason: "upstream_error" };

  let doc: RegistryDoc;
  try {
    doc = (await response.json()) as RegistryDoc;
  } catch {
    return { ok: false, reason: "upstream_error" };
  }

  const facts = reduce(name, doc);
  if (!facts) return { ok: false, reason: "no_releases" };
  return { ok: true, facts };
}

type RegistryVersion = {
  repository?: unknown;
  deprecated?: unknown;
  description?: unknown;
  homepage?: unknown;
};

type RegistryDoc = {
  name?: unknown;
  description?: unknown;
  homepage?: unknown;
  repository?: unknown;
  "dist-tags"?: Record<string, unknown>;
  versions?: Record<string, RegistryVersion>;
  time?: Record<string, unknown>;
};

function reduce(name: string, doc: RegistryDoc): PackageFacts | null {
  const versions = doc.versions;
  if (!versions || typeof versions !== "object") return null;

  const stable = sortStable(Object.keys(versions));
  if (stable.length === 0) return null;

  const latestRaw = doc["dist-tags"]?.latest;
  const latestTag = typeof latestRaw === "string" ? latestRaw : undefined;

  const time: Record<string, string> = {};
  const rawTime = doc.time;
  if (rawTime && typeof rawTime === "object") {
    for (const version of stable) {
      const value = rawTime[version];
      if (typeof value === "string") time[version] = value;
    }
  }

  const deprecations: Record<string, string> = {};
  for (const version of stable) {
    const flag = versions[version]?.deprecated;
    if (typeof flag === "string" && flag) deprecations[version] = flag;
    else if (flag === true) deprecations[version] = "This version is deprecated.";
  }

  // Ownership moves over time, so the newest release is the best source for
  // where the code lives now. Fall back to the document-level field.
  const newest = stable[stable.length - 1];
  const repo =
    parseRepository(versions[latestTag ?? newest]?.repository) ??
    parseRepository(versions[newest]?.repository) ??
    parseRepository(doc.repository);

  return {
    name,
    description: str(doc.description) ?? str(versions[newest]?.description),
    homepage: str(doc.homepage) ?? str(versions[newest]?.homepage),
    stable,
    time,
    latestTag,
    deprecations,
    repo,
  };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Run `task` over `items` with a bounded number of in-flight requests. */
export async function pooled<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}
