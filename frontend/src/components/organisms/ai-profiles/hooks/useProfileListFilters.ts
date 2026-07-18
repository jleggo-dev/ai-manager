/**
 * ai-profiles/hooks/useProfileListFilters
 * -----------------------------
 * Owns the AI Profiles list's search/filter/sort/group-by state and the
 * derived filtered+grouped view. Extracted from AiProfileManager.tsx (FE-02)
 * as a structural, behavior-preserving move.
 */

import { useState, useMemo } from 'react';
import type { AiProfile } from '../../../../types/api';

export function useProfileListFilters(profiles: AiProfile[]) {
  const [search, setSearch] = useState('');
  const [filterProvider, setFilterProvider] = useState('all');
  const [filterMode, setFilterMode] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('name-asc');
  const [groupBy, setGroupBy] = useState('none');

  const providerFilterOptions = useMemo(() => {
    const seen = new Map();
    for (const p of profiles) {
      const prov = p.provider;
      if (prov?.id && !seen.has(prov.id)) seen.set(prov.id, prov.name || prov.type);
    }
    return [
      { value: 'all', label: 'All providers' },
      ...Array.from(seen.entries()).map(([id, name]) => ({
        value: id,
        label: name,
      })),
    ];
  }, [profiles]);

  const filteredAndGroupedProfiles = useMemo(() => {
    const term = search.toLowerCase().trim();
    let list = profiles;

    if (term) {
      list = list.filter((p) => {
        const haystack = [p.name, p.description, p.external_ai_id, p.provider?.name, p.provider?.type]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      });
    }
    if (filterProvider !== 'all') {
      list = list.filter((p) => p.provider?.id === filterProvider);
    }
    if (filterMode !== 'all') {
      list = list.filter((p) => (p.mode || 'completion') === filterMode);
    }
    if (filterStatus !== 'all') {
      const wantActive = filterStatus === 'active';
      list = list.filter((p) => p.is_active === wantActive);
    }

    const sortFn =
      (
        {
          'name-asc': (a: AiProfile, b: AiProfile) => (a.name || '').localeCompare(b.name || ''),
          'name-desc': (a: AiProfile, b: AiProfile) => (b.name || '').localeCompare(a.name || ''),
          newest: (a: AiProfile, b: AiProfile) =>
            new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
          oldest: (a: AiProfile, b: AiProfile) =>
            new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
          provider: (a: AiProfile, b: AiProfile) => (a.provider?.name || '').localeCompare(b.provider?.name || ''),
        } as Record<string, (a: AiProfile, b: AiProfile) => number>
      )[sortBy] || null;
    if (sortFn) list = [...list].sort(sortFn);

    if (groupBy === 'none') return { type: 'flat' as const, items: list };

    const groups = new Map<string, { label: string; items: AiProfile[] }>();
    for (const p of list) {
      let key: string;
      let label: string;
      if (groupBy === 'provider') {
        key = p.provider?.id || 'unknown';
        label = p.provider?.name || 'Unknown Provider';
      } else {
        key = p.mode || 'completion';
        label = key === 'chat' ? 'Chat' : 'Completion';
      }
      if (!groups.has(key)) groups.set(key, { label, items: [] });
      groups.get(key)?.items.push(p);
    }
    return { type: 'grouped' as const, groups: Array.from(groups.values()) };
  }, [profiles, search, filterProvider, filterMode, filterStatus, sortBy, groupBy]);

  const isFiltered = Boolean(search) || filterProvider !== 'all' || filterMode !== 'all' || filterStatus !== 'all';
  const visibleCount =
    filteredAndGroupedProfiles.type === 'flat'
      ? filteredAndGroupedProfiles.items.length
      : filteredAndGroupedProfiles.groups.reduce((sum, g) => sum + g.items.length, 0);

  return {
    search,
    setSearch,
    filterProvider,
    setFilterProvider,
    filterMode,
    setFilterMode,
    filterStatus,
    setFilterStatus,
    sortBy,
    setSortBy,
    groupBy,
    setGroupBy,
    providerFilterOptions,
    filteredAndGroupedProfiles,
    isFiltered,
    visibleCount,
  };
}
