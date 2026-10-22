import jwt from 'jsonwebtoken';
import { unauthenticated } from './errors.js';

/**
 * HS256 with a shared secret: every service that can verify a token can also
 * mint one, so a compromise anywhere is a compromise everywhere.
 *
 * The upgrade is RS256 — auth holds the private key, everyone else holds the
 * public key and can verify but not sign. Only ALGORITHM and the key material
 * change. Do it before a third service verifies tokens.
 */
const ALGORITHM = 'HS256' as const;

export interface AccessTokenClaims {
  sub: string;
  role: string;
  status: string;
  /** Patient profile id, when the subject is a patient. */
  ppid?: string;
  /** Clinician profile id, when the subject is a clinician. */
  cpid?: string;
  /**
   * Clinician verification status, denormalised so route guards need no
   * database round trip. Bounded staleness: at most one access-token TTL after
   * an admin revokes a licence.
   */
  vst?: string;
  did?: string;
  /** How the session was established. Password changes depend on this. */
  amr?: 'otp' | 'password';
  jti: string;
}

export interface TokenConfig {
  secret: string;
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

export interface TokenService {
  sign(claims: AccessTokenClaims): string;
  verify(token: string): AccessTokenClaims;
}

export function createTokenService(config: TokenConfig): TokenService {
  return {
    sign: (claims) =>
      jwt.sign(claims, config.secret, {
        algorithm: ALGORITHM,
        expiresIn: config.ttlSeconds,
        issuer: config.issuer,
        audience: config.audience,
      }),
    verify: (token) => {
      try {
        return jwt.verify(token, config.secret, {
          algorithms: [ALGORITHM],
          issuer: config.issuer,
          audience: config.audience,
        }) as AccessTokenClaims;
      } catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
          throw unauthenticated('TOKEN_EXPIRED', 'Access token has expired');
        }
        throw unauthenticated('TOKEN_INVALID', 'Access token is invalid');
      }
    },
  };
}
