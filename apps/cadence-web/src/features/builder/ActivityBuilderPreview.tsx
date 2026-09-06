/**
 * `?preview=builder` — the Activity Builder and its four doors, without auth, a plan, or a
 * six-minute onboarding run.
 *
 * It exists because the builder sits behind a committed plan: `MainTabs` only mounts once one
 * exists, so on a fresh dev account there is no way to LOOK at this screen at all. Every design
 * decision in the 2026-09-06 pass — minimize by default, the pill, `Discard | Ask the coach | Save`
 * — was shipped on unit tests alone for exactly that reason. This is the door that lets someone
 * check them with their eyes.
 *
 * What it fakes, and nothing more: the network under Save (so the saved moment is reachable), and
 * the host's minimize/restore, which in the real app is `MainTabs`. The pill is the REAL one
 * (`DraftPill`), so it cannot drift into showing a control the app does not have. Everything else
 * — the header, the step palette, the card editors, the draft held on disk — is the shipping
 * component, unmocked.
 *
 * `&draft=held` starts minimized with a draft already on disk, which is what a launch after a
 * force-quit looks like.
 */
import { useEffect, useState } from 'react';
import { ActivityBuilder } from './ActivityBuilder.tsx';
import { DraftPill } from './DraftPill.tsx';
import { clearDraft, readDraft, writeDraft, type BuilderDraft } from './draftStore.ts';

/** What a half-built activity looks like when it comes back from disk. */
const HELD: BuilderDraft = {
  phase: 'builder',
  family: 'strength',
  // One item per card, which is the shape the builder itself produces (a card IS a block, and
  // StepCard edits its first item). A fixture with two items in one block renders as one visible
  // step and one invisible one — a preview that lies quietly is worse than no preview.
  cards: [
    { id: 'p-warm', block: { label: 'Warm-up', items: [{ name: 'Jumping jacks', duration_min: 2 }] } },
    { id: 'p-main', block: { label: 'Main', items: [{ name: 'Push-ups', sets: 3, reps: 10 }] } },
    { id: 'p-sq', block: { label: 'Main', items: [{ name: 'Goblet squat', sets: 3, reps: 12, load: '35 lb' }] } },
  ],
  name: 'Hotel HIIT',
};

/**
 * A dead ringer for the tab bar's FOOTPRINT and nothing else — no labels, no taps.
 *
 * The pill is positioned to clear the real tab bar (`bottom: 100px`), so without something
 * occupying that band the preview shows it floating in empty space and its placement can't be
 * judged. Deliberately blank rather than a fake copy of the real nav: a preview that draws
 * pretend tabs is a preview that can disagree with the app about what the tabs are.
 */
const PreviewTabBarSpacer = () => (
  <div
    aria-hidden
    style={{ flex: '0 0 auto', height: 76, borderTop: '1px solid var(--line-soft)', background: 'var(--ink-2)' }}
  />
);

export function ActivityBuilderPreview() {
  const startHeld = new URLSearchParams(window.location.search).get('draft') === 'held';
  const [ready, setReady] = useState(false);
  const [minimized, setMinimized] = useState(startHeld);
  const [restore, setRestore] = useState<BuilderDraft | undefined>(undefined);
  const [closed, setClosed] = useState<null | 'saved' | 'discarded'>(null);
  /** The coach hand-off, shown as text instead of sent — there is no chat here to send it to. */
  const [ask, setAsk] = useState<string | null>(null);

  useEffect(() => {
    // Save has to reach the saved moment, and there is no session here to authorise a real POST.
    const orig = window.fetch;
    window.fetch = (async (u: RequestInfo | URL, o?: RequestInit) => {
      if (String(u).includes('/me/routines')) {
        const body = JSON.parse(String(o?.body ?? '{}')) as { name?: string };
        return new Response(
          JSON.stringify({
            routine_id: 'preview',
            name: body.name || 'Untitled activity',
            area: 'movement',
            session: { blocks: [], note: '', generated_at: new Date().toISOString(), version: 1 },
            provenance: { kind: 'blank' },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            runs: 0,
            last_run: null,
            schedule: null,
          }),
          { status: 200 },
        );
      }
      return orig(u, o);
    }) as typeof window.fetch;

    if (startHeld) {
      writeDraft(HELD);
      setRestore(readDraft() ?? HELD);
    } else {
      clearDraft(); // a clean device, so `?preview=builder` always opens on the same first screen
    }
    setReady(true);
    return () => {
      window.fetch = orig;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return null;

  if (closed) {
    return (
      <div className="app">
        {/* `.scrollbody` already pads 20px and `.cta` is width:100% — a horizontal margin on top
            of that is what pushed this button off the phone. Vertical only. */}
        <div className="scrollbody">
          <div className="wiz-empty" style={{ marginTop: 48 }}>
            {closed === 'saved' ? 'Saved. In the app this lands back on your plan.' : 'Discarded — the draft is gone.'}
          </div>
          <button className="cta" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
            Start over
          </button>
        </div>
        <PreviewTabBarSpacer />
      </div>
    );
  }

  return (
    <>
      {/* The host's job, played straight: hidden rather than unmounted, so minimizing keeps the
          scroll position and an open palette exactly as MainTabs does. */}
      <div style={{ display: minimized ? 'none' : 'contents' }}>
        <ActivityBuilder
          restore={restore}
          onMinimize={() => setMinimized(true)}
          onClose={() => setClosed('discarded')}
          onSaved={() => setClosed('saved')}
          onAskReview={(text) => setAsk(text)}
        />
      </div>
      {minimized && (
        <div className="app">
          <div className="scrollbody">
            <div className="wiz-empty" style={{ marginTop: 48 }}>
              {ask
                ? 'This is where the coach would be. Below is the message the builder just handed her — sent visibly, as your own words.'
                : 'Minimized. In the app this is whichever tab you tapped; the draft is on disk, and the pill is the way back.'}
            </div>
            {/* The parent already pads; this only needs the card treatment. */}
            {ask && (
              <pre
                style={{
                  marginTop: 12,
                  padding: 14,
                  whiteSpace: 'pre-wrap',
                  font: 'inherit',
                  fontSize: 13,
                  color: 'var(--text)',
                  background: 'var(--surface)',
                  border: '1px solid var(--line-soft)',
                  borderRadius: 14,
                }}
              >
                {ask}
              </pre>
            )}
          </div>
          <DraftPill onClick={() => setMinimized(false)} />
          <PreviewTabBarSpacer />
        </div>
      )}
    </>
  );
}
