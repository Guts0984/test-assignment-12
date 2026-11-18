import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import type { Role } from '@clinic/shared';
import { gqlError } from '../infra/errors.js';
import type { GqlContext } from '../infra/tokens.js';

export const ROLES_KEY = 'clinic:roles';
export const PUBLIC_KEY = 'clinic:public';

/** Anyone, including anonymous visitors. */
export const Public = (): MethodDecorator => SetMetadata(PUBLIC_KEY, true);
/** Signed-in users with one of these roles. `Roles()` with no arguments: any signed-in user. */
export const Roles = (...roles: Role[]): MethodDecorator => SetMetadata(ROLES_KEY, roles);

const ROOT_TYPES = new Set(['Query', 'Mutation', 'Subscription']);

/**
 * Default DENY. Every root field (query, mutation, subscription) must say who may call it, with
 * @Public() or @Roles(...); one that says nothing is refused, so a forgotten decorator can never
 * expose data. Object fields are not guarded here: they are reached only through an authorized
 * root field and do their own per-object policy checks.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType<string>() !== 'graphql') return true; // /health and /ready are plain REST
    const gql = GqlExecutionContext.create(context);
    const parent = gql.getInfo<{ parentType: { name: string } }>().parentType.name;
    if (!ROOT_TYPES.has(parent)) return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles === undefined) throw gqlError('FORBIDDEN', 'This operation is not available');
    const ctx = gql.getContext<GqlContext>();
    if (!ctx.actor) throw gqlError('UNAUTHENTICATED', 'Please sign in');
    if (roles.length > 0 && !roles.includes(ctx.actor.role as Role))
      throw gqlError('FORBIDDEN', 'You are not allowed to do this');
    return true;
  }
}
