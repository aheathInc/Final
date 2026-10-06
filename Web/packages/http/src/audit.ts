import { prisma, type Prisma } from '@a-health/database';
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

const HASH_VERSION = 2;
const PAGE_SIZE = 500;

type AuditTransaction = Prisma.TransactionClient;

function metadataForStorage(metadata: Record<string, unknown> | undefined): Prisma.InputJsonObject {
  // Match JSONB's value model before hashing: Dates become ISO strings,
  // undefined object properties disappear, and unsupported values fail early.
  const value = JSON.parse(JSON.stringify(metadata ?? {})) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Audit metadata must be a JSON object');
  }
  return value as Prisma.InputJsonObject;
}

function v1Payload(row: {
  prevHash: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  metadata: unknown;
  createdAt: Date;
}) {
  return {
    prevHash: row.prevHash,
    actorUserId: row.actorUserId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    reason: row.reason,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

function v2Payload(row: {
  prevHash: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  reason: string | null;
  ipAddress: string | null;
  requestId: string | null;
  metadata: unknown;
  createdAt: Date;
}) {
  return {
    hashVersion: HASH_VERSION,
    prevHash: row.prevHash,
    actorUserId: row.actorUserId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    reason: row.reason,
    ipAddress: row.ipAddress,
    requestId: row.requestId,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt.toISOString(),
  };
}

async function appendAuditInTransaction(input: AuditInput, tx: AuditTransaction): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK}::bigint)`;

  const last = await tx.auditLog.findFirst({
    orderBy: { seq: 'desc' },
    select: { hash: true },
  });

  const createdAt = new Date();
  const metadata = metadataForStorage(input.metadata);
  const row = {
    hashVersion: HASH_VERSION,
    prevHash: last?.hash ?? null,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    reason: input.reason ?? null,
    ipAddress: input.ipAddress ?? null,
    requestId: input.requestId ?? null,
    metadata,
    createdAt,
  };

  await tx.auditLog.create({
    data: {
      ...row,
      hash: sha256(canonical(v2Payload(row))),
    },
  });
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
export async function appendAudit(input: AuditInput, transaction?: AuditTransaction): Promise<void> {
  if (transaction) return appendAuditInTransaction(input, transaction);
  await prisma.$transaction((tx) => appendAuditInTransaction(input, tx));
}

/** Replays every committed row from a consistent snapshot. */
export async function verifyAuditChain(): Promise<{
  ok: boolean;
  eventsChecked: number;
  brokenAtSeq?: bigint;
}> {
  let prev: string | null = null;
  let eventsChecked = 0;

  return prisma.$transaction(async (tx) => {
    let afterSeq: bigint | undefined;
    while (true) {
      const rows = await tx.auditLog.findMany({
        ...(afterSeq === undefined ? {} : { where: { seq: { gt: afterSeq } } }),
        orderBy: { seq: 'asc' },
        take: PAGE_SIZE,
      });
      if (rows.length === 0) break;

      for (const row of rows) {
        const expectedPrevious = prev;
        const payload = row.hashVersion === 1
          ? v1Payload({ ...row, prevHash: expectedPrevious })
          : row.hashVersion === HASH_VERSION
            ? v2Payload({ ...row, prevHash: expectedPrevious })
            : null;
        if (row.prevHash !== expectedPrevious || !payload || sha256(canonical(payload)) !== row.hash) {
          return { ok: false, eventsChecked: eventsChecked + 1, brokenAtSeq: row.seq };
        }
        prev = row.hash;
        afterSeq = row.seq;
        eventsChecked += 1;
      }
      if (rows.length < PAGE_SIZE) break;
    }
    return { ok: true, eventsChecked };
  }, { isolationLevel: 'RepeatableRead' });
}
