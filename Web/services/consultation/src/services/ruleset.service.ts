import { prisma } from '@a-health/database';
import { appendAudit, conflict, forbidden, notFound, unprocessable } from '@a-health/http';
import {
  DEFAULT_LABEL, DEFAULT_RULES, DEFAULT_SLA,
  NON_NEGOTIABLE_EMERGENCY, NON_NEGOTIABLE_OBSTETRIC,
  type Ruleset, validateRules, validateSla,
} from '../engine/ruleset.js';
import { triageWith } from '../engine/triage.js';

export interface Caller { sub: string; role: string }
export interface Meta { ip?: string | null; requestId?: string | null }

/**
 * Cached because triage runs on the path of every consultation request, and a
 * database round trip per triage would put the rules in the way of the thing
 * they exist to serve.
 *
 * Refreshed on a timer rather than pushed: a change reaches other service
 * instances within CACHE_TTL_MS. That delay is real and worth stating — a
 * newly activated ruleset is live here immediately and everywhere else within
 * half a minute.
 */
const CACHE_TTL_MS = 30_000;
let cached: { ruleset: Ruleset; at: number } | null = null;

const FALLBACK: Ruleset = { label: DEFAULT_LABEL, rules: DEFAULT_RULES, sla: DEFAULT_SLA };

export async function activeRuleset(): Promise<Ruleset> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ruleset;

  const row = await prisma.triageRuleset.findFirst({ where: { status: 'active' } });
  // No active row means the seed has not run. Falling back to the shipped
  // defaults keeps triage working rather than failing closed on a
  // configuration problem — a consultation that cannot be triaged is a patient
  // who cannot be seen.
  const ruleset: Ruleset = row
    ? { label: row.label, rules: row.rules as never, sla: row.slaSeconds as never }
    : FALLBACK;

  cached = { ruleset, at: Date.now() };
  return ruleset;
}

function invalidate() {
  cached = null;
}

/** Seeds the shipped rules as the first active version. Idempotent. */
export async function seedDefaultRuleset(systemUserId?: string): Promise<void> {
  const existing = await prisma.triageRuleset.findFirst({ where: { status: 'active' } });
  if (existing) return;

  const author =
    systemUserId ??
    (await prisma.user.findFirst({ where: { role: 'platform_admin' }, select: { id: true } }))?.id;
  if (!author) return; // No admin exists yet; the fallback covers triage until one does.

  await prisma.triageRuleset.create({
    data: {
      label: DEFAULT_LABEL,
      status: 'active',
      rules: DEFAULT_RULES as never,
      slaSeconds: DEFAULT_SLA as never,
      notes: 'Rules the platform shipped with, seeded so behaviour is unchanged.',
      createdById: author,
      activatedById: author,
      activatedAt: new Date(),
    },
  });
  invalidate();
}

function assertAdmin(caller: Caller) {
  if (caller.role !== 'platform_admin') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Only a platform administrator may change triage rules');
  }
}

function serialise(r: {
  id: string; label: string; status: string; rules: unknown; slaSeconds: unknown;
  notes: string | null; createdById: string; activatedAt: Date | null;
  retiredAt: Date | null; createdAt: Date;
}) {
  return {
    id: r.id,
    label: r.label,
    status: r.status,
    rules: r.rules,
    sla_seconds: r.slaSeconds,
    notes: r.notes,
    created_by_id: r.createdById,
    activated_at: r.activatedAt?.toISOString() ?? null,
    retired_at: r.retiredAt?.toISOString() ?? null,
    created_at: r.createdAt.toISOString(),
  };
}

export async function listRulesets(caller: Caller) {
  assertAdmin(caller);
  const rows = await prisma.triageRuleset.findMany({ orderBy: { createdAt: 'desc' } });
  return { data: rows.map(serialise) };
}

export async function getRuleset(label: string, caller: Caller) {
  assertAdmin(caller);
  const row = await prisma.triageRuleset.findUnique({ where: { label } });
  if (!row) throw notFound('Ruleset not found');
  return serialise(row);
}

/**
 * Creates a draft. Never edits an existing version — including another draft.
 *
 * Immutability is what keeps ConsultationRequest.triageRuleVersion honest: a
 * consultation decided months ago must still resolve to the rules that decided
 * it, and an editable row would make that stamp point at something else.
 */
