/**
 * AI Manager — Data Source Upload
 * ================================
 * Upload structured rows to Devs.ai datasources using deterministic,
 * byte-capped chunking. This is AI Manager-owned logic so all calling
 * applications share one chunking behavior.
 */

import { getProcessingJobBySlug, getProcessingJob } from '../models/processing-jobs.ts';
import { hydrateAiProfileProviderKeys } from '../models/ai-profiles.ts';
import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import { DiagnosticSession } from '../services/ai-diagnostics.ts';
import { errorMessage } from '../lib/error-message.ts';
import type { ProviderRow } from '../types.ts';

interface UploadChunkedOptions {
  jobSlug?: string | null;
  jobId?: string | null;
  callingApplication?: string;
  rows?: Record<string, unknown>[];
  maxChunkBytes?: number;
  namePrefix?: string;
  operationType?: string;
  preDeleteSummary?: Record<string, unknown> | null;
}

interface UploadSummary {
  [key: string]: unknown;
  operationType: string;
  startedAt: string;
  jobSlug: string;
  aiProfileId: string | undefined;
  aiProfileName: string | undefined;
  aiId: string;
  maxBytesPerChunk: number;
  totalMappings: number;
  estimatedBytes: number;
  totalChunks: number;
  uploadedDataSources: Record<string, unknown>[];
  failedChunks: Record<string, unknown>[];
  preDeleteSummary: Record<string, unknown> | null;
  completedAt?: string;
  totalDurationMs?: number;
  status?: string;
}

/**
 * Upload structured rows to Devs.ai datasources using deterministic chunking.
 * This is AI Manager-owned logic so all calling applications share one behavior.
 *
 * NOTE: This function does NOT delete existing datasources. Calling applications
 * choose delete strategy and can pass delete results for diagnostics metadata.
 */
export async function uploadApiDataSourcesChunked(
  options: UploadChunkedOptions = {},
): Promise<Record<string, unknown>> {
  const {
    jobSlug = null,
    jobId = null,
    callingApplication = 'unknown',
    rows = [],
    maxChunkBytes = 750_000,
    namePrefix = 'datasource',
    operationType = 'datasource-upload',
    preDeleteSummary = null,
  } = options;

  if (!jobSlug && !jobId) {
    throw new Error('uploadApiDataSourcesChunked requires jobSlug or jobId');
  }

  const job = jobId ? await getProcessingJob(jobId) : await getProcessingJobBySlug(jobSlug ?? '');
  if (!job) throw new Error(`Processing job not found (${jobId || jobSlug})`);

  const profile = job.ai_profile ? hydrateAiProfileProviderKeys(job.ai_profile) : job.ai_profile;
  const provider: ProviderRow | undefined = profile?.provider;
  const aiId = String(profile?.external_ai_id || '').trim();
  if (!provider || provider.type !== 'devs-ai') {
    throw new Error('Chunked datasource upload is only supported for Devs.ai provider');
  }
  if (!aiId) throw new Error('Processing job AI profile has no external_ai_id');

  const diag = new DiagnosticSession(job.id, callingApplication, true, job.workspace_id);
  const startedAtMs = Date.now();
  const chunks = splitRowsByByteCap(rows, maxChunkBytes);
  const summary: UploadSummary = {
    operationType,
    startedAt: new Date(startedAtMs).toISOString(),
    jobSlug: job.slug,
    aiProfileId: profile?.id,
    aiProfileName: profile?.name,
    aiId,
    maxBytesPerChunk: maxChunkBytes,
    totalMappings: rows.length,
    estimatedBytes: payloadBytes(rows),
    totalChunks: chunks.length,
    uploadedDataSources: [],
    failedChunks: [],
    preDeleteSummary,
  };

  diag.logRequestPayload({
    operationType,
    jobSlug: job.slug,
    aiId,
    profileId: profile?.id,
    profileName: profile?.name,
    totalMappings: rows.length,
    maxChunkBytes,
  });

  try {
    if (!provider.api_key) {
      throw new Error(`Provider "${provider.name}" has no API key configured`);
    }
    const client = new DevsAiClient(provider.base_url, provider.api_key);
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkRows = chunks[i];
      if (!chunkRows) continue;
      const chunkBytes = payloadBytes(chunkRows);
      const chunkName = buildChunkName(namePrefix, i, chunks.length);
      try {
        const created = (await client.createApiDataSource(aiId, chunkName, {
          mappings: chunkRows,
        })) as Record<string, unknown> | null;
        const createdData = created?.data as Record<string, unknown> | undefined;
        const dataSourceId: string | null =
          (created?.dataSourceId as string) || (createdData?.id as string) || (created?.id as string) || null;
        let refreshed = false;
        let refreshError: string | null = null;
        if (dataSourceId) {
          try {
            await client.refreshDataSource(dataSourceId, true);
            refreshed = true;
          } catch (err: unknown) {
            refreshError = errorMessage(err);
          }
        }
        summary.uploadedDataSources.push({
          index: i,
          name: chunkName,
          rows: chunkRows.length,
          bytes: chunkBytes,
          dataSourceId,
          refreshed,
          refreshError,
        });
      } catch (err: unknown) {
        summary.failedChunks.push({
          index: i,
          name: chunkName,
          rows: chunkRows.length,
          bytes: chunkBytes,
          error: errorMessage(err),
        });
      }
    }

    summary.completedAt = new Date().toISOString();
    summary.totalDurationMs = Date.now() - startedAtMs;
    summary.status = summary.failedChunks.length > 0 ? 'partial_failure' : 'success';
    diag.addMetadata('operationType', operationType);
    diag.addMetadata('preDeleteSummary', preDeleteSummary);
    diag.addMetadata('uploadedDataSources', summary.uploadedDataSources);
    diag.addMetadata('failedChunks', summary.failedChunks);
    diag.addMetadata('totalMappings', summary.totalMappings);
    diag.addMetadata('totalChunks', summary.totalChunks);
    diag.addMetadata('estimatedBytes', summary.estimatedBytes);
    if (summary.failedChunks.length > 0) {
      await diag.complete('error', `Chunk upload failed for ${summary.failedChunks.length} chunk(s)`);
      throw Object.assign(
        new Error(`Datasource upload partial failure: ${summary.failedChunks.length} chunk(s) failed`),
        { summary },
      );
    }

    await diag.complete('success');
    return summary;
  } catch (err: unknown) {
    if (!(err instanceof Error && 'summary' in err)) {
      await diag.complete('error', errorMessage(err));
    }
    throw err;
  }
}

