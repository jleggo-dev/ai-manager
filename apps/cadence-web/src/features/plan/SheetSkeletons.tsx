import { Skeleton, SkeletonRing, SkeletonScreen } from '../../components/Skeleton.tsx';

/**
 * Placeholders for the DETERMINISTIC sheets (PERF-06).
 *
 * The line these draw is between a sheet that is reading Postgres and a sheet that is waiting on
 * the coach. A meal capture, a weigh-in and the "log something you did" list are pure DB reads —
 * 136–163ms against the deployed API, measured 2026-08-20 — and they used to sit behind the
 * chat's typing dots, which is the app telling its user that writing down breakfast is an AI
 * conversation. Those get these.
 *
 * The sheets that genuinely wait on a model keep their dots and their honest label: StartSheet and
 * OccurrenceSheet prescribe a session (`kind: 'user'` → an LLM round trip that measured **34.2s**
 * on a first open, same probe), and CoachFoodActionSheet is matching spoken food. A wait that long
 * needs to say a model is thinking, because a model is thinking.
 */

/**
 * The meal capture's body — the two-tone ring and its macro bars, then the ways in.
 *
 * The ring is drawn as a bare TRACK: no arc, no number. The owner's instruction was "show
 * everything at 0 and then update" (2026-08-20), and this is that instruction kept honest — 0 kcal
 * on this meal is a real answer, so a placeholder 0 and a settled 0 are the same pixels and the
 * jump to 740 would retroactively make the first screen a lie. The track gives him the whole
 * structure on the first frame, which was the ask; the arc arrives with the answer.
 */
export function MealCaptureSkeleton() {
  return (
    <SkeletonScreen label="Opening your capture." className="sk-sheet">
      <div className="sk-row" style={{ gap: 16 }}>
        <SkeletonRing size={96} stroke={11} />
        <div className="sk-col">
          {[0, 1, 2].map((i) => (
            <div className="sk-row" key={i} style={{ gap: 8 }}>
              <Skeleton w={28} h={9} />
              <Skeleton h={7} radius={999} />
            </div>
          ))}
        </div>
      </div>
      <div className="sk-row" style={{ gap: 10, marginTop: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} h={58} radius={14} />
        ))}
      </div>
      <Skeleton w="46%" h={11} />
    </SkeletonScreen>
  );
}

/** The weigh-in's body — one number field and its confirm. */
export function WeighInSkeleton() {
  return (
    <SkeletonScreen label="Opening your weigh-in." className="sk-sheet">
      <Skeleton h={52} radius={14} />
      <Skeleton h={46} radius={999} />
    </SkeletonScreen>
  );
}

/** A plain list of rows — the "log something you did" activity list. */
export function SheetRowsSkeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <SkeletonScreen label={label} className="sk-sheet">
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i} style={{ gap: 12 }}>
          <Skeleton w={34} h={34} radius={10} />
          <div className="sk-col">
            <Skeleton w={i % 2 ? '58%' : '70%'} h={13} />
            <Skeleton w="34%" h={10} />
          </div>
        </div>
      ))}
    </SkeletonScreen>
  );
}

/**
 * The week review's body (check-in rebuild, step 4) — a pure DB read same as the others here, so
 * it gets shapes, not dots: seven rings for the day chips row, then the rollup cards beneath.
 */
export function WeekReviewSkeleton() {
  return (
    <SkeletonScreen label="Opening your week review." className="sk-sheet">
      <div className="sk-row" style={{ gap: 8 }}>
        {Array.from({ length: 7 }, (_, i) => (
          <SkeletonRing key={i} size={40} stroke={4} />
        ))}
      </div>
      <div className="sk-row" style={{ gap: 10, marginTop: 4 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} h={64} radius={14} />
        ))}
      </div>
    </SkeletonScreen>
  );
}
