# Deploying Bumplog

Everything below runs from this directory. Steps 1 and 2 need credentials that
only the account owner can create.

## 1. Cloudflare credentials

Either log in interactively once:

```sh
npx wrangler login
```

or set an API token, which is what CI needs:

```sh
$env:CLOUDFLARE_API_TOKEN = "..."
$env:CLOUDFLARE_ACCOUNT_ID = "..."
```

Create the token at **My Profile → API Tokens → Create Token → Custom token**
with these account-level permissions:

| Permission | Level |
| --- | --- |
| Workers Scripts | Edit |
| Workers KV Storage | Edit |
| D1 | Edit |
| Account Settings | Read |

Static assets upload as part of the Worker script, so they need no permission of
their own. A custom domain would additionally need zone-level `Workers Routes:
Edit`.

## 2. GitHub token (recommended)

Without one, GitHub allows **60 API calls an hour for the entire site**, shared
across every visitor. Most release notes come from `raw.githubusercontent.com`,
which is not rate limited, but packages whose changelog has been rotated or
never existed — `next`, `astro`, `@babel/core` — fall back to the API and will
start coming up empty under any real traffic.

A classic PAT with **no scopes at all** raises the limit to 5,000 an hour; it
only ever reads public repositories.

```sh
npx wrangler secret put GITHUB_TOKEN
```

## 3. Create the resources

```sh
npx wrangler d1 create bumplog
npx wrangler kv namespace create CACHE
```

Both commands print an id. Put them in `wrangler.jsonc` under
`d1_databases[0].database_id` and `kv_namespaces[0].id`, replacing the
placeholder zeros.

## 4. Migrate and deploy

```sh
npx wrangler d1 migrations apply bumplog --remote
npx wrangler deploy
```

The Worker is then live at `https://bumplog.<your-subdomain>.workers.dev`.

## 5. Custom domain (optional)

`workers.dev` works but Cloudflare recommends against it for production, and a
real domain is worth much more for search. Register or add the domain in the
Cloudflare dashboard, then add a route to `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "bumplog.example.com", "custom_domain": true }]
```

## Verifying a deploy

```sh
curl https://<host>/healthz            # {"ok":true}
curl -s https://<host>/ | head -c 200  # the landing page
```

Then paste a package.json at `/` and expand a row — that exercises the registry,
the cache, D1 and the GitHub fallback in one go.
