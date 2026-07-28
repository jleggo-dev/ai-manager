# Design brief — Food & nutrition module in the redesign

**Goal.** Design how food logging and the wider nutrition module live inside the redesigned app
(the sky-trail Today + the task-shape model), **reusing the substantial food features that already
exist**. Food logging might be a quick capture, a multi-step flow, or "a special module the coach
points you to" — recommending that framing is part of the job.

## Read these first
- **Visual language:** [`redesign-today-trail/README.md`](redesign-today-trail/README.md) — the nodes /
  discs, the sheets (§3 start sheet, §5 log sheet), the tokens, and the nutrition (apple) disc.
- **What the food system already does (Req 5):** [`../REQ5-food-and-recipes.md`](../REQ5-food-and-recipes.md).
- **Brand + nomenclature:** [`../BRAND.md`](../BRAND.md).

## What already exists (design AROUND it — don't reinvent)
Most of these are **built and working**; the design job is to surface them coherently in the new system.
- **Per-meal capture** — the redesign already split the single daily "Food log" into **Log breakfast /
  lunch / snack / dinner** trail tasks, each opening a minimal capture:
  `apps/cadence-web/src/features/plan/CaptureSheet.tsx` + `occurrence/MealLogPanel.tsx` (text / photo / mic,
  day macro totals, provisional-then-confirm estimates, meal pre-selected from the task).
- **Today's calorie / macro rings + day totals + targets:** `apps/cadence-web/src/lib/api/nutrition.ts`.
- **A "simpler MyFitnessPal" log:** `features/food/FoodSayPanel.tsx` (type/say), `FoodSnapPanel.tsx` (photo),
  `FoodBarcodePanel.tsx` (barcode), `FoodPortionConfirm.tsx` (**quantities**), backed by
  `lib/api/foods.ts` + `foods-resolve.ts`.
- **Pre-eat "should I?" plate advice:** `getPlateAdvice` (nutrition.ts), used inside MealLogPanel.
- **Weekly menu, recipes, fridge-photo, shopping list:** `features/food/MealPlansPanel.tsx`,
  `MealPlanShoppingList.tsx`, `RecipesPanel.tsx`, `RecipeFromChatPanel.tsx`, `FridgeFromPhotoPanel.tsx`,
  `RecipeDiscoverPanel.tsx`; APIs in `lib/api/recipes.ts` + `meal-plans.ts`.
- **The current Food tab that hosts most of this:** `features/food/FoodView.tsx` (pre-redesign styling).

## What we want designed
Bring these together in the redesign's language:
1. **The meal capture** (tap "Log breakfast") — the fast, honest log: photo / say / type / pick a saved food
   or recipe, with **quantities** so the macros are real, and today's **rings** shown in context. It's a
   *capture*, not a walkthrough — keep it quick, no "Start / less time".
2. **The nutrition home** (the Food tab, restyled) — today's rings + what's remaining, recent meals, and clear
   entry points into the richer tools below.
3. **Ask-before-eating** — the plate-advice moment, in the redesign's voice.
4. **Plan-ahead** — the coach suggests a **weekly menu**; suggests a **recipe from ingredients or a photo of
   the fridge**.
5. **Shopping list** — derived from the week's menu. Consider a **shopping task** the user can follow (a
   one-step check-off on the trail?), optionally grouped by **store area / aisle**.
6. **How food fits the task-shape model** — is a meal always a "capture", or can the coach make it multi-step
   (e.g. "log it → glance at your rings → note how it felt")? Recommend the model.

## Constraints
- **Reuse** the capabilities above — this is presentation + flow, not new backend.
- Meals appear on the **Today trail** as nodes with the nutrition (apple) disc; the fuller module lives deeper
  (Food tab / sheets).
- Nomenclature per [`../BRAND.md`](../BRAND.md).
- oklch tokens, Fraunces/Nunito, pressable discs + bottom-anchored sheets from the handoff.

## Deliverables
Screens / states with redlines in the handoff's format: the **meal capture sheet** (rings + quantities),
the restyled **Food / nutrition home**, the **plate-advice** moment, the **weekly-menu + recipe-from-ingredients**
flow, and the **shopping list** (including the shopping-task idea). Call out the shape-model recommendation.
