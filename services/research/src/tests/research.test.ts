import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AppError } from '@a-health/http';
import * as queries from '../services/query.service.js';

// Database-free regression for the legacy bypass. No fixture writes or clinical queries.
describe('legacy research endpoint boundary', () => {
  it('rejects a non-research role', async () => {
    await assert.rejects(() => queries.submitQuery({sub:randomUUID(),role:'patient'}, {
      dataset_id:randomUUID(),ethics_approval_ref:'synthetic-reference',query:{measure:'count',group_by:['channel']},
    },{}), (e:AppError)=>e.code==='ROLE_NOT_PERMITTED');
  });
  for (const role of ['researcher','platform_admin']) {
    it(`does not accept an unchecked ethics reference for ${role}`, async () => {
      await assert.rejects(() => queries.submitQuery({sub:randomUUID(),role},{
        dataset_id:randomUUID(),ethics_approval_ref:'synthetic-reference',query:{measure:'count',group_by:['urgencyLevel']},
      },{}), (e:AppError)=>e.code==='FORBIDDEN');
    });
    it(`does not expose historical result rows to ${role}`, async () => {
      await assert.rejects(() => queries.getQuery(randomUUID(),{sub:randomUUID(),role}), (e:AppError)=>e.code==='FORBIDDEN');
    });
  }
});
