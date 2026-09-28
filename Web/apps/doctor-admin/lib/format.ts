/** Seconds remaining, written for a glance rather than for precision. */
export function countdown(seconds: number): string {
  if (seconds <= 0) return 'Muda umepita';
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} dak`;
  const h = Math.floor(m / 60);
  return `${h} saa ${m % 60} dak`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('sw-TZ', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('sw-TZ', { day: '2-digit', month: 'short', year: 'numeric' });
}
