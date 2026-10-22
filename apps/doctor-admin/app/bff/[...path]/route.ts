import { NextRequest, NextResponse } from 'next/server';
import { resolveServiceUrl } from '@/lib/services';
import { tokenFromRequest } from '@/lib/serverToken';

export const dynamic = 'force-dynamic';

/**
 * At /bff rather than /api on purpose: next-auth owns /api/auth/[...nextauth],
 * and Next resolves that more specific route ahead of a catch-all. A proxy at
 * /api/[...path] would have every /auth/* call silently swallowed by next-auth
 * instead of reaching the backend.
 */
async function forward(req: NextRequest, path: string[]) {
  const apiPath = '/' + path.join('/');
  const base = resolveServiceUrl(apiPath);
  if (!base) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: `No service owns ${apiPath}` } },
      { status: 404 },
    );
  }

  const token = await tokenFromRequest(req);
  if (!token) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Ingia kwanza.' } },
      { status: 401 },
    );
  }

  const url = new URL(base + apiPath);
  url.search = req.nextUrl.search;

  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });
  const key = req.headers.get('Idempotency-Key');
  if (key) headers.set('Idempotency-Key', key);

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

  try {
    const upstream = await fetch(url, { method: req.method, headers, body, cache: 'no-store' });
    const text = await upstream.text();
    return new NextResponse(text || null, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
    });
  } catch {
    // A service being down is not the caller's mistake, and saying so stops
    // them retrying a request that cannot succeed.
    return NextResponse.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Huduma hii haipatikani kwa sasa.' } },
      { status: 503 },
    );
  }
}

type Ctx = { params: { path: string[] } };
export async function GET(r: NextRequest, c: Ctx) { return forward(r, c.params.path); }
export async function POST(r: NextRequest, c: Ctx) { return forward(r, c.params.path); }
export async function PATCH(r: NextRequest, c: Ctx) { return forward(r, c.params.path); }
export async function PUT(r: NextRequest, c: Ctx) { return forward(r, c.params.path); }
export async function DELETE(r: NextRequest, c: Ctx) { return forward(r, c.params.path); }
