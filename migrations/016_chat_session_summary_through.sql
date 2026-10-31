-- Where a session's summary stops. Compaction folds only the rows after this mark into the
-- existing summary, and the history sent to the model is: instructions + summary + every row
-- after it. Without the mark, every message after the first compaction re-summarized the whole
-- older conversation (3 runs in 3 sends on 2026-08-31). Nullable: a session that has never
-- compacted has no mark, and neither does one compacted before this column existed.
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS summary_through_at timestamptz;
