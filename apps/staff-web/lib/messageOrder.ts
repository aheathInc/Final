/** Keep older pages and freshly sent messages in the server's stable order. */
export function mergeMessages<T extends { id: string; created_at: string }>(existing: T[], incoming: T[]): T[] {
  const unique = new Map(existing.map(message => [message.id, message]));
  incoming.forEach(message => unique.set(message.id, message));
  return Array.from(unique.values()).sort((a, b) => {
    const time = Date.parse(a.created_at) - Date.parse(b.created_at);
    return time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
