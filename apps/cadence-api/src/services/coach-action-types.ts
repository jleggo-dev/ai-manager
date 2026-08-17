/**
 * The shape every coach ACTION tool takes.
 *
 * Its own module so a tool can live in its own file without importing the registry that collects
 * it — coach-actions.ts crossed the 500-line gate on 2026-08-17 and `update_constraint` moved out;
 * the next one to grow moves out the same way, with no cycle to untangle first.
 */
export interface CoachActionTool {
  name: string;
  description: string;
  parameters: { properties: Record<string, unknown>; required?: string[] };
  /** Returns the text the model sees. Never throws for user-facing failure — it explains instead. */
  run(userId: string, params: Record<string, unknown>): Promise<string>;
}
