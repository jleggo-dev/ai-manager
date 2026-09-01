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
  warmApi,
  type DevAccount,
} from './api/http.ts';

export {
  openCoachSession,
  getCurrentCoach,
  getEarlierCoachConversations,
  sendCoachMessage,
  stopCoachTurn,
  notifyOnCoachReply,
} from './api/coach.ts';
export type { ArchivedConversation, CurrentCoach } from './api/coach.ts';

export { registerPushToken, removePushToken } from './api/devices.ts';

export {
  getNotificationPrefs,
  saveNotificationPrefs,
  getLocalNudgePlan,
  type NotificationPrefs,
  type NotificationPrefsPatch,
  type LocalNudgePlan,
} from './api/notification-prefs.ts';

export {
  postHealthDigest,
  getHealthDigest,
  postWorkoutHistory,
  getWorkoutHistory,
  getDatedSessions,
  type WorkoutHistoryListItem,
  type DatedSessionListItem,
  type DatedSessionsListResult,
} from './api/health.ts';

export { getProgressLayout } from './api/progress-layout.ts';

export {
  prepareCoachFoodAction,
  type CoachFoodAction,
  type CoachFoodActionResult,
  type CoachFoodRecipeAction,
  type CoachFoodDietaryAction,
} from './api/coach-food.ts';

export {
  getPlan,
  setOccurrence,
  logAdhoc,
  logDid,
  enterEpisode,
  sendGymPhotos,
  sendDetourEquipment,
  postponeDetour,
  endEpisode,
  checkin,
  replan,
  previewReplan,
  dismissReplanPreview,
  getPendingReplan,
  acceptProposal,
  dismissProposal,
  lockPlan,
  getPendingChange,
  dismissPendingChange,
  getPendingChangeDetail,
  setPendingChangeToggles,
  type PendingChangeDetailItem,
  type PendingChangeDetail,
  getPendingWeekReview,
  dismissPendingWeekReview,
  getWeekReviewFacts,
  confirmWeekReviewSession,
  toggleWeekReviewMeal,
  toggleWeekReviewMindStep,
  previewPlan,
  dismissPlanPreview,
  getProgress,
  addGoalEvent,
  buildNextWeek,
  getRoutines,
  type PlanRoutine,
  type PlanOccurrence,
  type PlanDay,
  type PlanActivity,
  type PendingProposal,
  type PlanViewData,
  type ActiveEpisode,
  type ReplanPreview,
  type LockPreview,
  type PendingChange,
  type WeekBuildResult,
  type WeekReviewMeal,
  type WeekReviewMealSlot,
  type WeekReviewSessionRow,
  type WeekReviewMindStep,
  type WeekReviewMindRow,
  type WeekReviewDay,
  type WeekReviewWeighIn,
  type WeekReviewFacts,
} from './api/plan.ts';

export {
  getProgressHistory,
  type ProgressHistory,
  type HistoryOccurrence,
  type HistoryEpisodeRange,
} from './api/progress-history.ts';

export {
  getOccurrenceDetail,
  logOccurrence,
  recordWeighIn,
  recordWeighInToday,
  type OccurrenceDetail,
} from './api/occurrence.ts';

export {
  getNutritionDay,
  correctMealItem,
  enrichMeal,
  patchMeal,
  setMacroTargets,
  getPlateAdvice,
  type PlateAdvice,
  clearMacroTargets,
  logMeal,
  readMealPhoto,
  logMealFromReading,
  logMealFromFood,
  previewMeal,
  logPreviewedMeal,
  type MealPreview,
  logMealFromRecipe,
  logMealFromItems,
  logPlannedMealItems,
  type PlateItem,
  getRecentMeals,
  getBaselineRead,
  getNutritionInsight,
  type MealKind,
  type MealMacros,
  type Meal,
  type NutritionDayData,
  type BaselineRead,
  type NutritionInsightPack,
  type NutritionInsightItem,
  type NutritionInsightKind,
  type NutritionInsightStatus,
  logWater,
  deleteMeal,
} from './api/nutrition.ts';

