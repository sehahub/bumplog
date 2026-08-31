import semver from "semver";

/**
 * Decide whether a git tag names a release of `pkg`, and which version.
 *
 * Monorepos tag per package (`astro@5.0.0`), single repos tag bare (`v5.0.0`),
 * and some do both. A bare tag is accepted for any package, since in a single
 * repo it is the only thing on offer.
 */
export function versionFromTag(tag: string, pkg: string): string | null {
  const raw = tag.trim();
  if (!raw) return null;

  const bare = stripV(raw);
  if (semver.valid(bare)) return semver.valid(bare);

  const separator = raw.lastIndexOf("@");
  if (separator > 0) {
    const prefix = raw.slice(0, separator);
    const version = stripV(raw.slice(separator + 1));
    if (namesPackage(prefix, pkg) && semver.valid(version)) return semver.valid(version);
    return null;
  }

  // `some-pkg-v1.2.3` / `some-pkg_v1.2.3`
  const dashed = /^(.*?)[-_]v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(raw);
  if (dashed && namesPackage(dashed[1], pkg) && semver.valid(dashed[2])) {
    return semver.valid(dashed[2]);
  }

  return null;
}

function stripV(value: string): string {
  return value.replace(/^v/i, "");
}

function namesPackage(candidate: string, pkg: string): boolean {
  const normalize = (v: string) => v.replace(/^@/, "").toLowerCase();
  const unscoped = pkg.includes("/") ? pkg.slice(pkg.indexOf("/") + 1) : pkg;
  const options = [pkg, unscoped].map(normalize);
  return options.includes(normalize(candidate));
}
