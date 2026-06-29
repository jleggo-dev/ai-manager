import { describe, it, expect } from 'vitest';
import {
  getToolJobsFromProfile,
  buildToolNameMap,
  parseToolArguments,
  buildToolDefinitions,
} from '../src/services/tool-jobs.ts';
import type { AiProfileRow } from '../src/types.ts';

describe('tool-jobs service', () => {
  it('getToolJobsFromProfile reads config.toolJobs', () => {
    const profile = {
      config: {
        toolJobs: [{ jobSlug: 'extract-data', exposeAs: 'extract_data', description: 'Extract structured data' }],
      },
    } as unknown as AiProfileRow;
    const jobs = getToolJobsFromProfile(profile);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.exposeAs).toBe('extract_data');
  });

  it('buildToolNameMap maps exposeAs to binding', () => {
    const jobs = [{ jobSlug: 'my-job', exposeAs: 'run_my_job' }];
    const map = buildToolNameMap(jobs);
    expect(map.get('run_my_job')?.jobSlug).toBe('my-job');
  });

  it('parseToolArguments handles JSON string and object', () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolArguments({ b: 2 })).toEqual({ b: 2 });
  });

  it('buildToolDefinitions returns empty for unknown slugs', async () => {
    const defs = await buildToolDefinitions([{ jobSlug: 'nonexistent-slug-xyz', exposeAs: 'noop' }]);
    expect(defs).toEqual([]);
  });
});
