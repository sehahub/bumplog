export type Repo = {
  owner: string;
  name: string;
  /** Subdirectory for a package inside a monorepo, without leading/trailing slashes. */
  directory?: string;
};

/** Only GitHub is resolvable for changelogs today; everything else returns null. */
export function parseRepository(field: unknown): Repo | null {
  if (typeof field === "string") return fromString(field);
  if (typeof field === "object" && field !== null) {
    const obj = field as Record<string, unknown>;
    const url = typeof obj.url === "string" ? obj.url : undefined;
    if (!url) return null;
    const repo = fromString(url);
    if (!repo) return null;
    const directory = typeof obj.directory === "string" ? trimSlashes(obj.directory) : undefined;
    return directory ? { ...repo, directory } : repo;
  }
  return null;
}

const SHORTHAND = /^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:#.*)?$/;

function fromString(raw: string): Repo | null {
  const value = raw.trim();
  if (!value) return null;

  // Other forges and gists have no changelog path we can rely on.
  if (/^(gist|bitbucket|gitlab):/i.test(value)) return null;

  const shorthand = SHORTHAND.exec(value);
  if (shorthand) return { owner: shorthand[1], name: shorthand[2] };

  const url = toUrl(value);
  if (!url) return null;
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const name = parts[1].replace(/\.git$/, "");
  if (!owner || !name) return null;

  // `.../tree/<ref>/packages/x` carries the monorepo path in the URL itself.
  const treeAt = parts.indexOf("tree");
  const directory =
    treeAt === 2 && parts.length > 4 ? trimSlashes(parts.slice(4).join("/")) : undefined;

  return directory ? { owner, name, directory } : { owner, name };
}

function toUrl(value: string): URL | null {
  // Strip the protocol decorations npm publishes: git+https://, git://,
  // git+ssh://git@host/, ssh://git@host/.
  let normalized = value
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@([^:]+):/, "https://$1/");

  if (!/^https?:\/\//.test(normalized)) normalized = `https://${normalized}`;

  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export function repoUrl(repo: Repo): string {
  return `https://github.com/${repo.owner}/${repo.name}`;
}
