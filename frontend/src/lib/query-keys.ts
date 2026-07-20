/**
 * Query-key factories (CROSS-03).
 * Keep keys hierarchical so `invalidateQueries({ queryKey: providerKeys.all })`
 * clears every providers-related cache entry.
 */

export const providerKeys = {
  all: ['providers'] as const,
  lists: () => [...providerKeys.all, 'list'] as const,
  /** Workspace-scoped list — API reads workspace from auth headers. */
  list: (workspaceId: string | null) => [...providerKeys.lists(), workspaceId ?? 'none'] as const,
};
