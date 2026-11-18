import { Catch, HttpException } from '@nestjs/common';
import { GqlExceptionFilter } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';
import { gqlError } from './errors.js';

/**
 * Expected client / business errors are GraphQLErrors with a code: pass them through silently
 * (Nest would log each as an unhandled exception). Anything else is a bug: log it and let
 * formatError mask it.
 */
@Catch()
export class GraphqlExceptionsFilter implements GqlExceptionFilter {
  catch(exception: unknown): GraphQLError {
    if (exception instanceof GraphQLError) return exception;
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return gqlError(status === 404 ? 'NOT_FOUND' : status === 403 ? 'FORBIDDEN' : status === 401 ? 'UNAUTHENTICATED' : 'BAD_USER_INPUT', exception.message);
    }
    console.error(JSON.stringify({ at: new Date().toISOString(), svc: 'api', msg: 'unhandled', error: String((exception as Error)?.stack ?? exception).slice(0, 2000) }));
    return gqlError('INTERNAL_SERVER_ERROR', 'Something went wrong on our side');
  }
}
