import { describe, expect, it } from "vitest";
import type { Cache } from "../src/lib/cache";
import { nullCache } from "../src/lib/cache";
import { buildReport } from "../src/report";

/** A registry that serves whatever versions the test asks for. */
function stubRegistry(packages: Record<string, string[]>) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const name = decodeURIComponent(String(input).replace("https://registry.npmjs.org/", ""));
    calls.push(name);

    const list = packages[name];
    if (!list) return new Response("Not Found", { status: 404 });

    const versions = Object.fromEntries(
      list.map((v) => [v, { repository: { url: `https://github.com/acme/${name}` } }]),
    );
    return Response.json({
      name,
      description: `the ${name} package`,
      "dist-tags": { latest: list[list.length - 1] },
      versions,
      time: Object.fromEntries(list.map((v, i) => [v, `202${i}-01-01T00:00:00.000Z`])),
    });
  }) as unknown as typeof fetch;

  return { fetcher, calls };
}

const cache: Cache = nullCache();

describe("buildReport", () => {
  it("orders rows by severity, then by how far behind they are", async () => {
    const { fetcher } = stubRegistry({
      breaking: ["1.0.0", "2.0.0"],
      "very-stale": ["1.0.0", "1.1.0", "1.2.0", "2.0.0"],
      "small-fix": ["1.0.0", "1.0.1"],
      feature: ["1.0.0", "1.1.0"],
      settled: ["1.0.0"],
    });

    const report = await buildReport(
      JSON.stringify({
        dependencies: {
          "small-fix": "^1.0.0",
          feature: "^1.0.0",
          breaking: "^1.0.0",
          "very-stale": "^1.0.0",
          settled: "^1.0.0",
        },
      }),
      cache,
      fetcher,
    );

    expect(report.rows.map((r) => r.name)).toEqual([
      "very-stale",
      "breaking",
      "feature",
      "small-fix",
      "settled",
    ]);
    expect(report.summary).toMatchObject({
      total: 5,
      major: 2,
      minor: 1,
      patch: 1,
      current: 1,
      unresolved: 0,
      needsManifestEdit: 2,
    });
  });

  it("records a package the registry does not have", async () => {
    const { fetcher } = stubRegistry({});
    const report = await buildReport(
      JSON.stringify({ dependencies: { nope: "^1.0.0" } }),
      cache,
      fetcher,
    );

    expect(report.rows[0]).toMatchObject({ name: "nope", error: "not_found" });
    expect(report.summary.unresolved).toBe(1);
  });

  it("stops after the per-report limit and says so", async () => {
    const names = Array.from({ length: 160 }, (_, i) => `pkg-${i}`);
    const { fetcher, calls } = stubRegistry(
      Object.fromEntries(names.map((n) => [n, ["1.0.0", "2.0.0"]])),
    );

    const report = await buildReport(
      JSON.stringify({
        dependencies: Object.fromEntries(names.map((n) => [n, "^1.0.0"])),
      }),
      cache,
      fetcher,
    );

    expect(report.truncatedAt).toBe(150);
    expect(report.rows).toHaveLength(150);
    expect(calls).toHaveLength(150);
    expect(report.skipped.filter((s) => s.reason === "over the per-report limit")).toHaveLength(
      10,
    );
  });

  it("carries skipped dependencies through untouched", async () => {
    const { fetcher, calls } = stubRegistry({ real: ["1.0.0"] });
    const report = await buildReport(
      JSON.stringify({ dependencies: { real: "^1.0.0", internal: "workspace:*" } }),
      cache,
      fetcher,
    );

    expect(calls).toEqual(["real"]);
    expect(report.skipped).toEqual([
      { name: "internal", range: "workspace:*", scope: "dependencies", reason: "workspace protocol" },
    ]);
  });
});
