#!/usr/bin/env bash
#
# Completes services/auth. Four gaps, in order of severity:
#
#   1. No way to set a password. registerClinician never writes passwordHash,
#      so /auth/login could never succeed for anyone — dead code.
#   2. No brute-force protection on login. OTP is rate limited; password login
#      had nothing at all.
#   3. otp_challenges, idempotency_records and refresh_tokens grow forever.
#   4. The contract does not describe any of the above.
#
# Run from the repo root:
#   bash finish-auth.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/auth"
DB="$ROOT/packages/database"
API="$ROOT/packages/api/openapi/a-health-api-v1.yaml"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$SVC/src/services/auth.service.ts" ] || { echo "services/auth not set up."; exit 1; }

backup() { [ -f "$1" ] && [ -s "$1" ] && cp "$1" "$1.bak" || true; }
patch() { node - "$@"; }

# ---------------------------------------------------------------------------
# 1. Schema: lockout counters on User
# ---------------------------------------------------------------------------
echo "Patching schema…"
backup "$DB/prisma/schema.prisma"
patch "$DB/prisma/schema.prisma" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('failedLoginCount')) { console.log('  already patched'); process.exit(0); }

const anchor = '  preferredLanguage LanguageCode @default(sw) @map("preferred_language")';
if (!s.includes(anchor)) { console.error('  User anchor not found'); process.exit(1); }

s = s.replace(anchor, anchor + `

  /// Consecutive failed password attempts. Reset to zero on any success.
  failedLoginCount Int       @default(0) @map("failed_login_count")
  /// Set when the counter trips. Checked before the password is even compared,
  /// so a locked account costs an attacker nothing to discover and gains them
  /// nothing to keep trying.
  lockedUntil      DateTime? @map("locked_until")`);

fs.writeFileSync(p, s);
console.log('  lockout fields added');
NODE

# ---------------------------------------------------------------------------
# 2. jwt: record how the session was authenticated
# ---------------------------------------------------------------------------
backup "$SVC/src/utils/jwt.ts"
patch "$SVC/src/utils/jwt.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('amr?:')) { console.log('  jwt already patched'); process.exit(0); }

const anchor = '  did?: string;\n  jti: string;';
if (!s.includes(anchor)) { console.error('  claims anchor not found'); process.exit(1); }

s = s.replace(anchor, `  did?: string;
  /**
   * Authentication method reference: how this session was established.
   *
   * Password changes require either the current password or a session proved
   * by OTP, so the route guard has to know which one it is holding.
   */
  amr?: 'otp' | 'password';
  jti: string;`);

fs.writeFileSync(p, s);
console.log('  amr claim added');
NODE

# ---------------------------------------------------------------------------
# 3. auth.service: amr, lockout, setPassword
# ---------------------------------------------------------------------------
backup "$SVC/src/services/auth.service.ts"
patch "$SVC/src/services/auth.service.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('export async function setPassword')) { console.log('  already patched'); process.exit(0); }

function must(needle, replacement, label) {
  if (!s.includes(needle)) { console.error(`  anchor missing: ${label}`); process.exit(1); }
  s = s.replace(needle, replacement);
}

// -- issueSession takes an auth method -------------------------------------
must(
  `async function issueSession(
  user: UserWithProfiles,
  deviceId?: string,
  familyId: string = randomUUID(),
) {`,
  `async function issueSession(
  user: UserWithProfiles,
  deviceId?: string,
  familyId: string = randomUUID(),
  amr: 'otp' | 'password' = 'otp',
) {`,
  'issueSession signature',
);

must(
  `    did: deviceId,
    jti: randomUUID(),`,
  `    did: deviceId,
    amr,
    jti: randomUUID(),`,
  'issueSession claims',
);

// -- login: lockout before comparison --------------------------------------
must(
  `  if (!user || !user.passwordHash || user.role === 'patient') throw invalid();
  if (!(await bcrypt.compare(input.password, user.passwordHash))) {`,
  `  if (!user || !user.passwordHash || user.role === 'patient') throw invalid();

  // Checked before the hash comparison. A locked account must not become a
  // free oracle for testing whether a password happens to be right.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(
      'ACCOUNT_LOCKED',
      423,
      'Too many failed attempts. Try again later.',
    );
  }

  if (!(await bcrypt.compare(input.password, user.passwordHash))) {
    const failed = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (failed.failedLoginCount >= env.LOGIN_MAX_ATTEMPTS) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          lockedUntil: new Date(Date.now() + env.LOGIN_LOCKOUT_MINUTES * 60_000),
          failedLoginCount: 0,
        },
      });
      await appendAudit({
        actorUserId: user.id,
        action: 'auth.account_locked',
        entityType: 'users',
        entityId: user.id,
        ipAddress: meta.ip,
        requestId: meta.requestId,
      });
    }`,
  'login lockout',
);