export async function createDraft(
  caller: Caller,
  input: { label: string; rules?: unknown; sla_seconds?: unknown; clone_from?: string; notes?: string },
  meta: Meta,
) {
  assertAdmin(caller);

  const clash = await prisma.triageRuleset.findUnique({ where: { label: input.label } });
  if (clash) throw conflict('DUPLICATE_RESOURCE', `A ruleset labelled ${input.label} already exists`);

  let rules = input.rules;
  let sla = input.sla_seconds;

  if (input.clone_from) {
    const source = await prisma.triageRuleset.findUnique({ where: { label: input.clone_from } });
    if (!source) throw notFound(`Ruleset ${input.clone_from} not found`);
    rules = rules ?? source.rules;
    sla = sla ?? source.slaSeconds;
  }
  rules = rules ?? DEFAULT_RULES;
  sla = sla ?? DEFAULT_SLA;

  const problems = [...validateRules(rules), ...validateSla(sla)];
  if (problems.length > 0) {
    throw unprocessable(`This ruleset is not valid: ${problems.join('; ')}`, 'rules');
  }

  const created = await prisma.triageRuleset.create({
    data: {
      label: input.label,
      status: 'draft',
      rules: rules as never,
      slaSeconds: sla as never,
      notes: input.notes ?? null,
      createdById: caller.sub,
    },
  });

  await appendAudit({
    actorUserId: caller.sub, action: 'triage.ruleset_drafted',
    entityType: 'triage_rulesets', entityId: created.id,
    metadata: { label: input.label, clonedFrom: input.clone_from ?? null },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return serialise(created);
}

/**
 * The cases a ruleset must get right before it is allowed anywhere near a
 * patient. Each one is a presentation where a delayed answer changes the
 * outcome, so each must come back as an emergency.
 */
const MUST_BE_EMERGENCY: { name: string; input: Parameters<typeof triageWith>[0] }[] = [
  ...Object.keys(NON_NEGOTIABLE_EMERGENCY).map((code) => ({
    name: code,
    input: { symptomCodes: [code], ageYears: 40 },
  })),
  ...Object.keys(NON_NEGOTIABLE_OBSTETRIC).map((code) => ({
    name: `${code} (pregnant)`,
    input: { symptomCodes: [code], ageYears: 28, isPregnant: true },
  })),
];

export interface CheckResult { name: string; expected: string; got: string; passed: boolean }

function runSafetyChecks(ruleset: Ruleset): CheckResult[] {
  return MUST_BE_EMERGENCY.map(({ name, input }) => {
    const got = triageWith(input, ruleset).urgency;
    return { name, expected: 'emergency', got, passed: got === 'emergency' };
  });
}

/** Dry-run: what would this ruleset decide, and does it clear the floor? */
export async function previewRuleset(
  label: string,
  caller: Caller,
  sample?: Parameters<typeof triageWith>[0],
) {
  assertAdmin(caller);
  const row = await prisma.triageRuleset.findUnique({ where: { label } });
  if (!row) throw notFound('Ruleset not found');

  const ruleset: Ruleset = { label: row.label, rules: row.rules as never, sla: row.slaSeconds as never };
  const checks = runSafetyChecks(ruleset);

  return {
    label,
    safety_checks: checks,
    all_passed: checks.every((c) => c.passed),
    sample_result: sample ? triageWith(sample, ruleset) : null,
  };
}

/**
 * Activates a draft, retiring whatever was active.
 *
 * Refuses if any safety check fails. The floor would catch such a rule at
 * runtime anyway, but a ruleset that needs the floor to be safe is one nobody
 * should be relying on, and refusing here means the administrator finds out
 * now rather than from a patient outcome.
 */
export async function activateRuleset(label: string, caller: Caller, notes: string, meta: Meta) {
  assertAdmin(caller);
  if (!notes?.trim()) {
    throw unprocessable('Say why this ruleset is being activated — a rule change nobody explained is one nobody can review.', 'notes');
  }

  const row = await prisma.triageRuleset.findUnique({ where: { label } });
  if (!row) throw notFound('Ruleset not found');
  if (row.status === 'active') throw conflict('STATE_TRANSITION_INVALID', 'This ruleset is already active');
  if (row.status === 'retired') throw conflict('STATE_TRANSITION_INVALID', 'A retired ruleset cannot be reactivated; clone it into a new version instead');

  const ruleset: Ruleset = { label: row.label, rules: row.rules as never, sla: row.slaSeconds as never };
  const checks = runSafetyChecks(ruleset);
  const failed = checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    throw unprocessable(
      `Refused: this ruleset would not treat these as emergencies — ${failed.map((f) => f.name).join(', ')}`,
      'rules',
    );
  }

  const previous = await prisma.triageRuleset.findFirst({ where: { status: 'active' } });

  await prisma.$transaction(async (tx) => {
    if (previous) {
      await tx.triageRuleset.update({
        where: { id: previous.id },
        data: { status: 'retired', retiredAt: new Date() },
      });
    }
    await tx.triageRuleset.update({
      where: { id: row.id },
      data: { status: 'active', activatedById: caller.sub, activatedAt: new Date(), notes },
    });
  });

  invalidate();

  await appendAudit({
    actorUserId: caller.sub, action: 'triage.ruleset_activated',
    entityType: 'triage_rulesets', entityId: row.id,
    metadata: { label, replaced: previous?.label ?? null, notes },
    ipAddress: meta.ip, requestId: meta.requestId,
  });

  return { ...serialise({ ...row, status: 'active', activatedAt: new Date(), notes }), safety_checks: checks };
}
