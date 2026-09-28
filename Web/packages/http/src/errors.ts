/**
 * The single error-code catalogue, mirroring packages/api.
 *
 * Its value is that there is exactly one of it. When this lived inside a
 * service, the second service would have grown its own slightly different
 * copy, and clients branching on `code` would have had to learn both.
 *
 * Clients branch on `code`, never on `message`. Adding a code is a
 * non-breaking change; repurposing one is not.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_INVALID'
  | 'TOKEN_REUSE_DETECTED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_ATTEMPTS_EXCEEDED'
  | 'ACCOUNT_LOCKED'
  | 'PASSWORD_TOO_WEAK'
  | 'CURRENT_PASSWORD_REQUIRED'
  | 'CURRENT_PASSWORD_INCORRECT'
  | 'FORBIDDEN'
  | 'ROLE_NOT_PERMITTED'
  | 'NOT_RESOURCE_OWNER'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_KEY_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'STATE_TRANSITION_INVALID'
  | 'CLINICIAN_NOT_VERIFIED'
  | 'CLINICIAN_UNAVAILABLE'
  | 'CONSULTATION_ALREADY_ASSIGNED'
  | 'CARE_THREAD_CLOSED'
  | 'SLOT_UNAVAILABLE'
  | 'SLOT_IN_PAST'
  | 'APPOINTMENT_NOT_YET_STARTABLE'
  | 'APPOINTMENT_ALREADY_STARTED'
  | 'CHECK_IN_ALREADY_ANSWERED'
  | 'FOLLOW_UP_CYCLE_CLOSED'
  | 'PRESCRIPTION_NOT_ACTIVE'
  | 'CONSENT_REQUIRED'
  | 'DEVICE_REVOKED'
  | 'DISPENSE_CODE_INVALID'
  | 'DISPENSE_CODE_EXPIRED'
  | 'RESULT_ALREADY_ACKNOWLEDGED'
  | 'ETHICS_APPROVAL_REQUIRED'
  | 'AGGREGATE_TOO_SMALL'
  | 'FACILITY_NOT_INTEGRATED'
  | 'ALREADY_RATED'
  | 'PAYMENT_METHOD_UNAVAILABLE'
  | 'PAYMENT_ALREADY_SETTLED'
  | 'DUPLICATE_RESOURCE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SERVICE_UNAVAILABLE';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly field?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (c: ErrorCode, m: string, f?: string) => new AppError(c, 400, m, f);
export const unauthenticated = (c: ErrorCode, m: string) => new AppError(c, 401, m);
export const forbidden = (c: ErrorCode, m: string) => new AppError(c, 403, m);
export const notFound = (m = 'Resource not found') => new AppError('NOT_FOUND', 404, m);
export const conflict = (c: ErrorCode, m: string, f?: string) => new AppError(c, 409, m, f);
export const locked = (m: string) => new AppError('ACCOUNT_LOCKED', 423, m);
export const unprocessable = (m: string, f?: string) =>
  new AppError('VALIDATION_FAILED', 422, m, f);
export const rateLimited = (m = 'Too many requests') => new AppError('RATE_LIMITED', 429, m);
