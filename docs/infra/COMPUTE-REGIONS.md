# Compute regions — colocating each service with its database

**Status:** AI Admin backend pinned to `sfo1` (this doc) · Cadence API pinned to `pdx1` (PR #261)
**Date:** 2026-08-20

Every Vercel Function defaults to **`iad1`** (AWS us-east-1, Washington DC). Both of this repo's
databases live on the west coast. Left at the default, every query crosses the country — and because
application code awaits queries *in series*, that distance is paid once per query, not once per
request.

| Service | Config | Compute | Its database | Region |
|---|---|---|---|---|
| AI Admin backend | root [`vercel.json`](../../vercel.json) | **`sfo1`** | `ai-admin` / `mkxynwtuqceiblilxkvz` | AWS **us-west-1** |
| Cadence API | [`apps/cadence-api/vercel.json`](../../apps/cadence-api/vercel.json) | **`pdx1`** | `health_tracker` / `qvukqinwmyvewzgcsgzt` | AWS **us-west-2** |

The two targets differ because the two databases differ. `sfo1` **is** us-west-1 (San Francisco);
`pdx1` **is** us-west-2 (Portland). Getting these backwards buys a cross-region hop instead of
removing one. Cadence's reasoning is in
[docs/cadence/DEPLOY.md](../cadence/DEPLOY.md) under "Compute region"; this doc covers AI Admin.

## Why AI Admin moves — measured, not assumed

Measured 2026-08-20 from Montréal (edge PoP `yul1`) against production
`ai-manager-alpha-seven.vercel.app`, warm, medians of 5–8 samples.

| Probe | DB round trips | Median TTFB |
|---|---|---|
| `GET /_/backend/api/<unknown>` — no `Authorization` header | **0** | **~180 ms** |
| `GET /_/backend/api/workspaces` — valid API key | **1** (`api_keys` lookup) | ~230–310 ms |
| `GET /_/backend/api/health` | **12**, serial | **~1,460 ms** |

The no-token 401 is the control: [`auth.ts`](../../backend/src/middleware/auth.ts) returns it before
touching the database, so it prices the whole path *except* DB chatter — browser → `yul1` → `iad1` →
Express. The difference against `/api/health` is therefore pure distance:

> **(1,460 − 180) ms ÷ 12 queries ≈ ~106 ms per serial round trip.**

The 1-query probe corroborates it independently (~50–130 ms over control).

**Correction to a common assumption:** `/api/health` is *not* a DB-free liveness ping. It loops over
twelve tables with `await` inside the loop
([`db/ai-manager.ts`](../../backend/src/db/ai-manager.ts)), which is exactly why it makes a good
probe. Do not reach for it expecting a network-only measurement.

### The cost side, stated plainly

Moving compute west lengthens the *one* browser→function hop for the owner, who works from Montréal.
Measured TCP connect from Montréal to AWS regional endpoints (not CDN-fronted):

| From Montréal to | Median TCP connect |
|---|---|
| us-east-1 (today's `iad1`) | ~64 ms |
| us-west-1 (proposed `sfo1`) | ~153 ms |

So the move **adds ~89 ms once** and **removes ~106 ms per serial query**. That is an upper bound on
the cost: this is public-internet routing, while `yul1`→`sfo1` rides Vercel's backbone.

### Break-even, and why this clears it

Break-even is **one** database round trip per request. AI Admin clears it before a route handler even
runs: the JWT path the console actually uses awaits `auth.getUser()` and *then* `getProfile()` —
**two sequential** us-west-1 trips in middleware on every authenticated request. Everything the
handler does is additional.

Predicted for `/api/health`: ~180 + ~89 + (12 × single-digit ms) ≈ **~300 ms, down from ~1,460 ms**.

This was worth measuring rather than assuming: AI Admin is an internal operations console, and its
request pattern is not obviously the long serial chain that `GET /plan` is on Cadence. The
measurement says it is chatty enough — the auth middleware alone guarantees it.

**Rejected:** migrating the database east (a full Supabase project migration, not a config line);
multi-region compute with read replicas (correct eventually, overkill now).

## Where the config lives, and what is actually proven

The root `vercel.json` uses the older **`experimentalServices`** shape, not the newer `services`
shape. That matters, so here is the evidence rather than an assertion:

- **There is no per-service `regions` key in any services shape.** Vercel's official schema
  (`https://openapi.vercel.sh/vercel.json`) exposes no `regions` property under
  `experimentalServices`, `services`, or `experimentalServicesV2`. Top-level is the only lever.
- **Top-level `regions` is schema-valid here.** The schema's root is `additionalProperties: false`,
  `regions` is a permitted root property, and no `oneOf`/`not`/`dependentSchemas` constraint makes it
  exclusive with `experimentalServices`. The edited file validates with no unknown root keys.
- **It is the semantically right key.** `regions` governs "where the deployment's Serverless
  Functions should be deployed", and experimental-services backends run as Vercel Functions.

**What is *not* proven:** that the legacy `experimentalServices` build pipeline propagates the
top-level `regions` to the service's functions. Schema validity means the deploy will not be
*rejected*; it does not guarantee the key is *honored*. Vercel's `experimentalServices` docs are
silent on top-level keys. PR #261 proved the newer `services` shape honors it; that proof does not
transfer.

So this is a **verify-on-merge** change, not a fire-and-forget one.

### Verifying it took effect

Preview deployments here sit behind Vercel SSO and 302 at the edge, so `x-vercel-id` on a preview
reports the PoP, never the function region. Verification has to happen after the production deploy:

```bash
curl -sS -o /dev/null -D - https://ai-manager-alpha-seven.vercel.app/_/backend/api/health | grep -i x-vercel-id
```

`x-vercel-id: yul1::sfo1::…` means it worked — entered at Montréal, executed in San Francisco. If it
still reads `yul1::iad1::…`, the key was ignored; use the dashboard fallback below. Warm TTFB on that
endpoint is the second signal: ~300 ms means colocated, ~1,460 ms means it did not move.

### Dashboard fallback

If the key is ignored: **Vercel → project `ai-manager` → Settings → Functions → Function Regions →
`sfo1` (San Francisco, us-west-1) → redeploy.** A region change only applies to a *new* deployment.
Hobby allows one region, Pro allows five; one is all this needs.

## Blast radius

Backend-only in practice. The root config also declares a `frontend` service, but it is a static Vite
SPA with no functions — and per Vercel's docs, selecting a function region "does not impact static
files, which are deployed to every region by default." The daily `/api/cron/tick/health` cron runs as
a function and moves with the backend, which is the point: it is the twelve-query endpoint.
