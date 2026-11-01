/**
 * In every chat box the words get the whole width; the buttons sit on a row of their own beneath.
 *
 * The boxes were one flex row — field, then each button beside it — so every button took its
 * width out of the typing space. When the camera joined the Coach tab's paperclip, mic and send,
 * the text wrapped at about half the box on the phone ("I did my Piano / practice for today.",
 * owner, 2026-11-01). Nothing threw and every test passed, because jsdom does no layout. So this
 * checks the two things that make the layout: the field shares its parent with no button, and
 * that parent stacks its children (flex column) in the stylesheet that ships.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { readStyle } from '../test/css.ts';

vi.mock('../components/CoachFace.tsx', () => ({ CoachFace: () => <span>face</span> }));
vi.mock('../components/MicButton.tsx', () => ({ MicButton: () => <button type="button">mic</button> }));
vi.mock('../features/food/MealParseCard.tsx', () => ({ MealParseCard: () => <div>the card</div> }));
vi.mock('../lib/api.ts', () => ({ previewMeal: vi.fn() }));

const { ChatComposer } = await import('../features/onboarding/ChatComposer.tsx');
const { LogByChat } = await import('../features/food/LogByChat.tsx');
const { SteerBox } = await import('../features/plan/SteerBox.tsx');

const noop = () => {};
const tray = { items: [], add: vi.fn(), remove: vi.fn(), take: vi.fn(), ready: true, busy: false } as never;

/** Each box with the camera on, rendered the way its screen renders it — the most buttons it shows. */
const BOXES: { name: string; ui: ReactElement; box: string; tools: string; sheet: string }[] = [
  {
    name: 'Coach tab composer',
    ui: (
      <ChatComposer
        value="I did my Piano practice"
        onChange={noop}
        onSend={noop}
        streaming={false}
        showDisclaimer={false}
        tray={tray}
      />
    ),
    box: 'composer',
    tools: 'composer-tools',
    sheet: 'src/styles.css',
  },
  {
    name: 'Coach tab composer while she is replying',
    ui: (
      <ChatComposer value="" onChange={noop} onSend={noop} onStop={noop} streaming showDisclaimer={false} tray={tray} />
    ),
    box: 'composer',
    tools: 'composer-tools',
    sheet: 'src/styles.css',
  },
  {
    name: 'quick-log meal chat',
    ui: <LogByChat meal="dinner" onLogged={noop} onBack={noop} onPhoto={noop} />,
    box: 'fc-compose',
    tools: 'fc-compose-tools',
    sheet: 'src/styles/food-capture.css',
  },
  {
    name: 'plan "tell me what to change"',
    ui: <SteerBox value="move Thursday" onChange={noop} onPhotos={noop} />,
    box: 'steer-box',
    tools: 'steer-tools',
    sheet: 'src/styles.css',
  },
];

afterEach(cleanup);

/** The value a selector gets for a property across EVERY rule naming it, last one winning — as the
 *  browser cascades it. (`.composer` is named twice in styles.css; a map keyed by selector keeps
 *  only the later rule, which says nothing about the layout.) */
function declared(sheet: string, selector: string, prop: string): string {
  const el = document.createElement('style');
  el.textContent = readStyle(sheet);
  document.head.appendChild(el);
  let value = '';
  for (const rule of Array.from(el.sheet?.cssRules ?? [])) {
    const style = rule as CSSStyleRule;
    if (typeof style.selectorText !== 'string') continue;
    if (!style.selectorText.split(',').some((one) => one.trim() === selector)) continue;
    value = style.style.getPropertyValue(prop) || value;
  }
  el.remove();
  return value;
}

describe('chat boxes — the field has its own row', () => {
  it.each(BOXES)('$name — no button sits beside the field', ({ ui, box, tools }) => {
    const { container } = render(ui);
    const field = container.querySelector('textarea');
    expect(field, 'the box has a text field').not.toBeNull();
    const row = field!.parentElement!;
    expect(row).toHaveClass(box);
    // The field's row holds the field and the buttons' row — never a button of its own.
    const beside = Array.from(row.children).filter((el) => el !== field);
    expect(beside.map((el) => el.className)).toEqual([tools]);
    expect(row.querySelectorAll(`.${tools} button`).length).toBeGreaterThan(0);
  });

  it.each(BOXES)('$name — the stylesheet stacks the field over the buttons', ({ box, tools, sheet }) => {
    expect(declared(sheet, `.${box}`, 'flex-direction'), `.${box} flex-direction`).toBe('column');
    expect(declared(sheet, `.${tools}`, 'display'), `.${tools} display`).toBe('flex');
  });
});
