import { renderGate, type Mutates } from './tool-mutates.ts';

/**
 * The shape every coach ACTION tool takes.
 *
 * Its own module so a tool can live in its own file without importing the registry that collects
 * it — coach-actions.ts crossed the 500-line gate on 2026-08-17 and `update_constraint` moved out;
 * the next one to grow moves out the same way, with no cycle to untangle first.
 */
export interface CoachActionTool {
  name: string;
  /**
   * What calling it does to their data (tool-mutates.ts). An action is never `'none'` in practice
   * — the type allows it so the field means the same thing on every tool spec.
   */
  mutates: Mutates;
  /** LLM-facing. After `defineAction`, the `{gate}` token is already replaced by the sentence. */
  description: string;
  parameters: { properties: Record<string, unknown>; required?: string[] };
  /** Returns the text the model sees. Never throws for user-facing failure — it explains instead. */
  run(userId: string, params: Record<string, unknown>): Promise<string>;
}

/**
 * Every action is built through this, so its description's safety sentence comes from its
 * `mutates` field and cannot disagree with it. The returned tool carries the finished description:
 * nothing downstream ever sees the `{gate}` token.
 */
export function defineAction(spec: CoachActionTool): CoachActionTool {
  return { ...spec, description: renderGate(spec.description, spec.mutates) };
}
