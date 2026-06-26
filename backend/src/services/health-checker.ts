/**
 * Service – Health Checker
 * -------------------------
 * Executes a single health check against an AI profile using the
 * dedicated HC provider key. Reuses the LLM client factory so
 * provider types (devs-ai, google-gemini) are handled uniformly.
 *
 * Also manages the incident state machine:
 *   HEALTHY  → fail  → open incident
 *   INCIDENT → fail  → update failed_run_count
 *   INCIDENT → pass  → resolve incident
 */

import { createLlmClientForProvider } from '../integrations/client-factory.ts';
import { decryptSecret } from '../lib/crypto.ts';
import {
  serviceInsertRun,
  serviceUpdateCheckLastRun,
  serviceGetOpenIncident,
  serviceOpenIncident,
  serviceUpdateIncident,
  serviceResolveIncident,
} from '../models/health-checks.ts';
import type {
  HealthCheckRow,
  HealthCheckProfileRow,
  HealthCheckProviderKeyRow,
  HealthCheckRunRow,
  ProviderRow,
} from '../types.ts';

const MAX_RESPONSE_STORED = 500;
const TIMEOUT_MS = 30_000;

export interface HealthCheckResult {
  status: 'pass' | 'fail' | 'timeout' | 'error';
  responseTimeMs: number;
  errorMessage: string | null;
  rawResponse: string | null;
}

/**
 * Run a single health check: send the test message to the AI profile
 * and record whether it responded successfully.
 */
export async function executeHealthCheck(
  check: HealthCheckRow,
  profile: HealthCheckProfileRow,
  providerKeyRow: HealthCheckProviderKeyRow,
): Promise<HealthCheckResult> {
  const start = Date.now();

  try {
    const provider = profile.provider as ProviderRow | undefined;
    if (!provider) {
      return {
        status: 'error',
        responseTimeMs: Date.now() - start,
        errorMessage: 'Provider not found on health check profile',
        rawResponse: null,
      };
    }

    let apiKey = providerKeyRow.api_key;
    try {
      apiKey = decryptSecret(apiKey);
    } catch {
      /* already plaintext */
    }

    const syntheticProvider: ProviderRow = {
      ...provider,
      api_key: apiKey,
    };

    const client = createLlmClientForProvider(syntheticProvider);

    const completionPromise = client.chatCompletion(
      profile.external_ai_id,
      [{ role: 'user', content: check.test_message }],
      profile.runtime_options || {},
    );

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Health check timed out')), TIMEOUT_MS);
    });

    const result = await Promise.race([completionPromise, timeoutPromise]);
    const responseTimeMs = Date.now() - start;
    const content = result.choices?.[0]?.message?.content || '';

    return {
      status: 'pass',
      responseTimeMs,
      errorMessage: null,
      rawResponse: content.slice(0, MAX_RESPONSE_STORED),
    };
  } catch (err: unknown) {
    const responseTimeMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes('timed out');

    return {
      status: isTimeout ? 'timeout' : 'fail',
      responseTimeMs,
      errorMessage: message,
      rawResponse: null,
    };
  }
}

/**
 * Run a health check and persist results + update incident state.
 * Called by the scheduler and by the manual "Run Now" endpoint.
 */
export async function runAndRecordCheck(
  check: HealthCheckRow & { health_check_profile: HealthCheckProfileRow },
): Promise<HealthCheckRunRow> {
  const profile = check.health_check_profile;
  const providerKey = (profile as HealthCheckProfileRow & { hc_provider_key?: HealthCheckProviderKeyRow })
    .hc_provider_key;

  if (!providerKey) {
    const run = await serviceInsertRun({
      health_check_id: check.id,
      workspace_id: check.workspace_id,
      status: 'error',
      response_time_ms: 0,
      error_message: 'No HC provider key found for profile',
      raw_response: null,
    });
    await serviceUpdateCheckLastRun(check.id);
    return run;
  }

  const result = await executeHealthCheck(check, profile, providerKey);

  const run = await serviceInsertRun({
    health_check_id: check.id,
    workspace_id: check.workspace_id,
    status: result.status,
    response_time_ms: result.responseTimeMs,
    error_message: result.errorMessage,
    raw_response: result.rawResponse,
  });

  await serviceUpdateCheckLastRun(check.id);
  await updateIncidentState(check, result);

  return run;
}

async function updateIncidentState(check: HealthCheckRow, result: HealthCheckResult): Promise<void> {
  const openIncident = await serviceGetOpenIncident(check.id);
  const passed = result.status === 'pass';

  if (passed && openIncident) {
    await serviceResolveIncident(openIncident.id, openIncident.started_at);
    return;
  }

  if (!passed && openIncident) {
    await serviceUpdateIncident(openIncident.id, {
      failed_run_count: openIncident.failed_run_count + 1,
      last_error: result.errorMessage,
    });
    return;
  }

  if (!passed && !openIncident) {
    await serviceOpenIncident(check.id, check.workspace_id, result.errorMessage);
  }
}
