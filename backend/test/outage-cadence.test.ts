/**
 * Unit tests for the outage cadence acceleration logic in
 * listDueChecks() and listDueWidgetChecks().
 *
 * We mock getServiceSupabase() to return a fluent-API stub so we can
 * control the rows returned by the health_checks / widget_health_checks
 * and incident tables without needing a live database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Supabase mock builder ─────────────────────────────────── */

type MockRow = Record<string, unknown>;

function buildSupabaseMock(tableData: Record<string, MockRow[]>) {
  function chainForTable(tableName: string) {
    let rows = [...(tableData[tableName] || [])];

    const result = () => ({ data: rows, error: null });

    const chain: Record<string, unknown> = {
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };

    chain.select = vi.fn().mockReturnValue(chain);
    chain.eq = vi.fn((_col: string, val: unknown) => {
      rows = rows.filter((r) => r[_col] === val);
      return chain;
    });
    chain.or = vi.fn().mockReturnValue(chain);
    chain.in = vi.fn((_col: string, ids: string[]) => {
      rows = (tableData[tableName] || []).filter((r) => ids.includes(r[_col] as string));
      return chain;
    });
    chain.is = vi.fn((_col: string, _val: unknown) => {
      rows = rows.filter((r) => r[_col] === null || r[_col] === undefined);
      return chain;
    });

    return chain;
  }

  return {
    from: vi.fn((table: string) => chainForTable(table)),
  };
}

/* ── Mock the service-supabase module ─────────────────────── */

let mockSb: ReturnType<typeof buildSupabaseMock>;

vi.mock('../src/db/service-supabase.ts', () => ({
  getServiceSupabase: () => mockSb,
}));

vi.mock('../src/db/tenant.ts', () => ({
  tenantFrom: vi.fn(),
  tenantInsertPayload: vi.fn(),
}));

vi.mock('../src/lib/crypto.ts', () => ({
  encryptSecret: vi.fn((v: string) => v),
  decryptSecret: vi.fn((v: string) => v),
}));

import { listDueChecks } from '../src/models/health-checks.ts';
import { listDueWidgetChecks } from '../src/models/widget-health-checks.ts';

/* ── Helpers ──────────────────────────────────────────────── */

const now = Date.now();

function makeApiCheck(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: 'chk-1',
    workspace_id: 'ws-1',
    health_check_profile_id: 'prof-1',
    name: 'API Check',
    test_message: 'ping',
    cadence_minutes: 15,
    outage_cadence_minutes: 2,
    is_active: true,
    last_run_at: new Date(now - 3 * 60_000).toISOString(), // 3 min ago
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    health_check_profile: { id: 'prof-1', provider: { id: 'p-1' } },
    ...overrides,
  };
}

function makeWidgetCheck(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: 'wchk-1',
    workspace_id: 'ws-1',
    name: 'Widget Check',
    url: 'https://example.com',
    test_message: 'hello',
    cadence_minutes: 15,
    outage_cadence_minutes: 2,
    is_active: true,
    last_run_at: new Date(now - 3 * 60_000).toISOString(), // 3 min ago
    max_retries: 1,
    launcher_selector: '',
    iframe_selector: '',
    input_selector: '',
    send_selector: '',
    response_selector: '',
    error_patterns: [],
    page_load_timeout_ms: 15000,
    response_timeout_ms: 45000,
    capture_screenshot: false,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  };
}

function makeIncident(checkId: string, fkCol: string): MockRow {
  return {
    id: 'inc-1',
    [fkCol]: checkId,
    workspace_id: 'ws-1',
    started_at: new Date(now - 60 * 60_000).toISOString(),
    resolved_at: null,
    duration_seconds: null,
    failed_run_count: 3,
    last_error: 'down',
    created_at: '2024-01-01',
  };
}

/* ── Tests: API health checks ────────────────────────────── */

