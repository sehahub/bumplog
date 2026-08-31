/**
 * A deliberately small markdown renderer for release notes.
 *
 * Release bodies are arbitrary text from third parties, so every character is
 * HTML-escaped first and only then are our own tags added. Nothing in the
 * input can produce markup, which is why there is no sanitiser here.
 */

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FENCE = /^\s*(```|~~~)/;

export function renderMarkdown(source: string): string {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];

  let listOpen = false;
  let paragraph: string[] = [];
  let fence: string | null = null;
  let code: string[] = [];

  const closeList = () => {
    if (listOpen) {
      out.push("</ul>");
      listOpen = false;
    }
  };
  const closeParagraph = () => {
    if (paragraph.length === 0) return;
    const rendered = inline(paragraph.join(" ")).trim();
    paragraph = [];
    // A line that held only an image renders to nothing worth a paragraph.
    if (rendered) out.push(`<p>${rendered}</p>`);
  };

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      if (fence === null) {
        closeParagraph();
        closeList();
        fence = fenceMatch[1];
        code = [];
      } else if (line.trimStart().startsWith(fence)) {
        out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        fence = null;
      } else {
        code.push(line);
      }
      continue;
    }
    if (fence !== null) {
      code.push(line);
      continue;
    }

    if (!line.trim()) {
      closeParagraph();
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      out.push(`<p class="note-heading">${inline(heading[2])}</p>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      closeParagraph();
      const rendered = inline(bullet[1]).trim();
      if (!rendered) continue;
      if (!listOpen) {
        out.push("<ul>");
        listOpen = true;
      }
      out.push(`<li>${rendered}</li>`);
      continue;
    }

    // A wrapped continuation of the bullet above.
    if (listOpen && /^\s{2,}/.test(line)) {
      const last = out.pop();
      if (last?.startsWith("<li>")) {
        out.push(`${last.slice(0, -"</li>".length)} ${inline(line.trim())}</li>`);
        continue;
      }
      if (last) out.push(last);
    }

    closeList();
    paragraph.push(line.trim());
  }

  if (fence !== null) out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  closeParagraph();
  closeList();

  return out.join("\n");
}

/**
 * Placeholder delimiter for extracted code spans. NUL is stripped from the
 * input first, so no amount of ordinary text — a bare number, say — can be
 * mistaken for a placeholder on the way back.
 */
const MARK = "\u0000";
const PLACEHOLDER = /\u0000(\d+)\u0000/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

/** Inline formatting, applied to already-escaped text. */
function inline(raw: string): string {
  let text = escapeHtml(raw.replace(CONTROL, ""));

  // Code spans first, so their contents are not treated as other markup.
  const spans: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_all, body: string) => {
    spans.push(`<code>${body}</code>`);
    return `${MARK}${spans.length - 1}${MARK}`;
  });

  // Release notes open with banner images that we have nowhere to put, and
  // whose urls are usually relative to the repo anyway.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");

  // A link we will not follow still has a label worth keeping.
  text = text.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_all, label: string, href: string) =>
    isSafeHref(href) ? `<a href="${href}" rel="nofollow noopener">${label || href}</a>` : label,
  );

  text = text.replace(
    /(^|[\s(])(https?:\/\/[^\s<)]+)/g,
    (_all, lead: string, url: string) =>
      `${lead}<a href="${url}" rel="nofollow noopener">${url}</a>`,
  );

  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");

  return text.replace(PLACEHOLDER, (all, index: string) => spans[Number(index)] ?? all);
}

/**
 * Only absolute http(s) links survive. The href has already been escaped, so
 * `javascript:` and friends cannot slip through a quote.
 */
function isSafeHref(href: string): boolean {
  return /^https?:\/\/[^\s"']+$/.test(href);
}
