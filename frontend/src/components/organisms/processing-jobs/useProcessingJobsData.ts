import { useState, useEffect, useCallback } from 'react';
import { notifications } from '@mantine/notifications';
import * as api from '../../../services/api';
import type { ProcessingJob, ProcessingJobGroup, AiProfile, CallingApplication } from '../../../types/api';
import type { FormattingRule } from './types';

/**
 * Loads and owns all top-level data for the Processing Jobs manager: the job list,
 * job groups, AI profiles, available formatting rules, calling applications, and the
 * currently-selected job's full detail (fetched separately since the list view only
 * carries summary fields).
 */
export function useProcessingJobsData() {
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [jobGroups, setJobGroups] = useState<ProcessingJobGroup[]>([]);
  const [aiProfiles, setAiProfiles] = useState<AiProfile[]>([]);
  const [availableRules, setAvailableRules] = useState<FormattingRule[]>([]);
  const [callingApps, setCallingApps] = useState<CallingApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [selectedJobFull, setSelectedJobFull] = useState<ProcessingJob | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [jobsResult, groupsData, profilesResult, rulesData, callingAppsResult] = await Promise.all([
        api.listProcessingJobs(),
        api.listProcessingJobGroups(),
        api.listAiProfiles(),
        api.listFormattingRules(),
        api.listCallingApplications(),
      ]);
      setJobs(jobsResult.data || []);
      setJobGroups(groupsData || []);
      setAiProfiles(profilesResult.data || []);
      setAvailableRules(rulesData || []);
      setCallingApps(callingAppsResult.data || []);
    } catch (err: unknown) {
      notifications.show({ title: 'Error', message: err instanceof Error ? err.message : String(err), color: 'red' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /* Load full job detail when a job is selected */
  useEffect(() => {
    if (!selectedJob) {
      setSelectedJobFull(null);
      return;
    }
    setSelectedJobFull(null);
    api
      .getProcessingJob(selectedJob)
      .then(setSelectedJobFull)
      .catch(() => setSelectedJobFull(null));
  }, [selectedJob]);

  return {
    jobs,
    jobGroups,
    aiProfiles,
    availableRules,
    callingApps,
    setCallingApps,
    loading,
    selectedJob,
    setSelectedJob,
    selectedJobFull,
    setSelectedJobFull,
    loadData,
  };
}
