/**
 * The quiet entry card for the Food screen (canvas S3's opening line as a door, not a demand).
 * It reports what turned up and opens the sheet — it never applies anything itself, and carries
 * no per-proposal actions: the sweep proposes, never applies (MEAL-LOGGING.md).
 */
import type { PendingFoodSweep } from '@cadence/shared';
import { CoachLeaf } from './CoachLine.tsx';
import { noticeLine } from './copy.ts';

export interface FoodSweepCardProps {
  sweep: PendingFoodSweep;
  onOpen: () => void;
}

export function FoodSweepCard({ sweep, onOpen }: FoodSweepCardProps) {
  return (
    <button type="button" className="sw-card" onClick={onOpen}>
      <CoachLeaf />
      <span className="sw-card-line">{noticeLine(sweep.proposals.length)}</span>
      <span className="sw-card-chev" aria-hidden>
        {'›'}
      </span>
    </button>
  );
}
