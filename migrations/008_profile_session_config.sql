-- Add config jsonb columns for tool jobs (profiles) and session compaction (chat sessions).
ALTER TABLE ai_profiles ADD COLUMN IF NOT EXISTS config jsonb DEFAULT '{}'::jsonb;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS config jsonb DEFAULT '{}'::jsonb;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS session_summary text;
