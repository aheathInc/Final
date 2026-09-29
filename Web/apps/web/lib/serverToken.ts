import { encode, getToken } from 'next-auth/jwt';
import { cookies, headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { authCookies, sessionCookieName } from './authCookies';

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

type StoredToken = Record<string, unknown> & {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpires?: number;
  error?: string;
};

type CookieUpdate = {
  name: string;
  value: string;
  options: typeof authCookies.sessionToken.options & { maxAge: number };
};

type AccessResult = {
  accessToken: string;
  cookie?: CookieUpdate;
};

function roleFromAccessToken(accessToken: string | undefined): string | undefined {
  if (!accessToken) return undefined;
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return undefined;
    return (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { role?: string }).role;
  } catch {
    return undefined;
  }
}

const globalForRefresh = globalThis as unknown as {
  ahpRefreshes?: Map<string, Promise<StoredToken>>;
};

const refreshes = globalForRefresh.ahpRefreshes ?? new Map<string, Promise<StoredToken>>();
globalForRefresh.ahpRefreshes = refreshes;

async function refreshStoredToken(token: StoredToken): Promise<StoredToken> {
  const refreshToken = token.refreshToken;
  if (!refreshToken) return { ...token, error: 'NoRefreshToken' };

  const existing = refreshes.get(refreshToken);
  if (existing) return existing;

  const refresh = (async () => {
    const { resolveServiceUrl } = await import('./services');
    const base = resolveServiceUrl('/auth/token/refresh');
    if (!base) return { ...token, error: 'NoAuthService' };

    const res = await fetch(`${base}/auth/token/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    }).catch(() => null);

    if (!res?.ok) return { ...token, error: 'RefreshFailed' };
    const data = await res.json();
    return {
      ...token,
      accessToken: data.access_token,
      role: roleFromAccessToken(data.access_token) ?? token.role,
      refreshToken: data.refresh_token ?? refreshToken,
      accessTokenExpires: Date.now() + (data.expires_in ?? 900) * 1000,
      error: undefined,
    };
  })();

  refreshes.set(refreshToken, refresh);
  try {
    return await refresh;
  } finally {
    refreshes.delete(refreshToken);
  }
}

async function cookieFor(token: StoredToken): Promise<CookieUpdate> {
  const value = await encode({
    token,
    secret: process.env.NEXTAUTH_SECRET!,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return {
    name: sessionCookieName,
    value,
    options: { ...authCookies.sessionToken.options, maxAge: SESSION_MAX_AGE_SECONDS },
  };
}

/** For route handlers, which have the request in hand. */
export async function tokenFromRequest(req: NextRequest): Promise<AccessResult | null> {
  const t = (await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: sessionCookieName,
  })) as StoredToken | null;
  // A failed renewal leaves the old, expired token in place. Treating that as
  // "no token" turns an endless stream of 401s into one honest sign-in prompt.
  if (!t || t.error) return null;
  const expires = t?.accessTokenExpires as number | undefined;
  if (!expires || Date.now() < expires - 60_000) return t.accessToken ? { accessToken: t.accessToken } : null;

  const refreshed = await refreshStoredToken(t);
  if (refreshed.error || !refreshed.accessToken) return null;
  return { accessToken: refreshed.accessToken, cookie: await cookieFor(refreshed) };
}

/**
 * For server components, which do not. Reconstructs just enough of a request
 * for getToken to read the session cookie — the token still never leaves the
 * server, which is the whole point of keeping it off the session object.
 */
export async function tokenFromServerComponent(): Promise<string | null> {
  const t = (await getToken({
    req: { cookies: cookies(), headers: headers() } as never,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: sessionCookieName,
  })) as StoredToken | null;
  if (!t || t.error) return null;
  const expires = t?.accessTokenExpires as number | undefined;
  if (!expires || Date.now() < expires - 60_000) return t?.accessToken ?? null;
  const refreshed = await refreshStoredToken(t);
  return refreshed.error ? null : refreshed.accessToken ?? null;
}

/**
 * Server-side fetch against a backend service, with the caller's own token.
 * Returns null rather than throwing: a page that cannot load one panel should
 * still render the rest, not blank out entirely.
 */
export async function serverGet<T>(path: string): Promise<T | null> {
  const { resolveServiceUrl } = await import('./services');
  const lookupPath = path.split(/[?#]/, 1)[0] || path;
  const base = resolveServiceUrl(lookupPath);
  const token = await tokenFromServerComponent();
  if (!base || !token) return null;
  try {
    const res = await fetch(base + path, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
