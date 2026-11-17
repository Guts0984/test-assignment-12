import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

let container: StartedPostgreSqlContainer | undefined;

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // TEST_PG_ADMIN_URL lets a developer reuse a running Postgres instead of a container.
  const external = process.env['TEST_PG_ADMIN_URL'];
  if (external) {
    project.provide('pgAdminUrl', external);
    return async () => undefined;
  }
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withCommand(['postgres', '-c', 'max_connections=300', '-c', 'fsync=off'])
    .start();
  project.provide('pgAdminUrl', container.getConnectionUri());
  return async () => {
    await container?.stop();
  };
}
