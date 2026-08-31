import { beforeEach, describe, expect, it } from "vitest";
import type { Cache } from "../src/lib/cache";
import { fetchNotes } from "../src/lib/notes";
import type { Repo } from "../src/lib/repo";

function memoryCache(): Cache & { ttlOf: (key: string) => number | undefined } {
  const store = new Map<string, string>();
  const ttls = new Map<string, number>();
  return {
    async get<T>(key: string) {
      const raw = store.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    async put(key, value, ttl) {
      store.set(key, JSON.stringify(value));
      ttls.set(key, ttl);
    },
    ttlOf: (key) => ttls.get(key),
  };
}

const DAY = 24 * 60 * 60;

/** Serves only the URLs it is given; everything else 404s. */
function stubFetch(routes: Record<string, string>) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = routes[url];
    if (body === undefined) return new Response("Not Found", { status: 404 });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const repo: Repo = { owner: "acme", name: "widget" };

const CHANGELOG = `
# Changelog

## 2.0.0

### ⚠ BREAKING CHANGES

* dropped the legacy adapter

## 1.5.0

### Features
* added a knob
`;

describe("fetchNotes", () => {
  let cache: ReturnType<typeof memoryCache>;
  beforeEach(() => {
    cache = memoryCache();
  });

  it("reads notes from the raw changelog without touching the api", async () => {
    const { fetcher, calls } = stubFetch({
      "https://raw.githubusercontent.com/acme/widget/HEAD/CHANGELOG.md": CHANGELOG,
    });

    const result = await fetchNotes("widget", repo, ["2.0.0", "1.5.0"], { cache, fetcher });

    expect(result.missing).toEqual([]);
    expect(result.notes.map((n) => n.version)).toEqual(["2.0.0", "1.5.0"]);
    expect(result.notes[0].breaking).toEqual(["dropped the legacy adapter"]);
    expect(result.notes[1].breaking).toEqual([]);
    expect(calls.every((c) => !c.includes("api.github.com"))).toBe(true);
  });

  it("looks in the monorepo directory before the repo root", async () => {
    const { fetcher, calls } = stubFetch({
      "https://raw.githubusercontent.com/acme/widget/HEAD/packages/widget/CHANGELOG.md":
        CHANGELOG,
    });

    const result = await fetchNotes(
      "widget",
      { ...repo, directory: "packages/widget" },
      ["2.0.0"],
      { cache, fetcher },
    );

    expect(result.notes).toHaveLength(1);
    expect(calls[0]).toContain("packages/widget/CHANGELOG.md");
  });

  it("falls back to github releases when there is no changelog file", async () => {
    const releases = JSON.stringify([
      { tag_name: "v2.0.0", body: "BREAKING CHANGE: gone\r\n", html_url: "https://x/2" },
      { tag_name: "v1.9.0", body: "safe", html_url: "https://x/1" },
      { tag_name: "v3.0.0-rc.1", body: "nope", prerelease: true, html_url: "https://x/3" },
    ]);
    const { fetcher } = stubFetch({
      "https://api.github.com/repos/acme/widget/releases?per_page=100": releases,
    });

    const result = await fetchNotes("widget", repo, ["2.0.0", "3.0.0-rc.1"], {
      cache,
      fetcher,
    });

    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({
      version: "2.0.0",
      source: "releases",
      sourceUrl: "https://x/2",
      breaking: ["gone"],
    });
    expect(result.notes[0].body).not.toContain("\r");
    expect(result.missing).toEqual(["3.0.0-rc.1"]);
  });

  it("fills gaps in the changelog from releases", async () => {
    const { fetcher } = stubFetch({
      "https://raw.githubusercontent.com/acme/widget/HEAD/CHANGELOG.md": CHANGELOG,
      "https://api.github.com/repos/acme/widget/releases?per_page=100": JSON.stringify([
        { tag_name: "v1.4.0", body: "from releases", html_url: "https://x/4" },
      ]),
    });

    const result = await fetchNotes("widget", repo, ["2.0.0", "1.4.0"], { cache, fetcher });

    expect(result.notes.map((n) => [n.version, n.source])).toEqual([
      ["2.0.0", "changelog"],
      ["1.4.0", "releases"],
    ]);
  });

  it("serves a repeat lookup entirely from cache", async () => {
    const routes = {
      "https://raw.githubusercontent.com/acme/widget/HEAD/CHANGELOG.md": CHANGELOG,
    };
    const first = stubFetch(routes);
    await fetchNotes("widget", repo, ["2.0.0"], { cache, fetcher: first.fetcher });

    const second = stubFetch(routes);
    const result = await fetchNotes("widget", repo, ["2.0.0"], {
      cache,
      fetcher: second.fetcher,
    });

    expect(second.calls).toEqual([]);
    expect(result.notes[0].breaking).toEqual(["dropped the legacy adapter"]);
  });

  it("remembers that a version has no notes instead of refetching", async () => {
    const first = stubFetch({});
    await fetchNotes("widget", repo, ["9.9.9"], { cache, fetcher: first.fetcher });
    expect(first.calls.length).toBeGreaterThan(0);

    const second = stubFetch({});
    const result = await fetchNotes("widget", repo, ["9.9.9"], {
      cache,
      fetcher: second.fetcher,
    });

    expect(second.calls).toEqual([]);
    expect(result.missing).toEqual(["9.9.9"]);
  });

  it("asks for a specific tag when the release list does not reach back far enough", async () => {
    // The list only covers recent releases, as in a busy monorepo.
    const { fetcher, calls } = stubFetch({
      "https://api.github.com/repos/acme/widget/releases?per_page=100": JSON.stringify([
        { tag_name: "widget@9.1.0", body: "recent", html_url: "https://x/9" },
      ]),
      "https://api.github.com/repos/acme/widget/releases/tags/widget%405.0.0": JSON.stringify({
        tag_name: "widget@5.0.0",
        body: "### Major Changes\n\n- the old break",
        html_url: "https://x/5",
      }),
    });

    const result = await fetchNotes("widget", repo, ["5.0.0"], { cache, fetcher });

    expect(result.notes[0]).toMatchObject({
      version: "5.0.0",
      sourceUrl: "https://x/5",
      breaking: ["the old break"],
    });
    // The shape seen in the list is tried before the generic fallbacks.
    expect(calls.filter((c) => c.includes("/releases/tags/"))).toEqual([
      "https://api.github.com/repos/acme/widget/releases/tags/widget%405.0.0",
    ]);
  });

  it("caches a real find for far longer than a real miss", async () => {
    const { fetcher } = stubFetch({
      "https://raw.githubusercontent.com/acme/widget/HEAD/CHANGELOG.md": CHANGELOG,
    });

    await fetchNotes("widget", repo, ["2.0.0", "9.9.9"], { cache, fetcher });

    expect(cache.ttlOf("note:v1:widget:2.0.0")).toBe(30 * DAY);
    expect(cache.ttlOf("note:v1:widget:9.9.9")).toBe(7 * DAY);
  });

  it("does not cache a rate-limited miss for a month", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      if (String(input).includes("api.github.com")) {
        return new Response("limited", { status: 403 });
      }
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    const result = await fetchNotes("widget", repo, ["2.0.0"], { cache, fetcher });

    expect(result.missing).toEqual(["2.0.0"]);
    // Short enough that the answer is re-fetched once the limit clears.
    expect(cache.ttlOf("note:v1:widget:2.0.0")).toBeLessThanOrEqual(15 * 60);
  });

  it("learns the tag shape once, then costs one request per version", async () => {
    const routes: Record<string, string> = {
      "https://api.github.com/repos/acme/widget/releases?per_page=100": "[]",
    };
    for (const v of ["3.0.0", "4.0.0", "5.0.0"]) {
      routes[`https://api.github.com/repos/acme/widget/releases/tags/widget%40${v}`] =
        JSON.stringify({ tag_name: `widget@${v}`, body: `notes ${v}`, html_url: `https://x/${v}` });
    }
    const { fetcher, calls } = stubFetch(routes);

    const result = await fetchNotes("widget", repo, ["3.0.0", "4.0.0", "5.0.0"], {
      cache,
      fetcher,
    });

    expect(result.notes.map((n) => n.version)).toEqual(["3.0.0", "4.0.0", "5.0.0"]);

    const tagCalls = calls.filter((c) => c.includes("/releases/tags/"));

    // The newest version is probed first: it is the likeliest to have a
    // release to learn the tag shape from.
    expect(tagCalls[0]).toContain("5.0.0");

    // The probe pays for guessing — three candidate shapes before `widget@`
    // works. The other two versions then cost exactly one request each.
    expect(tagCalls.filter((c) => c.includes("5.0.0"))).toHaveLength(3);
    expect(tagCalls.filter((c) => c.includes("4.0.0"))).toEqual([
      "https://api.github.com/repos/acme/widget/releases/tags/widget%404.0.0",
    ]);
    expect(tagCalls.filter((c) => c.includes("3.0.0"))).toEqual([
      "https://api.github.com/repos/acme/widget/releases/tags/widget%403.0.0",
    ]);
  });

  it("stops calling the api once github reports a rate limit", async () => {
    const calls: string[] = [];
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("api.github.com")) return new Response("limited", { status: 403 });
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    await fetchNotes("widget", repo, ["1.0.0", "2.0.0"], { cache, fetcher });

    expect(calls.filter((c) => c.includes("api.github.com"))).toHaveLength(1);
  });

  it("sends the token when one is configured", async () => {
    let seen: Headers | undefined;
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = new Headers(init?.headers);
      return new Response("[]", { status: 200 });
    }) as unknown as typeof fetch;

    await fetchNotes("widget", repo, ["1.0.0"], { cache, fetcher, githubToken: "secret" });

    expect(seen?.get("authorization")).toBe("Bearer secret");
  });

  it("returns nothing for an empty version list without fetching", async () => {
    const { fetcher, calls } = stubFetch({});
    const result = await fetchNotes("widget", repo, [], { cache, fetcher });
    expect(result).toEqual({ notes: [], missing: [] });
    expect(calls).toEqual([]);
  });
});
