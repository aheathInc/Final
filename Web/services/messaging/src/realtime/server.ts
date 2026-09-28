import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { createLogger } from '@a-health/logger';
import type { EventBus } from '@a-health/http';
import { env } from '../config/env.js';
import { redeemTicket } from '../services/realtime.service.js';

const logger = createLogger('messaging.ws');

interface Socket extends WebSocket {
  userId?: string;
  alive?: boolean;
}

/**
 * Holds the open sockets and routes events to them.
 *
 * One user, many sockets: a clinician with the console open on a desktop and
 * the app open on a phone must see the same case appear on both.
 *
 * Delivery here is best effort by design. Every event carries entity, id and
 * version so a client that missed one refetches and reconciles; the database
 * stays the source of truth, and nothing clinical depends on a socket having
 * been open.
 */
export function attachRealtime(server: Server, bus: EventBus): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/realtime' });
  const sockets = new Map<string, Set<Socket>>();

  wss.on('connection', (raw, request) => {
    const socket = raw as Socket;
    void (async () => {
      try {
        const url = new URL(request.url ?? '', 'http://localhost');
        const ticket = url.searchParams.get('ticket');
        if (!ticket) {
          socket.close(4401, 'ticket required');
          return;
        }

        const userId = await redeemTicket(ticket);
        socket.userId = userId;
        socket.alive = true;

        let set = sockets.get(userId);
        if (!set) {
          set = new Set();
          sockets.set(userId, set);
        }
        set.add(socket);

        socket.on('pong', () => {
          socket.alive = true;
        });

        socket.on('close', () => {
          const current = sockets.get(userId);
          current?.delete(socket);
          if (current && current.size === 0) sockets.delete(userId);
        });

        socket.send(JSON.stringify({ event: 'connected', server_time: new Date().toISOString() }));
        logger.info('socket open', { userId, openForUser: set.size });
      } catch {
        // No detail on the wire. A failed handshake must not tell a caller
        // whether the ticket was unknown, expired, or already spent.
        socket.close(4401, 'unauthorised');
      }
    })();
  });

  // A socket on a mobile network can die without a close frame. Without this
  // the map fills with connections that will never receive anything.
  const heartbeat = setInterval(() => {
    for (const set of sockets.values()) {
      for (const socket of set) {
        if (!socket.alive) {
          socket.terminate();
          continue;
        }
        socket.alive = false;
        socket.ping();
      }
    }
  }, env.WS_HEARTBEAT_SECONDS * 1000);
  heartbeat.unref();

  void bus.subscribe((event) => {
    const payload = JSON.stringify(event);
    let delivered = 0;
    for (const userId of event.audienceUserIds) {
      for (const socket of sockets.get(userId) ?? []) {
        if (socket.readyState === socket.OPEN) {
          socket.send(payload);
          delivered += 1;
        }
      }
    }
    logger.debug('event routed', { event: event.event, delivered });
  });

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
