/**
 * Parallel AI Matcher slot execution — fires slots independently so results
 * stream in as each completes. Extracted from AiMatcherPage.tsx (FE-03).
 */

import { useState, useCallback } from 'react';
import { notifications } from '@mantine/notifications';
import * as api from '../services/api';
import type { AiMatcherSlotResult } from '../types/api';
import { isSlotConfigured, toMatcherSlotPayload, type SlotConfig } from '../lib/ai-matcher';

export interface RunComparisonArgs {
  prompt: string;
  slots: SlotConfig[];
  formattingRules: Record<string, unknown>[];
}

export function useAiMatcherExecution() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<(AiMatcherSlotResult | null)[] | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalSlotCount, setTotalSlotCount] = useState(0);

  const clearResults = useCallback(() => setResults(null), []);

  const runComparison = useCallback(async ({ prompt, slots, formattingRules }: RunComparisonArgs) => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      notifications.show({ title: 'Missing prompt', message: 'Enter a prompt before running.', color: 'orange' });
      return;
    }

    const validSlots = slots.filter(isSlotConfigured);
    if (validSlots.length === 0) {
      notifications.show({ title: 'No AI configured', message: 'Configure at least one AI slot.', color: 'orange' });
      return;
    }

    const placeholders = validSlots.map(() => null);
    setResults(placeholders);
    setCompletedCount(0);
    setTotalSlotCount(validSlots.length);
    setRunning(true);

    const promises = validSlots.map((s, idx) => {
      const slot = toMatcherSlotPayload(s);

      return api
        .runAiMatcherSlot({ prompt: trimmed, slot, formattingRules, slotIndex: idx })
        .then((data) => {
          setResults((prev) => prev?.map((r, i) => (i === idx ? data : r)) ?? null);
          setCompletedCount((c) => c + 1);
        })
        .catch((err) => {
          const errorResult: AiMatcherSlotResult = {
            slotIndex: idx,
            status: 'error',
            raw: null,
            formatted: null,
            formattingSteps: null,
            durationMs: null,
            model: 'unknown',
            provider: null,
            profileName: null,
            usage: null,
            finishReason: null,
            error: err instanceof Error ? err.message : 'Request failed',
          };
          setResults((prev) => prev?.map((r, i) => (i === idx ? errorResult : r)) ?? null);
          setCompletedCount((c) => c + 1);
        });
    });

    await Promise.allSettled(promises);
    setRunning(false);
  }, []);

  return {
    running,
    results,
    completedCount,
    totalSlotCount,
    runComparison,
    clearResults,
  };
}
