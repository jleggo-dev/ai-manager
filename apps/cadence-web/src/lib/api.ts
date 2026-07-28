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
  prepareCoachFoodAction,
  type CoachFoodAction,
  type CoachFoodActionResult,
  type CoachFoodLogAction,
  type CoachFoodRecipeAction,
  type CoachFoodDietaryAction,
} from './api/coach-food.ts';

export {
  getPlan,
  setOccurrence,
  logAdhoc,
  logDid,
  enterEpisode,
  endEpisode,
  checkin,
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
  type ActiveEpisode,
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
  logMealFromFood,
  logMealFromRecipe,
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
} from './api/nutrition.ts';

export {
  getDietaryProfile,
  saveDietaryProfile,
  getFoodRecents,
  searchFoods,
  getFoodById,
  estimateFood,
  parseNutritionLabel,
  identifyFood,
  createFood,
  type DietaryProfileResult,
  type FoodSummary,
  type FoodListResult,
  type FoodCandidate,
  type FoodCaptureResult,
  type FoodIdentifyResult,
  type FoodDetailResult,
  type CreateFoodInput,
  type ApiAvailability,
} from './api/foods.ts';

export {
  resolveFoods,
  foodSummaryFromResolve,
  portionHintFromResolve,
  type ResolveCandidate,
  type ResolveCandidateKind,
  type ResolveCaptureHint,
  type ResolveCapturePath,
  type ResolveFoodsResult,
  type ResolvePortionHint,
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

export {
  getHomeLocation,
  saveHomeLocation,
  clearHomeLocation,
  browserTimezone,
  getWeather,
  getTodayBrief,
  type HomeLocation,
  type LocationResult,
  type WeatherNow,
} from './api/location.ts';