must(
  `  if (user.status !== 'active') throw forbidden('FORBIDDEN', 'This account is not active');

  await appendAudit({
    actorUserId: user.id,
    action: 'auth.login',`,
  `  if (user.status !== 'active') throw forbidden('FORBIDDEN', 'This account is not active');

  // Any success clears the counter, so an unlucky run of typos never
  // accumulates toward a lockout weeks later.
  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  await appendAudit({
    actorUserId: user.id,
    action: 'auth.login',`,
  'login reset counter',
);

must(
  `  return issueSession(user, input.device_id);
}`,
  `  return issueSession(user, input.device_id, undefined, 'password');
}`,
  'login issueSession call',
);

// -- imports ---------------------------------------------------------------
must(
  `import { conflict, forbidden, unauthenticated } from '../utils/errors.js';`,
  `import { AppError, conflict, forbidden, unauthenticated } from '../utils/errors.js';`,
  'errors import',
);

// -- setPassword -----------------------------------------------------------
s += `

// ---------------------------------------------------------------------------
// Password lifecycle
// ---------------------------------------------------------------------------

/**
 * Sets, changes, or resets a password — one endpoint, one rule.
 *
 * You may set a password if you can prove either the current one, or control
 * of the registered phone number. The second case is what makes reset work
 * without a separate emailed-link flow: sign in by OTP, then set a new
 * password on that session. The token's \`amr\` claim is what distinguishes
 * the two, which is why it is minted at session creation and not asserted by
 * the caller.
 *
 * Setting a password revokes every other session. If the reason for changing
 * it was a suspected compromise, leaving the attacker's session alive would
 * defeat the whole exercise.
 */
export async function setPassword(
  userId: string,
  amr: 'otp' | 'password' | undefined,
  newPassword: string,
  currentPassword: string | undefined,
  meta: RequestMeta,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (user.role === 'patient') {
    throw forbidden('ROLE_NOT_PERMITTED', 'Patient accounts sign in with a code, not a password');
  }

  if (user.passwordHash && amr !== 'otp') {
    if (!currentPassword) {
      throw new AppError(
        'CURRENT_PASSWORD_REQUIRED',
        422,
        'Provide your current password, or sign in with a code first',
        'current_password',
      );
    }
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new AppError(
        'CURRENT_PASSWORD_INCORRECT',
        401,
        'Current password is incorrect',
        'current_password',
      );
    }
  }

  // Rejected here rather than only in the client, because the client is not a
  // control. Length does more work than composition rules.
  if (newPassword.length < env.PASSWORD_MIN_LENGTH) {
    throw new AppError(
      'PASSWORD_TOO_WEAK',
      422,
      \`Password must be at least \${env.PASSWORD_MIN_LENGTH} characters\`,
      'new_password',
    );
  }
  const lowered = newPassword.toLowerCase();
  if (
    (user.email && lowered.includes(user.email.split('@')[0]!.toLowerCase())) ||
    lowered.includes(user.phoneNumber.slice(-6))
  ) {
    throw new AppError(
      'PASSWORD_TOO_WEAK',
      422,
      'Password must not contain your email or phone number',
      'new_password',
    );
  }
  if (user.passwordHash && (await bcrypt.compare(newPassword, user.passwordHash))) {
    throw new AppError('PASSWORD_TOO_WEAK', 422, 'New password must differ from the old one', 'new_password');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(newPassword, SALT_ROUNDS),
        failedLoginCount: 0,
        lockedUntil: null,
        version: { increment: 1 },
      },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  await appendAudit({
    actorUserId: userId,
    action: user.passwordHash ? 'auth.password_changed' : 'auth.password_set',
    entityType: 'users',
    entityId: userId,
    metadata: { via: amr ?? 'password' },
    ipAddress: meta.ip,
    requestId: meta.requestId,
  });
}
`;

fs.writeFileSync(p, s);
console.log('  amr, lockout and setPassword applied');
NODE

# ---------------------------------------------------------------------------
# 4. Errors: new codes
# ---------------------------------------------------------------------------
backup "$SVC/src/utils/errors.ts"
patch "$SVC/src/utils/errors.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('ACCOUNT_LOCKED')) { console.log('  already patched'); process.exit(0); }
const anchor = "  | 'CLINICIAN_NOT_VERIFIED'";
if (!s.includes(anchor)) { console.error('  error code anchor not found'); process.exit(1); }
s = s.replace(anchor, `  | 'CLINICIAN_NOT_VERIFIED'
  | 'ACCOUNT_LOCKED'
  | 'PASSWORD_TOO_WEAK'
  | 'CURRENT_PASSWORD_REQUIRED'
  | 'CURRENT_PASSWORD_INCORRECT'`);
fs.writeFileSync(p, s);
console.log('  error codes added');
NODE

