import { prisma } from '@a-health/database';
import { verifyAuditChain } from '@a-health/http';

export type LedgerCategory = 'consent' | 'verification' | 'break_glass';

const ACTIONS: Record<LedgerCategory, string[]> = {
  consent: ['consent.granted', 'consent.revoked'],
  verification: ['clinician.verified', 'clinician.rejected'],
  break_glass: ['emergency.context_break_glass_access'],
};

const ALL_SUPPORTED_ACTIONS = Object.values(ACTIONS).flat();
const scopes = new Set([
  'full_history', 'current_thread', 'medications_only', 'investigations_only', 'emergency_minimum',
]);
const granteeTypes = new Set(['clinician', 'facility', 'researcher', 'emergency_responder']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeDetails(action: string, value: unknown): Record<string, string> {
  const metadata = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  if (action === 'consent.granted' || action === 'consent.revoked') {
    const scope = metadata.scope;
    const granteeType = metadata.granteeType;
    return {
      ...(typeof scope === 'string' && scopes.has(scope) ? { scope } : {}),
      ...(typeof granteeType === 'string' && granteeTypes.has(granteeType)
        ? { grantee_type: granteeType }
        : {}),
    };
  }
  if (action === 'clinician.verified') return { verification_status: 'verified' };
  if (action === 'clinician.rejected') return { verification_status: 'rejected' };
  if (action === 'emergency.context_break_glass_access') {
    const emergencyRequestId = metadata.emergencyRequestId;
    return typeof emergencyRequestId === 'string' && uuid.test(emergencyRequestId)
      ? { emergency_request_id: emergencyRequestId }
      : {};
  }
  return {};
}

export async function listLedgerEvents(input: {
  category?: LedgerCategory;
  cursor?: string;
  limit: number;
}) {
  const actions = input.category ? ACTIONS[input.category] : ALL_SUPPORTED_ACTIONS;
  const afterSeq = input.cursor ? BigInt(input.cursor) : undefined;
  const rows = await prisma.auditLog.findMany({
    where: {
      action: { in: actions },
      ...(afterSeq === undefined ? {} : { seq: { lt: afterSeq } }),
    },
    orderBy: { seq: 'desc' },
    take: input.limit + 1,
    select: {
      seq: true,
      action: true,
      actorUserId: true,
      entityType: true,
      entityId: true,
      metadata: true,
      createdAt: true,
    },
  });
  const hasMore = rows.length > input.limit;
  const events = hasMore ? rows.slice(0, input.limit) : rows;
  const last = events[events.length - 1];

  return {
    data: events.map((row) => ({
      seq: row.seq.toString(),
      category: input.category ?? categoryFor(row.action),
      event_type: row.action,
      actor_id: row.actorUserId,
      resource_type: row.entityType,
      resource_id: row.entityId,
      occurred_at: row.createdAt.toISOString(),
      details: safeDetails(row.action, row.metadata),
    })),
    meta: { next_cursor: hasMore && last ? last.seq.toString() : null, has_more: hasMore },
  };
}

function categoryFor(action: string): LedgerCategory {
  if (ACTIONS.consent.includes(action)) return 'consent';
  if (ACTIONS.verification.includes(action)) return 'verification';
  return 'break_glass';
}

export async function verifyLedger() {
  const result = await verifyAuditChain();
  return {
    status: result.ok ? 'VALID' as const : 'INVALID' as const,
    events_checked: result.eventsChecked,
    ...(result.brokenAtSeq === undefined ? {} : { broken_at_seq: result.brokenAtSeq.toString() }),
  };
}
