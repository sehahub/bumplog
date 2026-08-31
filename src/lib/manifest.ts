import semver from "semver";

export type DepScope =
  | "dependencies"
  | "devDependencies"
  | "peerDependencies"
  | "optionalDependencies";

export type Dep = {
  /** Name to look up in the npm registry (resolves `npm:` aliases). */
  name: string;
  /** Name as written in the manifest. Differs from `name` for aliases. */
  alias?: string;
  range: string;
  scope: DepScope;
};

export type SkippedDep = {
  name: string;
  range: string;
  scope: DepScope;
  reason: string;
};

export type ParsedManifest = {
  packageName?: string;
  deps: Dep[];
  skipped: SkippedDep[];
};

export class ManifestError extends Error {}

const SCOPES: DepScope[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** Protocols that don't resolve to a plain registry version range. */
const NON_REGISTRY = [
  { prefix: "workspace:", reason: "workspace protocol" },
  { prefix: "catalog:", reason: "catalog protocol" },
  { prefix: "file:", reason: "local path" },
  { prefix: "link:", reason: "local link" },
  { prefix: "portal:", reason: "local portal" },
  { prefix: "git+", reason: "git dependency" },
  { prefix: "git:", reason: "git dependency" },
  { prefix: "github:", reason: "git dependency" },
  { prefix: "gitlab:", reason: "git dependency" },
  { prefix: "bitbucket:", reason: "git dependency" },
  { prefix: "http:", reason: "url dependency" },
  { prefix: "https:", reason: "url dependency" },
  { prefix: "patch:", reason: "patch protocol" },
];

/** `user/repo` and `user/repo#ref` are shorthand for a GitHub dependency. */
const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+(#.*)?$/;

export function parseManifest(input: string): ParsedManifest {
  const text = input.trim();
  if (!text) throw new ManifestError("Paste a package.json to get started.");

  let json: unknown;
  try {
    json = JSON.parse(stripJsonComments(text));
  } catch {
    throw new ManifestError(
      "That doesn't parse as JSON. Paste the contents of a package.json file.",
    );
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    throw new ManifestError("Expected a JSON object, like a package.json file.");
  }

  const obj = json as Record<string, unknown>;
  const deps: Dep[] = [];
  const skipped: SkippedDep[] = [];
  const seen = new Set<string>();

  for (const scope of SCOPES) {
    const block = obj[scope];
    if (typeof block !== "object" || block === null || Array.isArray(block)) continue;

    for (const [rawName, rawRange] of Object.entries(block as Record<string, unknown>)) {
      if (typeof rawRange !== "string") continue;
      const name = rawName.trim();
      const range = rawRange.trim();
      if (!name) continue;

      // A package listed in several scopes only needs looking up once.
      if (seen.has(name)) continue;
      seen.add(name);

      const classified = classify(name, range);
      if ("reason" in classified) {
        skipped.push({ name, range, scope, reason: classified.reason });
      } else {
        deps.push({ ...classified, scope });
      }
    }
  }

  if (deps.length === 0 && skipped.length === 0) {
    throw new ManifestError(
      "No dependencies found. Make sure the file has a \"dependencies\" or \"devDependencies\" block.",
    );
  }

  const packageName = typeof obj.name === "string" ? obj.name : undefined;
  return { packageName, deps, skipped };
}

function classify(
  name: string,
  range: string,
): { name: string; alias?: string; range: string } | { reason: string } {
  if (!range) return { reason: "empty version" };

  if (range.startsWith("npm:")) {
    // `npm:target@range` — an alias for a different registry package.
    const spec = range.slice(4);
    const at = spec.lastIndexOf("@");
    if (at <= 0) return { reason: "unresolvable alias" };
    const target = spec.slice(0, at);
    const aliasRange = spec.slice(at + 1);
    if (!semver.validRange(aliasRange)) return { reason: "unresolvable alias" };
    return { name: target, alias: name, range: aliasRange };
  }

  for (const { prefix, reason } of NON_REGISTRY) {
    if (range.startsWith(prefix)) return { reason };
  }
  if (GITHUB_SHORTHAND.test(range)) return { reason: "git dependency" };

  if (range === "*" || range === "" || range === "x") return { reason: "wildcard range" };
  if (!semver.validRange(range)) return { reason: "dist-tag or unsupported range" };

  return { name, range };
}

/** package.json is strict JSON, but people paste from JSONC-ish sources. */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}