# ---------------------------------------------------------------------------
# 5. env: lockout and password policy
# ---------------------------------------------------------------------------
backup "$SVC/src/config/env.ts"
patch "$SVC/src/config/env.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('LOGIN_MAX_ATTEMPTS')) { console.log('  already patched'); process.exit(0); }
const anchor = '  IDEMPOTENCY_TTL_HOURS: z.coerce.number().default(24),';
if (!s.includes(anchor)) { console.error('  env anchor not found'); process.exit(1); }
s = s.replace(anchor, `${anchor}

  LOGIN_MAX_ATTEMPTS: z.coerce.number().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().default(15),
  PASSWORD_MIN_LENGTH: z.coerce.number().default(12),

  /** How often the retention sweep runs. Zero disables it in this process. */
  CLEANUP_INTERVAL_MINUTES: z.coerce.number().default(60),
  /**
   * Refresh tokens are kept well past expiry on purpose: reuse detection needs
   * the spent token to still be findable. Delete them early and a replayed
   * stolen token returns a bland "invalid" instead of revoking the family.
   */
  REFRESH_RETENTION_DAYS: z.coerce.number().default(60),`);
fs.writeFileSync(p, s);
console.log('  env extended');
NODE

# ---------------------------------------------------------------------------
# 6. Retention sweep
# ---------------------------------------------------------------------------
cat > "$SVC/src/services/maintenance.service.ts" << 'TS'
import { prisma } from '@a-health/database';
import { env } from '../config/env.js';

export interface SweepResult {
  otpChallenges: number;
  idempotencyRecords: number;
  refreshTokens: number;
}

/**
 * Deletes rows that have outlived their purpose.
 *
 * Without this, three tables grow forever. otp_challenges gains a row per
 * login attempt across the whole user base; idempotency_records is worse than
 * merely large, because it holds full response bodies — once consultations
 * become idempotent it will contain diagnoses and prescriptions, and an
 * expired copy of a medical record is still a medical record.
 */
export async function sweepExpired(now = new Date()): Promise<SweepResult> {
  // Kept a day past expiry so a support question about a failed sign-in can
  // still be answered.
  const otp = await prisma.otpChallenge.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } },
  });

  const idem = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  const cutoff = new Date(now.getTime() - env.REFRESH_RETENTION_DAYS * 86_400_000);
  const refresh = await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
    },
  });

  return {
    otpChallenges: otp.count,
    idempotencyRecords: idem.count,
    refreshTokens: refresh.count,
  };
}

/**
 * Runs the sweep on an interval inside the service process.
 *
 * Adequate for one instance. Once auth runs more than one replica this should
 * move to a single scheduled job — several replicas sweeping concurrently is
 * harmless here, but it is wasted work and the pattern does not generalise to
 * jobs that are not idempotent.
 */
export function scheduleSweep(): NodeJS.Timeout | null {
  if (env.CLEANUP_INTERVAL_MINUTES <= 0) return null;
  const run = () => {
    void sweepExpired()
      .then((r) => {
        if (r.otpChallenges + r.idempotencyRecords + r.refreshTokens > 0) {
          console.log('retention sweep', r);
        }
      })
      .catch((e) => console.error('retention sweep failed', e));
  };
  const timer = setInterval(run, env.CLEANUP_INTERVAL_MINUTES * 60_000);
  timer.unref();
  return timer;
}
TS

mkdir -p "$SVC/src/scripts"
cat > "$SVC/src/scripts/cleanup.ts" << 'TS'
// Standalone entry point, for running the sweep from cron instead of in-process:
//   0 * * * * cd /srv/a-health && pnpm --filter @a-health/auth exec tsx src/scripts/cleanup.ts
import { prisma } from '@a-health/database';
import { sweepExpired } from '../services/maintenance.service.js';

const result = await sweepExpired();
console.log(JSON.stringify(result));
await prisma.$disconnect();
TS

# ---------------------------------------------------------------------------
# 7. Types, controller, routes
# ---------------------------------------------------------------------------
patch "$SVC/src/types/auth.types.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('setPasswordSchema')) { console.log('  already patched'); process.exit(0); }
s += `
export const setPasswordSchema = z.object({
  new_password: z.string().min(1).max(200),
  // Omitted when the session was established by OTP, which is the reset path.
  current_password: z.string().max(200).optional(),
});

export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
`;
fs.writeFileSync(p, s);
console.log('  setPasswordSchema added');
NODE

patch "$SVC/src/controllers/auth.controller.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('setPassword')) { console.log('  already patched'); process.exit(0); }

const imp = `  updateMeSchema,
} from '../types/auth.types.js';`;
if (!s.includes(imp)) { console.error('  import anchor not found'); process.exit(1); }
s = s.replace(imp, `  setPasswordSchema,
  updateMeSchema,
} from '../types/auth.types.js';`);

