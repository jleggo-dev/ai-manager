import type { ProcessingJobGroupRow } from '../types.ts';
import { tenantFrom, tenantInsertPayload } from '../db/tenant.ts';

const TABLE = 'processing_job_groups';

export async function listProcessingJobGroups(appId: string = ''): Promise<ProcessingJobGroupRow[]> {
  let query = tenantFrom(TABLE)
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(1000);

  const appIdValue = String(appId || '').trim();
  if (appIdValue) {
    query = query.eq('app_id', appIdValue);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Processing job groups list error: ${error.message}`);
  return data || [];
}

export async function createProcessingJobGroup(data: Partial<ProcessingJobGroupRow>): Promise<ProcessingJobGroupRow> {
  const { data: row, error } = await tenantFrom(TABLE)
    .insert(
      tenantInsertPayload({
        app_id: data.app_id,
        name: data.name,
        slug: data.slug,
        sort_order: Number.isFinite(data.sort_order) ? data.sort_order : 0,
        updated_at: new Date().toISOString(),
      }),
    )
    .select()
    .single();
  if (error) throw new Error(`Processing job groups create error: ${error.message}`);
  return row;
}

export async function updateProcessingJobGroup(
  id: string,
  updates: Partial<ProcessingJobGroupRow>,
): Promise<ProcessingJobGroupRow> {
  const { name, slug, sort_order, description } = updates;
  const payload: Record<string, unknown> = {
    ...(name !== undefined && { name }),
    ...(slug !== undefined && { slug }),
    ...(sort_order !== undefined && { sort_order }),
    ...(description !== undefined && { description }),
    updated_at: new Date().toISOString(),
  };
  const { data: row, error } = await tenantFrom(TABLE).update(payload).eq('id', id).select().single();
  if (error) throw new Error(`Processing job groups update error: ${error.message}`);
  return row;
}

export async function deleteProcessingJobGroup(id: string): Promise<void> {
  const { error } = await tenantFrom(TABLE).delete().eq('id', id);
  if (error) throw new Error(`Processing job groups delete error: ${error.message}`);
}
