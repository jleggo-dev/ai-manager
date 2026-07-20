/**
 * Typed error surface for the AI Admin in-process seam (`aim.ts`).
 *
 * Routes used to catch `unknown` and default to 500. Classifying failures here lets
 * handlers map `kind` → HTTP status without re-deriving shapes at every call site.
 */

export type AimErrorKind = 'config' | 'upstream' | 'not_found' | 'unknown';

export class AimError extends Error {
  readonly kind: AimErrorKind;
  readonly cause: unknown;

  constructor(kind: AimErrorKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'AimError';
    this.kind = kind;
    this.cause = cause;
  }

  /** Prefer AimError.message; fall back to Error.message / String(err). */
  static messageOf(err: unknown): string {
    if (err instanceof AimError) return err.message;
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === 'string' && err.trim()) return err;
    return 'Unknown AI Admin error';
  }

  /** Map a seam failure to a stable kind for HTTP / logging. */
  static classify(err: unknown): AimErrorKind {
    if (err instanceof AimError) return err.kind;

    const msg = AimError.messageOf(err).toLowerCase();
    const status =
      typeof err === 'object' && err !== null && 'status' in err
        ? Number((err as { status: unknown }).status)
        : typeof err === 'object' && err !== null && 'statusCode' in err
          ? Number((err as { statusCode: unknown }).statusCode)
          : NaN;

    // Config before not_found: "workspace missing" is a Cadence/AIM setup failure, not a 404.
    if (
      /\bauth context\b/.test(msg) ||
      /\baim_workspace\b/.test(msg) ||
      /\bcalling.?application\b/.test(msg) ||
      (/\bworkspace\b/.test(msg) && /\b(missing|invalid|required|unset)\b/.test(msg)) ||
      (/\bconfig\b/.test(msg) && /\b(missing|invalid|required)\b/.test(msg))
    )
      return 'config';

    if (
      (Number.isFinite(status) && status === 404) ||
      /\bnot found\b/.test(msg) ||
      (/\bmissing\b/.test(msg) && /\b(job|session|profile)\b/.test(msg))
    )
      return 'not_found';

    if (
      (Number.isFinite(status) && status >= 500) ||
      /\btimeout\b/.test(msg) ||
      /\btimed out\b/.test(msg) ||
      /\bupstream\b/.test(msg) ||
      (/\bprovider\b/.test(msg) && /\b(fail|error|unavailable)\b/.test(msg)) ||
      /\bdevs\.ai\b/.test(msg) ||
      (/\bgemini\b/.test(msg) && /\b(fail|error|timeout)\b/.test(msg))
    )
      return 'upstream';

    return 'unknown';
  }

  static fromUnknown(err: unknown): AimError {
    if (err instanceof AimError) return err;
    return new AimError(AimError.classify(err), AimError.messageOf(err), err);
  }

  /** HTTP status for route responses (declarative map). */
  get httpStatus(): number {
    switch (this.kind) {
      case 'not_found':
        return 404;
      case 'upstream':
        return 502;
      case 'config':
      case 'unknown':
        return 500;
      default: {
        const _exhaustive: never = this.kind;
        return _exhaustive;
      }
    }
  }
}

/** Wrap a rejected seam promise so callers always see AimError. */
export function rejectAsAimError(err: unknown): never {
  throw AimError.fromUnknown(err);
}
