import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WidgetKind, WidgetSpec } from '@cadence/shared';
import { commitProgressLayoutDraft, dismissProgressLayoutDraft } from '../../lib/api.ts';
import { queryKeys, useProgressLayoutDraft } from '../../lib/query/index.ts';

/** What a section is called when the coach didn't give it a warm title (`spec.title` is the
 *  ordinary case — "Your runs", not "dated_sessions"). One plain noun per kind, house-style. */
const KIND_LABEL: Record<WidgetKind, string> = {
  rhythm: 'Your week',
  trend_vs_target: 'Trend',
  dated_sessions: 'Session history',
  weekly_bars: 'Weekly totals',
  shelf: 'Highlights',
  stage_path: 'Stages',
  count_toward: 'Progress toward your goal',
  balance: 'Balance',
  total: 'Total',
  variety: 'Variety',
  recap_rail: 'Your weekly check-ins',
  history: 'History',
};

function sectionLabel(spec: WidgetSpec): string {
  return spec.title || KIND_LABEL[spec.kind];
}

/** "N (section|sections)" — never the literal "(s)". */
function plural(n: number): string {
  return n === 1 ? '1 section' : `${n} sections`;
}

/** The receipt handed to the coach, visibly, once "Set my page this way" is tapped — same idiom as
 *  week-review's `confirmReceipt`: a plain factual line built from the same list the card itself
 *  just showed, so the number she's told about and the number the user just saw agree by
 *  construction. */
function confirmReceipt(sections: WidgetSpec[]): string {
  return `Progress page set — ${plural(sections.length)}: ${sections.map(sectionLabel).join(', ')}`;
}

/**
 * "Your Progress page, rearranged" — the progress talk's preview card (Wave 3, W3-2 client half;
 * docs/cadence/PROGRESS-ENGINE.md "The progress talk").
 *
 * ChangeCard/WeekReviewCard's third sibling: `propose_progress_layout` writes a DRAFT layout
 * server-side rather than the composition landing in the chat wire — the chat is pure SSE prose, a
 * tool call never reaches the browser — so this asks the server what is pending and draws nothing
 * when the answer is nothing. A turn that describes the new page loosely, or gets it wrong, still
 * cannot alter what the user is agreeing to: the card is the truth and the tap is the consent.
 *
 * Confirm-before-committing is the whole point (brand: the page never changes until they say so).
 * "Not now" leaves the committed layout — or the deterministic default — exactly as it was; she can
 * propose again in the same conversation.
 */
export function LayoutProposalCard({ onConfirmed }: { onConfirmed?: (receiptText: string) => void }) {
  const { data: draft } = useProgressLayoutDraft();
  const queryClient = useQueryClient();
  const [state, setState] = useState<'idle' | 'committing' | 'gone' | 'failed'>('idle');

  // Nothing pending (never proposed, already committed, dismissed elsewhere) — render nothing
  // rather than an empty frame promising a page that isn't there. The shape guard is insurance,
  // not policy: the validator gates every write, but a card must never be able to take the whole
  // Coach tab down over one malformed row.
  if (!draft?.layout?.sections?.length || state === 'gone') return null;

  const sections = draft.layout.sections;

  async function confirm() {
    setState('committing');
    const ok = await commitProgressLayoutDraft(draft!.draft_id).catch(() => false);
    if (!ok) return setState('failed');
    setState('gone');
    // The Progress tab repaints from the new committed layout on its next read.
    await queryClient.invalidateQueries({ queryKey: queryKeys.progressLayout.all });
    onConfirmed?.(confirmReceipt(sections));
  }

  async function dismiss() {
    setState('gone');
    await dismissProgressLayoutDraft(draft!.draft_id).catch(() => {
      /* it stays pending server-side; the next card will show it again */
    });
  }

  return (
    <div className="cfm chg">
      <div className="chg-t">Your Progress page, rearranged</div>
      <ul className="chg-list">
        {sections.map((s) => (
          <li key={s.id}>{sectionLabel(s)}</li>
        ))}
      </ul>
      {state === 'failed' && <div className="chg-err">That didn&rsquo;t take — try again?</div>}
      <button type="button" className="cfm-build" onClick={() => void confirm()} disabled={state === 'committing'}>
        {state === 'committing' ? 'Setting…' : 'Set my page this way'}
      </button>
      <button type="button" className="cfm-more" onClick={() => void dismiss()}>
        Not now
      </button>
    </div>
  );
}
