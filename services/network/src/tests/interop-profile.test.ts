import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateIntegrationProfile } from '../services/interop.service.js';

const observation = () => ({
  resourceType: 'Observation', id: 'observation-a1',
  meta: { versionId: '1', lastUpdated: '2026-10-01T09:00:00Z' },
  status: 'final', code: { text: 'Synthetic observation' },
  subject: { reference: 'Patient/patient-a' },
  effectiveDateTime: '2026-10-01T08:55:00Z',
  valueQuantity: { value: 12, unit: 'synthetic-unit' },
});

describe('limited FHIR R4 resource profiles', () => {
  it('accepts a supported resource with a source patient reference and event time', () => {
    const parsed = validateIntegrationProfile(observation());
    assert.equal(parsed.resourceType, 'Observation');
    assert.equal(parsed.id, 'observation-a1');
  });

  it('rejects unsupported FHIR resource types and unsupported top-level fields', () => {
    assert.throws(() => validateIntegrationProfile({ resourceType: 'Bundle', id: 'bundle-1' }));
    assert.throws(() => validateIntegrationProfile({ ...observation(), valueAttachment: { url: 'https://invalid.test' } }));
  });

  it('rejects unsupported FHIR extensions and embedded resources', () => {
    assert.throws(() => validateIntegrationProfile({ ...observation(), extension: [{ url: 'urn:test', valueString: 'x' }] }));
    assert.throws(() => validateIntegrationProfile({ ...observation(), code: { text: 'x', extension: [] } }));
  });

  it('rejects malformed or external patient references', () => {
    assert.throws(() => validateIntegrationProfile({ ...observation(), subject: { reference: 'Patient' } }));
    assert.throws(() => validateIntegrationProfile({ ...observation(), subject: { reference: 'https://outside.example/Patient/abc' } }));
    assert.throws(() => validateIntegrationProfile({ ...observation(), focus: [{ reference: 'Patient/patient-b' }] }));
  });

  it('requires a clinical event time and source identity', () => {
    assert.throws(() => validateIntegrationProfile({ ...observation(), effectiveDateTime: undefined }));
    assert.throws(() => validateIntegrationProfile({ ...observation(), id: '../patient-a' }));
  });

  it('rejects oversized payloads before persistence', () => {
    assert.throws(() => validateIntegrationProfile({ ...observation(), valueString: 'x'.repeat(300_000) }));
  });

  it('validates all synthetic Hospital A and Hospital B resources', async () => {
    const root = fileURLToPath(new URL('./fixtures/fhir', import.meta.url));
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.name.endsWith('.json')) files.push(path);
      }
    };
    await walk(root);
    const resourceFiles = files.filter((path) => !path.endsWith('test-actors.json'));
    assert.ok(resourceFiles.length >= 10);
    for (const path of resourceFiles) {
      const payload = JSON.parse(await readFile(path, 'utf8')) as unknown;
      assert.equal(validateIntegrationProfile(payload).id, JSON.parse(await readFile(path, 'utf8')).id, path);
    }
  });
});
