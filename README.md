# Bumplog

Paste a `package.json`, get every dependency's real release notes and breaking
changes between the version you declare and the latest published.

Runs entirely on Cloudflare Workers. No account, no install, no build step for
the user.

## Why

`npm outdated` tells you a version number changed. It does not tell you whether
the change will cost you an afternoon. Bumplog answers the second question by
pulling the notes the maintainers actually wrote.

## How it works

1. **Versions** come from the npm registry. The version you are treated as being
   on is the *oldest published release your declared range permits* — for
   `^5.0.0` of typescript that is 5.0.2, because 5.0.0 was never published.
2. **Release notes** come from the project's own `CHANGELOG.md` first, read
   through `raw.githubusercontent.com` (which does not consume GitHub's API rate
   limit). When the changelog has been rotated or does not exist, Bumplog falls
   back to GitHub Releases, first as a list and then by exact tag.
3. **Breaking changes** are detected from the conventions projects really use:
   `BREAKING CHANGES` headings, changesets' `Major Changes`, conventional-commit
   `feat!:` markers, and keep-a-changelog `Removed` sections. Nothing is
   summarised or paraphrased.

Notes are fetched when a row is expanded, not up front, so a report renders from
npm data alone and only the packages you care about cost an upstream request.

## Layout

| Path | What |
| --- | --- |
| `src/index.tsx` | Routes |
| `src/report.ts` | Manifest to report orchestration |
| `src/lib/manifest.ts` | package.json parsing, alias and protocol handling |
| `src/lib/version.ts` | Range to upgrade analysis |
| `src/lib/npm.ts` | Registry client, reduces ~7MB documents to cacheable facts |
| `src/lib/notes.ts` | Changelog and GitHub releases fallback chain |
| `src/lib/changelog.ts` | CHANGELOG.md parsing and breaking-change extraction |
| `src/lib/md.ts` | Escape-first markdown renderer for untrusted release bodies |
| `src/views/` | Server-rendered pages (Hono JSX) |

## Development

```sh
npm install
npm run migrate:local     # create the local D1 schema
npm run dev               # http://127.0.0.1:8787
npm test                  # unit tests, no network
npm run typecheck
```

`npm run test:live` hits the real npm registry and GitHub. It is excluded from
the default run because GitHub allows only 60 unauthenticated API calls an hour.

## Deploying

Pushing to `main` runs the tests and deploys via GitHub Actions. First-time
setup — the API token, the D1 and KV resources — is in [DEPLOY.md](DEPLOY.md).

## Caching and cost

Everything upstream is cached in Workers KV: reduced npm facts for 6 hours,
changelog documents for 12 hours, and per-version release notes for 30 days. A
package that has been looked up once costs nothing upstream for a month.

D1 holds saved reports (90 day retention, purged by a nightly cron) and a count
of which packages get looked up, which drives `/popular` and the sitemap.
