# Code Review & Test Plan

This document tracks the security hardening, input validation, and quality measures applied across the health monitoring feature area and the broader codebase. Use it as a review checklist when modifying these areas.

---

## Input Validation (Zod)

### Route-level body validation

All health check and widget health check routes use `validateBody()` middleware with Zod schemas. Every create/update endpoint rejects malformed payloads before they reach the model layer.

**API health check schemas:**
- `createProviderKeySchema` — `provider_id` (UUID), `name` (1–200 chars), `api_key` (non-empty)
- `updateProviderKeySchema` — all fields optional
- `createProfileSchema` — `provider_id` (UUID), `hc_provider_key_id` (UUID), `external_ai_id` (1–200 chars), `name` (1–200 chars), enums for `mode` and `profile_type`
- `updateProfileSchema` — all fields optional
- `createCheckSchema` — `health_check_profile_id` (UUID), `name` (1–200 chars), `cadence_minutes` (int 1–1440)
- `updateCheckSchema` — all fields optional

**Widget health check schemas:**
- `createWidgetCheckSchema` — `url` (valid URL, max 2000 chars), CSS selectors (max 500 chars each), `error_patterns` (array of strings, max 20 entries, each max 200 chars), `page_load_timeout_ms` (5000–600000), `response_timeout_ms` (10000–600000)
- `updateWidgetCheckSchema` — all fields optional (partial of create)

### Query parameter validation

Run history endpoints validate query params with Zod before use:

```
runQuerySchema = z.object({
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string() → split by comma, filtered against VALID_STATUSES set,
  from:   z.string().datetime({ offset: true }) or YYYY-MM-DD,
  to:     z.string().datetime({ offset: true }) or YYYY-MM-DD,
})
```

Invalid query params return `400 { error: 'Invalid query parameters' }`.

### UUID route parameter validation

Both routers define a `validateUuidParam()` helper that parses `req.params.id` through `z.string().uuid()`. Non-UUID values return `400 { error: 'Invalid ID format' }` without hitting the database.

Applied on: `GET /:id/runs`, `GET /:id/failure-patterns` (both routers).

---

## Access Control

### Role enforcement

Both the health check and widget health check routers apply `requireRole('owner', 'admin')` as router-level middleware. All endpoints under these routers are restricted to workspace admins and owners — members cannot access health monitoring configuration or data.

```typescript
router.use(requireRole('owner', 'admin'));
```

### Workspace scoping

All tenant-scoped queries go through `tenantFrom()` which automatically filters by `workspace_id`. The failure-patterns RPCs additionally pass `p_workspace_id` explicitly to the database function as a defense-in-depth measure, preventing cross-tenant data leakage even if the RPC's internal query were misconfigured.

---

## Data Sanitization

### Credential stripping from responses

The `stripSecrets()` function (in `lib/sanitize.ts`) recursively removes sensitive keys from API response objects. The sensitive key set includes: `api_key`, `key_hash`, `password`, `secret`, `token`, `credentials`, `service_role_key`, `encryption_key`, `access_token`, `refresh_token`, and `screenshot_base64`.

Applied on:
- **Provider keys list** — `GET /provider-keys` strips each key row
- **Provider key create/update** — response is stripped
- **Health check list** — each check in `GET /` is stripped (credentials in nested profile/key objects)
- **Widget run manual trigger** — `POST /:id/run` strips the response
- **Widget dashboard** — recent runs are stripped

### Screenshot stripping from list responses

Widget health check runs can contain large base64-encoded screenshots. To keep list payloads small, the `stripScreenshot()` helper removes `screenshot_base64` from every run in list responses. Screenshots are only available via the dedicated endpoint:

```
GET /api/widget-health-checks/runs/:runId/screenshot
```

This separation prevents multi-megabyte payloads when paginating through run history.

### Generic 500 error messages

All route handlers use a consistent error response pattern:

```typescript
catch (err: unknown) {
  console.error('[health-checks]', err);
  res.status(500).json({ error: 'Internal server error' });
}
```

Internal error details (stack traces, database error messages, provider errors) are logged server-side but never leaked to the client. The client always sees the generic `"Internal server error"` message.

---

## Shared Logic

### `computeHealthStatus()`

A shared pure function in `lib/health-status.ts` computes the health status of a check from its last two runs and current incident state. Used by both the API health check and widget health check routers to ensure consistent status reporting.

| Inputs | Result |
|--------|--------|
| No last run | `unknown` |
| Last run failed or open incident | `down` |
| Last run passed, previous run failed | `degraded` |
| Last run passed, previous run passed | `healthy` |

The frontend mirrors this via `HEALTH_STATUS_CONFIG` in `constants/healthStatus.ts` for consistent color/label mapping.

---

## Frontend Quality

### AbortController on InvestigationPanel effects

The `InvestigationPanel` component fetches three data streams (runs, incidents, failure patterns) via `useEffect` hooks. Each effect uses a `cancelled` flag checked before setting state, and the runs effect creates an `AbortController` for cleanup. This prevents stale state updates when the selected check changes rapidly or the component unmounts.

```typescript
useEffect(() => {
  const controller = new AbortController();
  let cancelled = false;
  (async () => {
    // ... fetch ...
    if (!cancelled) { setRuns(res.data); setTotalRuns(res.total); }
  })();
  return () => { cancelled = true; controller.abort(); };
}, [checkId, checkType, buildFilterParams]);
```

### Error surfacing in UI

All three data tabs in the InvestigationPanel (runs, incidents, patterns) have dedicated error state (`runsError`, `incidentsError`, `patternsError`) that displays an `<Alert color="red">` when a fetch fails. Errors are derived from the caught exception message rather than silently swallowed.

---

## Test Coverage Expectations

When modifying health monitoring code, verify the following test areas:

| Area | What to test |
|------|-------------|
| **Zod schemas** | Invalid bodies rejected (400), valid bodies accepted, edge cases (empty strings, boundary values) |
| **UUID param validation** | Non-UUID `:id` returns 400, valid UUID proceeds |
| **Role enforcement** | Member-role requests receive 403, admin/owner requests proceed |
| **Credential stripping** | `api_key` never appears in any list or create response body |
| **Screenshot stripping** | `screenshot_base64` absent from widget run list responses, present in dedicated screenshot endpoint |
| **Error message opacity** | 500 responses contain only `"Internal server error"`, not database/provider details |
| **computeHealthStatus** | All four status outcomes covered, including null inputs |
| **workspace_id enforcement** | Failure patterns RPCs pass workspace ID, tenant queries use `tenantFrom()` |
| **Incident state machine** | Open on first failure, increment on subsequent failures, resolve on pass, duration calculated correctly |
| **Effect cleanup** | InvestigationPanel does not set state after unmount (covered by E2E or manual testing) |
