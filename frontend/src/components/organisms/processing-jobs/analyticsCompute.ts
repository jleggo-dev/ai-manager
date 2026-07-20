import type { DiagnosticLog } from '../../../types/api';
import type {
  ExpectedSchema,
  SchemaFieldDefExtended,
  SchemaFieldDetail,
  SchemaValidationResult,
  FieldFrequency,
  AnalyticsData,
} from './types';

export function validateAgainstExpectedSchema(
  text: string,
  expectedSchema: ExpectedSchema | null | undefined,
): SchemaValidationResult {
  const result: SchemaValidationResult = {
    jsonValid: false,
    fieldsTotal: 0,
    fieldsPopulated: 0,
    fieldsCorrectType: 0,
    requiredTotal: 0,
    requiredPresent: 0,
    unexpectedFields: 0,
    fieldDetails: [] as SchemaFieldDetail[],
  };

  /* Try JSON parse */
  let parsed;
  try {
    /* Strip markdown fences if present */
    const clean = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
    parsed = JSON.parse(clean);
    result.jsonValid = true;
  } catch {
    return result;
  }

  /* Non-object responses can't be validated field-by-field */
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return result;
  }

  const fields = expectedSchema?.fields || {};
  const schemaKeys = new Set(Object.keys(fields));

  for (const [name, def] of Object.entries(fields) as [string, SchemaFieldDefExtended][]) {
    result.fieldsTotal++;
    if (def.required) result.requiredTotal++;

    const val = parsed[name];
    const isPopulated = val != null && val !== '' && !(Array.isArray(val) && val.length === 0);

    /* Check type correctness */
    let typeCorrect = false;
    if (isPopulated) {
      result.fieldsPopulated++;
      if (def.required) result.requiredPresent++;

      if (def.type === 'array' && Array.isArray(val)) typeCorrect = true;
      else if (def.type === 'string' && typeof val === 'string') typeCorrect = true;
      else if (def.type === 'number' && typeof val === 'number') typeCorrect = true;
      else if (def.type === 'boolean' && typeof val === 'boolean') typeCorrect = true;
      else if (!def.type) typeCorrect = true; /* no type constraint */

      if (typeCorrect) result.fieldsCorrectType++;
    }

    result.fieldDetails.push({
      field: name,
      label: def.description || name,
      required: !!def.required,
      populated: isPopulated,
      typeCorrect,
      value: isPopulated ? (Array.isArray(val) ? val.join(', ') : String(val)).slice(0, 100) : null,
    });
  }

  /* Count unexpected fields not in the schema */
  result.unexpectedFields = Object.keys(parsed).filter((k) => !schemaKeys.has(k)).length;

  return result;
}

function buildModelBreakdown(logs: DiagnosticLog[]) {
  const modelUsage = new Map();
  for (const log of logs) {
    const modelId =
      String(log?.llm_timing?.model || log?.llm_request?.model || log?.metadata?.primaryModel || 'unknown').trim() ||
      'unknown';
    const providerId = String(log?.llm_timing?.provider || log?.llm_request?.provider || 'unknown').trim() || 'unknown';
    const key = `${providerId}::${modelId}`;
    if (!modelUsage.has(key)) {
      modelUsage.set(key, {
        provider: providerId,
        model: modelId,
        calls: 0,
        success: 0,
        errors: 0,
        failoverCalls: 0,
        llmDurations: [] as number[],
        totalDurations: [] as number[],
      });
    }
    const row = modelUsage.get(key);
    row.calls += 1;
    if (log?.status === 'success') row.success += 1;
    if (log?.status === 'error') row.errors += 1;
    if (String(log?.metadata?.failoverUsed) === 'true') row.failoverCalls += 1;
    if (typeof log?.llm_timing?.durationMs === 'number') row.llmDurations.push(log.llm_timing.durationMs);
    if (typeof log?.total_duration_ms === 'number') row.totalDurations.push(log.total_duration_ms);
  }

  return [...modelUsage.values()]
    .map((row) => ({
      ...row,
      avgLlmMs:
        row.llmDurations.length > 0
          ? Math.round(row.llmDurations.reduce((a: number, b: number) => a + b, 0) / row.llmDurations.length)
          : null,
      avgTotalMs:
        row.totalDurations.length > 0
          ? Math.round(row.totalDurations.reduce((a: number, b: number) => a + b, 0) / row.totalDurations.length)
          : null,
      successRate: row.calls > 0 ? Math.round((row.success / row.calls) * 100) : 0,
    }))
    .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model));
}

function buildFieldBreakdown(validParses: SchemaValidationResult[]): FieldFrequency[] {
  const fieldFrequency: Record<string, FieldFrequency> = {};
  for (const v of validParses) {
    for (const f of v.fieldDetails) {
      if (!fieldFrequency[f.field]) {
        fieldFrequency[f.field] = { field: f.field, label: f.label, required: f.required, count: 0, total: 0, rate: 0 };
      }
      const entry = fieldFrequency[f.field];
      if (entry) {
        entry.total++;
        if (f.populated) entry.count++;
      }
    }
  }
  return Object.values(fieldFrequency).map((f) => ({
    ...f,
    rate: Math.round((f.count / f.total) * 100),
  }));
}

/**
 * Compute aggregate analytics from an array of diagnostic logs
 * and the job's expected schema.
 *
 * @param {Array} logs — diagnostic log entries
 * @param {object} expectedSchema — the job's expectedSchema config
 * @param {Set|null} contentFields — if provided, only these fields count
 *   towards the Content score. null = all fields count.
 */
