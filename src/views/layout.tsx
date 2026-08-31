import type { Context } from "hono";
import type { Child } from "hono/jsx";

export type PageMeta = {
  title: string;
  description: string;
  canonical?: string;
  noindex?: boolean;
};

export function Shell(props: PageMeta & { children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <meta name="description" content={props.description} />
        {props.canonical ? <link rel="canonical" href={props.canonical} /> : null}
        {props.noindex ? <meta name="robots" content="noindex" /> : null}
        <meta property="og:title" content={props.title} />
        <meta property="og:description" content={props.description} />
        <meta property="og:type" content="website" />
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <header class="site-header">
          <div class="wrap">
            <a class="wordmark" href="/">
              bump<span>log</span>
            </a>
            <nav>
              <a href="/popular">Popular packages</a>
              <a href="/about">About</a>
            </nav>
          </div>
        </header>
        <main class="wrap">{props.children}</main>
        <footer class="site-footer">
          <div class="wrap">
            Release notes come from each project's own CHANGELOG and GitHub releases.
            Version data comes from the npm registry. Nothing you paste is stored beyond
            the list of public package names in your report.
          </div>
        </footer>
        <script src="/app.js" defer></script>
      </body>
    </html>
  );
}

/** Hono renders JSX to a string; the doctype has to be prepended by hand. */
export function page(c: Context, meta: PageMeta, body: Child, status = 200) {
  const html = `<!doctype html>${(<Shell {...meta}>{body}</Shell>)}`;
  return c.html(html, status as 200);
}
