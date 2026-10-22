/** Reminder timing, not prescribing. Only a verified clinician supplies times. */
export class ScheduleError extends Error {}
const DAY = 86_400_000;
export interface ScheduleInput {
  start_date: string;
  timezone: string;
  times: string[];
}
const formatters = new Map<string, Intl.DateTimeFormat>();
function dateParts(date: Date, zone: string): string {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value!);
    formatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
export function validZone(zone: string): boolean {
  if (!zone || zone.length > 80) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date()); return true; } catch { return false; }
}
function parseDay(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ScheduleError('Use a valid calendar date.');
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== day) throw new ScheduleError('Invalid calendar date.');
  return ms;
}
/** Reject DST gaps/overlaps instead of quietly moving a clinician-selected time. */
export function wallTimeToUtc(day: string, time: string, zone: string): Date {
  const midnight = parseDay(day);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !validZone(zone)) throw new ScheduleError('Invalid time or IANA time zone.');
  const wall = midnight + (Number(time.slice(0, 2)) * 60 + Number(time.slice(3))) * 60_000;
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 12) {
    const instant = new Date(wall + hours * 3_600_000);
    const local = Date.parse(dateParts(instant, zone) + ':00Z');
    offsets.add(local - instant.getTime());
  }
  const candidates = [...offsets].map(offset => new Date(wall - offset))
    .filter(date => dateParts(date, zone) === `${day}T${time}`);
  if (candidates.length !== 1) throw new ScheduleError('A selected time is ambiguous or missing at a daylight-saving change. Choose a different time.');
  return candidates[0]!;
}
export function buildSchedule(input: ScheduleInput, frequency: number, duration: number, now = new Date()): Date[] {
  if (!Number.isInteger(frequency) || frequency < 1 || frequency > 12 || !Number.isInteger(duration) || duration < 1 || duration > 365) {
    throw new ScheduleError('Unsupported prescription frequency or duration.');
  }
  if (!Array.isArray(input.times) || input.times.length !== frequency || new Set(input.times).size !== frequency) {
    throw new ScheduleError('Choose one distinct time for each clinician-prescribed daily dose.');
  }
  if (!validZone(input.timezone)) throw new ScheduleError('Choose a valid IANA time zone.');
  const start = parseDay(input.start_date);
  const today = dateParts(now, input.timezone).slice(0, 10);
  if (input.start_date < today) throw new ScheduleError('Reminder schedules cannot be backdated.');
  if (start > parseDay(today) + 366 * DAY) throw new ScheduleError('Schedule start is too far in the future.');
  const rows: Date[] = [];
  for (let day = 0; day < duration; day += 1) {
    const date = new Date(start + day * DAY).toISOString().slice(0, 10);
    for (const time of input.times) rows.push(wallTimeToUtc(date, time, input.timezone));
  }
  rows.sort((a, b) => a.getTime() - b.getTime());
  if (rows[0]!.getTime() < now.getTime()) throw new ScheduleError('The first reminder must not be in the past. Choose the next agreed start date.');
  return rows;
}
export function doseState(status: string, scheduledAt: Date, now = new Date()): string {
  if (status === 'taken') return 'taken';
  if (status === 'missed') return 'patient_reported_skipped';
  if (status === 'delayed') return 'patient_reported_delayed';
  return scheduledAt <= now ? 'not_confirmed' : 'upcoming';
}
export function safeReportTime(value: string | undefined, now = new Date()): Date {
  if (!value) return now;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() > now.getTime() + 5 * 60_000) throw new ScheduleError('Invalid reported time.');
  return date;
}
