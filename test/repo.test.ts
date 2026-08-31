import { describe, expect, it } from "vitest";
import { parseRepository } from "../src/lib/repo";

describe("parseRepository", () => {
  it("handles the git+https form npm publishes most often", () => {
    expect(
      parseRepository({
        type: "git",
        url: "git+https://github.com/facebook/react.git",
        directory: "packages/react",
      }),
    ).toEqual({ owner: "facebook", name: "react", directory: "packages/react" });
  });

  it("handles a plain https url with no .git suffix", () => {
    expect(parseRepository({ url: "https://github.com/facebook/react" })).toEqual({
      owner: "facebook",
      name: "react",
    });
  });

  it("handles git:// and http:// urls", () => {
    expect(parseRepository({ url: "git://github.com/jeffbski/react.git" })).toEqual({
      owner: "jeffbski",
      name: "react",
    });
    expect(parseRepository({ url: "http://github.com/jeffbski/react.git" })).toEqual({
      owner: "jeffbski",
      name: "react",
    });
  });

  it("handles ssh forms", () => {
    expect(parseRepository({ url: "git+ssh://git@github.com/a/b.git" })).toEqual({
      owner: "a",
      name: "b",
    });
    expect(parseRepository({ url: "git@github.com:a/b.git" })).toEqual({
      owner: "a",
      name: "b",
    });
  });

  it("handles string shorthands", () => {
    expect(parseRepository("facebook/react")).toEqual({ owner: "facebook", name: "react" });
    expect(parseRepository("github:facebook/react")).toEqual({
      owner: "facebook",
      name: "react",
    });
  });

  it("reads the monorepo path out of a tree url", () => {
    expect(parseRepository("https://github.com/vitejs/vite/tree/main/packages/vite")).toEqual({
      owner: "vitejs",
      name: "vite",
      directory: "packages/vite",
    });
  });

  it("normalises a directory with stray slashes", () => {
    expect(
      parseRepository({ url: "https://github.com/a/b", directory: "/packages/c/" }),
    ).toMatchObject({ directory: "packages/c" });
  });

  it("returns null for forges we cannot resolve", () => {
    expect(parseRepository("gitlab:a/b")).toBeNull();
    expect(parseRepository("bitbucket:a/b")).toBeNull();
    expect(parseRepository("gist:abc123")).toBeNull();
    expect(parseRepository({ url: "https://gitlab.com/a/b" })).toBeNull();
  });

  it("returns null for missing or malformed input", () => {
    expect(parseRepository(undefined)).toBeNull();
    expect(parseRepository({})).toBeNull();
    expect(parseRepository("")).toBeNull();
    expect(parseRepository({ url: "https://github.com/onlyowner" })).toBeNull();
  });
});
