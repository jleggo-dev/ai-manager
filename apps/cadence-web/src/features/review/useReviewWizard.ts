import { useEffect, useState } from 'react';
import { getReview, getPlan, type ReviewData } from '../../lib/api.ts';
import { LABELS, MANAGE_ORDER, type Step } from './reviewConstants.ts';

/**
 * If a lock already succeeded server-side but the client never advanced (e.g. the response was
 * lost to a connection blip), route to the plan instead of dead-ending on a confusing error.
 */
export async function recoverIfAlreadyCommitted(onLocked: () => void): Promise<boolean> {
  try {
    if ((await getPlan())?.stage === 'committed') {
      onLocked();
      return true;
    }
  } catch {
    /* fall through to the normal error path */
  }
  return false;
}

/**
 * Wizard shell state: review payload and step navigation.
 * Step-local UI state (drafts, assessments) lives in the step components.
 */
export function useReviewWizard({ onBack }: { onBack: () => void }) {
  const ORDER = MANAGE_ORDER;
  const [data, setData] = useState<ReviewData | null>(null);
  const [step, setStep] = useState<Step>('goals');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getReview()
      .then(setData)
      .catch(() => setMsg("I couldn't load this — give it a second and try again."));
  }, []);

  const idx = ORDER.indexOf(step);
  const back = () => (idx === 0 ? onBack() : setStep(ORDER[idx - 1] as Step));
  const next = () => idx < ORDER.length - 1 && setStep(ORDER[idx + 1] as Step);

  return {
    ORDER,
    LABELS,
    data,
    setData,
    step,
    msg,
    idx,
    back,
    next,
  };
}
