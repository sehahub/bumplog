import { describe, expect, it } from "vitest";
import { versionFromTag } from "../src/lib/tags";

describe("versionFromTag", () => {
  it("accepts bare and v-prefixed tags for any package", () => {
    expect(versionFromTag("v19.0.0", "react")).toBe("19.0.0");
    expect(versionFromTag("19.0.0", "react")).toBe("19.0.0");
    expect(versionFromTag("V19.0.0", "react")).toBe("19.0.0");
  });

  it("accepts a scoped monorepo tag only for its own package", () => {
    expect(versionFromTag("@astrojs/cloudflare@14.2.5", "@astrojs/cloudflare")).toBe("14.2.5");
    expect(versionFromTag("@astrojs/cloudflare@14.2.5", "astro")).toBeNull();
  });

  it("accepts an unscoped monorepo tag", () => {
    expect(versionFromTag("astro@5.0.0", "astro")).toBe("5.0.0");
    expect(versionFromTag("create-astro@5.2.4", "astro")).toBeNull();
  });

  it("matches a scoped package against its unscoped tag", () => {
    expect(versionFromTag("kit@2.0.0", "@sveltejs/kit")).toBe("2.0.0");
  });

  it("accepts dashed tags", () => {
    expect(versionFromTag("my-pkg-v1.2.3", "my-pkg")).toBe("1.2.3");
    expect(versionFromTag("other-pkg-v1.2.3", "my-pkg")).toBeNull();
  });

  it("rejects prereleases handled elsewhere and junk tags", () => {
    expect(versionFromTag("v16.4.0-canary.3", "next")).toBe("16.4.0-canary.3");
    expect(versionFromTag("release", "next")).toBeNull();
    expect(versionFromTag("", "next")).toBeNull();
    expect(versionFromTag("v1.2", "next")).toBeNull();
  });
});
