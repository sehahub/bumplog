import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/lib/md";

describe("renderMarkdown escaping", () => {
  it("never emits markup that came from the input", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)"> and <script>bad()</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
  });

  it("keeps the label but drops the link for anything not http", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
  });

  it("keeps the label but drops the link for a relative url", () => {
    expect(renderMarkdown("see [the guide](/docs/guide)")).toBe("<p>see the guide</p>");
  });

  it("removes images rather than leaking raw markdown", () => {
    expect(renderMarkdown("![Vite 6 is out!](../../docs/og.png)\n\nreal text")).toBe(
      "<p>real text</p>",
    );
  });

  it("keeps http and https links", () => {
    expect(renderMarkdown("[docs](https://example.com/a)")).toContain(
      '<a href="https://example.com/a" rel="nofollow noopener">docs</a>',
    );
  });

  it("cannot be tricked into breaking out of an href", () => {
    const html = renderMarkdown('[x](https://a.com"onmouseover="alert(1))');
    expect(html).not.toContain('onmouseover="alert');
  });

  it("linkifies a bare url once", () => {
    const html = renderMarkdown("see https://example.com for more");
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});

describe("renderMarkdown formatting", () => {
  it("renders bullets as a list", () => {
    expect(renderMarkdown("- one\n- two")).toBe("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
  });

  it("folds a wrapped bullet into one item", () => {
    expect(renderMarkdown("- one\n  continued")).toBe("<ul>\n<li>one continued</li>\n</ul>");
  });

  it("renders code spans and fenced blocks", () => {
    expect(renderMarkdown("use `npm ci` now")).toContain("<code>npm ci</code>");
    expect(renderMarkdown("```js\nconst a = 1 < 2\n```")).toBe(
      "<pre><code>const a = 1 &lt; 2</code></pre>",
    );
  });

  it("does not treat a bare number as a code-span placeholder", () => {
    const html = renderMarkdown("`node` 18 and 20 are `supported`");
    expect(html).toContain("<code>node</code>");
    expect(html).toContain("<code>supported</code>");
    expect(html).toContain(" 18 and 20 ");
  });

  it("leaves markdown inside a code span alone", () => {
    expect(renderMarkdown("`**not bold**`")).toContain("<code>**not bold**</code>");
  });

  it("renders emphasis", () => {
    expect(renderMarkdown("**bold** and *italic*")).toContain("<strong>bold</strong>");
    expect(renderMarkdown("**bold** and *italic*")).toContain("<em>italic</em>");
  });

  it("turns headings into labelled paragraphs", () => {
    expect(renderMarkdown("### Bug Fixes")).toBe(
      '<p class="note-heading">Bug Fixes</p>',
    );
  });

  it("closes an unterminated code fence", () => {
    expect(renderMarkdown("```\nunclosed")).toBe("<pre><code>unclosed</code></pre>");
  });

  it("returns nothing for empty input", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("\n\n")).toBe("");
  });
});
