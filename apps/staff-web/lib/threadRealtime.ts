import { api } from './api';

/** A fresh, single-use ticket for every reconnect; never retain credentials. */
export function watchThread(threadId: string, changed: () => void, connected: (live: boolean) => void) {
  let closed = false, socket: WebSocket | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let retry = 1000;
  async function connect() {
    try {
      const { data } = await api.post<{ url: string; ticket: string }>('/realtime/token', {});
      if (closed) return;
      const url = new URL(data.url); url.searchParams.set('ticket', data.ticket);
      socket = new WebSocket(url);
      socket.onmessage = e => {
        try { const event = JSON.parse(e.data); if (event.event === 'connected') { retry = 1000; connected(true); changed(); }
          else if (event.careThreadId === threadId) changed(); } catch { /* invalid event; fallback polling remains active */ }
      };
      socket.onclose = () => { if (!closed) { connected(false); timer = setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); } };
      socket.onerror = () => socket?.close();
    } catch { if (!closed) { connected(false); timer = setTimeout(connect, retry); retry = Math.min(retry * 2, 30000); } }
  }
  void connect();
  return () => { closed = true; clearTimeout(timer); socket?.close(); };
}
