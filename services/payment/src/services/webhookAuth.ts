import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time HMAC check. A naive `===` comparison leaks timing
 * information about how many leading bytes matched, which is exactly the
 * side channel an attacker forging a settlement callback would use.
 */
export function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
