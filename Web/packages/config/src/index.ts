// Shared constants every service agrees on. package.json already pointed here;
// the file was missing, which would have broken the first service to import it.

export const API_VERSION = 'v1';
export const API_BASE_PATH = `/api/${API_VERSION}`;

export const SERVICE_PORTS = {
  gateway: 8080,
  auth: 4001,
  patient: 4002,
  doctor: 4003,
  appointment: 4004,
  consultation: 4005,
  messaging: 4006,
  followup: 4007,
  notification: 4008,
} as const;

/** SLA window per urgency, in seconds. Mirrors the contract. */
export const SLA_SECONDS = {
  emergency: 180,
  urgent: 900,
  routine: 7200,
} as const;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 5;
export const IDEMPOTENCY_TTL_HOURS = 24;
