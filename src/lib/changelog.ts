import semver from "semver";

export type ChangelogSection = {
  version: string;
  /** Heading depth, 1 for `#`. */
  level: number;
  /** Heading text with markdown link syntax removed. */
  title: string;
  body: string;
};

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * A semver in heading position. Link destinations are stripped before this
 * runs, so compare URLs like `.../v1.2.2...v1.2.3` cannot leak a false match.
 */
const VERSION_IN_HEADING = /(?:^|[^\w.])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?![\w.])/;

/** Split a CHANGELOG.md into one section per released version. */
export function splitChangelog(markdown: string): ChangelogSection[] {
  const lines = markdown.split(/\r?\n/);
  const headings: { index: number; level: number; title: string; version?: string }[] = [];

  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1];
      else if (line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const match = HEADING.exec(line);
    if (!match) continue;

    const title = cleanHeading(match[2]);
    headings.push({
      index: i,
      level: match[1].length,
      title,
      version: versionOf(title),
    });
  }

  const sections: ChangelogSection[] = [];
  for (let h = 0; h < headings.length; h++) {
    const heading = headings[h];
    if (!heading.version) continue;

    // The section runs to the next version heading at any depth, or to the
    // next heading that outdents past this one — whichever comes first.
    let end = lines.length;
    for (let n = h + 1; n < headings.length; n++) {
      const next = headings[n];
      if (next.version || next.level < heading.level) {
        end = next.index;
        break;
      }
    }

    sections.push({
      version: heading.version,
      level: heading.level,
      title: heading.title,
      body: lines.slice(heading.index + 1, end).join("\n").trim(),
    });
  }

  return sections;
}

/** Look up one version's section, tolerating `v` prefixes and build metadata. */
export function sectionFor(
  sections: ChangelogSection[],
  version: string,
): ChangelogSection | undefined {
  return sections.find((s) => semver.valid(s.version) && semver.eq(s.version, version));
}

/** `Major Changes` is what changesets emits for a breaking release. */
const BREAKING_HEADING = /breaking\s*[- ]?\s*changes?|major\s+changes?/i;
const BREAKING_INLINE = /\bBREAKING[ -]CHANGE[S]?\b/;
/** Conventional commits mark a breaking change with `!` before the colon. */
const BANG_SCOPE = /^\s*[-*+]?\s*(?:\*\*)?[\w$@/ .-]*!(?:\*\*)?:/;
const REMOVED_HEADING = /^(removed|removals?)$/i;

const BULLET = /^\s*[-*+]\s+/;

/**
 * Pull the breaking changes out of a section body, one entry per bullet.
 *
 * Entries wrap onto continuation lines, so lines are accumulated until a blank
 * line, the next bullet, or a heading closes the entry — otherwise a single
 * wrapped note would be counted several times over.
 */
export function breakingChanges(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const found: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const cleaned = cleanBullet(current.join(" ").replace(/\s+/g, " ").trim());
    current = [];
    if (cleaned && !found.includes(cleaned)) found.push(cleaned);
  };

  let fence: string | null = null;
  let underBreakingHeading = false;
  let breakingHeadingLevel = 0;

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (fence === null) {
        // A fenced example belongs to the entry above it, not to a new one.
        flush();
        fence = fenceMatch[1];
      } else if (line.trimStart().startsWith(fence)) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue;

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      const title = cleanHeading(heading[2]);
      if (BREAKING_HEADING.test(title) || REMOVED_HEADING.test(title.trim())) {
        underBreakingHeading = true;
        breakingHeadingLevel = level;
      } else if (level <= breakingHeadingLevel) {
        underBreakingHeading = false;
      }
      continue;
    }

    const text = line.trim();
    if (!text) {
      flush();
      continue;
    }

    if (BULLET.test(line)) {
      flush();
      if (underBreakingHeading || BREAKING_INLINE.test(text) || BANG_SCOPE.test(line)) {
        current.push(text);
      }
      continue;
    }

    if (current.length > 0) {
      current.push(text); // continuation of the entry above
      continue;
    }
    // Indented prose belongs to the bullet above it, which is already closed.
    if (/^\s{2,}/.test(line)) continue;

    if (underBreakingHeading || BREAKING_INLINE.test(text)) {
      current.push(text); // a prose note with no bullet
    }
  }

  flush();
  return found;
}

