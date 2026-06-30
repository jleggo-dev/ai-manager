-- v2 provider threading metadata on chat sessions (Devs.ai Responses API v2).
ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS provider_metadata jsonb DEFAULT NULL;

COMMENT ON COLUMN chat_sessions.provider_metadata IS
  'Provider-specific session state. For devs-ai-v2: previous_response_id, conversation_id, last_sequence.';
