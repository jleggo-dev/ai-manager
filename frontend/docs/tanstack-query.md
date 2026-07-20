# TanStack Query (CROSS-03)

AI Admin and Cadence share the same React Query conventions. Setup lives in
`src/lib/query-client.ts` (defaults + comments); keys in `src/lib/query-keys.ts`.

## Defaults (align Cadence nutrition-day pilot)

| Option                 | Value   | Why                                                           |
| ---------------------- | ------- | ------------------------------------------------------------- |
| `staleTime`            | 30s     | Skip refetch when navigating between pages that share a query |
| `gcTime`               | 5m      | Keep unused cache briefly for back-nav                        |
| `retry`                | 1       | One transient retry                                           |
| `refetchOnWindowFocus` | `false` | Mutations invalidate explicitly                               |

## Patterns

1. **Query-key factories** — hierarchical keys (`providerKeys.list(workspaceId)`), invalidate with the parent (`providerKeys.all`).
2. **Invalidate after mutate** — after create/update/delete, call `invalidateQueries` for that resource; do not rely on focus refetch.
3. **Narrow pilots** — one shared list/resource per PR until the pattern is familiar.

## AI Admin pilot

`GET /api/providers` via `useProvidersQuery`, consumed by `ProviderManager` and
`useAiProfilesData` (Providers ↔ AI Profiles nav shares cache).
