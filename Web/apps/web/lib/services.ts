/**
 * Maps an API path to the service that owns it.
 *
 * The SA&D's edge layer specifies a real API Gateway (Kong) doing this
 * routing, plus rate limiting and token validation. This table is a stopgap
 * so the console runs before that gateway exists — not a replacement for it.
 * Setting API_GATEWAY_URL collapses every lookup to one origin, which is why
 * the resolver checks it first.
 *
 * `*` matches one path segment, and patterns are matched longest-first,
 * because several paths share a prefix but belong to different services:
 * `/users/me` is auth's, `/users/me/dependents` is patient's. A plain
 * startsWith() sends the second to the wrong service, and the bug then looks
 * like a permissions problem rather than a routing one.
 */
interface Route { pattern: string; env: string; port: number }

const ROUTES: Route[] = [
  { pattern: '/users/me/dependents', env: 'PATIENT_SERVICE_URL', port: 4002 },
  { pattern: '/patient-profiles/*/risk-scores', env: 'PREVENTION_SERVICE_URL', port: 4024 },
  { pattern: '/patient-profiles/*/vaccinations', env: 'PREVENTION_SERVICE_URL', port: 4024 },
  { pattern: '/patient-profiles/*/prescriptions', env: 'CONSULTATION_SERVICE_URL', port: 4005 },
  { pattern: '/care-threads/*/messages', env: 'MESSAGING_SERVICE_URL', port: 4006 },

  { pattern: '/auth', env: 'AUTH_SERVICE_URL', port: 4001 },
  { pattern: '/users', env: 'AUTH_SERVICE_URL', port: 4001 },
  { pattern: '/patient-profiles', env: 'PATIENT_SERVICE_URL', port: 4002 },
  { pattern: '/clinicians', env: 'DOCTOR_SERVICE_URL', port: 4003 },
  { pattern: '/appointments', env: 'APPOINTMENT_SERVICE_URL', port: 4004 },
  { pattern: '/consultations', env: 'CONSULTATION_SERVICE_URL', port: 4005 },
  { pattern: '/care-threads', env: 'CONSULTATION_SERVICE_URL', port: 4005 },
  { pattern: '/queue', env: 'CONSULTATION_SERVICE_URL', port: 4005 },
  { pattern: '/prescriptions', env: 'CONSULTATION_SERVICE_URL', port: 4005 },
  { pattern: '/messages', env: 'MESSAGING_SERVICE_URL', port: 4006 },
  { pattern: '/realtime', env: 'MESSAGING_SERVICE_URL', port: 4006 },
  { pattern: '/follow-up-cycles', env: 'FOLLOWUP_SERVICE_URL', port: 4007 },
  { pattern: '/check-ins', env: 'FOLLOWUP_SERVICE_URL', port: 4007 },
  { pattern: '/adherence-logs', env: 'FOLLOWUP_SERVICE_URL', port: 4007 },
  { pattern: '/ai', env: 'AI_SERVICE_URL', port: 4009 },
  { pattern: '/emergency-requests', env: 'EMERGENCY_SERVICE_URL', port: 4010 },
  { pattern: '/transport-units', env: 'EMERGENCY_SERVICE_URL', port: 4010 },
  { pattern: '/pharmacies', env: 'PHARMACY_SERVICE_URL', port: 4011 },
  { pattern: '/dispensing', env: 'PHARMACY_SERVICE_URL', port: 4011 },
  { pattern: '/payments', env: 'PAYMENT_SERVICE_URL', port: 4012 },
  { pattern: '/investigation-orders', env: 'DIAGNOSTICS_SERVICE_URL', port: 4013 },
  { pattern: '/incident-reports', env: 'QUALITY_SERVICE_URL', port: 4014 },
  { pattern: '/families', env: 'FAMILIES_SERVICE_URL', port: 4015 },
  { pattern: '/education', env: 'EDUCATION_SERVICE_URL', port: 4016 },
  { pattern: '/network', env: 'NETWORK_SERVICE_URL', port: 4017 },
  { pattern: '/insurance', env: 'INSURANCE_SERVICE_URL', port: 4018 },
  { pattern: '/research', env: 'RESEARCH_SERVICE_URL', port: 4019 },
  { pattern: '/surveillance', env: 'SURVEILLANCE_SERVICE_URL', port: 4020 },
  { pattern: '/sync', env: 'SYNC_SERVICE_URL', port: 4022 },
  { pattern: '/devices', env: 'DEVICES_SERVICE_URL', port: 4023 },
  { pattern: '/screening-programmes', env: 'PREVENTION_SERVICE_URL', port: 4024 },
  { pattern: '/screening-invitations', env: 'PREVENTION_SERVICE_URL', port: 4024 },
  { pattern: '/facilities', env: 'FACILITIES_SERVICE_URL', port: 4025 },
];

const seg = (p: string) => p.split('/').filter(Boolean);

function matches(pattern: string, path: string): boolean {
  const a = seg(pattern);
  const b = seg(path);
  if (b.length < a.length) return false;
  return a.every((s, i) => s === '*' || s === b[i]);
}

const SORTED = [...ROUTES].sort((a, b) => seg(b.pattern).length - seg(a.pattern).length);

export function resolveServiceUrl(path: string): string | null {
  const gateway = process.env.API_GATEWAY_URL;
  if (gateway) return gateway;
  const route = SORTED.find((r) => matches(r.pattern, path));
  if (!route) return null;
  return process.env[route.env] ?? `http://localhost:${route.port}`;
}
