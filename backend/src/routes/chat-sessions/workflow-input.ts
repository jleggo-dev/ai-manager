/**
 * Completing a workflow step with an answer from the PERSON, not the model.
 *
 * Every other step in a workflow advances by sending its job to an LLM: the reply's declared
 * `outputMappings` land in `workflow_variables`, `workflow.step.completed` fires, and the next step
 * composes its prompt from those variables. That machinery works and is not touched here. This is
 * the same completion, with the model taken out of it — because for a step whose whole purpose is
 * "show the user what we read and let them correct it", the model was never the source of the
 * answer, and calling one anyway costs a round-trip to produce a sentence the app could write
 * itself (see migration 014).
 *
 * The shape it was built for (owner, 2026-08-21): read the photo → SHOW THE READING AND ASK →
 * convert to numbers. The middle step is this endpoint.
 *
 * The answer is recorded as a USER message tagged with `workflow_step_id`, which is not a detail —
 * that tag is how step completion has always been counted (`getCompletedWorkflowSteps`), so a step
 * finished this way satisfies a later step's `depends_on` through the existing path rather than a
 * parallel one. It also means the answer is in the transcript, where an auditor reading the session
 * sees what the person was shown and what they said back.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../../middleware/validate.ts';
import { authorizeSessionAccess } from './shared.ts';
import { getWorkflowStepByKey } from '../../models/workflows.ts';
import { createChatMessage, mergeWorkflowVariables } from '../../models/chat-sessions.ts';
import { fireInternalTriggers } from '../../services/internal-triggers.ts';
import { errorMessage } from '../../lib/error-message.ts';

export const workflowInputRouter = Router();

const inputBodySchema = z.object({
  /** What the person answered. Free text: a correction, a confirmation, a number. */
  answer: z.string().min(1, 'answer is required').max(20000),
  /**
   * Extra variables to merge alongside it — for a structured confirmation (the corrected macros,
   * say) where the free text alone would lose the shape.
   */
  variables: z.record(z.unknown()).optional(),
});

/* ================================================================
   POST /api/chat-sessions/:id/workflow-steps/:stepKey/input
   Complete an input step with the user's answer.
   ================================================================ */
workflowInputRouter.post(
  '/:id/workflow-steps/:stepKey/input',
  validateBody(inputBodySchema),
  async (req: Request, res: Response) => {
    try {
      const sessionId = req.params.id as string;
      const stepKey = req.params.stepKey as string;

      // requireOwnership: an answer attributed to a person must come from that person.
      const session = await authorizeSessionAccess(sessionId, res, { requireOwnership: true });
      if (!session) return;

      if (!session.workflow_id) {
        return res.status(400).json({ error: 'This chat session is not running a workflow' });
      }

      const step = await getWorkflowStepByKey(session.workflow_id, stepKey);
      if (!step) return res.status(404).json({ error: `Workflow step "${stepKey}" not found` });
      if (step.step_type !== 'input') {
        return res.status(400).json({
          error: `Workflow step "${stepKey}" is a job step — send it a message so it runs its processing job.`,
        });
      }

      const { answer, variables } = req.body as { answer: string; variables?: Record<string, unknown> };

      // The tag is what makes this count as completion; without it the step stays open forever.
      const message = await createChatMessage({
        chat_session_id: sessionId,
        role: 'user',
        content: answer,
        workflow_step_id: step.id,
      });

      /**
       * `<step>.response` mirrors what a job step stores, so a later step's `inputMappings` reads a
       * human answer and a model answer through the identical path — a workflow author should not
       * have to know which kind of step filled a variable. `config.collects` additionally names it
       * something meaningful ("confirmed_meal") for the steps that care.
       */
      const collects = step.config?.collects;
      const merged = await mergeWorkflowVariables(sessionId, {
        [`${stepKey}.response`]: answer,
        ...(collects ? { [collects]: answer } : {}),
        ...(variables ?? {}),
      });

      await fireInternalTriggers('workflow.step.completed', {
        sessionId,
        stepKey,
        callingApplication: session.calling_application,
        userId: session.user_id,
      });

      return res.status(201).json({
        stepKey,
        stepId: step.id,
        messageId: message.id,
        collected: collects ?? null,
        workflowVariables: merged,
      });
    } catch (err) {
      console.error('[POST /chat-sessions/:id/workflow-steps/:stepKey/input]', err);
      return res.status(500).json({ error: errorMessage(err) || 'Failed to record workflow input' });
    }
  },
);
