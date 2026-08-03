import { useState, type CSSProperties } from 'react';

/**
 * "What's this?" — the mind pillar's answer to the how-to video a barbell movement gets.
 *
 * Named for the question actually in someone's head. Handed "Box · 4 · 4 · 4 · 4" by their coach,
 * a person who has never met box breathing is not asking for mechanism — they are asking what the
 * thing IS, so the label answers that rather than assuming they got that far.
 *
 * A grounding game or a breath pattern has no *form* to watch, so filming it would be mostly
 * filler; what someone actually needs is a couple of sentences saying what to do and why it
 * works. Text also reads with the sound off, mid-practice, on a dimmed screen — which is when
 * it's wanted. (`video_query` still rides alongside any step, so a coach can attach a link when
 * one genuinely helps.)
 *
 * Deliberately **always available, never automatic**: it doesn't fire on first use and doesn't
 * disappear once "seen", because nobody should have to remember whether they've read it, and
 * being shown an explanation you didn't ask for reads as being talked down to. Collapsed it is
 * one quiet line; open it pushes nothing around that matters.
 */
export function WhatsThis({ text, tone = 'light' }: { text: string; tone?: 'light' | 'dark' }) {
  const [open, setOpen] = useState(false);
  const dark = tone === 'dark';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          ...trigger,
          color: dark ? 'oklch(78% 0.03 268)' : 'oklch(52% 0.03 268)',
        }}
      >
        {open ? 'Close' : "What's this?"}
      </button>
      {open && (
        <div
          style={{
            ...body,
            background: dark ? 'oklch(100% 0 0 / 0.06)' : 'oklch(97% 0.012 85)',
            color: dark ? 'oklch(86% 0.02 268)' : 'oklch(40% 0.02 150)',
            border: dark ? '1px solid oklch(100% 0 0 / 0.1)' : '1px solid oklch(92% 0.015 85)',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

const trigger: CSSProperties = {
  alignSelf: 'center',
  border: 'none',
  background: 'transparent',
  padding: '4px 8px',
  fontSize: 12,
  fontWeight: 800,
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};
const body: CSSProperties = {
  borderRadius: 12,
  padding: '11px 13px',
  fontSize: 12.5,
  lineHeight: 1.55,
  textWrap: 'pretty',
};
