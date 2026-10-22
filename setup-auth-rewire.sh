#!/usr/bin/env bash
#
# Points services/auth at @a-health/http.
#
# The migration is done with re-export shims rather than by editing every
# import: services/auth/src/utils/errors.ts becomes a one-line re-export of the
# package. Nothing that imports it has to change, including the test suite, so
# this refactor cannot break behaviour — it only moves where the code lives.
#
# Run from the repo root, after setup-shared-http.sh:
#   bash setup-auth-rewire.sh
#
set -euo pipefail

ROOT="$(pwd)"
SVC="$ROOT/services/auth"

[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }
[ -f "$ROOT/packages/http/src/index.ts" ] || { echo "Run setup-shared-http.sh first."; exit 1; }
[ -f "$SVC/src/services/auth.service.ts" ] || { echo "services/auth not set up."; exit 1; }

backup() { [ -f "$1" ] && [ -s "$1" ] && cp "$1" "$1.bak" || true; }

echo "Replacing local copies with shims…"

for f in \
  src/utils/errors.ts \
  src/utils/hash.ts \
  src/services/audit.service.ts \
  src/services/changelog.service.ts \
  src/middlewares/context.middleware.ts \
  src/middlewares/error.middleware.ts
do
  backup "$SVC/$f"
done

cat > "$SVC/src/utils/errors.ts" << 'TS'
// Moved to @a-health/http. Kept as a re-export so existing imports and the
// test suite keep working; new code should import from the package directly.
export * from '@a-health/http';
TS

cat > "$SVC/src/utils/hash.ts" << 'TS'
export { sha256, canonical, hashPayload, generateOpaqueToken, generateOtpCode, safeEqual } from '@a-health/http';
TS

cat > "$SVC/src/services/audit.service.ts" << 'TS'
export { appendAudit, verifyAuditChain, type AuditInput } from '@a-health/http';
TS

cat > "$SVC/src/services/changelog.service.ts" << 'TS'
export { recordChange, type TxClient } from '@a-health/http';
TS

cat > "$SVC/src/middlewares/context.middleware.ts" << 'TS'
export { requestContext } from '@a-health/http';
TS

cat > "$SVC/src/middlewares/error.middleware.ts" << 'TS'
import { createErrorHandler, notFoundHandler } from '@a-health/http';
import { createLogger } from '@a-health/logger';
import { env } from '../config/env.js';

export { notFoundHandler };
export const errorHandler = createErrorHandler(
  createLogger('auth'),
  env.NODE_ENV === 'development',
);
TS

# --- jwt: keep the same exported names, back them with the package ---------
backup "$SVC/src/utils/jwt.ts"
cat > "$SVC/src/utils/jwt.ts" << 'TS'
import { createTokenService, type AccessTokenClaims } from '@a-health/http';
import { env } from '../config/env.js';

export type { AccessTokenClaims };

const tokens = createTokenService({
  secret: env.JWT_SECRET,
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
});

export const tokenService = tokens;
export const signAccessToken = (claims: AccessTokenClaims): string => tokens.sign(claims);
export const verifyAccessToken = (token: string): AccessTokenClaims => tokens.verify(token);
TS

# --- auth guards -----------------------------------------------------------
backup "$SVC/src/middlewares/auth.middleware.ts"
cat > "$SVC/src/middlewares/auth.middleware.ts" << 'TS'
import { createAuthGuards } from '@a-health/http';
import { tokenService } from '../utils/jwt.js';

const guards = createAuthGuards(tokenService);

export const requireAuth = guards.requireAuth;
export const requireRole = guards.requireRole;
export const requireVerifiedClinician = guards.requireVerifiedClinician;
TS

# --- idempotency -----------------------------------------------------------
backup "$SVC/src/middlewares/idempotency.middleware.ts"
cat > "$SVC/src/middlewares/idempotency.middleware.ts" << 'TS'
import { createIdempotency } from '@a-health/http';
import { env } from '../config/env.js';

export const idempotency = createIdempotency(env.IDEMPOTENCY_TTL_HOURS);
TS

# --- index: use the shared bootstrap --------------------------------------
backup "$SVC/src/index.ts"
cat > "$SVC/src/index.ts" << 'TS'
import { createService } from '@a-health/http';
import { env } from './config/env.js';
import { authRouter, userRouter } from './routes/auth.routes.js';
import { scheduleSweep } from './services/maintenance.service.js';

// Helmet, CORS, JSON parsing, request ids, access logging, /health, the error
// envelope and graceful shutdown all come from the shared bootstrap. What is
// left here is what is actually specific to auth.
const service = createService({
  name: 'auth',
  port: env.PORT,
  routers: [authRouter, userRouter],
  development: env.NODE_ENV === 'development',
});

scheduleSweep();
service.start();
TS

# --- dependencies ----------------------------------------------------------
node - "$SVC/package.json" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies['@a-health/http'] = 'workspace:*';
pkg.dependencies['@a-health/logger'] = 'workspace:*';
pkg.dependencies['@a-health/database'] = pkg.dependencies['@a-health/database'] || 'workspace:*';
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
console.log('  workspace deps added');
NODE

echo
echo "Done. Next:"
echo "  pnpm install"
echo "  pnpm --filter @a-health/auth exec tsc --noEmit"
echo "  pnpm --filter @a-health/auth test"
echo "  pnpm --filter @a-health/auth dev"
