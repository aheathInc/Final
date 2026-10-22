/** Read-only probe; called by verify-safety.cjs, not an application entry point. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = process.env.AHP_SOURCE_ROOT;
let prisma;
try {
  if (!root) throw new Error('SOURCE_ROOT_REQUIRED');
  const helper = await import(pathToFileURL(path.join(root, 'services/consultation/src/tests/safety-test-target.ts')).href);
  const target = helper.parseSafetyTestTarget(process.env); // BEFORE database/app imports
  ({ prisma } = await import(pathToFileURL(path.join(root, 'packages/database/src/client.ts')).href));
  const rows = await prisma.$queryRaw`
    SELECT current_database() AS database_name, inet_server_addr()::text AS server_address,
      inet_server_port() AS server_port, current_user::text AS login_role,
      pg_get_userbyid(datdba)::text AS database_owner, pg_is_in_recovery() AS in_recovery
    FROM pg_database WHERE datname = current_database()`;
  helper.assertSafetyDatabaseIdentity(target, rows[0]);
  if (process.argv[2] === '--prepare-check') {
    const folder = path.dirname(fileURLToPath(import.meta.url));
    const requirements = JSON.parse(fs.readFileSync(path.join(folder, 'requirements.json'), 'utf8'));
    const migrations = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name`;
    const successful = migrations.filter(row => row.finished_at && !row.rolled_back_at).map(row => row.migration_name).sort();
    if (migrations.some(row => !row.finished_at && !row.rolled_back_at) ||
        JSON.stringify(successful) !== JSON.stringify(requirements.migrations)) throw new Error('MIGRATION_INVENTORY_MISMATCH');
    const counts = await Promise.all([prisma.user.count(), prisma.patientProfile.count(), prisma.careThread.count(),
      prisma.consultationRequest.count(), prisma.followUpCycle.count(), prisma.prescription.count()]);
    if (counts.some(count => count !== 0)) throw new Error('PREEXISTING_DATA_USE_A_FRESH_DISPOSABLE_TEST_DB');
    console.log(JSON.stringify({ database: 'ahealth_test', port: target.port, identity: 'PASS',
      migrations: successful.length, empty_business_tables: 'PASS', writes: 0 }));
  } else if (process.argv[2] === '--ledger') {
    const { verifyAuditChain } = await import(pathToFileURL(path.join(root, 'packages/http/src/audit.ts')).href);
    const result = await verifyAuditChain();
    if (!result.ok) throw new Error('LEDGER_VERIFICATION_FAILED');
    console.log(JSON.stringify({ ledger: 'VALID', events_checked: result.eventsChecked }));
  } else throw new Error('UNSUPPORTED_PROBE');
} catch (error) {
  // Sanitized high-level reason only. The parent redacts any dependency logger output.
  const reason = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'TEST_DATABASE_OR_CONFIG_CHECK_FAILED';
  console.error(JSON.stringify({ result: 'BLOCKED', reason, probe_writes: 0 }));
  process.exitCode = 2;
} finally {
  await prisma?.$disconnect();
}
