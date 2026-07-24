/**
 * Cadence API client. Talks to @cadence/api. In dev the backend resolves the user
 * from CADENCE_DEV_USER_ID, so no token is required; later, set the Supabase JWT via
 * setAuthToken. NEVER calls AI Admin directly and NEVER holds aim_sk_.
 *
 * WEB-02: thin barrel — domain modules live under `./api/`; import paths `lib/api` stay unchanged.
 */

export {
  setAuthToken,
  isDevMode,
  DEV_ACCOUNTS,
  DEV_ACCOUNT_LABELS,
  getDevAccount,
  setDevAccount,
  deleteMyData,
  type DevAccount,
} from './api/http.ts';

export { openCoachSession, getCurrentCoach, sendCoachMessage } from './api/coach.ts';

export {
  getPlan,
  setOccurrence,
  replan,
  previewReplan,
  dismissReplanPreview,
  acceptProposal,
  dismissProposal,
  lockPlan,
  previewPlan,
  dismissPlanPreview,
  getProgress,
  addGoalEvent,
  type PlanOccurrence,
  type PlanDay,
  type PlanActivity,
  type PendingProposal,
  type PlanViewData,
  type ReplanPreview,
  type LockPreview,
} from './api/plan.ts';

export { getOccurrenceDetail, logOccurrence, recordWeighIn, type OccurrenceDetail } from './api/occurrence.ts';

export {
  getNutritionDay,
  patchMeal,
  setMacroTargets,
  setEatbackPct,
  getPlateAdvice,
  type PlateAdvice,
  clearMacroTargets,
  logMeal,
  getRecentMeals,
  getBaselineRead,
  type MealKind,
  type MealMacros,
  type Meal,
  type NutritionDayData,
  type BaselineRead,
} from './api/nutrition.ts';

export {
  getReview,
  confirmGoals,
  updateGoal,
  assessGoal,
  deleteGoal,
  addGoal,
  updateEquipment,
  deleteEquipmentItem,
  addEquipment,
  updateBaseline,
  updateName,
  type ReviewData,
} from './api/review.ts';

export { resetAccount, getTrace, getCoachLog, type DevTrace, type AiLogEntry } from './api/dev.ts';
