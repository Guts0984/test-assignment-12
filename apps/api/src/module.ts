import { Controller, Get, Global, Inject, Module, Res, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { GraphqlExceptionsFilter } from './infra/filter.js';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { ApolloServerPluginLandingPageLocalDefault } from '@apollo/server/plugin/landingPage/default';
import { createRequire } from 'node:module';
import { areGraphQLErrors } from 'graphql-ws';
import { GraphQLError, parse, type GraphQLSchema } from 'graphql';
import type { IncomingMessage } from 'node:http';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import {
  DB,
  ENV,
  LIMITERS,
  REDIS,
  SCHEMA_REF,
  BUS,
  DOMAIN,
  POOL,
  TRUSTED,
  type GqlContext,
  type Services,
} from './infra/tokens.js';
import { RolesGuard } from './auth/roles.js';
import {
  SESSION_COOKIE,
  findSessionUser,
  hashToken,
  parseCookies,
  toActor,
  type SessionUser,
} from './auth/sessions.js';
import { clientIp } from './infra/ip.js';
import { formatError, gqlError } from './infra/errors.js';
import { checkLimits, limitsPlugin } from './infra/security.js';
import { TOPIC } from './infra/event-bus.js';
import { createLoaders } from './loaders.js';
import { loadVisible } from './graphql/resolvers.js';
import {
  AppointmentFieldResolver,
  AuthResolver,
  PatientFieldResolver,
  BookingResolver,
  CatalogResolver,
  NotificationResolver,
  OfferFieldResolver,
  ReportResolver,
  SlotResolver,
  StaffResolver,
  SubscriptionResolver,
  WaitlistFieldResolver,
  WaitlistResolver,
} from './graphql/resolvers.js';
import type { ApiEnv } from './env.js';
import type { Db } from '@clinic/db';
import type { Redis } from 'ioredis';

export const RESOLVERS = [
  AuthResolver,
  PatientFieldResolver,
  CatalogResolver,
  SlotResolver,
  AppointmentFieldResolver,
  BookingResolver,
  WaitlistFieldResolver,
  OfferFieldResolver,
  WaitlistResolver,
  NotificationResolver,
  StaffResolver,
  ReportResolver,
  SubscriptionResolver,
];

const log = (msg: string, extra?: Record<string, unknown>): void => {
  console.log(JSON.stringify({ at: new Date().toISOString(), svc: 'api', msg, ...extra }));
};

// graphql-ws checks `instanceof GraphQLError` against ITS copy of graphql (ESM or CJS build, depending
// on how it was loaded). Pick the class it accepts, so rejections reach the client as proper errors.
const cjsGraphQL = createRequire(import.meta.url)('graphql') as {
  GraphQLError: typeof GraphQLError;
};
const wsErrorClass: typeof GraphQLError =
  [GraphQLError, cjsGraphQL.GraphQLError].find((C) => areGraphQLErrors([new C('probe')])) ??
  GraphQLError;
const wsError = (code: string, message: string): GraphQLError =>
  new wsErrorClass(message, { extensions: { code } });

export type SchemaRef = { current: GraphQLSchema | null };

@Global()
@Module({})
export class ServicesModule {
  static register(s: Services, schemaRef: SchemaRef): DynamicModule {
    const providers = [
      { provide: ENV, useValue: s.env },
      { provide: POOL, useValue: s.pool },
      { provide: DB, useValue: s.db },
      { provide: REDIS, useValue: s.redis },
      { provide: DOMAIN, useValue: s.domain },
      { provide: LIMITERS, useValue: s.limiters },
      { provide: BUS, useValue: s.bus },
      { provide: TRUSTED, useValue: s.trusted },
      { provide: SCHEMA_REF, useValue: schemaRef },
    ];
    return { module: ServicesModule, providers, exports: providers.map((p) => p.provide) };
  }
}

@Controller()
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process answers. */
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: Postgres and Redis answer within 2 s. */
  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    const within = <T>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000).unref()),
      ]);
    const checks = { postgres: false, redis: false };
    await Promise.all([
      within(this.db.execute(sql`SELECT 1`))
        .then(() => {
          checks.postgres = true;
        })
        .catch(() => undefined),
      within(this.redis.ping())
        .then(() => {
          checks.redis = true;
        })
        .catch(() => undefined),
    ]);
    res
      .status(checks.postgres && checks.redis ? 200 : 503)
      .json({ status: checks.postgres && checks.redis ? 'ready' : 'degraded', ...checks });
  }
}

