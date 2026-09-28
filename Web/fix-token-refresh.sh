#!/usr/bin/env bash
#
# The consoles never renewed their access token.
#
# Signing in stored both tokens, but the jwt callback only copied them through.
# An access token lives fifteen minutes, so after fifteen minutes every request
# returned 401 — permanently, until the user signed out and back in. The
# refresh token was sitting right there, unused.
#
# The backend was behaving correctly the whole time: it was handed an expired
# token and refused it, which is exactly its job.
#
# Applies to whichever of the three consoles are present.
#
# Run from the repo root:
#   bash fix-token-refresh.sh
#
set -euo pipefail

ROOT="$(pwd)"
[ -f "$ROOT/pnpm-workspace.yaml" ] || { echo "Run this from the repo root."; exit 1; }

patched=0
for app in doctor-admin admin analytics; do
  f="$ROOT/apps/$app/lib/auth.ts"
  [ -f "$f" ] || { echo "  skip (not present): apps/$app"; continue; }

  if grep -q "refreshAccessToken" "$f"; then
    echo "  already refreshing: apps/$app"
    continue
  fi

  cp "$f" "$f.bak"

  node - "$f" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');

// The renewal itself, placed above authOptions so the callback can see it.
const helper = `
/**
 * Exchanges the refresh token for a new pair.
 *
 * Returns the token marked with an error rather than throwing: next-auth has
 * no way to surface a thrown error from this callback, and a silent failure
 * here is what produced permanent 401s the first time round. Marking it lets
 * the session end cleanly instead.
 */
async function refreshAccessToken(token: Record<string, unknown>) {
  const base = resolveServiceUrl('/auth/token/refresh');
  if (!base || !token.refreshToken) return { ...token, error: 'NoRefreshToken' };

  const res = await fetch(\`\${base}/auth/token/refresh\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: token.refreshToken }),
  }).catch(() => null);

  if (!res || !res.ok) return { ...token, error: 'RefreshFailed' };

  const data = await res.json();
  return {
    ...token,
    accessToken: data.access_token,
    // The backend rotates the refresh token on every use and invalidates the
    // old one, so keeping the previous value would break the NEXT renewal.
    refreshToken: data.refresh_token ?? token.refreshToken,
    accessTokenExpires: Date.now() + (data.expires_in ?? 900) * 1000,
    error: undefined,
  };
}

`;

const anchor = 'export const authOptions: NextAuthOptions = {';
if (!s.includes(anchor)) { console.error('  authOptions anchor not found'); process.exit(1); }
s = s.replace(anchor, helper + anchor);

// Renew when it is close to expiry, not after: a token that dies mid-request
// is a 401 the user sees, and sixty seconds of margin costs nothing.
const oldJwt = `    async jwt({ token, user }) {
      if (user) Object.assign(token, user);
      return token;
    },`;
const newJwt = `    async jwt({ token, user }) {
      if (user) {
        Object.assign(token, user);
        return token;
      }

      const expires = token.accessTokenExpires as number | undefined;
      if (expires && Date.now() < expires - 60_000) return token;

      return refreshAccessToken(token as Record<string, unknown>);
    },`;
if (!s.includes(oldJwt)) { console.error('  jwt callback anchor not found'); process.exit(1); }
s = s.replace(oldJwt, newJwt);

fs.writeFileSync(p, s);
const after = fs.readFileSync(p, 'utf8');
if (!after.includes('refreshAccessToken(token as Record<string, unknown>)')) {
  console.error('  VERIFY FAILED'); process.exit(1);
}
console.log(`  patched: ${p.split('/apps/')[1]}`);
NODE
  patched=$((patched + 1))
done

# The proxy should say the session ended rather than repeating a bare 401
# forever, so the page can send the user to sign in again.
for app in doctor-admin admin analytics; do
  f="$ROOT/apps/$app/lib/serverToken.ts"
  [ -f "$f" ] || continue
  if grep -q "token?.error" "$f"; then continue; fi
  node - "$f" << 'NODE'
const fs = require('fs');
const p = process.argv[2];
let s = fs.readFileSync(p, 'utf8');
const old = `export async function tokenFromRequest(req: NextRequest): Promise<string | null> {
  const t = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  return (t?.accessToken as string | undefined) ?? null;
}`;
const replacement = `export async function tokenFromRequest(req: NextRequest): Promise<string | null> {
  const t = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  // A failed renewal leaves the old, expired token in place. Treating that as
  // "no token" turns an endless stream of 401s into one honest sign-in prompt.
  if (t?.error) return null;
  return (t?.accessToken as string | undefined) ?? null;
}`;
if (s.includes(old)) {
  fs.writeFileSync(p, s.replace(old, replacement));
  console.log(`  patched: ${p.split('/apps/')[1]}`);
}
NODE
done

echo
echo "  $patched console(s) now renew their token"
echo
echo "Restart the apps, then sign in once more — the existing cookie holds an"
echo "expired token with no way to know it should renew."
