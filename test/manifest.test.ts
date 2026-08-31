import { describe, expect, it } from "vitest";
import { ManifestError, parseManifest } from "../src/lib/manifest";

describe("parseManifest", () => {
  it("collects deps from every scope, deduped", () => {
    const { packageName, deps } = parseManifest(
      JSON.stringify({
        name: "my-app",
        dependencies: { react: "^18.2.0" },
        devDependencies: { react: "^18.2.0", vitest: "~1.0.0" },
        peerDependencies: { typescript: ">=5" },
        optionalDependencies: { fsevents: "2.3.3" },
      }),
    );

    expect(packageName).toBe("my-app");
    expect(deps.map((d) => [d.name, d.scope])).toEqual([
      ["react", "dependencies"],
      ["vitest", "devDependencies"],
      ["typescript", "peerDependencies"],
      ["fsevents", "optionalDependencies"],
    ]);
  });

  it("resolves npm: aliases to the registry package", () => {
    const { deps } = parseManifest(
      JSON.stringify({ dependencies: { "string-width-cjs": "npm:string-width@^4.2.0" } }),
    );
    expect(deps).toEqual([
      {
        name: "string-width",
        alias: "string-width-cjs",
        range: "^4.2.0",
        scope: "dependencies",
      },
    ]);
  });

  it("resolves scoped npm: aliases", () => {
    const { deps } = parseManifest(
      JSON.stringify({ dependencies: { hono: "npm:@hono/node-server@^1.0.0" } }),
    );
    expect(deps[0]).toMatchObject({ name: "@hono/node-server", range: "^1.0.0" });
  });

  it("skips non-registry protocols with a reason", () => {
    const { deps, skipped } = parseManifest(
      JSON.stringify({
        dependencies: {
          ui: "workspace:*",
          local: "file:../local",
          forked: "git+https://github.com/a/b.git",
          shorthand: "someuser/somerepo",
          tagged: "latest",
          anything: "*",
        },
      }),
    );

    expect(deps).toEqual([]);
    expect(Object.fromEntries(skipped.map((s) => [s.name, s.reason]))).toEqual({
      ui: "workspace protocol",
      local: "local path",
      forked: "git dependency",
      shorthand: "git dependency",
      tagged: "dist-tag or unsupported range",
      anything: "wildcard range",
    });
  });

  it("tolerates comments and trailing whitespace", () => {
    const { deps } = parseManifest(`
      {
        // the app
        "dependencies": { "react": "^18.2.0" } /* inline */
      }
    `);
    expect(deps).toHaveLength(1);
  });

  it("does not strip comment-like sequences inside strings", () => {
    const { deps } = parseManifest(
      JSON.stringify({ dependencies: { "http://x": "1.0.0", react: "^18.0.0" } }),
    );
    expect(deps.map((d) => d.name)).toContain("http://x");
  });

  it("rejects input that is not a package.json", () => {
    expect(() => parseManifest("")).toThrow(ManifestError);
    expect(() => parseManifest("not json")).toThrow(ManifestError);
    expect(() => parseManifest("[1,2,3]")).toThrow(ManifestError);
    expect(() => parseManifest('{"name":"x"}')).toThrow(ManifestError);
  });
});
