import type { ProcessingJob, ProcessingJobGroup, CallingApplication } from '../../../types/api';
import type { CallingAppEntry } from './types';
import { getJobConfig } from './types';

export function getCallingAppMeta(job: ProcessingJob, callingAppsLookup: Map<string, CallingApplication>) {
  const colId = job?.calling_application_id || null;
  const appId = colId || 'unknown-calling-application';
  const registered = callingAppsLookup?.get(appId);
  return {
    appId,
    appName: registered?.display_name || appId,
    isUnknown: !colId,
  };
}

export function buildJobsByCallingApp(
  jobs: ProcessingJob[],
  subgroups: ProcessingJobGroup[],
  callingAppsLookup: Map<string, CallingApplication>,
) {
  const appMap = new Map<string, CallingAppEntry>();
  const subgroupById = new Map<string, ProcessingJobGroup>((subgroups || []).map((g) => [g.id, g]));

  for (const job of jobs || []) {
    const meta = getCallingAppMeta(job, callingAppsLookup);
    if (!appMap.has(meta.appId)) {
      appMap.set(meta.appId, { ...meta, jobs: [], grouped: [], ungrouped: [], totalJobs: 0 });
    }
    const entry = appMap.get(meta.appId);
    if (entry) entry.jobs.push(job);
  }

  const apps: CallingAppEntry[] = [];
  for (const app of appMap.values()) {
    const appGroups = (subgroups || [])
      .filter((group) => group.app_id === app.appId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));

    const grouped = appGroups.map((group) => ({ group, jobs: [] as ProcessingJob[] }));
    const ungrouped: ProcessingJob[] = [];
    for (const job of app.jobs) {
      const subgroupId = getJobConfig(job).subgroupId || null;
      const subgroup = subgroupId ? subgroupById.get(subgroupId) : null;
      if (!subgroup || subgroup.app_id !== app.appId) {
        ungrouped.push(job);
        continue;
      }
      const target = grouped.find((entry) => entry.group.id === subgroup.id);
      if (target) target.jobs.push(job);
      else ungrouped.push(job);
    }

    apps.push({
      ...app,
      grouped,
      ungrouped,
      totalJobs: app.jobs.length,
    });
  }

  return apps.sort((a, b) => {
    if (a.isUnknown) return 1;
    if (b.isUnknown) return -1;
    return a.appName.localeCompare(b.appName);
  });
}
