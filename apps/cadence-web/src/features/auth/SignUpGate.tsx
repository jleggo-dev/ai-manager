import { useEffect, useState } from 'react';
import { getPlan, type PlanActivity, type PlanDay } from '../../lib/api.ts';
import { AuthScreen } from './AuthScreen.tsx';

/**
 * "Your first week is ready. Save it."
 *
 * The gate moved to the end of onboarding, and this screen is why that works: the week they just
 * built is on the page, slightly faded, with their protected days visibly kept off. "Create an
 * account" asking for a password before anything exists is a toll; the same ask standing in front
 * of a plan someone can see is a save button.
 *
 * The plan already exists server-side against their anonymous id. Signing up upgrades that id in
 * place, so nothing here is migrating anything — which is exactly why the copy can say "save it"
 * without qualification.
 */
function WeekTease({ week, activities }: { week: PlanDay[]; activities: PlanActivity[] }) {
  if (!week.length) return null;
  const areaOf = (activityId: string) => activities.find((a) => a.activity_id === activityId)?.kind ?? 'user';
  return (
    <div className="gate-week" aria-hidden>
      {week.slice(0, 7).map((d) => (
        <div key={d.date} className="gate-day">
          <span className="gate-dl">{d.weekday.slice(0, 1)}</span>
          <span className="gate-dbox">
            {d.occurrences.length ? (
              d.occurrences
                .slice(0, 3)
                .map((o) => <i key={o.occurrence_id} className={`gate-dot is-${areaOf(o.activity_id)}`} />)
            ) : (
              <em>off</em>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SignUpGate() {
  const [plan, setPlan] = useState<{ week: PlanDay[]; activities: PlanActivity[] } | null>(null);

  useEffect(() => {
    getPlan()
      .then((p) => setPlan({ week: p.week, activities: p.activities }))
      .catch(() => {
        /* the gate stands on its own; the tease is the bonus */
      });
  }, []);

  return (
    <div className="welcome gate">
      {/* No progress bar here. A 100%-complete bar says nothing at the one screen that IS the end,
          and `.chat-prog` is built for the chat header's flex ROW — `flex: 1` in this column
          container grew it vertically instead, overriding its 12px height into a full-width green
          slab above the headline. */}
      <div className="gate-h">
        Your first week is ready.
        <br />
        Save it.
      </div>

      {plan && (
        <div className="gate-plan">
          <WeekTease week={plan.week} activities={plan.activities} />
          <div className="gate-lines">
            {plan.activities.slice(0, 4).map((a) => (
              <div key={a.activity_id} className="gate-line">
                <i className={`gate-dot is-${a.kind}`} />
                {a.title}
                {a.cadence && <span> — {a.cadence}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* The provider sheet itself is unchanged — same wording, same order, same Apple rules. */}
      <AuthScreen mode="upgrade" />
    </div>
  );
}
