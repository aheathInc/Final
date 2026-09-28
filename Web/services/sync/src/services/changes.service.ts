import { prisma } from '@a-health/database';
import { ENTITY_FETCHERS } from './entityFetchers.js';
import { env } from '../config/env.js';

export interface Caller { sub: string; role: string; ppid?: string; cpid?: string }

function encodeCursor(seq: bigint): string {
  return Buffer.from(seq.toString()).toString('base64url');
}
function decodeCursor(cursor: string): bigint {
  return BigInt(Buffer.from(cursor, 'base64url').toString('utf8'));
}

/**
 * The read half. Visibility is scoped the same way every other list
 * endpoint in this platform is: a patient sees their own patientProfileId,
 * a clinician sees rows tagged with their clinicianId, admin sees all.
 *
 * Within the returned page, only the LATEST change per (entity, entityId) is
 * emitted — a client rebuilding local state needs current truth, not a full
 * replay of every intermediate version, and re-fetching the same row's
 * current body three times because it changed three times serves nobody.
 * If that latest change is a delete, a tombstone is emitted with no data;
 * otherwise the row's current live body is fetched fresh, never served from
 * the change-log entry itself (which never stored a snapshot to begin with).
 */
export async function getSyncChanges(
  caller: Caller,
  query: { cursor?: string; entities?: string[]; limit: number },
) {
  const afterSeq = query.cursor ? decodeCursor(query.cursor) : null;

  const visibility =
    caller.role === 'platform_admin'
      ? {}
      : caller.cpid
        ? { clinicianId: caller.cpid }
        : caller.ppid
          ? { patientProfileId: caller.ppid }
          : { patientProfileId: '__none__' };

  const isFirstSync = afterSeq === null;
  const snapshotCutoff = new Date(Date.now() - env.SNAPSHOT_WINDOW_DAYS * 86_400_000);

  const rows = await prisma.changeLog.findMany({
    where: {
      ...visibility,
      ...(afterSeq !== null ? { seq: { gt: afterSeq } } : {}),
      ...(query.entities && query.entities.length > 0 ? { entity: { in: query.entities } } : {}),
      // A first sync returns only recent activity — a closed thread from
      // years ago is fetched on demand, not pushed to every fresh install.
      ...(isFirstSync ? { occurredAt: { gte: snapshotCutoff } } : {}),
    },
    orderBy: { seq: 'asc' },
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;

  // Collapse to the latest row per (entity, entityId) within this page.
  const latest = new Map<string, (typeof page)[number]>();
  for (const row of page) {
    latest.set(`${row.entity}:${row.entityId}`, row);
  }

  const data = await Promise.all(
    Array.from(latest.values()).map(async (row) => {
      const base = {
        entity: row.entity,
        id: row.entityId,
        op: row.op,
        version: row.version,
        updated_at: row.occurredAt.toISOString(),
      };
      if (row.op === 'delete') return base;

      const fetcher = ENTITY_FETCHERS[row.entity];
      const liveData = fetcher ? await fetcher(row.entityId) : null;
      return { ...base, ...(liveData ? { data: liveData } : {}) };
    }),
  );

  const lastSeq = page.length > 0 ? page[page.length - 1]!.seq : afterSeq ?? 0n;

  return {
    data,
    meta: {
      next_cursor: encodeCursor(lastSeq),
      has_more: hasMore,
      server_time: new Date().toISOString(),
    },
  };
}
