import { useState } from 'react';
import { CoachFace } from '../../components/CoachFace.tsx';

/**
 * The plan-level rationale as HER SPEECH BUBBLE — it is her talking, and it is the part that
 * earns the signup, so it opens in place and pushes the list down (no sheet, no new screen:
 * leaving the page to read reasoning breaks the "we're looking at it together" frame).
 *
 * Collapsed, the ad is her actual first words cut mid-sentence (a two-line clamp) — a cut
 * sentence sells continuation; a chevron sells furniture. The whole bubble is the tap target.
 *
 * The rationale is ONE model-written string (two sentences to two paragraphs — design says
 * design for the long end): paragraphs split on blank lines, rendered as plain text only. It is
 * unauthenticated-visible model output; nothing here may interpret it as markup.
 */
export function RationaleBubble({ rationale, startOpen = false }: { rationale: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const text = rationale.trim();
  if (!text) return null; // plans committed before 0031 have none — the card stands without it
  const paragraphs = text.split(/\n\s*\n/);
  return (
    <div className="gr-wrap">
      <CoachFace size={40} className="gr-face" />
      <button type="button" className="gr-bubble" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="gr-tail" aria-hidden />
        {open ? (
          <>
            {paragraphs.map((p, i) => (
              <p key={i} className="gr-p">
                {p}
              </p>
            ))}
            <span className="gr-pill">▴ that&rsquo;s my thinking</span>
          </>
        ) : (
          <>
            <p className="gr-p gr-clamp">{paragraphs[0]}</p>
            <span className="gr-pill">See my thinking ▾</span>
          </>
        )}
      </button>
    </div>
  );
}