export {
  getDietaryProfile,
  saveDietaryProfile,
  getFoodRecents,
  searchFoods,
  getFoodById,
  estimateFood,
  createFood,
  type DietaryProfileResult,
  type FoodSummary,
  type FoodListResult,
  type FoodCandidate,
  type FoodCaptureResult,
  type FoodDetailResult,
  type CreateFoodInput,
  type ApiAvailability,
  deleteFood,
  updateFood,
} from './api/foods.ts';

export { getUsualAtSlot, type UsualAtSlot } from './api/foods-usual.ts';

export {
  resolveFoods,
  portionHintFromResolve,
  type ResolveCandidateKind,
  type ResolveCaptureHint,
  type ResolveCapturePath,
  type ResolveFoodsResult,
} from './api/foods-resolve.ts';

export {
  listRecipes,
  getRecipeById,
  structureRecipeFromChat,
  parseFridgePhoto,
  generateRecipesFromIngredients,
  saveRecipe,
  recipeMacroHint,
  parseRecipe,
  parseRecipeDraft,
  type RecipeDraft,
  type RecipeIngredientRow,
  type FridgeIngredient,
  type RecipeListResult,
  type RecipeDetailResult,
  type RecipeFromChatResult,
  type ParseFridgeResult,
  type GenerateRecipesResult,
  type SaveRecipeResult,
  type RecipeSource,
} from './api/recipes.ts';

export {
  listMealPlans,
  getCurrentMealPlan,
  getMealPlanById,
  generateMealPlan,
  saveMealPlan,
  patchMealPlan,
  deleteMealPlan,
  probeRecipeDiscovery,
  discoverRecipes,
  weekOfMonday,
  mealPlanDayLabel,
  shoppingListSummary,
  parseMealPlan,
  parseMealPlanDraft,
  type MealPlanRecord,
  type MealPlanDraft,
  type MealPlanDraftDay,
  type MealPlanDraftMeal,
  type MealPlanRecipeDraft,
  type MealPlanDay,
  type MealPlanMeal,
  type MealPlanListResult,
  type MealPlanDetailResult,
  type GenerateMealPlanResult,
  type SaveMealPlanResult,
  type PatchMealPlanResult,
  type DiscoverRecipesResult,
} from './api/meal-plans.ts';

export {
  getReview,
  confirmGoals,
  updateGoal,
  renameGoal,
  retireGoal,
  restoreGoal,
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

export { getNowMenu } from './api/now-menu.ts';
export { exportJournal, keepJournalEntry, listJournal, setJournalSecret } from './api/journal.ts';

export {
  getCoachFace,
  setCoachFace,
  sendSessionFeedback,
  getDailyCheckinStatus,
  sendDailyCheckin,
  getSessionInsight,
  type DailyCheckinStatus,
  type SessionInsight,
} from './api/coach-moments.ts';

export {
  getHomeLocation,
  saveHomeLocation,
  clearHomeLocation,
  saveCurrentLocation,
  clearCurrentLocation,
  browserTimezone,
  getWeather,
  getTodayBrief,
  type HomeLocation,
  type CurrentLocation,
  type LocationResult,
  type WeatherNow,
} from './api/location.ts';

export {
  getConstraints,
  removeConstraint,
  renameConstraint,
  getUnits,
  setUnits,
  type UserConstraint,
  type UnitsResponse,
} from './api/me.ts';

export {
  getProgressEvents,
  getProgressBalance,
  getProgressTotals,
  getProgressVariety,
  getProgressStagePath,
  getProgressCount,
  getProgressRepertoire,
  getProgressFeltWeeks,
  getProgressThenNow,
  type Omittable,
} from './api/progress-extras.ts';

export {
  getProgressPhotoPair,
  getProgressPhotosStatus,
  setProgressPhotosEnabled,
  type ProgressPhotosStatus,
} from './api/progress-photos.ts';

export {
  getProgressLayoutDraft,
  commitProgressLayoutDraft,
  dismissProgressLayoutDraft,
  type ProgressLayoutDraft,
} from './api/progress-layout.ts';

export { getRecaps, postWeekReviewRecap, type RecapListItem, type RecapListResult } from './api/recaps.ts';

export { getWatchWeek, postWatchLog } from './api/watch.ts';

export {
  getProgressPhotos,
  postProgressPhoto,
  putProgressPhotosEnabled,
  type ProgressPhotoList,
  type StoredProgressPhoto,
} from './api/progress-photos.ts';
