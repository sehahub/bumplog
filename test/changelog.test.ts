import { describe, expect, it } from "vitest";
import {
  breakingChanges,
  migrationGuides,
  sectionFor,
  splitChangelog,
} from "../src/lib/changelog";

describe("splitChangelog", () => {
  it("parses keep-a-changelog headings", () => {
    const sections = splitChangelog(`
# Changelog

All notable changes.

## [Unreleased]

## [2.1.0] - 2024-03-01
### Added
- A thing

## [2.0.0] - 2024-01-01
### Removed
- The old thing
`);

    expect(sections.map((s) => s.version)).toEqual(["2.1.0", "2.0.0"]);
    expect(sections[0].body).toContain("A thing");
    expect(sections[0].body).not.toContain("The old thing");
  });

  it("parses conventional-changelog headings without leaking compare links", () => {
    const sections = splitChangelog(`
## [1.4.0](https://github.com/a/b/compare/v1.3.9...v1.4.0) (2024-05-02)

### Features

* add a flag ([abc1234](https://github.com/a/b/commit/abc1234))

## [1.3.9](https://github.com/a/b/compare/v1.3.8...v1.3.9) (2024-04-01)

### Bug Fixes

* stop crashing
`);

    expect(sections.map((s) => s.version)).toEqual(["1.4.0", "1.3.9"]);
    expect(sections[0].body).toContain("add a flag");
    expect(sections[0].body).not.toContain("stop crashing");
  });

  it("does not nest a deeper version heading inside a shallower one", () => {
    // Angular publishes majors at `#` and patches at `##`.
    const sections = splitChangelog(`
# 17.0.0 (2023-11-08)

### Features
* the big one

## 16.2.12 (2023-11-08)

### Bug Fixes
* the small one
`);

    expect(sections.map((s) => s.version)).toEqual(["17.0.0", "16.2.12"]);
    expect(sections[0].body).toContain("the big one");
    expect(sections[0].body).not.toContain("the small one");
  });

  it("ignores headings inside fenced code blocks", () => {
    const sections = splitChangelog(`
## 1.1.0

\`\`\`sh
# 9.9.9 is not a release
npm install
\`\`\`

- real note

## 1.0.0
- older
`);

    expect(sections.map((s) => s.version)).toEqual(["1.1.0", "1.0.0"]);
    expect(sections[0].body).toContain("real note");
  });

  it("accepts a v prefix and rejects dates", () => {
    const sections = splitChangelog(`
## v3.0.1 (2024-01-02)
- note
`);
    expect(sections.map((s) => s.version)).toEqual(["3.0.1"]);
  });

  it("returns nothing for a changelog with no version headings", () => {
    expect(splitChangelog("# Changelog\n\nNothing here yet.")).toEqual([]);
  });
});

describe("sectionFor", () => {
  const sections = splitChangelog("## v2.0.0\n- a\n\n## 1.0.0\n- b\n");

  it("matches regardless of v prefix", () => {
    expect(sectionFor(sections, "2.0.0")?.body).toBe("- a");
  });

  it("returns undefined for an absent version", () => {
    expect(sectionFor(sections, "1.5.0")).toBeUndefined();
  });
});

