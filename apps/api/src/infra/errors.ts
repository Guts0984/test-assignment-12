import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { ZodError, type ZodType } from 'zod';
import { appError, ERROR_CODES, type AppError, type ErrorCode, type Result } from '@clinic/shared';

export const gqlError = (
  code: ErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): GraphQLError => new GraphQLError(message, { extensions: { code, ...extra } });

export const fromAppError = (e: AppError): GraphQLError =>
  gqlError(e.code, e.message, e.fieldErrors ? { fieldErrors: e.fieldErrors } : {});

/** Domain results become values or GraphQL errors with a stable `extensions.code`. */
export const unwrap = <T>(r: Result<T, AppError>): T => {
  if (r.ok) return r.value;
  throw fromAppError(r.error);
};

export const fieldErrorsOf = (e: ZodError): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const issue of e.issues) {
    const key = issue.path.length ? issue.path.map(String).join('.') : '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
};

/** Validates input with the shared Zod schema; failures carry `fieldErrors` for the form fields. */
export const parseInput = <T>(schema: ZodType<T>, input: unknown): T => {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw gqlError('BAD_USER_INPUT', 'Some fields are invalid', {
      fieldErrors: fieldErrorsOf(r.error),
    });
  }
  return r.data;
};

const KNOWN = new Set<string>(ERROR_CODES);
const PASSTHROUGH = new Set([
  'GRAPHQL_PARSE_FAILED',
  'GRAPHQL_VALIDATION_FAILED',
  'BAD_USER_INPUT',
  'BAD_REQUEST',
  'PERSISTED_QUERY_NOT_FOUND',
  'OPERATION_RESOLUTION_FAILURE',
  'CSRF_PREVENTION_FAILED',
]);

/**
 * Last line of defence in Apollo's formatError. Business and client errors keep their code; GraphQL
 * validation errors are client errors (BAD_USER_INPUT / GRAPHQL_VALIDATION_FAILED); anything else is
 * a bug: it is logged, and the client sees a masked message, never internals or stack traces.
 */
export const formatError = (
  formatted: GraphQLFormattedError,
  original: unknown,
  log: (msg: string, extra?: Record<string, unknown>) => void,
): GraphQLFormattedError => {
  const code = String((formatted.extensions as { code?: unknown } | undefined)?.code ?? '');
  if (KNOWN.has(code) && code !== 'INTERNAL_SERVER_ERROR')
    return {
      message: formatted.message,
      ...(formatted.path ? { path: formatted.path } : {}),
      extensions: { ...formatted.extensions, code },
    };
  if (PASSTHROUGH.has(code)) {
    return {
      message: formatted.message,
      ...(formatted.locations ? { locations: formatted.locations } : {}),
      ...(formatted.path ? { path: formatted.path } : {}),
      extensions: { code },
    };
  }
  log('unhandled resolver error', {
    error: String((original as { originalError?: unknown })?.originalError ?? original),
    path: formatted.path,
  });
  const e = appError('INTERNAL_SERVER_ERROR', 'Something went wrong on our side');
  return {
    message: e.message,
    ...(formatted.path ? { path: formatted.path } : {}),
    extensions: { code: e.code },
  };
};
