/** Test-only safety boundary. No database connection or application import here. */
export interface SafetyTestTarget { host: string; port: number; database: string; schema: string }
export interface DatabaseIdentity {
  database_name: string;
  schema_name: string;
  schema_owner: string;
  server_address: string | null;
  server_port: number | null;
  login_role: string;
  in_recovery: boolean;
}

export const SAFETY_DB_ACK = 'ISOLATED_DISPOSABLE_AHEALTH_TEST';

export function parseSafetyTestTarget(env: Record<string, string | undefined>): SafetyTestTarget {
  if (env.NODE_ENV !== 'test') throw new Error('Safety integration tests require NODE_ENV=test.');
  if (env.AHP_SAFETY_TEST_DB_ACK !== SAFETY_DB_ACK) {
    throw new Error('Explicit acknowledgement of an owned, disposable local test database/schema is required.');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required; no database fallback exists.');
  let url: URL;
  try { url = new URL(env.DATABASE_URL); }
  catch { throw new Error('DATABASE_URL is not an approved test target.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = Number(url.port);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const schemaOptions = url.searchParams.getAll('schema');
  const schema = schemaOptions[0] ?? '';
  const testSchema = schema === 'ahp_test' || /^ahp_test_[a-z0-9_]+$/.test(schema);
  const isolatedTarget = (database === 'ahealth_test' && schema === 'public') ||
    (database === 'ahealth_dev' && testSchema);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '::1'].includes(host) ||
      !isolatedTarget || schemaOptions.length !== 1 || !url.username || url.hash ||
      !/^\d+$/.test(url.port) || port <= 0 || port > 65535 || port === 5432) {
    throw new Error('Use an explicitly isolated local test database/schema on a non-5432 port.');
  }
  // Prevent libpq/Prisma URL options from redirecting a superficially local URL.
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) throw new Error('Duplicate database URL options are not allowed.');
    seen.add(key);
    if (key === 'schema' && value === schema && (schema === 'public' || testSchema)) continue;
    if (['connection_limit', 'connect_timeout', 'pool_timeout'].includes(key) &&
        /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 30) continue;
    throw new Error('Unsupported database URL option; test target was not contacted.');
  }
  return { host, port, database, schema }; // Never return or log the password-bearing URL.
}

export function selectDedicatedTestSchema(
  env: Record<string, string | undefined>,
  schemaEnvironmentVariable: 'AHP_TEST_FRONT_DESK_SCHEMA' | 'AHP_TEST_THREAD_SCHEMA',
  expectedPrefix: 'ahp_test_front_desk_' | 'ahp_test_thread_integrity_',
): SafetyTestTarget {
  const base = parseSafetyTestTarget(env);
  const schema = env[schemaEnvironmentVariable] ?? '';
  if (base.database !== 'ahealth_dev' || !schema.startsWith(expectedPrefix) ||
      !/^ahp_test_(front_desk|thread_integrity)_[a-z0-9_]+$/.test(schema)) {
    throw new Error('An operator-created isolated suite schema is required for this retained-fixture test.');
  }
  const url = new URL(env.DATABASE_URL!);
  url.searchParams.set('schema', schema);
  process.env.DATABASE_URL = url.toString();
  return parseSafetyTestTarget({ ...env, DATABASE_URL: url.toString() });
}

export function assertSafetyDatabaseIdentity(target: SafetyTestTarget, row: DatabaseIdentity | undefined): void {
  const address = (row?.server_address ?? '').toLowerCase().replace(/^::ffff:/, '').replace(/\/\d+$/, '');
  const ipv4 = address.split('.').map(Number);
  const isLoopback = address === '::1' || (
    /^127\.\d+\.\d+\.\d+$/.test(address) && ipv4.every((part) => part >= 0 && part <= 255)
  );
  if (!row || row.database_name !== target.database || row.schema_name !== target.schema ||
      row.server_port !== target.port || !isLoopback || !row.login_role ||
      row.schema_owner !== row.login_role || row.in_recovery !== false) {
    throw new Error('Database identity/ownership check failed; no test fixture writes are allowed.');
  }
}
