-- Add slug to ai_profiles for config-as-code upsert-by-slug.
ALTER TABLE ai_profiles ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_profiles_workspace_slug ON ai_profiles(workspace_id, slug) WHERE slug IS NOT NULL;
