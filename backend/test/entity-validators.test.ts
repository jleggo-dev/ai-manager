import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateWorkflowDeps, validateFailoverPair, sendValidationErrors } from '../src/lib/entity-validators.ts';
import { tenantFrom } from '../src/db/tenant.ts';

vi.mock('../src/db/tenant.ts', () => ({
  tenantFrom: vi.fn(),
}));

/* ------------------------------------------------------------------ */
/*  validateWorkflowDeps                                              */
/* ------------------------------------------------------------------ */
describe('validateWorkflowDeps', () => {
  it('returns empty result for an empty array', () => {
    const r = validateWorkflowDeps([]);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('returns no errors for steps with no dependencies', () => {
    const r = validateWorkflowDeps([
      { step_key: 'a', sort_order: 1 },
      { step_key: 'b', sort_order: 2 },
    ]);
    expect(r.errors).toHaveLength(0);
    expect(r.warnings).toHaveLength(0);
  });

  it('returns no errors for a valid dependency chain', () => {
    const r = validateWorkflowDeps([
      { step_key: 'a', sort_order: 1 },
      { step_key: 'b', depends_on: ['a'], sort_order: 2 },
      { step_key: 'c', depends_on: ['b'], sort_order: 3 },
    ]);
    expect(r.errors).toHaveLength(0);
  });

  it('detects a missing dependency reference', () => {
    const r = validateWorkflowDeps([{ step_key: 'a' }, { step_key: 'b', depends_on: ['nonexistent'] }]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.path).toBe('steps.1.depends_on');
    expect(r.errors[0]?.message).toContain('nonexistent');
  });

  it('detects a self-referencing dependency', () => {
    const r = validateWorkflowDeps([{ step_key: 'a', depends_on: ['a'] }]);
    const selfRef = r.errors.find((e) => e.message.includes('cannot depend on itself'));
    expect(selfRef).toBeDefined();
  });

  it('detects circular dependencies (A -> B -> A)', () => {
    const r = validateWorkflowDeps([
      { step_key: 'a', depends_on: ['b'] },
      { step_key: 'b', depends_on: ['a'] },
    ]);
    const cycle = r.errors.find((e) => e.message.includes('Circular dependency'));
    expect(cycle).toBeDefined();
  });

  it('detects a longer cycle (A -> B -> C -> A)', () => {
    const r = validateWorkflowDeps([
      { step_key: 'a', depends_on: ['c'] },
      { step_key: 'b', depends_on: ['a'] },
      { step_key: 'c', depends_on: ['b'] },
    ]);
    const cycle = r.errors.find((e) => e.message.includes('Circular dependency'));
    expect(cycle).toBeDefined();
  });

  it('warns on duplicate sort_order values', () => {
    const r = validateWorkflowDeps([
      { step_key: 'a', sort_order: 1 },
      { step_key: 'b', sort_order: 1 },
    ]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('sort_order');
  });

  it('does not warn when sort_order values are unique', () => {
    const r = validateWorkflowDeps([
      { step_key: 'a', sort_order: 1 },
      { step_key: 'b', sort_order: 2 },
    ]);
    expect(r.warnings).toHaveLength(0);
  });

  it('does not warn when sort_order is omitted', () => {
    const r = validateWorkflowDeps([{ step_key: 'a' }, { step_key: 'b' }]);
    expect(r.warnings).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  validateFailoverPair                                              */
/* ------------------------------------------------------------------ */
describe('validateFailoverPair', () => {
  it('returns no warnings when both provider and model are set', () => {
    expect(validateFailoverPair('prov-1', 'model-1')).toHaveLength(0);
  });

  it('returns no warnings when both are null', () => {
    expect(validateFailoverPair(null, null)).toHaveLength(0);
  });

  it('returns no warnings when both are undefined', () => {
    expect(validateFailoverPair(undefined, undefined)).toHaveLength(0);
  });

  it('warns when only provider is set', () => {
    const w = validateFailoverPair('prov-1', null);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('no failover model');
  });

  it('warns when only model is set', () => {
    const w = validateFailoverPair(null, 'model-1');
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('no failover provider');
  });
});

/* ------------------------------------------------------------------ */
/*  validateRef                                                       */
/* ------------------------------------------------------------------ */
describe('validateRef', () => {
  const mockSelect = vi.fn();
  const mockEq = vi.fn();
  const mockMaybeSingle = vi.fn();
  const mockTenantFrom = vi.mocked(tenantFrom);

  beforeEach(() => {
    vi.clearAllMocks();
    mockTenantFrom.mockReturnValue({
      select: mockSelect.mockReturnValue({
        eq: mockEq.mockReturnValue({
          maybeSingle: mockMaybeSingle,
        }),
      }),
    } as unknown as ReturnType<typeof tenantFrom>);
  });

  // Dynamic import so the module-level mock is already in place
  async function callValidateRef(table: string, id: string | null | undefined, fieldPath: string, label: string) {
    const mod = await import('../src/lib/entity-validators.ts');
    return mod.validateRef(table, id, fieldPath, label);
  }

  it('returns null when id is null (skips check)', async () => {
    const result = await callValidateRef('providers', null, 'provider_id', 'Provider');
    expect(result).toBeNull();
    expect(mockTenantFrom).not.toHaveBeenCalled();
  });

  it('returns null when id is undefined (skips check)', async () => {
    const result = await callValidateRef('providers', undefined, 'provider_id', 'Provider');
    expect(result).toBeNull();
    expect(mockTenantFrom).not.toHaveBeenCalled();
  });

  it('returns null when the entity is found', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: 'abc-123' }, error: null });
    const result = await callValidateRef('providers', 'abc-123', 'provider_id', 'Provider');
    expect(result).toBeNull();
    expect(mockTenantFrom).toHaveBeenCalledWith('providers');
    expect(mockSelect).toHaveBeenCalledWith('id');
    expect(mockEq).toHaveBeenCalledWith('id', 'abc-123');
  });

  it('returns error detail when entity is not found', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const result = await callValidateRef('providers', 'missing-id', 'provider_id', 'Provider');
    expect(result).toEqual({ path: 'provider_id', message: 'Provider not found' });
  });

  it('returns error detail when the query errors', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'db error' } });
    const result = await callValidateRef('providers', 'err-id', 'provider_id', 'Provider');
    expect(result).toEqual({ path: 'provider_id', message: 'Provider not found' });
  });
});

/* ------------------------------------------------------------------ */
/*  sendValidationErrors                                              */
/* ------------------------------------------------------------------ */
describe('sendValidationErrors', () => {
  function mockRes() {
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    return { status, json };
  }

  it('returns false and does not call res.status when there are no errors', () => {
    const res = mockRes();
    const sent = sendValidationErrors(res, { errors: [], warnings: [] });
    expect(sent).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns true and sends 400 response when errors exist', () => {
    const res = mockRes();
    const vr = {
      errors: [{ path: 'name', message: 'required' }],
      warnings: [],
    };
    const sent = sendValidationErrors(res, vr);
    expect(sent).toBe(true);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: vr.errors,
    });
  });

  it('sends all error details when multiple errors exist', () => {
    const res = mockRes();
    const vr = {
      errors: [
        { path: 'name', message: 'required' },
        { path: 'provider_id', message: 'Provider not found' },
      ],
      warnings: ['some warning'],
    };
    const sent = sendValidationErrors(res, vr);
    expect(sent).toBe(true);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: vr.errors,
    });
  });
});
