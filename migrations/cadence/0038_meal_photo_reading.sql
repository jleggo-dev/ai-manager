-- 0038 — keep what the eyes actually said about the photo.
--
-- Two-stage photo logging asks a vision model for PROSE first ("assume a 250ml latte: roughly
-- 200ml milk, 50ml espresso; I cannot see inside the closed lid, so I cannot tell the milk type"),
-- and only then turns that into numbers. The prose is the valuable half and it had nowhere to
-- live: generated, used once, discarded.
--
-- Keeping it buys three things the JSON alone cannot:
--   1. The user can SEE why a number is what it is, and correct the reading rather than the total.
--      "That's oat milk" fixes the cause; editing kcal fixes the symptom.
--   2. A wrong estimate becomes diagnosable after the fact. The 2026-08-20 zero-calorie meals were
--      undiagnosable precisely because nothing but the empty result survived.
--   3. The eval harness gets real inputs — descriptions of real plates, with the user's correction
--      as ground truth attached.
--
-- Nullable, and every existing row keeps NULL: meals logged by text, barcode, recipe or saved food
-- never had a photo to read, and a photo log whose read failed legitimately has nothing to store.
alter table cadence.nutrition_logs
  add column if not exists photo_reading text;

comment on column cadence.nutrition_logs.photo_reading is
  'Stage-1 prose from describe-meal-photo: what the model saw, the portion it committed to, and what it could not tell. NULL for any meal not logged from a photo, and for a photo whose read failed. May be the user''s EDITED version — a correction outranks anything the model saw.';
