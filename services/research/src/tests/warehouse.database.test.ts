/** Explicit opt-in only: creates additive research schemas in a dedicated disposable
 * warehouse database. It never drops schemas, touches operational tables or starts PG. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { PostgresWarehouse } from '../warehouse/postgres.js';
import { warehouseConfig } from '../warehouse/config.js';
import { loadVocabulary } from '../warehouse/vocabulary.js';
import { parseBundle } from '../warehouse/bundle.js';
import { TABLES } from '../warehouse/catalog.js';
import { schemaName } from '../warehouse/sql.js';
import { sha } from '../portal/policy.js';
const enabled = process.env.AHP_RUN_OMOP_DATABASE_TESTS === 'YES_DEDICATED_TEST_DATABASE';
test('Dedicated PostgreSQL OMOP provisioning, ETL, constraints, immutability and export', { skip: !enabled, timeout: 180000 }, async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  const config = warehouseConfig();
  const url = new URL(config.databaseUrl);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.match(config.expectedDatabase, /^ahealth_research_test(?:_[a-z0-9]+)?$/);
  assert.notEqual(url.port, '5432'); assert.ok(url.port);
  assert.equal(url.pathname, '/' + config.expectedDatabase);
  const warehouse = new PostgresWarehouse(config);
  try {
    await warehouse.verifyIdentity(); // Read-only identity gate before any schema write.
    await warehouse.initialize();
    const vocabularyDir = fileURLToPath(new URL('./fixtures/warehouse/vocabulary/', import.meta.url));
    const vocabulary = await loadVocabulary(warehouse, vocabularyDir, { licensed: false, allowSynthetic: true });
    assert.equal(vocabulary.version, 'SYNTHETIC-TEST-ONLY');
    const sourceId = randomUUID(), datasetId = randomUUID(), linkageKey = randomBytes(32);
    const raw = JSON.parse(await readFile(new URL('./fixtures/warehouse/clinical-synthetic.json', import.meta.url), 'utf8'));
    const input = { buildId: randomUUID(), sourceId, datasetId, synthetic: true, bundles: [parseBundle(raw, datasetId + ':' + sourceId, linkageKey)], mappings: [], sourceHash: sha(JSON.stringify(raw)), minimumCellSize: 10, linkageKey, datePolicy: 'restricted_source_dates' as const };
    const build = await warehouse.materialize(input);
    await t.test('schema has all 39 CDM relations and 432 fields', async () => {
      const rows = await warehouse.client().$queryRawUnsafe<{ table_name: string; column_name: string }[]>('SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1', build.schema);
      assert.equal(new Set(rows.map(r => r.table_name)).size, 39); assert.equal(rows.length, 432);
      for (const table of TABLES) for (const column of table.columns) assert.ok(rows.some(r => r.table_name === table.name && r.column_name === column.name));
    });
    await t.test('ETL has persons, visits, labs, ingredient eras and explicit observation periods', async () => {
      assert.equal(build.persons, 20); assert.equal(build.quality.passed, true);
      assert.equal(build.quality.table_counts.drug_era, 20); assert.equal(build.quality.table_counts.observation_period, 20);
      assert.ok(build.cells.every(c => c.participants >= 10));
    });
    await t.test('materialization is retry-idempotent', async () => {
      assert.equal((await warehouse.materialize(input)).manifestHash, build.manifestHash);
    });
    await t.test('approved content hashes agree with PostgreSQL read-back', async () => {
      const out = await warehouse.extract(build.schema, build.manifestHash);
      assert.equal(out.tables.person.length, 20); assert.equal(out.tables.concept.length, 0);
      assert.equal(out.tables.measurement[0].value_as_number, 5.2);
    });
    await t.test('snapshot row mutations and TRUNCATE are rejected', async () => {
      await assert.rejects(warehouse.client().$executeRawUnsafe(`UPDATE ${schemaName(build.schema)}.person SET year_of_birth=1980`));
      await assert.rejects(warehouse.client().$executeRawUnsafe(`TRUNCATE ${schemaName(build.schema)}.measurement`));
    });
    await t.test('incorrect content-hash token cannot extract records', async () => {
      await assert.rejects(warehouse.extract(build.schema, '0'.repeat(64)));
    });
    console.log('Retained dedicated test snapshot: ' + build.schema + '; no schema was dropped.');
  } finally { await warehouse.close(); }
});