type WsExtra = {
  socket?: { close: (code?: number, reason?: string) => void };
  request: IncomingMessage;
  session?: { ip: string; user: SessionUser | null; token: string | null };
};

@Module({})
export class ApiModule {
  static register(s: Services, schemaRef: SchemaRef): DynamicModule {
    const env: ApiEnv = s.env;
    const limits = {
      maxDepth: env.GQL_MAX_DEPTH,
      maxComplexity: env.GQL_MAX_COMPLEXITY,
      maxFields: env.GQL_MAX_FIELDS,
    };
    const wsPerIp = new Map<string, number>();
    // open sockets by session (token hash): a sign-out must not leave a live stream behind
    const socketsBySession = new Map<
      string,
      { token: string; sockets: Set<NonNullable<WsExtra['socket']>> }
    >();
    const closeSession = (hash: string): void => {
      const entry = socketsBySession.get(hash);
      if (!entry) return;
      socketsBySession.delete(hash);
      for (const sock of entry.sockets) sock.close(4401, 'Session ended');
    };
    // sign-out on any replica arrives through the bus (Redis) on all of them
    void s.bus.pubsub.subscribe(TOPIC, (e: unknown) => {
      if (e && typeof e === 'object' && (e as { type?: string }).type === 'session_revoked')
        closeSession(String((e as { tokenHash?: unknown }).tokenHash));
    });
    // expiry (and revocations whose bus message was lost) are caught by a periodic re-check
    const sweep = setInterval(() => {
      for (const [hash, entry] of [...socketsBySession]) {
        void findSessionUser(s.db, entry.token, s.domain.now())
          .then((u) => {
            if (!u) closeSession(hash);
          })
          .catch(() => undefined);
      }
    }, 15_000);
    sweep.unref();
    const baseContext = (
      ip: string,
      user: SessionUser | null,
      token: string | null,
      transport: 'http' | 'ws',
    ): Omit<GqlContext, 'req' | 'res'> => {
      const actor = toActor(user);
      return {
        ip,
        user,
        token,
        actor,
        transport,
        loaders: createLoaders(s.db, actor),
        visible: (id) => loadVisible(s.db, id, actor),
      };
    };
    const ipOf = (req: IncomingMessage): string =>
      clientIp(
        req.socket.remoteAddress,
        (h) => {
          const v = req.headers[h];
          return Array.isArray(v) ? v[0] : v;
        },
        s.trusted,
      );

    return {
      module: ApiModule,
      imports: [
        ServicesModule.register(s, schemaRef),
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
          sortSchema: true,
          introspection: env.NODE_ENV !== 'production',
          playground: false,
          csrfPrevention: true,
          hideSchemaDetailsFromClientErrors: env.NODE_ENV === 'production',
          includeStacktraceInErrorResponses: false,
          plugins: [
            env.NODE_ENV === 'production'
              ? ApolloServerPluginLandingPageDisabled()
              : ApolloServerPluginLandingPageLocalDefault({ embed: false, includeCookies: true }),
            limitsPlugin(() => schemaRef.current, limits, s.limiters.cost),
          ],
          formatError: (formatted, original) => formatError(formatted, original, log),
          context: async ({
            req,
            res,
            extra,
          }: {
            req?: IncomingMessage & { headers: Record<string, string | string[] | undefined> };
            res?: Response;
            extra?: WsExtra;
          }): Promise<GqlContext> => {
            if (extra?.session) {
              // WebSocket: identity was established once when the connection opened
              return {
                ...baseContext(extra.session.ip, extra.session.user, extra.session.token, 'ws'),
              } as GqlContext;
            }
            if (!req) throw gqlError('INTERNAL_SERVER_ERROR', 'No request');
            const ip = ipOf(req);
            const token =
              parseCookies(req.headers['cookie'] as string | undefined)[SESSION_COOKIE] ?? null;
            const user = await findSessionUser(s.db, token ?? undefined, s.domain.now());
            return {
              ...baseContext(ip, user, token, 'http'),
              req: req as never,
              ...(res ? { res } : {}),
            } as GqlContext;
          },
          subscriptions: {
            'graphql-ws': {
              path: '/graphql',
              onConnect: async (c: { extra: unknown }) => {
                const ctx = c as { extra: WsExtra };
                const req = ctx.extra.request;
                const ip = ipOf(req);
                // reconnect storms: limit how often one address may open sockets, then how many at once
                if (!(await s.limiters.wsConnect.consume(ip)).ok) return false;
                const n = (wsPerIp.get(ip) ?? 0) + 1;
                if (n > env.WS_MAX_CONN_PER_IP) return false; // refused: too many sockets from one address
                wsPerIp.set(ip, n);
                const token = parseCookies(req.headers['cookie'])[SESSION_COOKIE] ?? null;
                const user = await findSessionUser(s.db, token ?? undefined, s.domain.now());
                ctx.extra.session = { ip, user, token };
                if (user && token && ctx.extra.socket) {
                  const h = hashToken(token);
                  const entry = socketsBySession.get(h) ?? { token, sockets: new Set() };
                  entry.sockets.add(ctx.extra.socket);
                  socketsBySession.set(h, entry);
                }
                return true;
              },
              onDisconnect: (c: { extra: unknown }) => {
                const x = c.extra as WsExtra;
                if (x.session?.token && x.socket) {
                  const h = hashToken(x.session.token);
                  const entry = socketsBySession.get(h);
                  entry?.sockets.delete(x.socket);
                  if (entry && entry.sockets.size === 0) socketsBySession.delete(h);
                }
                const ip = x.session?.ip;
                if (!ip) return;
                const n = (wsPerIp.get(ip) ?? 1) - 1;
                if (n <= 0) wsPerIp.delete(ip);
                else wsPerIp.set(ip, n);
              },
              onSubscribe: async (c: unknown, _id: string, p: unknown) => {
                const ctx = c as {
                  subscriptions: Map<string, unknown> | Record<string, unknown>;
                  extra: WsExtra;
                };
                // every subscribe message costs a request from the same per-IP budget as HTTP
                const rate = await s.limiters.wsSubscribe.consume(
                  ctx.extra.session?.ip ?? 'unknown',
                );
                if (!rate.ok) return [wsError('RATE_LIMITED', 'Too many subscriptions, slow down')];
                if (!(await s.limiters.global.consume(ctx.extra.session?.ip ?? 'unknown')).ok)
                  return [wsError('RATE_LIMITED', 'Too many requests, slow down')];
                const payload = p as {
                  query?: string;
                  variables?: Record<string, unknown> | null;
                  operationName?: string | null;
                };
                const open =
                  ctx.subscriptions instanceof Map
                    ? ctx.subscriptions.size
                    : Object.keys(ctx.subscriptions).length;
                if (open >= env.WS_MAX_SUBS_PER_CONN)
                  return [wsError('RATE_LIMITED', 'Too many subscriptions on this connection')];
                const schema = schemaRef.current;
                if (
                  !schema ||
                  typeof payload.query !== 'string' ||
                  payload.query.length > env.BODY_LIMIT_KB * 1024
                )
                  return [wsError('BAD_USER_INPUT', 'Invalid subscription')];
                try {
                  const e = checkLimits(
                    schema,
                    parse(payload.query),
                    payload.variables ?? undefined,
                    payload.operationName,
                    limits,
                  );
                  if (e)
                    return [wsError(String((e.extensions as { code?: string }).code), e.message)];
                } catch (e) {
                  return [wsError('GRAPHQL_PARSE_FAILED', String((e as Error).message))];
                }
                return undefined;
              },
            },
          },
        }),
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: GraphqlExceptionsFilter },
        ...RESOLVERS,
      ],
    };
  }
}
