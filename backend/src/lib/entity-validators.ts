/**
 * Entity Validators
 * -----------------
 * Semantic validation helpers that run after Zod schema parsing.
 * All queries use tenantFrom() to respect workspace isolation.
 * Returns the same { error, details } shape as the Zod middleware
 * so the frontend has one code path for validation errors.
 */

import { tenantFrom } from '../db/tenant.ts';

export interface ValidationDetail {
  path: string;
  message: string;
}

export interface ValidationResult {
  errors: ValidationDetail[];
  warnings: string[];
}

function result(): ValidationResult {
  return { errors: [], warnings: [] };
}

/**
 * Verify a referenced entity exists within the current workspace.
 * Uses tenantFrom() so RLS/workspace scoping is enforced automatically.
 */
export async function validateRef(
  table: string,
  id: string | null | undefined,
  fieldPath: string,
  label: string,
): Promise<ValidationDetail | null> {
  if (!id) return null;
  const { data, error } = await tenantFrom(table).select('id').eq('id', id).maybeSingle();
  if (error || !data) return { path: fieldPath, message: `${label} not found` };
  return null;
}

/**
 * Validate workflow step dependencies:
 * - Every depends_on value must reference an existing step_key
 * - No circular dependencies (topological sort)
 * - Warn on duplicate sort_order values
 */
export function validateWorkflowDeps(
  steps: { step_key: string; depends_on?: string[]; sort_order?: number }[],
): ValidationResult {
  const r = result();
  if (!steps || steps.length === 0) return r;

  const allKeys = new Set(steps.map((s) => s.step_key));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step) continue;
    const deps = step.depends_on ?? [];
    for (const dep of deps) {
      if (!allKeys.has(dep)) {
        r.errors.push({
          path: `steps.${i}.depends_on`,
          message: `Depends on "${dep}" but no step with that key exists`,
        });
      }
      if (dep === step.step_key) {
        r.errors.push({
          path: `steps.${i}.depends_on`,
          message: `Step "${step.step_key}" cannot depend on itself`,
        });
      }
    }
  }

  // Cycle detection via topological sort (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const s of steps) {
    inDegree.set(s.step_key, 0);
    adjacency.set(s.step_key, []);
  }
  for (const s of steps) {
    for (const dep of s.depends_on ?? []) {
      if (!allKeys.has(dep)) continue;
      adjacency.get(dep)?.push(s.step_key);
      inDegree.set(s.step_key, (inDegree.get(s.step_key) ?? 0) + 1);
    }
  }
  const queue: string[] = [];
  for (const [key, deg] of inDegree) {
    if (deg === 0) queue.push(key);
  }
  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift() as string;
    visited++;
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }
  if (visited < steps.length) {
    r.errors.push({
      path: 'steps',
      message: 'Circular dependency detected in step depends_on references',
    });
  }

  // Warn on duplicate sort_order
  const sortOrders = steps.filter((s) => s.sort_order != null).map((s) => s.sort_order as number);
  const seen = new Set<number>();
  for (const so of sortOrders) {
    if (seen.has(so)) {
      r.warnings.push(`Multiple steps share sort_order ${so}`);
      break;
    }
    seen.add(so);
  }

  return r;
}

/**
 * Validate cross-field rules (e.g., failover requires both provider and model).
 * Returns warnings for incomplete but non-fatal configurations.
 */
export function validateFailoverPair(
  failoverProviderId: string | null | undefined,
  failoverExternalAiId: string | null | undefined,
): string[] {
  const warnings: string[] = [];
  if (failoverProviderId && !failoverExternalAiId) {
    warnings.push('Failover provider set but no failover model specified');
  }
  if (!failoverProviderId && failoverExternalAiId) {
    warnings.push('Failover model specified but no failover provider set');
  }
  return warnings;
}

/**
 * Convenience: send a 400 response with validation errors if any exist.
 * Returns true if errors were sent (caller should return early).
 */
export function sendValidationErrors(
  res: { status: (code: number) => { json: (body: unknown) => unknown } },
  vr: ValidationResult,
): boolean {
  if (vr.errors.length === 0) return false;
  res.status(400).json({ error: 'Validation failed', details: vr.errors });
  return true;
}