describe("breakingChanges", () => {
  it("collects bullets under a BREAKING CHANGES heading", () => {
    expect(
      breakingChanges(`
### ⚠ BREAKING CHANGES

* \`render\` was removed, use \`createRoot\`
* node 16 is no longer supported

### Features

* something harmless
`),
    ).toEqual([
      "`render` was removed, use `createRoot`",
      "node 16 is no longer supported",
    ]);
  });

  it("collects bullets under a Removed heading", () => {
    expect(breakingChanges("### Removed\n- the legacy adapter\n")).toEqual([
      "the legacy adapter",
    ]);
  });

  it("collects inline BREAKING CHANGE notes", () => {
    expect(
      breakingChanges("### Features\n\n* new api\n\nBREAKING CHANGE: the old api is gone\n"),
    ).toEqual(["the old api is gone"]);
  });

  it("collects conventional-commit bang scopes", () => {
    expect(
      breakingChanges("### Features\n\n* **core!:** drop the shim\n* **core:** keep the other\n"),
    ).toEqual(["**core!:** drop the shim"]);
  });

  it("strips commit and issue link noise", () => {
    expect(
      breakingChanges(
        "### BREAKING CHANGES\n\n* drop node 16 ([#1234](https://x/y/1234)) ([abc1234](https://x/y/c))\n",
      ),
    ).toEqual(["drop node 16"]);
  });

  it("stops collecting once the heading level pops back out", () => {
    expect(
      breakingChanges(`
### BREAKING CHANGES
* the breaking one

### Bug Fixes
* the safe one
`),
    ).toEqual(["the breaking one"]);
  });

  it("treats a changesets Major Changes heading as breaking", () => {
    expect(
      breakingChanges(`
### Major Changes

- [#12000](https://github.com/a/b/pull/12000) [\`abc1234\`](https://github.com/a/b/commit/abc1234) Thanks [@someone](https://github.com/someone)! - Node 18 is no longer supported

### Minor Changes

- [#12001](https://github.com/a/b/pull/12001) Thanks [@other](https://github.com/other)! - added a flag
`),
    ).toEqual(["Node 18 is no longer supported"]);
  });

  it("strips a multi-author changesets attribution", () => {
    expect(
      breakingChanges(
        "### Major Changes\n\n- [`abc1234`](https://x/c) Thanks [@a](https://x/a), [@b](https://x/b)! - dropped the shim\n",
      ),
    ).toEqual(["dropped the shim"]);
  });

  it("joins a wrapped entry instead of counting each line", () => {
    expect(
      breakingChanges(`
### Major Changes

- The \`renderer\` option was removed
  because it never worked with streaming.
- Node 18 is no longer supported
`),
    ).toEqual([
      "The `renderer` option was removed because it never worked with streaming.",
      "Node 18 is no longer supported",
    ]);
  });

  it("keeps only the summary line of a multi-paragraph entry", () => {
    expect(
      breakingChanges(`
### Major Changes

- Config moved to \`astro.config.mjs\`

  Here is a longer explanation that should not become its own entry.

  \`\`\`js
  export default {}
  \`\`\`

- A second break
`),
    ).toEqual(["Config moved to `astro.config.mjs`", "A second break"]);
  });

  it("finds nothing in an ordinary section", () => {
    expect(breakingChanges("### Bug Fixes\n\n* fix a typo\n")).toEqual([]);
    expect(breakingChanges("### Minor Changes\n\n- a new option\n")).toEqual([]);
    expect(breakingChanges("### Patch Changes\n\n- a fix\n")).toEqual([]);
  });
});

describe("migrationGuides", () => {
  it("finds a bare upgrade-guide url, as turbo publishes it", () => {
    expect(
      migrationGuides(
        "What's Changed\n\nUpgrade guide: https://turbo.build/repo/docs/crafting-your-repository/upgrading\n\n* feat: a thing by @someone",
      ),
    ).toEqual([
      {
        label: "Upgrade guide",
        url: "https://turbo.build/repo/docs/crafting-your-repository/upgrading",
      },
    ]);
  });

  it("finds a markdown migration link, as TanStack Query publishes it", () => {
    expect(
      migrationGuides(
        "Read the [migration guide](https://tanstack.com/query/v5/docs/react/guides/migrating-to-v5) here.",
      ),
    ).toEqual([
      {
        label: "migration guide",
        url: "https://tanstack.com/query/v5/docs/react/guides/migrating-to-v5",
      },
    ]);
  });

  it("matches on the label when the url says nothing", () => {
    expect(
      migrationGuides("Please checkout our [Migration Guide](https://storybook.js.org/docs/8)."),
    ).toEqual([{ label: "Migration Guide", url: "https://storybook.js.org/docs/8" }]);
  });

  it("ignores ordinary links", () => {
    expect(
      migrationGuides(
        "* fix: a thing by @a in https://github.com/o/r/pull/1\n* See [the docs](https://example.com/docs)",
      ),
    ).toEqual([]);
  });

  it("does not repeat a url that appears twice", () => {
    const body =
      "Migration guide: https://x.com/migrating\n\nAgain: [migration](https://x.com/migrating)";
    expect(migrationGuides(body)).toHaveLength(1);
  });

  it("strips punctuation that trails a bare url", () => {
    expect(migrationGuides("See the upgrade guide at https://x.com/upgrading.")[0].url).toBe(
      "https://x.com/upgrading",
    );
  });

  it("caps how many it returns", () => {
    const body = Array.from({ length: 6 }, (_, i) => `[migration](https://x.com/${i})`).join(" ");
    expect(migrationGuides(body)).toHaveLength(3);
  });

  it("only accepts http urls", () => {
    expect(migrationGuides("[migration](javascript:alert(1))")).toEqual([]);
  });
});
