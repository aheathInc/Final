import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseReportDays, patientTotalBand, publishCounts } from '../services/admin-analytics.policy.js';

describe('admin analytics disclosure policy', () => {
  it('accepts only fixed reporting windows', () => {
    assert.equal(parseReportDays(undefined), 90);
    assert.equal(parseReportDays('30'), 30);
    assert.equal(parseReportDays('365'), 365);
    for (const value of ['0', '1', '9999', '', ['30'], null]) assert.throws(() => parseReportDays(value));
  });
  it('suppresses small nonzero groups and never returns their counts', () => {
    assert.deepEqual(publishCounts([{label:'A',count:2},{label:'B',count:11},{label:'C',count:0}]), [
      {label:'B',count:11,suppressed:false},
      {label:'A',count:null,suppressed:true},
      {label:'C',count:null,suppressed:false},
    ]);
  });
  it('does not expose an exact patient total', () => {
    assert.equal(patientTotalBand(0), 'No records');
    assert.equal(patientTotalBand(8), 'Under 10');
    assert.equal(patientTotalBand(87), '80–89');
  });
});
