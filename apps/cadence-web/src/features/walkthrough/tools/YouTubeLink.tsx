import type { CSSProperties } from 'react';
import { ytSearch } from '../../plan/occurrence/format.ts';

/**
 * The video-query link (walkthrough v2) — a small YouTube glyph + a label naming what it shows
 * ("Form", "Follow along", "Hollow hold"). Rides any tool's target row; the client builds a YouTube
 * SEARCH link from the coach's query (never a model-supplied URL). Absent when a step has no query.
 */
export function YouTubeLink({ query, label }: { query: string; label: string }) {
  return (
    <a href={ytSearch(query)} target="_blank" rel="noopener noreferrer" style={wrap}>
      <svg width="17" height="13" viewBox="0 0 24 18" aria-hidden>
        <rect x="0.5" y="0.5" width="23" height="17" rx="4.5" fill="oklch(52% 0.21 27)" />
        <path d="M9.6 4.9 L16 9 L9.6 13.1 Z" fill="white" />
      </svg>
      <span style={{ fontSize: 11.5, fontWeight: 900, color: 'oklch(38% 0.02 150)' }}>{label}</span>
    </a>
  );
}

const wrap: CSSProperties = {
  background: 'oklch(100% 0 0 / 0.7)',
  border: '1px solid oklch(86% 0.04 66)',
  borderRadius: 12,
  padding: '7px 10px',
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
  textDecoration: 'none',
};
