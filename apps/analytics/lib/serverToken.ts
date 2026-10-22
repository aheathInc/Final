import { getToken } from 'next-auth/jwt';
import { cookies, headers } from 'next/headers';
import type { NextRequest } from 'next/server';

/** For route handlers, which have the request in hand. */
export async function tokenFromRequest(req: NextRequest): Promise<string | null> {
  const t = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  // A failed renewal leaves the old, expired token in place. Treating that as
  // "no token" turns an endless stream of 401s into one honest sign-in prompt.
  if (t?.error) return null;
  return (t?.accessToken as string | undefined) ?? null;
}

/**
 * For server components, which do not. Reconstructs just enough of a request
 * for getToken to read the session cookie — the token still never leaves the
 * server, which is the whole point of keeping it off the session object.
 */
export async function tokenFromServerComponent(): Promise<string | null> {
  const t = await getToken({
    req: { cookies: cookies(), headers: headers() } as never,
    secret: process.env.NEXTAUTH_SECRET,
  });
  return (t?.accessToken as string | undefined) ?? null;
}

/**
 * Server-side fetch against a backend service, with the caller's own token.
 * Returns null rather than throwing: a page that cannot load one panel should
 * still render the rest, not blank out entirely.
 */
export async function serverGet<T>(path: string): Promise<T | null> {
  const { resolveServiceUrl } = await import('./services');
  const base = resolveServiceUrl(path);
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
