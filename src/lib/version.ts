import semver from "semver";

export type Severity = "major" | "minor" | "patch" | "none";

export type VersionFacts = {
  /** Every published version, ascending, prereleases excluded. */
  stable: string[];
  /** Publish timestamps keyed by version, when the registry provides them. */
  time?: Record<string, string>;
  /** The `latest` dist-tag. */
  latestTag?: string;
  deprecations?: Record<string, string>;
};

export type Upgrade = {
  /** Oldest published version the declared range permits — what you could be on. */
  from: string;
  /** Newest published version the declared range already permits. */
  rangeMax: string;
  /** Newest stable version published. */
  latest: string;
  severity: Severity;
  /** True when `latest` falls outside the range, so package.json must change. */
  needsManifestEdit: boolean;
  /** Stable releases published after `from`, up to and including `latest`. */
  versionsBehind: number;
  fromPublished?: string;
  latestPublished?: string;
  /** Deprecation message on the version currently permitted, if any. */
  deprecated?: string;
};

export class VersionError extends Error {}

/**
 * Compare a declared range against what the registry actually has.
 * Returns null when the range floor is already the newest thing published.
 */
export function analyze(range: string, facts: VersionFacts): Upgrade | null {
  const stable = facts.stable;
  if (stable.length === 0) throw new VersionError("no stable releases published");

  const floor = semver.minVersion(range)?.version;
  if (!floor) throw new VersionError(`unresolvable range: ${range}`);

  const latest = pickLatest(facts);
  const satisfying = stable.filter((v) => semver.satisfies(v, range));

  // The range's arithmetic floor is often a version nobody ever published —
  // `^5.0.0` of typescript, whose 5.0 line starts at 5.0.2. The oldest release
  // that actually exists is what someone could be running.
  const from = satisfying.length > 0 ? satisfying[0] : floor;
  const rangeMax = satisfying.length > 0 ? satisfying[satisfying.length - 1] : from;

  if (semver.gte(from, latest)) return null;

  const severity = severityOf(from, latest);
  const versionsBehind = stable.filter(
    (v) => semver.gt(v, from) && semver.lte(v, latest),
  ).length;

  return {
    from,
    rangeMax,
    latest,
    severity,
    needsManifestEdit: !semver.satisfies(latest, range),
    versionsBehind,
    fromPublished: facts.time?.[from],
    latestPublished: facts.time?.[latest],
    deprecated: facts.deprecations?.[rangeMax],
  };
}

/**
 * Prefer the `latest` dist-tag, but only when it is a stable release that we
 * know about — some packages point `latest` at a prerelease.
 */
function pickLatest(facts: VersionFacts): string {
  const tagged = facts.latestTag;
  if (tagged && facts.stable.includes(tagged)) return tagged;
  return facts.stable[facts.stable.length - 1];
}

function severityOf(from: string, to: string): Severity {
  if (semver.eq(from, to)) return "none";
  if (semver.major(from) !== semver.major(to)) return "major";
  // 0.x releases signal breakage in the minor slot.
  if (semver.major(to) === 0 && semver.minor(from) !== semver.minor(to)) return "major";
  if (semver.minor(from) !== semver.minor(to)) return "minor";
  return "patch";
}

/** Stable releases strictly after `from`, up to and including `to`, ascending. */
export function releasesBetween(stable: string[], from: string, to: string): string[] {
  return stable.filter((v) => semver.gt(v, from) && semver.lte(v, to));
}

/**
 * The releases worth reading notes for. Every major in the window plus the
 * newest release, capped so a package that is 200 versions behind stays
 * readable.
 */
export function notableReleases(stable: string[], from: string, to: string, cap = 12): string[] {
  const window = releasesBetween(stable, from, to);
  if (window.length <= cap) return window;

  const majors = new Set<string>();
  for (const v of window) {
    // First release of each major line is where breaking changes land.
    const major = semver.major(v);
    const first = window.find((w) => semver.major(w) === major);
    if (first) majors.add(first);
  }
  majors.add(window[window.length - 1]);

  const picked = [...majors].sort(semver.compare);
  if (picked.length >= cap) return picked.slice(-cap);

  // Fill the remaining budget with the newest releases, which are the ones
  // most likely to matter.
  const rest = window.filter((v) => !majors.has(v)).slice(-(cap - picked.length));
  return [...new Set([...picked, ...rest])].sort(semver.compare);
}

export function sortStable(versions: string[]): string[] {
  return versions
    .filter((v) => semver.valid(v) !== null && semver.prerelease(v) === null)
    .sort(semver.compare);
}
