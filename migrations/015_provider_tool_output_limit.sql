-- Per-provider ceiling on how large a tool result may be, in characters.
--
-- Sits beside request_timeout_ms and resolves the same way: most specific tier wins
-- (toolJobs[].maxOutputChars -> ai_profiles.runtime_options.tools.max_output_chars ->
-- this column -> app_settings 'default_tool_output_chars' -> a code floor).
--
-- This tier is the provider's own fact: every upstream has a payload/context wall we do not
-- control, and sitting below it means we fail predictably at our layer -- cleanly, with a message
-- the model can act on -- rather than discovering theirs mid-turn.
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS max_tool_output_chars integer DEFAULT NULL;

COMMENT ON COLUMN providers.max_tool_output_chars IS
  'Max characters of a single tool result for jobs using this provider. NULL = inherit the app default. Structured results over the limit are replaced with an error object, never truncated.';
