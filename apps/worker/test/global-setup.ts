import net from 'node:net';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
    redisUrl: string;
    redisContainerId: string;
    smtpPort: number;
    mailUiUrl: string;
    mailContainerId: string;
  }
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });

const started: {
  pg?: StartedPostgreSqlContainer;
  redis?: StartedTestContainer;
  mail?: StartedTestContainer;
} = {};

// Fixed host ports: tests stop / restart Redis and Mailpit and must find them at the same address.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [redisPort, smtpPort, uiPort] = await Promise.all([freePort(), freePort(), freePort()]);
  started.pg = await new PostgreSqlContainer('postgres:16-alpine')
    .withCommand(['postgres', '-c', 'max_connections=300', '-c', 'fsync=off'])
    .start();
  started.redis = await new GenericContainer('redis:7-alpine')
    .withCommand(['redis-server', '--save', '', '--appendonly', 'no']) // no persistence: a restart really loses everything
    .withExposedPorts({ container: 6379, host: redisPort })
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  started.mail = await new GenericContainer('axllent/mailpit:v1.33.0')
    .withExposedPorts({ container: 1025, host: smtpPort }, { container: 8025, host: uiPort })
    .withWaitStrategy(Wait.forHttp('/livez', 8025))
    .start();
  project.provide('pgAdminUrl', started.pg.getConnectionUri());
  project.provide('redisUrl', `redis://127.0.0.1:${redisPort}`);
  project.provide('redisContainerId', started.redis.getId());
  project.provide('smtpPort', smtpPort);
  project.provide('mailUiUrl', `http://127.0.0.1:${uiPort}`);
  project.provide('mailContainerId', started.mail.getId());
  return async () => {
    await Promise.all([started.pg?.stop(), started.redis?.stop(), started.mail?.stop()]);
  };
}
