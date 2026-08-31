/**
 * Hits the real npm registry and GitHub. Excluded from the default run.
 * `npm run test:live`
 */
import { describe, expect, it } from "vitest";
import type { Cache } from "../../src/lib/cache";
import { fetchNotes } from "../../src/lib/notes";
import { fetchPackageFacts } from "../../src/lib/npm";
import { analyze, notableReleases } from "../../src/lib/version";

function memoryCache(): Cache {
  const store = new Map<string, string>();
  return {
    async get<T>(key: string) {
      const raw = store.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    async put(key, value) {
      store.set(key, JSON.stringify(value));
    },
  };
}

const cache = memoryCache();
const TIMEOUT = 60_000;

describe("npm registry", () => {
  it(
    "reduces react metadata to usable facts",
    async () => {
      const result = await fetchPackageFacts("react", cache);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { facts } = result;
      expect(facts.stable.length).toBeGreaterThan(100);
      expect(facts.stable).toContain("18.2.0");
      expect(facts.repo).toMatchObject({ name: "react" });
      expect(facts.time["18.2.0"]).toMatch(/^\d{4}-/);

      const upgrade = analyze("^18.2.0", facts);
      expect(upgrade).not.toBeNull();
      console.log("react ^18.2.0 ->", JSON.stringify(upgrade));
    },
    TIMEOUT,
  );

  it(
    "handles a scoped package",
    async () => {
      const result = await fetchPackageFacts("@angular/core", cache);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.facts.repo).toMatchObject({ owner: "angular" });
    },
    TIMEOUT,
  );

  it(
    "reports a missing package",
    async () => {
      const result = await fetchPackageFacts(
        "this-package-should-not-exist-bumplog-test",
        cache,
      );
      expect(result).toEqual({ ok: false, reason: "not_found" });
    },
    TIMEOUT,
  );
});

describe("release notes", () => {
  const cases = [
    { pkg: "vite", range: "^4.0.0" },
    { pkg: "react", range: "^17.0.0" },
    { pkg: "@babel/core", range: "^7.20.0" },
    { pkg: "next", range: "^13.0.0" },
    { pkg: "astro", range: "^4.0.0" },
  ];

  for (const { pkg, range } of cases) {
    it(
      `finds notes for ${pkg}`,
      async () => {
        const result = await fetchPackageFacts(pkg, cache);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { facts } = result;
        expect(facts.repo).not.toBeNull();
        if (!facts.repo) return;

        const upgrade = analyze(range, facts);
        expect(upgrade).not.toBeNull();
        if (!upgrade) return;

        const versions = notableReleases(facts.stable, upgrade.from, upgrade.latest, 6);
        const notes = await fetchNotes(pkg, facts.repo, versions, { cache });

        console.log(
          `${pkg} ${upgrade.from} -> ${upgrade.latest}:`,
          `${notes.notes.length}/${versions.length} notes`,
          `via ${notes.notes[0]?.source ?? "none"}`,
          `| breaking: ${notes.notes.reduce((n, x) => n + x.breaking.length, 0)}`,
        );

        expect(notes.notes.length).toBeGreaterThan(0);
      },
      TIMEOUT,
    );
  }
});
