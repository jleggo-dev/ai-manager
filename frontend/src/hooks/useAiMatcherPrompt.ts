/**
 * AI Matcher prompt/mode/job state + reference-data loading.
 * Uses lib/interpolate via composeMatcherPrompt (FE-03).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { notifications } from '@mantine/notifications';
import * as api from '../services/api';
import type { Provider, AiProfile, ProcessingJob, JobVariable } from '../types/api';
import { composeMatcherPrompt } from '../lib/ai-matcher';

export function useAiMatcherPrompt() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [loadingRef, setLoadingRef] = useState(true);

  const [mode, setMode] = useState('free');
  const [selectedJobId, setSelectedJobId] = useState('');
  const [fetchedJobFull, setFetchedJobFull] = useState<ProcessingJob | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState('');

  const selectedJobFull = useMemo(
    () => (selectedJobId && fetchedJobFull?.id === selectedJobId ? fetchedJobFull : null),
    [selectedJobId, fetchedJobFull],
  );

  useEffect(() => {
    Promise.all([api.listProviders(), api.listAiProfiles(), api.listProcessingJobs()])
      .then(([p, a, j]) => {
        setProviders(p.data || []);
        setProfiles(a.data || []);
        setJobs(j.data || []);
      })
      .catch((err) =>
        notifications.show({
          title: 'Failed to load data',
          message: err instanceof Error ? err.message : 'Request failed',
          color: 'red',
        }),
      )
      .finally(() => setLoadingRef(false));
  }, []);

  const applyComposedPrompt = useCallback((template: string, vars: Record<string, string>) => {
    setPrompt(composeMatcherPrompt(template, vars));
  }, []);

  useEffect(() => {
    if (!selectedJobId) return;
    api
      .getProcessingJob(selectedJobId)
      .then((j) => {
        setFetchedJobFull(j);
        const vars: Record<string, string> = {};
        for (const v of j.config?.variables || []) {
          vars[v.name] = j.config?.testData?.[v.name] || '';
        }
        setVariables(vars);
        applyComposedPrompt(j.config?.promptTemplate || '', vars);
      })
      .catch((err) =>
        notifications.show({
          title: 'Failed to load job',
          message: err instanceof Error ? err.message : 'Request failed',
          color: 'red',
        }),
      );
  }, [selectedJobId, applyComposedPrompt]);

  function handleVarChange(name: string, value: string) {
    const updated = { ...variables, [name]: value };
    setVariables(updated);
    if (selectedJobFull) applyComposedPrompt(selectedJobFull.config?.promptTemplate || '', updated);
  }

  function resetPromptMode(nextMode: string) {
    setMode(nextMode);
    setPrompt('');
    setSelectedJobId('');
    setFetchedJobFull(null);
    setVariables({});
  }

  const jobOptions = jobs.map((j) => ({ value: j.id, label: `${j.name} (${j.slug})` }));
  const allVars: JobVariable[] = selectedJobFull?.config?.variables || [];
  const expectedSchema = mode === 'job' ? (selectedJobFull?.config?.expectedSchema ?? null) : null;
  const formattingRules =
    mode === 'job' && selectedJobFull?.config?.formattingRules ? selectedJobFull.config.formattingRules : [];

  return {
    providers,
    profiles,
    loadingRef,
    mode,
    resetPromptMode,
    selectedJobId,
    setSelectedJobId,
    variables,
    handleVarChange,
    prompt,
    setPrompt,
    jobOptions,
    allVars,
    expectedSchema,
    formattingRules,
  };
}
