import { useCoachFace } from '../features/coach/coachFaceContext.ts';
import { Orb } from './Orb.tsx';

/**
 * Cadence's face, as a circular chip.
 *
 * **Where this belongs, and where it doesn't.** The face goes wherever Cadence speaks in the
 * first person — the header identity chip, the recap card, the trail bubble, every sheet Cadence
 * asks a question from. The `<Orb>` mark stays wherever the *product* speaks: the wordmark,
 * empty states, the sign-in screen. No screen shows both, because two marks on one screen is
 * the reader having to work out which one is talking.
 *
 * With no face picked this renders the mark, so the rule above holds either way and no caller
 * needs a branch. That is also why there is no default face: showing someone a stranger's
 * portrait they never chose is worse than showing them the logo.
 *
 * `ring` draws the raised white collar from the design; drop it where the chip sits inside
 * something already bordered (the small inline replies).
 */
export function CoachFace({
  size = 36,
  ring = true,
  className,
}: {
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const { face } = useCoachFace();
  const cls = ['cface', ring ? 'cface-ring' : '', className].filter(Boolean).join(' ');
  const style = { width: size, height: size } as const;

  if (!face?.art) {
    return (
      <span className={`${cls} cface-mark`} style={style} aria-hidden>
        <Orb />
      </span>
    );
  }
  return (
    <span className={cls} style={style} aria-hidden>
      {/* Decorative in every placement: Cadence is always named in the adjacent copy, so an alt
          text here would just make a screen reader say the name twice per surface. */}
      <img src={face.art} alt="" loading="lazy" decoding="async" />
    </span>
  );
}