export function computeAnalytics(
  logs: DiagnosticLog[],
  expectedSchema: ExpectedSchema | null | undefined,
  contentFields: Set<string> | null = null,
): AnalyticsData {
  if (!logs || logs.length === 0) {
    return { hasData: false };
  }

  /* ── Speed Metrics ─────────────────────────────────── */
  const llmDurations = logs.map((l) => l.llm_timing?.durationMs).filter((d): d is number => typeof d === 'number');

  const totalDurations = logs.map((l) => l.total_duration_ms).filter((d): d is number => typeof d === 'number');

  const tokenUsage = logs
    .map((l) => l.llm_response?.usage)
    .filter((u): u is { prompt_tokens?: number; completion_tokens?: number } => !!u);

  const avgLlm =
    llmDurations.length > 0
      ? Math.round(llmDurations.reduce((a: number, b: number) => a + b, 0) / llmDurations.length)
      : null;
  const minLlm = llmDurations.length > 0 ? Math.min(...llmDurations) : null;
  const maxLlm = llmDurations.length > 0 ? Math.max(...llmDurations) : null;

  const avgTotal =
    totalDurations.length > 0
      ? Math.round(totalDurations.reduce((a: number, b: number) => a + b, 0) / totalDurations.length)
      : null;

  const avgPromptTokens =
    tokenUsage.length > 0
      ? Math.round(tokenUsage.reduce((a, u) => a + (u.prompt_tokens || 0), 0) / tokenUsage.length)
      : null;
  const avgCompletionTokens =
    tokenUsage.length > 0
      ? Math.round(tokenUsage.reduce((a, u) => a + (u.completion_tokens || 0), 0) / tokenUsage.length)
      : null;

  /* ── Content & Accuracy Metrics ────────────────────── */
  const validationResults = logs
    .map((l) => {
      const rawContent = l.llm_response?.rawContent;
      if (!rawContent) return null;
      return validateAgainstExpectedSchema(rawContent, expectedSchema);
    })
    .filter((v): v is SchemaValidationResult => v !== null);

  const jsonParseSuccessCount = validationResults.filter((v) => v.jsonValid).length;
  const jsonParseRate =
    validationResults.length > 0 ? Math.round((jsonParseSuccessCount / validationResults.length) * 100) : null;

  const validParses = validationResults.filter((v): v is SchemaValidationResult => v.jsonValid && v.fieldsTotal > 0);

  let avgFieldCoverage = null;
  let avgRequiredCoverage = null;
  let scoredFieldCount = 0;

  if (validParses.length > 0) {
    const coverages = validParses.map((v) => {
      const relevant = contentFields ? v.fieldDetails.filter((f) => contentFields.has(f.field)) : v.fieldDetails;
      const total = relevant.length;
      const populated = relevant.filter((f) => f.populated).length;
      return total > 0 ? (populated / total) * 100 : 0;
    });
    avgFieldCoverage = Math.round(coverages.reduce((a: number, b: number) => a + b, 0) / coverages.length);

    const reqCoverages = validParses.map((v) => {
      const reqFields = v.fieldDetails.filter((f) => f.required);
      const total = reqFields.length;
      const present = reqFields.filter((f) => f.populated).length;
      return total > 0 ? (present / total) * 100 : 100;
    });
    avgRequiredCoverage = Math.round(reqCoverages.reduce((a: number, b: number) => a + b, 0) / reqCoverages.length);

    scoredFieldCount = contentFields ? contentFields.size : Object.keys(expectedSchema?.fields || {}).length;
  }

  const avgTypeConformance =
    validParses.length > 0
      ? Math.round(
          validParses.reduce(
            (a: number, v: SchemaValidationResult) => a + (v.fieldsCorrectType / Math.max(v.fieldsPopulated, 1)) * 100,
            0,
          ) / validParses.length,
        )
      : null;

  const finishReasons = logs.map((l) => l.llm_response?.finishReason).filter(Boolean);
  const stopCount = finishReasons.filter((r) => r === 'stop').length;
  const completionRate = finishReasons.length > 0 ? Math.round((stopCount / finishReasons.length) * 100) : null;

  const errorCount = logs.filter((l) => l.status === 'error').length;
  const errorRate = Math.round((errorCount / logs.length) * 100);

  const modelBreakdown = buildModelBreakdown(logs);
  const fieldBreakdown = buildFieldBreakdown(validParses);

  const accuracyScore =
    jsonParseRate != null && avgRequiredCoverage != null && avgTypeConformance != null && completionRate != null
      ? Math.round(
          jsonParseRate * 0.25 +
            (avgRequiredCoverage ?? 0) * 0.25 +
            (avgTypeConformance ?? 0) * 0.25 +
            completionRate * 0.25,
        )
      : null;

  const totalFailoverCalls = modelBreakdown.reduce((sum, m) => sum + m.failoverCalls, 0);
  const failoverRate = logs.length > 0 ? Math.round((totalFailoverCalls / logs.length) * 100) : 0;

  return {
    hasData: true,
    logCount: logs.length,
    avgLlm,
    minLlm,
    maxLlm,
    avgTotal,
    avgPromptTokens,
    avgCompletionTokens,
    llmDurations,
    avgFieldCoverage,
    avgRequiredCoverage,
    validationCount: validParses.length,
    fieldBreakdown,
    scoredFieldCount,
    jsonParseRate,
    avgTypeConformance,
    completionRate,
    errorRate,
    accuracyScore,
    distinctModels: modelBreakdown.length,
    modelBreakdown,
    totalFailoverCalls,
    failoverRate,
  };
}

/** Score badge with colour coding based on percentage */
/** Format milliseconds for display */
export function fmtMs(ms: number | null | undefined) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
