/**
 * Internal event triggers — fire configured triggers on platform events.
 */

import { listTriggers } from '../models/triggers.ts';
import { runTrigger } from './trigger-runner.ts';
import type { TriggerRow } from '../types.ts';
import { errorMessage } from '../lib/error-message.ts';

export async function fireInternalTriggers(
  eventType: TriggerRow['trigger_type'],
  context: { sessionId?: string; stepKey?: string; callingApplication?: string; userId?: string },
): Promise<void> {
  try {
    const all = await listTriggers();
    const matching = all.filter((t) => t.is_active && t.trigger_type === eventType);
    if (matching.length === 0) return;

    for (const trigger of matching) {
      try {
        await runTrigger(trigger, {
          callingApplication: context.callingApplication || `trigger:${trigger.slug}`,
          userId: context.userId,
          variables: {
            sessionId: context.sessionId,
            stepKey: context.stepKey,
          },
        });
        console.info('[internal-triggers] fired', { eventType, triggerSlug: trigger.slug });
      } catch (err) {
        console.warn('[internal-triggers] trigger failed:', trigger.slug, errorMessage(err));
      }
    }
  } catch (err) {
    console.warn('[internal-triggers] list failed:', errorMessage(err));
  }
}
