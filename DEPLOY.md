# Deploying Bumplog

Deployment runs from GitHub Actions, so the Cloudflare token lives in GitHub
Secrets and never has to exist on a developer machine.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` | pull requests, pushes off `main` | typecheck + tests |
| `provision.yml` | manual, once | creates the D1 database and KV namespace |
| `deploy.yml` | push to `main`, or manual | typecheck + tests, migrate, deploy |

## 1. Create the Cloudflare API token

**My Profile → API Tokens → Create Token → Custom token**, with these
account-level permissions:

| Permission | Level |
| --- | --- |
| Workers Scripts | Edit |
| Workers KV Storage | Edit |
| D1 | Edit |
| Account Settings | Read |

Static assets upload as part of the Worker script and need no permission of
their own. A custom domain would additionally need zone-level
`Workers Routes: Edit`.

The account id is on the right-hand side of the Workers & Pages overview page,
and in the dashboard URL.

## 2. Add the repository secrets

**Settings → Secrets and variables → Actions → New repository secret**:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 3. Provision the resources, once

Run the **Provision Cloudflare resources** workflow from the Actions tab. It
creates the D1 database `bumplog` and the KV namespace `CACHE`, and prints both
ids in the run summary.

Copy those two ids into `wrangler.jsonc`, replacing the placeholder zeros in
`d1_databases[0].database_id` and `kv_namespaces[0].id`, and commit. The deploy
cannot discover them on its own — Wrangler requires both to be in the config.

The workflow refuses to run a second time once real ids are committed, so it
cannot quietly create a duplicate database.

## 4. Deploy

Pushing to `main` now runs the tests, applies migrations and deploys. The Worker
is live at `https://bumplog.<your-subdomain>.workers.dev`.

## 5. GitHub token (recommended, after the first deploy)

Without one, GitHub allows **60 API calls an hour for the whole site**, shared
across every visitor. Most release notes come from `raw.githubusercontent.com`,
which is not rate limited, but packages whose changelog has been rotated or
never existed — `next`, `astro`, `@babel/core` — fall back to the API and go
empty under any real traffic.

A classic PAT with **no scopes at all** raises this to 5,000 an hour; it only
ever reads public repositories. It is a Worker secret rather than an Actions
secret, so it is set with Wrangler:

```sh
npx wrangler secret put GITHUB_TOKEN
```

That needs Cloudflare credentials locally. Alternatively set it in the
dashboard: **Workers & Pages → bumplog → Settings → Variables and Secrets**.

## 6. Custom domain

Live at **https://bumplog.sehahub.info**, attached through the Cloudflare
dashboard (**Workers & Pages → bumplog → Settings → Domains & Routes**).

`wrangler.jsonc` sets `"workers_dev": false`. Without it, every deploy
re-enables the `workers.dev` hostname and the same pages become reachable at two
addresses, each canonicalising to itself — which splits the search signal this
project depends on.

The domain is deliberately **not** declared in `wrangler.jsonc`. A
`custom_domain` route makes Wrangler manage the zone's DNS record, which needs a
zone-scoped token; with the account-scoped token above the deploy fails at the
`wrangler deploy` step (verified — the failure was reproduced and then bisected
away). Adding zone-level `Workers Routes: Edit` to the token would make the
route declarable, at the cost of a broader token.

## Deploying from a machine instead

```sh
npx wrangler login
npx wrangler d1 migrations apply bumplog --remote
npx wrangler deploy
```

## Verifying a deploy

```sh
curl https://<host>/healthz            # {"ok":true}
```

Then paste a package.json at `/` and expand a row — that exercises the registry,
the cache, D1 and the GitHub fallback in one go.
