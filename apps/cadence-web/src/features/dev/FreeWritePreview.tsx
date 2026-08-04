import { useEffect, useState } from 'react';
import { JournalWrite } from '../journal/JournalWrite.tsx';

/**
 * `?preview=freewrite` — the timed free-write, without auth, a plan, or a coach.
 *
 * It exists because the journal is the one pillar surface sitting behind sign-in, so the hairline,
 * the bell and the paper screen shipped several times over without anyone having looked at them.
 * Opens on the start sheet with a coach-issued 20 minutes, exactly as a `duration_min` row does.
 *
 * `?preview=freewrite&min=1` shortens the clock so the bell can actually be heard in a dev session
 * rather than twenty minutes from now — the one thing a fixture can offer that production can't.
 */
export function FreeWritePreview() {
  const [ready, setReady] = useState(false);
  const minutes = Number(new URLSearchParams(window.location.search).get('min')) || 20;

  useEffect(() => {
    const orig = window.fetch;
    window.fetch = (async (u: RequestInfo | URL, o?: RequestInit) => {
      const url = String(u);
      if (url.includes('/journal')) {
        // Accept the save and echo it back; nothing here reaches a real store.
        if (o?.method === 'POST') return new Response(JSON.stringify({ entry: { entry_id: 'p1' } }), { status: 201 });
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      return orig(u, o);
    }) as typeof window.fetch;
    setReady(true);
    return () => {
      window.fetch = orig;
    };
  }, []);

  if (!ready) return null;
  return (
    <JournalWrite
      openWith={{
        bank: null,
        prompt: null,
        minutes,
        // Design's fixture copy read "Twenty minutes on the move…", which contradicted the chip
        // the moment the duration wasn't twenty — visible in this very preview at 3 minutes. The
        // coach defines the duration, once, in duration_min; the topic text never restates it.
        topics: [
          { label: 'The move', prompt: "What you haven't said out loud yet about the move." },
          { label: 'This week', prompt: 'Write through the week just gone — start anywhere, keep your hand moving.' },
        ],
      }}
      onClose={() => undefined}
      onKept={() => undefined}
    />
  );
}
