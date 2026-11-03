import type { Response } from 'express';
import { BodyValidationError } from '../validation/body.ts';
import type { KeptFault } from '../services/kept-answers.ts';

/**
 * What a failed read answers with — one rule for the four read routes in nutrition.ts, because
 * the same rule now also decides what is KEPT for a client that left (services/kept-answers.ts):
 * the fault on the row must be the fault the live client would have been sent.
 *
 * A 400 is the person's words, refused: the body did not parse, a reading had no line that reads
 * as a food, a photo was not a photo, an answer had no words. The client must not retry those as
 * written. Everything else is ours, answered with the route's own line and logged.
 */
export function readFault(err: unknown, line: string): KeptFault {
  if (err instanceof BodyValidationError) return { status: 400, error: err.message };
  const msg = err instanceof Error ? err.message : '';
  if (/a meal needs|an answer needs|invalid photo/.test(msg)) return { status: 400, error: msg };
  return { status: 500, error: line };
}

/** Send the fault; only ours (5xx) are worth a log line. */
export function sendReadFault(res: Response, err: unknown, line: string, where: string): void {
  const fault = readFault(err, line);
  if (fault.status >= 500) console.error(where, err);
  res.status(fault.status).json({ error: fault.error });
}
