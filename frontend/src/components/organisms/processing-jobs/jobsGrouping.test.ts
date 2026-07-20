import { describe, expect, it } from 'vitest';
import { buildJobsByCallingApp, getCallingAppMeta } from './jobsGrouping';
import type { CallingApplication, ProcessingJob, ProcessingJobGroup } from '../../../types/api';

function job(partial: Partial<ProcessingJob> & { id: string; name: string }): ProcessingJob {
  return {
    slug: partial.slug || partial.name.toLowerCase().replace(/\s+/g, '-'),
    description: '',
    is_active: true,
    ai_profile_id: null,
    calling_application_id: null,
    config: {},
    workspace_id: 'ws-1',
    created_at: '2024-01-01',
    ...partial,
  } as ProcessingJob;
}

describe('getCallingAppMeta', () => {
  it('marks missing calling_application_id as unknown', () => {
    const lookup = new Map<string, CallingApplication>();
    const meta = getCallingAppMeta(job({ id: 'j1', name: 'One' }), lookup);
    expect(meta.appId).toBe('unknown-calling-application');
    expect(meta.isUnknown).toBe(true);
  });

  it('resolves registered app display name', () => {
    const lookup = new Map<string, CallingApplication>([
      [
        'app-1',
        {
          id: 'app-1',
          display_name: 'Cadence',
          slug: 'cadence',
          workspace_id: 'ws-1',
          created_at: '2024-01-01',
        } as CallingApplication,
      ],
    ]);
    const meta = getCallingAppMeta(job({ id: 'j1', name: 'One', calling_application_id: 'app-1' }), lookup);
    expect(meta.appId).toBe('app-1');
    expect(meta.appName).toBe('Cadence');
    expect(meta.isUnknown).toBe(false);
  });
});

describe('buildJobsByCallingApp', () => {
  it('buckets jobs into groups and ungrouped under each app', () => {
    const appsLookup = new Map<string, CallingApplication>([
      [
        'app-1',
        {
          id: 'app-1',
          display_name: 'App One',
          slug: 'app-one',
          workspace_id: 'ws-1',
          created_at: '2024-01-01',
        } as CallingApplication,
      ],
    ]);
    const groups: ProcessingJobGroup[] = [
      { id: 'g1', app_id: 'app-1', name: 'Alpha', slug: 'alpha', sort_order: 0 } as ProcessingJobGroup,
    ];
    const jobs = [
      job({ id: 'j1', name: 'Grouped', calling_application_id: 'app-1', config: { subgroupId: 'g1' } }),
      job({ id: 'j2', name: 'Loose', calling_application_id: 'app-1', config: {} }),
      job({ id: 'j3', name: 'Orphan', calling_application_id: null, config: {} }),
    ];

    const result = buildJobsByCallingApp(jobs, groups, appsLookup);
    expect(result).toHaveLength(2);
    const [appOne, unknown] = result;
    expect(appOne?.appId).toBe('app-1');
    expect(appOne?.grouped[0]?.jobs.map((j) => j.id)).toEqual(['j1']);
    expect(appOne?.ungrouped.map((j) => j.id)).toEqual(['j2']);
    expect(unknown?.isUnknown).toBe(true);
    expect(unknown?.ungrouped.map((j) => j.id)).toEqual(['j3']);
  });
});
