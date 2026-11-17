/** Every business/client error code that can appear in GraphQL `extensions.code`. */
export const ERROR_CODES = [
  'BAD_USER_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'QUERY_TOO_COMPLEX',
  'SLOT_TAKEN',
  'ROOM_TAKEN',
  'PATIENT_BUSY',
  'FUTURE_LIMIT_REACHED',
  'DOCTOR_DAILY_LIMIT',
  'OUTSIDE_BOOKING_WINDOW',
  'OUTSIDE_WORKING_HOURS',
  'HOLD_EXPIRED',
  'OFFER_EXPIRED',
  'ONLINE_BOOKING_BLOCKED',
  'INVALID_TRANSITION',
  'IDEMPOTENCY_KEY_REUSED',
  'EMAIL_TAKEN',
  'INVALID_CREDENTIALS',
  'WAITLIST_LIMIT_REACHED',
  'SERVICE_NOT_PROVIDED',
  'VERSION_CONFLICT',
  'INTERNAL_SERVER_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type AppError = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly fieldErrors?: Readonly<Record<string, string>>;
};

export const appError = (
  code: ErrorCode,
  message: string,
  fieldErrors?: Record<string, string>,
): AppError => (fieldErrors ? { code, message, fieldErrors } : { code, message });
