import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { triageWith } from '../engine/triage.js';
import { DEFAULT_LABEL, DEFAULT_RULES, DEFAULT_SLA } from '../engine/ruleset.js';
import { fanoutFor, rank } from '../engine/matching.js';

// The rules the platform ships with. Testing against these keeps the engine
// tests pure — they exercise the logic, not whatever is currently active in
// the database.
const SHIPPED = { label: DEFAULT_LABEL, rules: DEFAULT_RULES, sla: DEFAULT_SLA };
const triage = (input: Parameters<typeof triageWith>[0]) => triageWith(input, SHIPPED);

describe('triage', () => {
  it('is deterministic', () => {
    const input = { symptomCodes: ['fever', 'cough'], ageYears: 30 };
    assert.deepEqual(triage(input), triage(input));
  });

  it('stamps the rule version so a decision stays explainable', () => {
    assert.equal(triage({ symptomCodes: [] }).ruleVersion, DEFAULT_LABEL);
  });

  it('treats stroke signs as an emergency', () => {
    const r = triage({ symptomCodes: ['one_sided_weakness', 'speech_difficulty'], ageYears: 60 });
    assert.equal(r.urgency, 'emergency');
    assert.ok(r.matchedRules.includes('RF-STROKE-01'));
  });

  it('escalates fever in an infant above the same fever in an adult', () => {
    const infant = triage({ symptomCodes: ['fever'], ageYears: 0 });
    const adult = triage({ symptomCodes: ['fever'], ageYears: 30 });
    assert.equal(infant.urgency, 'emergency');
    assert.notEqual(adult.urgency, 'emergency');
  });

  it('raises obstetric bleeding and routes it to OB/GYN', () => {
    const r = triage({ symptomCodes: ['vaginal_bleeding_pregnancy'], isPregnant: true });
    assert.equal(r.urgency, 'emergency');
    assert.equal(r.recommendedSpecialty, 'obstetrics_gynaecology');
  });

  it('treats severity at the top of the scale as urgent', () => {
    const r = triage({ symptomCodes: ['headache'], severityByCode: { headache: 9 }, ageYears: 30 });
    assert.equal(r.urgency, 'urgent');
  });

  it('lifts an ordinary complaint when a chronic condition is present', () => {
    const plain = triage({ symptomCodes: ['cough'], ageYears: 30 });
    const chronic = triage({ symptomCodes: ['cough'], ageYears: 30, chronicConditions: ['hiv'] });
    assert.equal(plain.urgency, 'routine');
    assert.equal(chronic.urgency, 'urgent');
  });

  it('routes children to paediatrics', () => {
    assert.equal(triage({ symptomCodes: ['rash'], ageYears: 6 }).recommendedSpecialty, 'paediatrics');
  });
});

describe('matching', () => {
  const base = {
    specialty: 'general_practice',
    languages: ['sw'],
    currentLoad: 0,
    maxLoad: 5,
    ratingAvg: 4 as number | null,
  };
  const ctx = {
    requiredSpecialty: 'general_practice',
    patientLanguage: 'sw',
    urgency: 'routine' as const,
  };

  it('excludes clinicians at capacity', () => {
    assert.equal(rank([{ ...base, clinicianId: 'a', currentLoad: 5 }], ctx).length, 0);
  });

  it('prefers a shared language', () => {
    const out = rank(
      [
        { ...base, clinicianId: 'sw', languages: ['sw'] },
        { ...base, clinicianId: 'fr', languages: ['fr'] },
      ],
      ctx,
    );
    assert.equal(out[0]!.clinicianId, 'sw');
  });

  it('prefers the lighter load when all else matches', () => {
    const out = rank(
      [
        { ...base, clinicianId: 'busy', currentLoad: 4 },
        { ...base, clinicianId: 'free', currentLoad: 0 },
      ],
      ctx,
    );
    assert.equal(out[0]!.clinicianId, 'free');
  });

  it('does not bury an unrated clinician', () => {
    // Ranking a newly deployed graduate last would mean they never get a first
    // case, which defeats the point of employing them.
    const out = rank(
      [
        { ...base, clinicianId: 'new', ratingAvg: null },
        { ...base, clinicianId: 'poor', ratingAvg: 2 },
      ],
      ctx,
    );
    assert.equal(out[0]!.clinicianId, 'new');
  });

  it('records the weights behind every score', () => {
    const out = rank([{ ...base, clinicianId: 'a' }], ctx);
    assert.deepEqual(
      Object.keys(out[0]!.weights).sort(),
      ['availability', 'language', 'proximity', 'rating', 'specialty'],
    );
  });

  it('widens the pool on each escalation', () => {
    assert.ok(fanoutFor('routine', 2, 3) > fanoutFor('routine', 0, 3));
    assert.ok(fanoutFor('emergency', 0, 3) > fanoutFor('routine', 0, 3));
  });
});
