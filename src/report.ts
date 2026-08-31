import type { Cache } from "./lib/cache";
import { type Dep, type SkippedDep, parseManifest } from "./lib/manifest";
import { fetchPackageFacts, pooled } from "./lib/npm";
import { type Upgrade, analyze } from "./lib/version";

export type RowError = "not_found" | "no_releases" | "upstream_error" | "unresolvable";

export type Row = {
  name: string;
  alias?: string;
  scope: Dep["scope"];
  range: string;
  description?: string;
  /** Null when the declared range already permits nothing newer. */
  upgrade: Upgrade | null;
  /** Set when the package could not be resolved at all. */
  error?: RowError;
  /** False when we have no repository to read release notes from. */
  hasRepo: boolean;
};

export type Summary = {
  total: number;
  major: number;
  minor: number;
  patch: number;
  current: number;
  unresolved: number;
  /** Upgrades that the declared range does not already permit. */
  needsManifestEdit: number;
};

export type Report = {
  version: 1;
  packageName?: string;
  createdAt: number;
  rows: Row[];
  skipped: SkippedDep[];
  summary: Summary;
  /** Set when the manifest had more dependencies than one report will check. */
  truncatedAt?: number;
};

/** Workers allow six connections waiting on response headers at a time. */
const CONCURRENCY = 6;

/** One registry lookup per dependency, so a report has to have an upper bound. */
const MAX_DEPS = 150;

export async function buildReport(
  input: string,
  cache: Cache,
  fetcher: typeof fetch = fetch,
): Promise<Report> {
  const { packageName, deps, skipped } = parseManifest(input);

  const checked = deps.slice(0, MAX_DEPS);
  const rows = await pooled(checked, CONCURRENCY, (dep) => resolveRow(dep, cache, fetcher));
  rows.sort(compareRows);

  return {
    version: 1,
    packageName,
    createdAt: Date.now(),
    rows,
    skipped: [
      ...skipped,
      ...deps.slice(MAX_DEPS).map((dep) => ({
        name: dep.name,
        range: dep.range,
        scope: dep.scope,
        reason: "over the per-report limit",
      })),
    ],
    summary: summarize(rows),
    truncatedAt: deps.length > MAX_DEPS ? MAX_DEPS : undefined,
  };
}

async function resolveRow(dep: Dep, cache: Cache, fetcher: typeof fetch): Promise<Row> {
  const base: Row = {
    name: dep.name,
    alias: dep.alias,
    scope: dep.scope,
    range: dep.range,
    upgrade: null,
    hasRepo: false,
  };

  const result = await fetchPackageFacts(dep.name, cache, fetcher);
  if (!result.ok) return { ...base, error: result.reason };

  const { facts } = result;
  try {
    return {
      ...base,
      description: facts.description,
      upgrade: analyze(dep.range, facts),
      hasRepo: facts.repo !== null,
    };
  } catch {
    return { ...base, error: "unresolvable", hasRepo: facts.repo !== null };
  }
}

const SEVERITY_ORDER = { major: 0, minor: 1, patch: 2, none: 3 } as const;

/** Most urgent first: majors, then minors, then patches, then everything else. */
function compareRows(a: Row, b: Row): number {
  const rank = (row: Row) =>
    row.upgrade ? SEVERITY_ORDER[row.upgrade.severity] : row.error ? 5 : 4;
  const diff = rank(a) - rank(b);
  if (diff !== 0) return diff;

  // Within a severity, the most stale package is the most interesting.
  const behind = (row: Row) => row.upgrade?.versionsBehind ?? 0;
  const staleness = behind(b) - behind(a);
  if (staleness !== 0) return staleness;

  return a.name.localeCompare(b.name);
}

function summarize(rows: Row[]): Summary {
  const summary: Summary = {
    total: rows.length,
    major: 0,
    minor: 0,
    patch: 0,
    current: 0,
    unresolved: 0,
    needsManifestEdit: 0,
  };

  for (const row of rows) {
    if (row.error) summary.unresolved++;
    else if (!row.upgrade) summary.current++;
    else {
      if (row.upgrade.severity === "major") summary.major++;
      else if (row.upgrade.severity === "minor") summary.minor++;
      else if (row.upgrade.severity === "patch") summary.patch++;
      if (row.upgrade.needsManifestEdit) summary.needsManifestEdit++;
    }
  }

  return summary;
}

const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Unguessable id, so a saved report is effectively unlisted. */
export function newReportId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}
