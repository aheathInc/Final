/**
 * Captures the exact bytes Express received, before JSON parsing
 * re-serialises them differently than the sender did — required for HMAC
 * verification to match.
 *
 * Typed with `unknown` parameters to match createService's jsonVerify field
 * exactly: TypeScript checks function-typed properties contravariantly under
 * strict mode, so a version typed with Express's own Request/Response here
 * would fail to satisfy a field declared as accepting `unknown` — the cast
 * belongs inside the function body, not in a narrower parameter signature.
 */
export function captureRawBody(req: unknown, _res: unknown, buf: Buffer): void {
  (req as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
}
