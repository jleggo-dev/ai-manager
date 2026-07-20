import { useState, useEffect } from 'react';
import { buildStepJobData, loadProcessingJobs } from './helpers';
import type { StepJobData, WorkflowStepInfo } from './types';

export function useStepJobData(steps: WorkflowStepInfo[]) {
  const [stepData, setStepData] = useState<StepJobData[]>([]);
  const [loading, setLoading] = useState(steps.length > 0);

  useEffect(() => {
    let cancelled = false;

    async function loadJobs() {
      setLoading(true);
      const jobMap = await loadProcessingJobs(steps);
      if (cancelled) return;

      setStepData(buildStepJobData(steps, jobMap));
      setLoading(false);
    }

    if (steps.length === 0) return;
    loadJobs();
    return () => {
      cancelled = true;
    };
  }, [steps]);

  return { stepData, loading };
}