describe('listDueChecks — outage cadence acceleration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses outage_cadence_minutes when an open incident exists (check becomes due)', async () => {
    const check = makeApiCheck({ last_run_at: new Date(now - 3 * 60_000).toISOString() });

    mockSb = buildSupabaseMock({
      health_checks: [check],
      health_check_incidents: [makeIncident('chk-1', 'health_check_id')],
    });

    const due = await listDueChecks();
    expect(due).toHaveLength(1);
    const firstDue = due[0] as (typeof due)[number];
    expect(firstDue.id).toBe('chk-1');
  });

  it('uses normal cadence_minutes when no open incident (check not yet due)', async () => {
    const check = makeApiCheck({ last_run_at: new Date(now - 3 * 60_000).toISOString() });

    mockSb = buildSupabaseMock({
      health_checks: [check],
      health_check_incidents: [], // no incidents
    });

    const due = await listDueChecks();
    expect(due).toHaveLength(0);
  });

  it('still returns checks with no last_run_at regardless of incident state', async () => {
    const check = makeApiCheck({ last_run_at: null });

    mockSb = buildSupabaseMock({
      health_checks: [check],
      health_check_incidents: [],
    });

    const due = await listDueChecks();
    expect(due).toHaveLength(1);
  });

  it('does not accelerate when incident is resolved (resolved_at is non-null)', async () => {
    const check = makeApiCheck({ last_run_at: new Date(now - 3 * 60_000).toISOString() });
    const resolvedIncident = {
      ...makeIncident('chk-1', 'health_check_id'),
      resolved_at: new Date().toISOString(),
    };

    mockSb = buildSupabaseMock({
      health_checks: [check],
      health_check_incidents: [resolvedIncident],
    });

    const due = await listDueChecks();
    expect(due).toHaveLength(0);
  });

  it('correctly handles mixed checks — one with incident, one without', async () => {
    const checkWithIncident = makeApiCheck({
      id: 'chk-1',
      last_run_at: new Date(now - 3 * 60_000).toISOString(),
    });
    const checkWithout = makeApiCheck({
      id: 'chk-2',
      last_run_at: new Date(now - 3 * 60_000).toISOString(),
    });

    mockSb = buildSupabaseMock({
      health_checks: [checkWithIncident, checkWithout],
      health_check_incidents: [makeIncident('chk-1', 'health_check_id')],
    });

    const due = await listDueChecks();
    expect(due).toHaveLength(1);
    const firstDue = due[0] as (typeof due)[number];
    expect(firstDue.id).toBe('chk-1');
  });
});

/* ── Tests: Widget health checks ─────────────────────────── */

describe('listDueWidgetChecks — outage cadence acceleration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses outage_cadence_minutes when an open incident exists (check becomes due)', async () => {
    const check = makeWidgetCheck({ last_run_at: new Date(now - 3 * 60_000).toISOString() });

    mockSb = buildSupabaseMock({
      widget_health_checks: [check],
      widget_health_check_incidents: [makeIncident('wchk-1', 'widget_health_check_id')],
    });

    const due = await listDueWidgetChecks();
    expect(due).toHaveLength(1);
    const firstDue = due[0] as (typeof due)[number];
    expect(firstDue.id).toBe('wchk-1');
  });

  it('uses normal cadence_minutes when no open incident (check not yet due)', async () => {
    const check = makeWidgetCheck({ last_run_at: new Date(now - 3 * 60_000).toISOString() });

    mockSb = buildSupabaseMock({
      widget_health_checks: [check],
      widget_health_check_incidents: [],
    });

    const due = await listDueWidgetChecks();
    expect(due).toHaveLength(0);
  });

  it('still returns checks with no last_run_at regardless of incident state', async () => {
    const check = makeWidgetCheck({ last_run_at: null });

    mockSb = buildSupabaseMock({
      widget_health_checks: [check],
      widget_health_check_incidents: [],
    });

    const due = await listDueWidgetChecks();
    expect(due).toHaveLength(1);
  });

  it('does not accelerate when incident is resolved', async () => {
    const check = makeWidgetCheck({ last_run_at: new Date(now - 3 * 60_000).toISOString() });
    const resolvedIncident = {
      ...makeIncident('wchk-1', 'widget_health_check_id'),
      resolved_at: new Date().toISOString(),
    };

    mockSb = buildSupabaseMock({
      widget_health_checks: [check],
      widget_health_check_incidents: [resolvedIncident],
    });

    const due = await listDueWidgetChecks();
    expect(due).toHaveLength(0);
  });

  it('correctly handles mixed checks — one with incident, one without', async () => {
    const checkWithIncident = makeWidgetCheck({
      id: 'wchk-1',
      last_run_at: new Date(now - 3 * 60_000).toISOString(),
    });
    const checkWithout = makeWidgetCheck({
      id: 'wchk-2',
      last_run_at: new Date(now - 3 * 60_000).toISOString(),
    });

    mockSb = buildSupabaseMock({
      widget_health_checks: [checkWithIncident, checkWithout],
      widget_health_check_incidents: [makeIncident('wchk-1', 'widget_health_check_id')],
    });

    const due = await listDueWidgetChecks();
    expect(due).toHaveLength(1);
    const firstDue = due[0] as (typeof due)[number];
    expect(firstDue.id).toBe('wchk-1');
  });
});
