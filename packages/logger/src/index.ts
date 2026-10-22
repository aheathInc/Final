/**
 * Structured JSON logging, no dependencies.
 *
 * One line per event so a log shipper can parse it, and — the part that
 * matters on a health platform — a redaction pass on every payload. An OTP,
 * a bearer token or a diagnosis reaching a log file is a disclosure that no
 * amount of access control on the database undoes.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Redacted wherever they appear, at any depth. Add to this list rather than
 * remembering not to log something — the default has to be safe.
 */
const SECRET_KEYS = new Set([
  'password',
  'new_password',
  'current_password',
  'passwordhash',
  'code',
  'codehash',
  'otp',
  'dev_code',
  'token',
  'access_token',
  'refresh_token',
  'accesstoken',
  'refreshtoken',
  'tokenhash',
  'authorization',
  'cookie',
  'signature',
  'secret',
  'jwt_secret',
  'mfasecret',
  'idempotency-key',
]);

/** Fields that identify a patient. Kept out of logs unless explicitly asked for. */
const PII_KEYS = new Set([
  'phone_number',
  'phonenumber',
  'email',
  'full_name',
  'fullname',
  'symptom_text',
  'symptomtext',
  'diagnosis_text',
  'diagnosistext',
  'advice_text',
  'body',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (SECRET_KEYS.has(key)) out[k] = '[redacted]';
    else if (PII_KEYS.has(key)) out[k] = '[pii]';
    else out[k] = redact(v, depth + 1);
  }
  return out;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(
  service: string,
  options: { level?: LogLevel; pretty?: boolean; bindings?: Record<string, unknown> } = {},
): Logger {
  const level = options.level ?? (process.env.LOG_LEVEL as LogLevel) ?? 'info';
  const pretty = options.pretty ?? process.env.NODE_ENV === 'development';
  const bindings = options.bindings ?? {};
  const threshold = LEVELS[level] ?? LEVELS.info;

  const write = (lvl: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (LEVELS[lvl] < threshold) return;
    const entry = {
      time: new Date().toISOString(),
      level: lvl,
      service,
      message,
      ...bindings,
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    };
    const line = pretty
      ? `${entry.time} ${lvl.toUpperCase().padEnd(5)} [${service}] ${message} ${
          fields ? JSON.stringify(redact(fields)) : ''
        }`.trimEnd()
      : JSON.stringify(entry);
    (lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout).write(line + '\n');
  };

  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (extra) =>
      createLogger(service, { level, pretty, bindings: { ...bindings, ...extra } }),
  };
}

export const redactForLog = redact;
