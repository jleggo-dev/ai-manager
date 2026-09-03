import type { ReactNode } from 'react';
import {
  BreathingPreview,
  GroundingPreview,
  MeditatePreview,
  NowMenuPreview,
  FeelingLogPreview,
  JournalPreview,
} from './BreathingPreview.tsx';
import { FreeWritePreview } from './FreeWritePreview.tsx';
import { IntervalPreview } from './IntervalPreview.tsx';
import { MetronomePreview } from './MetronomePreview.tsx';
import { CoachMomentsPreview } from './CoachMomentsPreview.tsx';
import { PlanCardPreview } from './PlanCardPreview.tsx';
import { SkeletonPreview } from './SkeletonPreview.tsx';
import { WidgetsPreview } from './WidgetsPreview.tsx';
import { ItemScreenPreview } from '../repertoire/ItemScreenPreview.tsx';
import { SeedReviewPreview } from '../repertoire/SeedReviewPreview.tsx';
import { ListScreenPreview } from '../repertoire/ListScreenPreview.tsx';

/**
 * `?preview=<tool>` — render ONE component against fixture data, short-circuiting auth and the
 * plan entirely, so a temporal tool can be watched without a coach-composed session.
 *
 * Dev affordance only; nothing links here. Lifted out of App.tsx so the screen machine there
 * reads as the screen machine and not as a switch statement with a flow attached.
 */
const PREVIEWS: Record<string, () => ReactNode> = {
  breathing: () => <BreathingPreview />,
  meditate: () => <MeditatePreview />,
  grounding: () => <GroundingPreview />,
  feeling: () => <FeelingLogPreview />,
  journal: () => <JournalPreview />,
  freewrite: () => <FreeWritePreview />,
  interval: () => <IntervalPreview />,
  metronome: () => <MetronomePreview />,
  coach: () => <CoachMomentsPreview />,
  nowmenu: () => <NowMenuPreview />,
  plancard: () => <PlanCardPreview />,
  skeletons: () => <SkeletonPreview />,
  widgets: () => <WidgetsPreview />,
  item: () => <ItemScreenPreview />,
  seed: () => <SeedReviewPreview />,
  repertoire: () => <ListScreenPreview />,
};

export function previewScreen(name: string | null): ReactNode | null {
  return name ? (PREVIEWS[name]?.() ?? null) : null;
}