export function hasBreakingChanges(body: string): boolean {
  return breakingChanges(body).length > 0;
}

export type Guide = { label: string; url: string };

/** Words that mark a link as the thing you read before upgrading. */
const GUIDE_HINT = /migrat|upgrad|breaking[\s-]?change/i;
const MARKDOWN_LINK = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const BARE_URL = /(?:^|[\s(])(https?:\/\/[^\s<)"']+)/g;

/**
 * Plenty of projects put no breaking changes in their release notes at all —
 * turbo lists PR titles, TanStack Query and Storybook just say "read the
 * migration guide". The link they point at is then the most useful thing on
 * the page, so it is worth pulling out.
 */
export function migrationGuides(body: string, limit = 3): Guide[] {
  const found: Guide[] = [];
  const seen = new Set<string>();

  const add = (label: string, url: string) => {
    const clean = url.replace(/[.,;:)\]]+$/, "");
    if (seen.has(clean) || NOT_A_GUIDE.test(clean)) return;
    if (!GUIDE_HINT.test(label) && !GUIDE_HINT.test(clean)) return;
    seen.add(clean);
    found.push({ label: cleanLabel(label) || clean, url: clean });
  };

  for (const match of body.matchAll(MARKDOWN_LINK)) add(match[1], match[2]);

  // A bare url is often introduced by the sentence above it, so the preceding
  // words stand in for a label.
  for (const match of body.matchAll(BARE_URL)) {
    const before = body.slice(Math.max(0, match.index - 60), match.index);
    add(GUIDE_HINT.test(before) ? lastPhrase(before) : "", match[1]);
  }

  return found.slice(0, limit);
}

/**
 * A guide is a document, never a pull request, issue, commit or diff — but
 * changelogs are full of entries like "chore: Upgrade js-yaml (#13427)" whose
 * titles trip the same keywords.
 */
const NOT_A_GUIDE = /\/(?:pull|issues|commit|commits|compare|releases)\//;

/** The trailing words of a sentence, used as a link label. */
function lastPhrase(text: string): string {
  const words = text.replace(/[:\s]+$/, "").split(/[.\n]/).pop()?.trim() ?? "";
  return words.split(/\s+/).slice(-6).join(" ");
}

/** Drop issue references and unbalanced brackets left by the surrounding markdown. */
function cleanLabel(label: string): string {
  return label
    .replace(/\(?\[?#\d+\]?\)?/g, "")
    .replace(/^[^\w`]+|[([\s]+$/g, "")
    .trim();
}

/** `[text](url)` -> `text`, and drop trailing anchor cruft. */
function cleanHeading(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/#+\s*$/, "")
    .trim();
}

/**
 * changesets prefixes every entry with the PR, the commit and a thank-you:
 * `- [#123](url) [`abc1234`](url) Thanks [@someone](url)! - the actual note`
 */
const CHANGESET_ATTRIBUTION =
  /^(?:\[#\d+\]\([^)]*\)\s*)?(?:\[`[0-9a-f]+`\]\([^)]*\)\s*)?(?:Thanks(?:\s*\[@[^\]]+\]\([^)]*\),?)+!?\s*[-–]\s*)/;

function cleanBullet(text: string): string {
  return text
    .replace(/^[-*+]\s+/, "")
    .replace(/^BREAKING[ -]CHANGE[S]?:\s*/i, "")
    .replace(CHANGESET_ATTRIBUTION, "")
    .replace(/\(\[[0-9a-f]{6,}\]\([^)]*\)\)/g, "")
    .replace(/\(\[#\d+\]\([^)]*\)\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

function versionOf(title: string): string | undefined {
  const match = VERSION_IN_HEADING.exec(title);
  if (!match) return undefined;
  return semver.valid(match[1]) ? match[1] : undefined;
}
