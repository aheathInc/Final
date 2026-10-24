import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { TABLES, CDM_VERSION } from '../warehouse/catalog.js';
import { parseBins, responseDataset } from '../responses/analytics.js';
import { tableCsv, tableXlsx } from '../responses/export.js';

const fields = [
  { key: 'score', label: 'Score', type: 'number' as const, min: 0, max: 100, required: true },
  { key: 'flag', label: 'Flag', type: 'boolean' as const, required: true },
];
const participants = Array.from({ length: 20 }, (_, i) => ({ subjectHash: `sample-${i}`, answers: { score: 25, flag: true } }));
const key = randomBytes(32);
const bins = parseBins(fields, { score: [0, 50, 100] });

test('OMOP CDM has 39 unique pinned v5.4 tables', () => {
  assert.equal(CDM_VERSION, '5.4');
  assert.equal(TABLES.length, 39);
  assert.equal(new Set(TABLES.map(t => t.name)).size, TABLES.length);
});
test('eCRF numeric bin limits are reviewed and strictly ascending', () => {
  assert.deepEqual(bins.score, [0, 50, 100]);
  assert.throws(() => parseBins(fields, { score: [0, 40, 40, 100] }));
});
test('approved eCRF response aggregation counts unique participants', () => {
  const report = responseDataset(fields, participants, bins, 10, key, 'study', 'form');
  assert.equal(report.participantCount, 20);
  assert.deepEqual(report.cells.map(cell => cell.participants), [20, 20]);
  assert.ok(report.rows.every(row => !String(row.participant).startsWith('sample-')));
});
test('suppresses entire field when any value is below minimum cell size', () => {
  const changed = participants.map((p, i) => ({ ...p, answers: { score: i === 0 ? 75 : 25, flag: true } }));
  const report = responseDataset(fields, changed, bins, 10, key, 'study', 'form');
  assert.equal(report.cells.some(cell => cell.field === 'score'), false);
  assert.ok(report.suppressedFields.includes('score'));
});
test('rejects duplicate responses and privacy thresholds below ten', () => {
  assert.throws(() => responseDataset(fields, [participants[0], participants[0]], bins, 10, key, 'study', 'form'));
  assert.throws(() => responseDataset(fields, participants, bins, 9, key, 'study', 'form'));
});
test('CSV and XLSX export functions produce correct file signatures', () => {
  const csv = tableCsv(['field', 'participants'], [{ field: 'flag', participants: 20 }]);
  assert.ok(csv.includes('"flag",20'));
  assert.equal(tableXlsx(['A'], [{ A: 1 }], 'Approved output').subarray(0, 2).toString(), 'PK');
});