s += `
export async function setPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const input = setPasswordSchema.parse(req.body);
    await authService.setPassword(
      req.auth!.sub,
      req.auth!.amr,
      input.new_password,
      input.current_password,
      meta(req, res),
    );
    // 204 rather than a body: every session was just revoked, so there is
    // nothing useful to hand back. The client re-authenticates.
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
`;
fs.writeFileSync(p, s);
console.log('  setPassword handler added');
NODE

patch "$SVC/src/routes/auth.routes.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('/auth/password/set')) { console.log('  already patched'); process.exit(0); }
const anchor = "authRouter.post('/auth/logout', requireAuth, controller.logout);";
if (!s.includes(anchor)) { console.error('  route anchor not found'); process.exit(1); }
s = s.replace(anchor, `${anchor}

// Set, change and reset are one endpoint. You may set a password if you can
// prove the current one, or prove control of the registered phone by having
// signed in with a code — the token's amr claim decides which.
authRouter.post('/auth/password/set', requireAuth, controller.setPassword);`);
fs.writeFileSync(p, s);
console.log('  password route added');
NODE

backup "$SVC/src/index.ts"
patch "$SVC/src/index.ts" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('scheduleSweep')) { console.log('  already patched'); process.exit(0); }
const imp = "import { authRouter, userRouter } from './routes/auth.routes.js';";
const lst = 'const server = app.listen(env.PORT, () => {';
if (!s.includes(imp) || !s.includes(lst)) { console.error('  index anchors not found'); process.exit(1); }
s = s.replace(imp, `${imp}\nimport { scheduleSweep } from './services/maintenance.service.js';`);
s = s.replace(lst, `scheduleSweep();\n\n${lst}`);
fs.writeFileSync(p, s);
console.log('  sweep scheduled');
NODE

# ---------------------------------------------------------------------------
# 8. Contract: the endpoint and codes must be described, not just implemented
# ---------------------------------------------------------------------------
if [ -f "$API" ]; then
  backup "$API"
  patch "$API" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
if (s.includes('/auth/password/set:')) { console.log('  contract already patched'); process.exit(0); }

const codeAnchor = `        - CLINICIAN_NOT_VERIFIED`;
if (s.includes(codeAnchor)) {
  s = s.replace(codeAnchor, `        - CLINICIAN_NOT_VERIFIED
        - ACCOUNT_LOCKED
        - PASSWORD_TOO_WEAK
        - CURRENT_PASSWORD_REQUIRED
        - CURRENT_PASSWORD_INCORRECT`);
}

const pathAnchor = `  /auth/logout:`;
if (!s.includes(pathAnchor)) { console.error('  contract path anchor not found'); process.exit(1); }

s = s.replace(pathAnchor, `  /auth/password/set:
    post:
      tags: [auth]
      summary: Set, change or reset a password
      description: |
        One endpoint for all three cases, because the rule is the same in each:
        you may set a password if you can prove either the current one or
        control of the registered phone number.

        Send \`current_password\` when the session came from a password login.
        Omit it when the session came from OTP verification — that already
        proved possession of the phone, and it is what makes password reset
        work without a separate emailed link.

        Every other session is revoked on success. If the password was being
        changed because of a suspected compromise, leaving the intruder's
        session alive would defeat the point.

        Not available to patient accounts, which authenticate by code only.
      operationId: setPassword
      responses:
        '204':
          description: Password set; all other sessions revoked
        '401':
          description: Not authenticated, or current password incorrect
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ErrorEnvelope' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '422': { $ref: '#/components/responses/UnprocessableEntity' }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [new_password]
              properties:
                new_password:
                  type: string
                  format: password
                  minLength: 12
                current_password:
                  type: string
                  format: password
                  description: Required unless the session was established by OTP.

  /auth/logout:`);

fs.writeFileSync(p, s);
console.log('  contract updated');
NODE
else
  echo "  contract not found at packages/api — skipped"
fi

# ---------------------------------------------------------------------------
if ! grep -q "LOGIN_MAX_ATTEMPTS" "$SVC/.env" 2>/dev/null; then
  {
    echo ""
    echo "LOGIN_MAX_ATTEMPTS=5"
    echo "LOGIN_LOCKOUT_MINUTES=15"
    echo "PASSWORD_MIN_LENGTH=12"
    echo "CLEANUP_INTERVAL_MINUTES=60"
    echo "REFRESH_RETENTION_DAYS=60"
  } >> "$SVC/.env"
  echo "  env appended"
fi

echo
echo "Done. Next:"
echo "  pnpm --filter @a-health/database exec prisma migrate dev --name login_lockout"
echo "  pnpm --filter @a-health/auth exec tsc --noEmit"
echo "  pnpm --filter @a-health/api lint"
