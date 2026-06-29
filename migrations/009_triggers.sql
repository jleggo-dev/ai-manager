-- General-purpose triggers for external-clock and event-driven job/workflow execution.
CREATE TABLE IF NOT EXISTS triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL DEFAULT 'external_clock',
  target_type text NOT NULL,
  target_slug text NOT NULL,
  config jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_triggers_workspace_slug UNIQUE (workspace_id, slug),
  CONSTRAINT triggers_target_type_check CHECK (target_type IN ('job', 'workflow'))
);

CREATE INDEX IF NOT EXISTS idx_triggers_workspace_slug ON triggers(workspace_id, slug);
