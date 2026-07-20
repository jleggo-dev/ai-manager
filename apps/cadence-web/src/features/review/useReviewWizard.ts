import { useEffect, useState } from 'react';
import type { PendingPlanActivity } from '@cadence/shared';
import {
  getReview,
  getPlan,
  confirmGoals,
  lockPlan,
  previewPlan,
  dismissPlanPreview,
  type ReviewData,
} from '../../lib/api.ts';
import { LABELS, MANAGE_ORDER, ONBOARD_ORDER, type Step } from './reviewConstants.ts';

export type ReviewMode = 'onboard' | 'manage';

export type PlanPreview = { activities: PendingPlanActivity[]; note: string };

/**
 * If a lock already succeeded server-side but the client never advanced (e.g. the response was
 * lost to a connection blip), route to the plan instead of dead-ending on a confusing error.
 */
export async function recoverIfAlreadyCommitted(onLocked: () => void): Promise<boolean> {
  try {
    if ((await getPlan()).stage === 'committed') {
      onLocked();
      return true;
    }
  } catch {
    /* fall through to the normal error path */
  }
  return false;
}

/**
 * Wizard shell state: review payload, step navigation, and preview → lock commit flow.
 * Step-local UI state (drafts, assessments) lives in the step components.
 */
export function useReviewWizard({
  mode,
  onBack,
  onLocked,
}: {
  mode: ReviewMode;
  onBack: () => void;
  onLocked: () => void;
}) {
  const ORDER = mode === 'manage' ? MANAGE_ORDER : ONBOARD_ORDER;
  const [data, setData] = useState<ReviewData | null>(null);
  const [step, setStep] = useState<Step>('goals');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    getReview()
      .then(setData)
      .catch(() => setMsg("I couldn't load this — give it a second and try again."));
  }, []);

  const idx = ORDER.indexOf(step);
  const back = () => (idx === 0 ? onBack() : setStep(ORDER[idx - 1] as Step));
  const next = () => idx < ORDER.length - 1 && setStep(ORDER[idx + 1] as Step);

  async function doPreview() {
    setBusy(true);
    setMsg('');
    try {
      await confirmGoals();
      const r = await previewPlan();
      if (r.status === 'proposed' && r.proposal) {
        setPreview(r.proposal);
      } else if (r.status === 'needs_focus') {
        setMsg(`That's a lot to carry at once — want to pick the few that matter most right now?`);
      } else {
        if (await recoverIfAlreadyCommitted(onLocked)) return;
        const why = r.violations?.join('; ');
        setMsg(
          why ? `I couldn't put it together yet: ${why}` : `Something went wrong on my end — try again in a moment.`,
        );
      }
      setData(await getReview());
    } catch {
      setMsg('Something went wrong on my end — try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function doConfirmLock() {
    setBusy(true);
    setMsg('');
    try {
      const { status, body } = await lockPlan();
      if (status === 200) {
        const n = Number(body.activities ?? 0);
        setPreview(null);
        setMsg(`Your rhythm is set — ${n} ${n === 1 ? 'thing' : 'things'} on your week. It can always bend later.`);
        setTimeout(onLocked, 900);
        return;
      }
      if (await recoverIfAlreadyCommitted(onLocked)) return;
      const why = (body.violations as string[] | undefined)?.join('; ');
      setMsg(why ? `I couldn't set it yet: ${why}` : `Something went wrong on my end — try again in a moment.`);
      setPreview(null);
      setData(await getReview());
    } catch {
      setMsg('Something went wrong on my end — try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function doDismissPreview() {
    setPreview(null);
    setMsg('');
    dismissPlanPreview().catch(() => {});
  }

  return {
    ORDER,
    LABELS,
    data,
    setData,
    step,
    busy,
    preview,
    msg,
    idx,
    back,
    next,
    doPreview,
    doConfirmLock,
    doDismissPreview,
  };
}
