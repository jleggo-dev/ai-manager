/**
 * ai-profiles/hooks/useProfileBulkActions
 * -----------------------------
 * Owns the AI Profiles list's card/table view toggle and multi-select
 * (checked-set) state used by the bulk-selection checkboxes. Extracted from
 * AiProfileManager.tsx (FE-02) as a structural, behavior-preserving move.
 */

import { useState } from 'react';

export function useProfileBulkActions() {
  const [viewMode, setViewMode] = useState('list');
  const [checkedProfileIds, setCheckedProfileIds] = useState<Set<string>>(new Set());

  function toggleProfileChecked(id: string) {
    setCheckedProfileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Selects every id in `allVisibleIds`, or clears the selection if all of them are already checked. */
  function toggleSelectAll(allVisibleIds: string[]) {
    setCheckedProfileIds((prev) => (prev.size === allVisibleIds.length ? new Set() : new Set(allVisibleIds)));
  }

  return {
    viewMode,
    setViewMode,
    checkedProfileIds,
    toggleProfileChecked,
    toggleSelectAll,
  };
}
