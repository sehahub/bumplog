import { describe, expect, it } from "vitest";
import { analyze, notableReleases, sortStable, type VersionFacts } from "../src/lib/version";

const facts = (stable: string[], extra: Partial<VersionFacts> = {}): VersionFacts => ({
  stable,
  ...extra,
});

describe("analyze", () => {
  it("flags a major bump that the range does not permit", () => {
    const result = analyze("^18.2.0", facts(["18.2.0", "18.3.1", "19.0.0", "19.1.0"]));
    expect(result).toMatchObject({
      from: "18.2.0",
      rangeMax: "18.3.1",
      latest: "19.1.0",
      severity: "major",
      needsManifestEdit: true,
      versionsBehind: 3,
    });
  });

  it("reports no manifest edit when the range already permits latest", () => {
    const result = analyze("^18.2.0", facts(["18.2.0", "18.3.1"]));
    expect(result).toMatchObject({
      severity: "minor",
      needsManifestEdit: false,
      rangeMax: "18.3.1",
    });
  });

  it("starts from the oldest published version, not the arithmetic floor", () => {
    // typescript's 5.0 line starts at 5.0.2; plain 5.0.0 was never published.
    const result = analyze("^5.0.0", facts(["5.0.2", "5.0.3", "5.9.0", "7.0.2"]));
    expect(result).toMatchObject({ from: "5.0.2", rangeMax: "5.9.0", versionsBehind: 3 });
  });

  it("falls back to the range floor when nothing published satisfies it", () => {
    expect(analyze(">=99.0.0", facts(["1.0.0"]))).toBeNull();
  });

  it("returns null when the range floor is already newest", () => {
    expect(analyze("^18.3.1", facts(["18.2.0", "18.3.1"]))).toBeNull();
    expect(analyze("18.3.1", facts(["18.2.0", "18.3.1"]))).toBeNull();
  });

  it("treats a 0.x minor bump as breaking", () => {
    expect(analyze("^0.4.0", facts(["0.4.0", "0.5.0"]))?.severity).toBe("major");
    expect(analyze("^0.4.0", facts(["0.4.0", "0.4.9"]))?.severity).toBe("patch");
  });

  it("ignores a latest dist-tag that points at a prerelease", () => {
    const result = analyze(
      "^1.0.0",
      facts(["1.0.0", "1.2.0"], { latestTag: "2.0.0-beta.1" }),
    );
    expect(result?.latest).toBe("1.2.0");
  });

  it("honours a latest dist-tag that lags the newest publish", () => {
    // A patch backport to an old line can be published after the current latest.
    const result = analyze("^1.0.0", facts(["1.0.0", "1.2.0", "2.0.0"], { latestTag: "1.2.0" }));
    expect(result).toMatchObject({ latest: "1.2.0", severity: "minor" });
  });

  it("carries publish dates and deprecation of the permitted version", () => {
    const result = analyze(
      "^1.0.0",
      facts(["1.0.0", "2.0.0"], {
        time: { "1.0.0": "2020-01-01T00:00:00Z", "2.0.0": "2024-01-01T00:00:00Z" },
        deprecations: { "1.0.0": "no longer maintained" },
      }),
    );
    expect(result).toMatchObject({
      fromPublished: "2020-01-01T00:00:00Z",
      latestPublished: "2024-01-01T00:00:00Z",
      deprecated: "no longer maintained",
    });
  });
});

describe("notableReleases", () => {
  it("returns the whole window when it fits", () => {
    expect(notableReleases(["1.0.0", "1.1.0", "1.2.0"], "1.0.0", "1.2.0")).toEqual([
      "1.1.0",
      "1.2.0",
    ]);
  });

  it("keeps every major and the newest release when capping", () => {
    const stable = ["1.0.0", "1.1.0", "1.2.0", "2.0.0", "2.1.0", "3.0.0", "3.1.0"];
    const picked = notableReleases(stable, "1.0.0", "3.1.0", 4);
    expect(picked).toContain("2.0.0");
    expect(picked).toContain("3.0.0");
    expect(picked).toContain("3.1.0");
    expect(picked.length).toBeLessThanOrEqual(4);
  });
});

describe("sortStable", () => {
  it("drops prereleases and invalid versions, then sorts", () => {
    expect(sortStable(["2.0.0", "1.0.0", "2.0.0-beta.1", "not-a-version", "1.10.0"])).toEqual([
      "1.0.0",
      "1.10.0",
      "2.0.0",
    ]);
  });
});