/* ── Internal helpers (not exported) ──────────────────────── */

function payloadBytes(rows: Record<string, unknown>[] = []): number {
  return Buffer.byteLength(JSON.stringify({ mappings: rows || [] }), 'utf8');
}

/**
 * Split rows into chunks that each stay under `maxBytes` when serialized as
 * `{ mappings: [...] }`, without ever re-serializing the whole growing chunk.
 *
 * Previously this re-ran `payloadBytes(candidate)` — a full JSON.stringify of
 * the entire accumulator — on every row appended, making the function O(n²)
 * for large row sets (SD4 / BE-01). Instead we track a running byte total:
 * each row's own serialized size is computed once, plus the constant
 * "empty payload" wrapper size and one comma byte per row after the first.
 * This mirrors exactly what `payloadBytes(candidate)` would have returned,
 * just computed incrementally in O(1) per row instead of O(row count).
 */
function splitRowsByByteCap(
  rows: Record<string, unknown>[] = [],
  maxBytes: number = 750_000,
): Record<string, unknown>[][] {
  const emptyPayloadBytes = payloadBytes([]);
  const chunks: Record<string, unknown>[][] = [];
  let current: Record<string, unknown>[] = [];
  let currentBytes = emptyPayloadBytes;

  for (const row of rows) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row), 'utf8');
    const commaBytes = current.length > 0 ? 1 : 0;
    const candidateBytes = currentBytes + rowBytes + commaBytes;

    if (current.length > 0 && candidateBytes > maxBytes) {
      chunks.push(current);
      current = [row];
      currentBytes = emptyPayloadBytes + rowBytes;
      continue;
    }
    if (current.length === 0 && candidateBytes > maxBytes) {
      chunks.push([row]);
      current = [];
      currentBytes = emptyPayloadBytes;
      continue;
    }
    current.push(row);
    currentBytes = candidateBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function utcTag(): string {
  const now = new Date();
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}-${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}`;
}

function buildChunkName(prefix: string, index: number, total: number): string {
  return `${prefix}-${utcTag()}-part-${index + 1}-of-${total}`;
}
