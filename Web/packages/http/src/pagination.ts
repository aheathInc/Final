import { unprocessable } from './errors.js';

/**
 * Opaque cursor over a row id.
 *
 * Cursor rather than offset for anything that mutates while being read — a
 * clinician queue, a message thread, a sync feed. With offsets, a row inserted
 * between page one and page two shifts everything down and the reader silently
 * skips a record. In a queue of patients that is not a cosmetic bug.
 *
 * Base64 rather than the raw id so clients treat it as opaque and we stay free
 * to change what it encodes.
 */
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    const id = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!id) throw new Error('empty');
    return id;
  } catch {
    throw unprocessable('Cursor is not valid', 'cursor');
  }
}

export interface CursorPage<T> {
  data: T[];
  meta: { next_cursor: string | null; has_more: boolean };
}

/**
 * Takes one row more than asked for, uses its presence to answer has_more, and
 * drops it. Avoids a second COUNT query, which on a live queue would be both
 * expensive and immediately stale.
 */
export function toCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
  map?: (row: T) => unknown,
): CursorPage<unknown> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    data: page.map((r) => (map ? map(r) : r)),
    meta: {
      next_cursor: hasMore && last ? encodeCursor(last.id) : null,
      has_more: hasMore,
    },
  };
}

/** Prisma take/cursor/skip arguments for a cursor page. */
export function cursorArgs(cursor: string | undefined, limit: number) {
  const id = decodeCursor(cursor);
  return {
    take: limit + 1,
    ...(id ? { cursor: { id }, skip: 1 } : {}),
  };
}
