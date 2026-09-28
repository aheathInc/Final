import { prisma } from '@a-health/database';
import { canonical, sha256 } from './hash.js';

const CHAIN_LOCK = 8471120325;

export interface AuditInput {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Appends one hash-chained entry. Each row commits the hash of its
 * predecessor, so editing an old row breaks the chain and is detectable by
 * replay — tamper evidence without a distributed ledger.
 *
 * The advisory lock serialises appends. Without it two concurrent writers read
 * the same predecessor and fork the chain, silently destroying the one
 * property the structure exists for.
 */
export async function appendAudit(input: AuditInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK}::bigint)`;

    const last = await tx.auditLog.findFirst({
      orderBy: { seq: 'desc' },
      select: { hash: true },
    });

    const createdAt = new Date();
    const payload = {
      prevHash: last?.hash ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
      createdAt: createdAt.toISOString(),
    };

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        reason: input.reason ?? null,
        ipAddress: input.ipAddress ?? null,
        requestId: input.requestId ?? null,
        metadata: (input.metadata ?? {}) as object,
        prevHash: last?.hash ?? null,
        hash: sha256(canonical(payload)),
        createdAt,
      },
    });
  });
}

/** Walks the chain and reports the first row whose hash does not recompute. */
export async function verifyAuditChain(
  limit = 1000,
): Promise<{ ok: boolean; brokenAtSeq?: bigint }> {
  const rows = await prisma.auditLog.findMany({ orderBy: { seq: 'asc' }, take: limit });
  let prev: string | null = null;
  for (const row of rows) {
    const expected = sha256(
      canonical({
        prevHash: prev,
        actorUserId: row.actorUserId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        reason: row.reason,
        metadata: row.metadata ?? {},
        createdAt: row.createdAt.toISOString(),
      }),
    );
    if (expected !== row.hash) return { ok: false, brokenAtSeq: row.seq };
    prev = row.hash;
  }
  return { ok: true };
}
