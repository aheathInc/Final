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
