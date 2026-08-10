import { useEffect } from 'react';
import { PICKABLE_COACH_FACES } from '@cadence/shared';
import { useCoachFace } from './coachFaceContext.ts';

/**
 * Make sure Cadence has a face before she speaks.
 *
 * The owner ruling (2026-08-09) is that the portrait is drawn at random when you meet her and
 * kept. That was implemented on the "Meet Cadence" screen alone — which is wrong, because that
 * screen is not the only way into the conversation. `screenFromPlanStage` sends anyone with a
 * plan already in progress *straight* to the chat, so someone who closed the app mid-onboarding
 * came back to a coach with no face and every bubble wearing the brand mark. The mark is where
 * the product speaks; a coach saying "I" while wearing it is the exact confusion the ruling
 * exists to prevent.
 *
 * So the draw belongs to a hook that any onboarding entry point can call, not to one screen.
 *
 * `enabled` is the guard that keeps this out of the ongoing Coach tab: someone who deliberately
 * chose the mark in Settings must not have a face silently dealt back to them on their next visit.
 * Only the first conversation draws.
 */
export function useEnsureCoachFace(enabled: boolean): void {
  const { face, ready, setFaceId } = useCoachFace();

  useEffect(() => {
    // `ready` matters: `face` is null both for "hasn't picked" and "still loading", and drawing on
    // the second would overwrite a portrait they chose weeks ago.
    if (!enabled || !ready || face) return;
    const drawn = PICKABLE_COACH_FACES[Math.floor(Math.random() * PICKABLE_COACH_FACES.length)];
    if (drawn) void setFaceId(drawn.id);
  }, [enabled, ready, face, setFaceId]);
}
