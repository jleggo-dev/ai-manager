/**
 * PLACEHOLDER — the real "Nutrition" screen (targets, allergies, things to skip — folding in the
 * existing NutritionTargets and DietaryProfileEditor) is owned by another Settings Room wave
 * parcel, not SR-3 (the room shell). This file exists only so SettingsRoom.tsx has a real module
 * to import at integration time; it renders nothing.
 *
 * When that parcel lands, this file is replaced outright — it is not meant to grow into the real
 * screen in place.
 */
export function SettingsNutrition(_props: { onBack: () => void; onCoach?: (note: string) => void }) {
  return null;
}
