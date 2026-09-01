import { useEffect, useState } from 'react';
import '../../styles/settings-room.css';
import {
  getConstraints,
  getDevAccount,
  getReview,
  isDevMode,
  type ReviewData,
  type UserConstraint,
  type UserRoutine,
} from '../../lib/api.ts';
import { supabase } from '../../lib/supabase.ts';
import { ActivityBuilder } from '../builder/ActivityBuilder.tsx';
import { AppleHealthSettings } from './AppleHealthSettings.tsx';
import { CoachFaceSettings } from './CoachFaceSettings.tsx';
import { NotificationSettings } from './NotificationSettings.tsx';
import { SettingsAccountDanger } from './SettingsAccountDanger.tsx';
import { SettingsDeviceGroup } from './SettingsDeviceGroup.tsx';
import { SettingsGoals } from './SettingsGoals.tsx';
import { SettingsNutrition } from './SettingsNutrition.tsx';
import { SettingsSubScreen } from './SettingsSubScreen.tsx';
import { SettingsTools } from './SettingsTools.tsx';
import { SettingsYouGroup } from './SettingsYouGroup.tsx';
import { SettingsYourActivities } from './SettingsYourActivities.tsx';
import { buildRoomSubLine, weeksSinceCreation } from './settingsRoomWeek.ts';
import { UnitSettings } from './UnitSettings.tsx';

type RoomScreen =
  'root' | 'coachFace' | 'goals' | 'activities' | 'tools' | 'nutrition' | 'units' | 'notifications' | 'health';

/**
 * Settings, as a full-screen room (design owner-approved 2026-08-31) — replacing the bottom
 * sheet `SettingsSheet.tsx`, which stays mounted-out but intact until the lead deletes it at
 * integration. Same idiom `FoodHome.tsx` uses: the screen replaces the active tab's content while
 * the tab bar stays put, and `onBack` returns to it (wired in `MainTabs.tsx`).
 *
 * This file is the shell and the navigation between it and its door screens, same division of
 * responsibility `FoodHome.tsx` draws for itself — the groups, the account/danger card and each
 * door's content each own their own file.
 *
 * `getReview()` and `getConstraints()` are fetched ONCE here, not by each row that needs them, so
 * the goal/equipment counts on the root list and whatever the door screens show underneath can
 * never disagree.
 */
export function SettingsRoom({
  email,
  onBack,
  onCoach,
}: {
  email: string | null;
  onBack: () => void;
  /** App-authored context for the next coach turn — threaded down to the goals/tools/nutrition
   *  doors, whose screens can hand the conversation to the coach the same way `FoodHome` does. */
  onCoach?: (note: string) => void;
}) {
  const [screen, setScreen] = useState<RoomScreen>('root');
  /** "Edit steps" (Your activities) — the builder mounts INSIDE the room, same full-screen idiom
   *  as every other door here, so editing never leaves Settings and MainTabs never learns about
   *  it. Update mode: saving writes the routine in place (updateRoutineId), never a copy. */
  const [editing, setEditing] = useState<UserRoutine | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [constraints, setConstraints] = useState<UserConstraint[] | null>(null);
  const [weekN, setWeekN] = useState<number | null>(null);
  const dev = isDevMode();

  useEffect(() => {
    let alive = true;
    void getReview()
      .then((r) => alive && setReview(r))
      .catch(() => {});
    void getConstraints()
      .then((c) => alive && setConstraints(c))
      .catch(() => alive && setConstraints([]));
    // Dev mode has no real Supabase session, so `created_at` is unavailable — weekN then stays
    // null and the header simply omits WEEK, per the design's own instruction.
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setWeekN(weeksSinceCreation(data.session?.user?.created_at));
    });
    return () => {
      alive = false;
    };
  }, []);

  function goRoot() {
    setScreen('root');
  }

  if (screen === 'coachFace') {
    return (
      <SettingsSubScreen title="Cadence’s face" onBack={goRoot}>
        <CoachFaceSettings startOpen />
      </SettingsSubScreen>
    );
  }
  if (screen === 'goals') return <SettingsGoals onBack={goRoot} onCoach={onCoach} />;
  if (screen === 'activities') {
    if (editing) {
      return (
        <ActivityBuilder
          initial={{
            name: editing.name,
            session: editing.session,
            provenance: editing.provenance,
            area: editing.area,
          }}
          updateRoutineId={editing.routine_id}
          onSaved={() => setEditing(null)}
          onClose={() => setEditing(null)}
        />
      );
    }
    return <SettingsYourActivities onBack={goRoot} onEditRoutine={setEditing} />;
  }
  if (screen === 'tools') return <SettingsTools onBack={goRoot} onCoach={onCoach} />;
  if (screen === 'nutrition') return <SettingsNutrition onBack={goRoot} onCoach={onCoach} />;
  if (screen === 'units') {
    return (
      <SettingsSubScreen title="Units" onBack={goRoot}>
        <UnitSettings />
      </SettingsSubScreen>
    );
  }
  if (screen === 'notifications') {
    return (
      <SettingsSubScreen title="Notifications" onBack={goRoot}>
        <NotificationSettings />
      </SettingsSubScreen>
    );
  }
  if (screen === 'health') {
    return (
      <SettingsSubScreen title="Apple Health" onBack={goRoot}>
        <AppleHealthSettings />
      </SettingsSubScreen>
    );
  }

  const base = dev ? `dev · ${getDevAccount()}` : (email ?? '');

  return (
    <div className="room" role="region" aria-label="Settings">
      <div className="room-head">
        <button className="room-back" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div className="room-head-text">
          <b className="room-title">Settings</b>
          <span className="room-sub">{buildRoomSubLine(base, weekN)}</span>
        </div>
      </div>

      <div className="room-body">
        <button type="button" className="room-facecard" onClick={() => setScreen('coachFace')}>
          <span className="room-facecard-t">Cadence</span>
          <span className="room-facecard-s">{"Change the coach's face — plan and history stay put"}</span>
        </button>

        <SettingsYouGroup
          review={review}
          constraints={constraints}
          onOpenGoals={() => setScreen('goals')}
          onOpenActivities={() => setScreen('activities')}
          onOpenTools={() => setScreen('tools')}
          onOpenNutrition={() => setScreen('nutrition')}
        />

        <SettingsDeviceGroup
          onOpenUnits={() => setScreen('units')}
          onOpenNotifications={() => setScreen('notifications')}
          onOpenHealth={() => setScreen('health')}
        />

        <SettingsAccountDanger email={email} />
      </div>
    </div>
  );
}
