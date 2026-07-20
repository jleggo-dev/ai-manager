/**
 * Slot CRUD for AI Matcher (up to 4 parallel AI configs).
 * Extracted from AiMatcherPage.tsx (FE-03).
 */

import { useState, useCallback } from 'react';
import { emptySlot, type SlotConfig } from '../lib/ai-matcher';

const MAX_SLOTS = 4;

export function useAiMatcherSlots() {
  const [slots, setSlots] = useState<SlotConfig[]>([emptySlot()]);

  const updateSlot = useCallback((index: number, slot: SlotConfig) => {
    setSlots((prev) => prev.map((s, i) => (i === index ? slot : s)));
  }, []);

  const removeSlot = useCallback((index: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const addSlot = useCallback(() => {
    setSlots((prev) => (prev.length < MAX_SLOTS ? [...prev, emptySlot()] : prev));
  }, []);

  return {
    slots,
    updateSlot,
    removeSlot,
    addSlot,
    canAddSlot: slots.length < MAX_SLOTS,
  };
}
