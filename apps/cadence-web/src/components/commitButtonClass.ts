/** The classes a CommitButton gets — its look, then the screen's own layout class. */
export function commitButtonClass(size: 'full' | 'compact', inline: boolean, extra?: string): string {
  return ['commit-btn', size === 'compact' && 'commit-btn--compact', inline && 'commit-btn--inline', extra]
    .filter(Boolean)
    .join(' ');
}
