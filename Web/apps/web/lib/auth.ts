import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { authCookies } from './authCookies';
import { resolveServiceUrl } from './services';

/**
 * next-auth is a session container here, not an identity provider. The real
 * authentication happens where it already does — POST /auth/login in the auth
 * service — and this only carries the resulting token pair in next-auth's own
 * httpOnly cookie.
 *
 * The backend stays the single source of truth about who someone is, and the
 * browser gets a session its own JavaScript cannot read.
 */

/**
 * Exchanges the refresh token for a new pair.
 *
 * Returns the token marked with an error rather than throwing: next-auth has
 * no way to surface a thrown error from this callback, and a silent failure
 * here is what produced permanent 401s the first time round. Marking it lets
 * the session end cleanly instead.
 */
async function refreshAccessToken(token: Record<string, unknown>): Promise<Record<string, unknown>> {
  const base = resolveServiceUrl('/auth/token/refresh');
  if (!base || !token.refreshToken) return { ...token, error: 'NoRefreshToken' };

  const res = await fetch(`${base}/auth/token/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: token.refreshToken }),
  }).catch(() => null);

  if (!res || !res.ok) return { ...token, error: 'RefreshFailed' };

  const data = await res.json();
  const claims = readAccessClaims(data.access_token);
  return {
    ...token,
    accessToken: data.access_token,
    role: claims.role ?? (typeof token.role === 'string' ? token.role : undefined),
    // The backend rotates the refresh token on every use and invalidates the
    // old one, so keeping the previous value would break the NEXT renewal.
    refreshToken: data.refresh_token ?? token.refreshToken,
    accessTokenExpires: Date.now() + (data.expires_in ?? 900) * 1000,
    error: undefined,
  };
}

function readAccessClaims(accessToken: string | undefined): { sub?: string; email?: string; role?: string } {
  if (!accessToken) return {};
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sub?: string;
      email?: string;
      role?: string;
    };
  } catch {
    return {};
  }
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  cookies: authCookies,
  pages: { signIn: '/login' },
  providers: [
    CredentialsProvider({
      name: 'A-health',
      credentials: {
        kind: { label: 'Kind', type: 'text' },
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const authPath = '/auth/login';
        const base = resolveServiceUrl(authPath);
        if (!base) return null;

        const body = {
          email: credentials?.email?.trim().toLowerCase(),
          password: credentials?.password,
          device_id: 'a-health-web-staff',
        };

        if (!body.email || !body.password) return null;

        const res = await fetch(`${base}${authPath}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch(() => null);

        if (!res || !res.ok) return null;
        const data = await res.json();
        const claims = readAccessClaims(data.access_token);

        return {
          id: data.user?.id ?? claims.sub ?? 'unknown',
          name: data.user?.full_name ?? null,
          email: data.user?.email ?? claims.email ?? credentials?.email,
          role: data.user?.role ?? claims.role,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          accessTokenExpires: Date.now() + (data.expires_in ?? 900) * 1000,
        } as never;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        Object.assign(token, user);
        return token;
      }

      const expires = token.accessTokenExpires as number | undefined;
      if (expires && Date.now() < expires - 60_000) return token;

      return refreshAccessToken(token as Record<string, unknown>);
    },
    async session({ session, token }) {
      // The access token deliberately does NOT go on the session object:
      // anything placed there is readable by client components. It stays on
      // the encrypted JWT and is read server-side only.
      if (session.user) {
        session.user.name = (token.name as string) ?? null;
        session.user.id = ((token.id as string) ?? (token.sub as string)) ?? undefined;
        session.user.role = token.role as string | undefined;
      }
      return session;
    },
  },
};
