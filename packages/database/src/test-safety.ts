import type { PrismaClient } from '@prisma/client';

export interface LocalTestTarget {
  host: string;
  port: number;
  database: string;
  schema: string;
}

export interface LocalTestIdentity {
  database_name: string;
  schema_name: string;
  schema_owner: string;
  server_address: string | null;
  server_port: number | null;
  login_role: string;
  in_recovery: boolean;
}

/** Accept only an explicit disposable database or an owned isolated test schema. */
export function assertIsolatedLocalTestTarget(
  input: { NODE_ENV?: string; DATABASE_URL?: string } = process.env,
): LocalTestTarget {
  if (input.NODE_ENV !== 'test') throw new Error('Database integration tests require NODE_ENV=test.');
  let url: URL;
  try { url = new URL(input.DATABASE_URL ?? ''); } catch { throw new Error('A valid isolated local test DATABASE_URL is required.'); }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const schemas = url.searchParams.getAll('schema');
  const schema = schemas[0] ?? '';
  const testSchema = schema === 'ahp_test' || /^ahp_test_[a-z0-9_]+$/.test(schema);
  const acceptedTarget = (database === 'ahealth_test' && schema === 'public') ||
    (database === 'ahealth_dev' && testSchema);
  const supportedOptions = [...url.searchParams].every(([key, value]) =>
    (key === 'schema' && value === schema && (value === 'public' || testSchema)) ||
    (['connection_limit', 'connect_timeout', 'pool_timeout'].includes(key) &&
      /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 30));

  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '::1'].includes(host) || !acceptedTarget ||
      schemas.length !== 1 || !supportedOptions || !url.username || url.hash ||
      !/^\d+$/.test(url.port) || Number(url.port) <= 0 || Number(url.port) > 65535 || Number(url.port) === 5432) {
    throw new Error('Use a loopback disposable test database or ahp_test schema on an explicit non-5432 port.');
  }
  return { host, port: Number(url.port), database, schema };
}

export function assertLocalTestIdentity(target: LocalTestTarget, row: LocalTestIdentity | undefined): void {
  const address = (row?.server_address ?? '').toLowerCase().replace(/^::ffff:/, '').replace(/\/\d+$/, '');
  const ipv4 = address.split('.').map(Number);
  const loopback = address === '::1' || (/^127\.\d+\.\d+\.\d+$/.test(address) && ipv4.every((part) => part >= 0 && part <= 255));
  if (!row || row.database_name !== target.database || row.schema_name !== target.schema ||
      row.server_port !== target.port || !loopback || !row.login_role ||
      row.schema_owner !== row.login_role || row.in_recovery !== false) {
    throw new Error('Connected test database identity or schema ownership did not match the approved local target.');
  }
}

export async function verifyLocalTestIdentity(prisma: PrismaClient, target: LocalTestTarget): Promise<void> {
  const [row] = await prisma.$queryRaw<LocalTestIdentity[]>`
    SELECT current_database()::text AS database_name, current_schema()::text AS schema_name,
           (SELECT pg_get_userbyid(nspowner)::text FROM pg_namespace WHERE nspname = current_schema()) AS schema_owner,
           inet_server_addr()::text AS server_address, inet_server_port() AS server_port,
           current_user::text AS login_role, pg_is_in_recovery() AS in_recovery`;
  assertLocalTestIdentity(target, row);
}
