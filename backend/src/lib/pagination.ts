import type { Request, Response, NextFunction } from 'express';

export interface PaginationParams {
  cursor: string | null;
  limit: number;
  direction: 'next' | 'prev';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
}

export class InvalidCursorError extends Error {
  constructor(cursor: string) {
    super(`Invalid cursor value: "${cursor}"`);
    this.name = 'InvalidCursorError';
  }
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}[T ]/;

/**
 * Middleware that validates the `cursor` query parameter early,
 * returning 400 before route handlers run.
 */
export function validateCursorParam(req: Request, res: Response, next: NextFunction): void {
  const raw = req.query.cursor as string | undefined;
  if (raw && (!ISO_LIKE.test(raw) || Number.isNaN(Date.parse(raw)))) {
    res.status(400).json({ error: `Invalid cursor format` });
    return;
  }
  next();
}

export function parsePagination(req: Request): PaginationParams {
  const cursor = (req.query.cursor as string) || null;
  const rawLimit = parseInt(req.query.limit as string, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  const direction = req.query.direction === 'prev' ? 'prev' : 'next';
  return { cursor, limit, direction };
}

export function buildPaginatedResponse<T extends { created_at?: string; id?: string }>(
  rows: T[],
  params: PaginationParams,
): PaginatedResponse<T> {
  const hasMore = rows.length > params.limit;
  const data = hasMore ? rows.slice(0, params.limit) : rows;

  let nextCursor: string | null = null;
  let prevCursor: string | null = null;

  if (data.length > 0) {
    const last = data[data.length - 1];
    const first = data[0];
    if (hasMore && last?.created_at) {
      nextCursor = last.created_at;
    }
    if (params.cursor && first?.created_at) {
      prevCursor = first.created_at;
    }
  }

  return {
    data,
    pagination: {
      next_cursor: nextCursor,
      prev_cursor: prevCursor,
      has_more: hasMore,
      limit: params.limit,
    },
  };
}
