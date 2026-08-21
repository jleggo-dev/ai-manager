import { Skeleton, SkeletonRing, SkeletonScreen } from '../../components/Skeleton.tsx';

/**
 * The Progress tab while `/progress` is in flight (PERF-06): a ring card and two goal cards in
 * the shape the real ones take.
 *
 * The journal row is NOT drawn here — ProgressView renders it for real above this, because it is
 * static chrome that reads nothing from the server. Anything that does not wait should not be
 * made to look like it is waiting; a skeleton over a button that was ready all along is its own
 * small lie about the app's speed.
 */
export function ProgressSkeleton() {
  return (
    <SkeletonScreen label="Loading how you have been showing up." className="sk-progress">
      <div className="sk-card">
        <div className="sk-row" style={{ gap: 16 }}>
          <SkeletonRing size={92} stroke={10} />
          <div className="sk-col">
            <Skeleton w="66%" h={14} />
            <Skeleton w="44%" h={11} />
          </div>
        </div>
      </div>

      {[0, 1].map((i) => (
        <div className="sk-card" key={i}>
          <Skeleton w={i === 0 ? '52%' : '61%'} h={14} />
          <Skeleton w={96} h={24} className="sk-num" />
          <Skeleton w="72%" h={11} />
        </div>
      ))}
    </SkeletonScreen>
  );
}
