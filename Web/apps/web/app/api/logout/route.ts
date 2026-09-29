import { NextRequest, NextResponse } from 'next/server';
import { resolveServiceUrl } from '@/lib/services';
import { tokenFromRequest } from '@/lib/serverToken';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await tokenFromRequest(req);
  if (!auth) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Your session has expired. Please sign in again.' } },
      { status: 401 },
    );
  }

  const base = resolveServiceUrl('/auth/logout');
  if (!base) return NextResponse.json({ error: { code: 'AUTH_UNAVAILABLE' } }, { status: 503 });

  try {
    const upstream = await fetch(`${base}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      cache: 'no-store',
    });
    if (!upstream.ok && upstream.status !== 204) {
      return NextResponse.json({ error: { code: 'LOGOUT_FAILED' } }, { status: upstream.status });
    }
    const response = new NextResponse(null, { status: 204 });
    if (auth.cookie) response.cookies.set(auth.cookie.name, auth.cookie.value, auth.cookie.options);
    return response;
  } catch {
    return NextResponse.json({ error: { code: 'AUTH_UNAVAILABLE' } }, { status: 503 });
  }
}
