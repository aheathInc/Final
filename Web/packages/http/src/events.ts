import { Client } from 'pg';
import { createLogger } from '@a-health/logger';

const logger = createLogger('events');
const CHANNEL = 'ahealth_events';

/**
 * What one service tells the others.
 *
 * `audienceUserIds` is computed by the publisher, not the subscriber. The
 * service that owns the data is the only one that knows who is entitled to
 * hear about it, and working that out at the delivery end would mean the
 * realtime layer needing read access to every domain.
 */
export interface DomainEvent {
  event:
    | 'consultation.assigned'
    | 'consultation.escalated'
    | 'consultation.completed'
    | 'consultation.message'
    | 'checkin.deviation'
    | 'emergency.dispatched'
    | 'device.alert';
  entity: string;
  id: string;
  version?: number;
  careThreadId?: string | null;
  audienceUserIds: string[];
  data?: Record<string, unknown>;
}

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe(handler: (event: DomainEvent) => void): Promise<void>;
  close(): Promise<void>;
}

/**
 * Postgres LISTEN/NOTIFY.
 *
 * Chosen over Redis because the database is already there, and one fewer
 * moving part in a pilot is worth more than headroom nobody is using yet.
 *
 * Its limits are real and worth stating: the payload cap is 8000 bytes,
 * nothing is persisted, and a subscriber that is down misses what was sent
 * while it was down. None of that matters for realtime nudges — the client
 * refetches on reconnect and the database remains the source of truth — but it
 * would matter for anything that must not be missed. Those go through a table
 * and a worker, not through here.
 */
export function createPostgresEventBus(connectionString: string): EventBus {
  let publisher: Client | null = null;
  let listener: Client | null = null;

  async function getPublisher(): Promise<Client> {
    if (publisher) return publisher;
    publisher = new Client({ connectionString });
    await publisher.connect();
    return publisher;
  }

  return {
    async publish(event) {
      let payload = JSON.stringify(event);

      // Over the cap, drop the body and keep the pointer. The client already
      // knows how to fetch; it does not know how to recover a truncated event.
      if (Buffer.byteLength(payload) > 7000) {
        payload = JSON.stringify({ ...event, data: { truncated: true } });
      }

      try {
        const client = await getPublisher();
        await client.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]);
      } catch (err) {
        // A dropped notification must never fail the write that caused it. The
        // record is committed; the nudge is best effort.
        logger.warn('publish failed', { event: event.event, err: String(err) });
      }
    },

    async subscribe(handler) {
      listener = new Client({ connectionString });
      await listener.connect();
      await listener.query(`LISTEN ${CHANNEL}`);

      listener.on('notification', (msg) => {
        if (!msg.payload) return;
        try {
          handler(JSON.parse(msg.payload) as DomainEvent);
        } catch (err) {
          logger.warn('undeliverable payload', { err: String(err) });
        }
      });

      listener.on('error', (err) => {
        logger.error('listener error, reconnecting', { err: String(err) });
        setTimeout(() => {
          void this.subscribe(handler).catch(() => undefined);
        }, 2000);
      });

      logger.info('subscribed', { channel: CHANNEL });
    },

    async close() {
      await publisher?.end().catch(() => undefined);
      await listener?.end().catch(() => undefined);
      publisher = null;
      listener = null;
    },
  };
}
