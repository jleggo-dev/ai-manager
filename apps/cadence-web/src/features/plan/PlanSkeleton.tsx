import { Skeleton, SkeletonCircle, SkeletonScreen } from '../../components/Skeleton.tsx';

/**
 * The Plan tab while `/plan` is in flight (PERF-06) — the trail's own bones: a header band, then
 * the day label and three node rows the real trail will land into.
 *
 * This is the screen behind the owner's 2026-08-20 report, and it almost never shows any more:
 * PERF-01/02 mean a return paints from cache with no loader at all, and PERF-02 means the app-open
 * fetch is the one PlanView reads. What is left is the true first load of a session — which is
 * exactly the moment a person is deciding whether this app is fast, and the moment it used to
 * show them the coach's typing dots over a plain Postgres read.
 *
 * Three nodes, not the real count: the count is data. A shape that guesses "you have five things
 * today" and resolves to one has told a small lie to save a moment.
 */
export function PlanSkeleton() {
  return (
    <SkeletonScreen label="Loading your week." className="sk-plan">
      {/* The header band: coach mark, a line of weather, streak. */}
      <div className="sk-row">
        <SkeletonCircle size={36} />
        <div className="sk-col">
          <Skeleton w="62%" h={13} />
          <Skeleton w="34%" h={10} />
        </div>
        <Skeleton w={54} h={22} radius={999} />
      </div>

      <Skeleton w={92} h={11} style={{ marginTop: 10 }} />

      {[0, 1, 2].map((i) => (
        <div className="sk-row" key={i} style={{ gap: 14, marginTop: 4 }}>
          <SkeletonCircle size={56} />
          <div className="sk-col">
            <Skeleton w={i === 1 ? '54%' : '68%'} h={14} />
            <Skeleton w="38%" h={11} />
          </div>
        </div>
      ))}
    </SkeletonScreen>
  );
}
