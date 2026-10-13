const allowedEnvironments = new Set(['development', 'production', 'test']);

export interface AuthSecurityInput {
  NODE_ENV?: string;
  AUTH_LOCAL_OTP_MODE?: string;
  OTP_ECHO_IN_RESPONSE?: string;
  OTP_LOG_TO_CONSOLE?: string;
  DATABASE_URL?: string;
}

export interface AuthSecuritySettings {
  OTP_ECHO_IN_RESPONSE: boolean;
  OTP_LOG_TO_CONSOLE: boolean;
  OTP_VERIFICATION_BYPASS: false;
}

function flag(name: string, value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`Invalid Auth configuration: ${name} must be true or false.`);
}

export function isLocalAhealthDatabase(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) return false;
  try {
    const url = new URL(databaseUrl);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const host = url.hostname.replace(/^\[|\]$/g, '');
    return ['localhost', '127.0.0.1', '::1'].includes(host) &&
      ['ahealth_dev', 'ahealth_test'].includes(database) &&
      Boolean(url.port) && url.port !== '5432';
  } catch {
    return false;
  }
}

export function assertLocalAuthSeedEnvironment(input: Pick<AuthSecurityInput, 'NODE_ENV' | 'DATABASE_URL'>): void {
  if (!['development', 'test'].includes(input.NODE_ENV ?? '') || !isLocalAhealthDatabase(input.DATABASE_URL)) {
    throw new Error('Auth demo seeds require explicit development/test mode and a local non-5432 ahealth_dev or ahealth_test database.');
  }
}

/**
 * Resolves the three OTP development capabilities independently. Missing or
 * unrecognized environments fail closed; callers never receive a dev bypass.
 */
export function resolveAuthSecuritySettings(input: AuthSecurityInput): AuthSecuritySettings {
  const nodeEnv = input.NODE_ENV;
  if (!nodeEnv || !allowedEnvironments.has(nodeEnv)) {
    throw new Error('Invalid Auth configuration: set NODE_ENV explicitly to development, test, or production.');
  }

  const localOtpMode = flag('AUTH_LOCAL_OTP_MODE', input.AUTH_LOCAL_OTP_MODE);
  const echoRequested = flag('OTP_ECHO_IN_RESPONSE', input.OTP_ECHO_IN_RESPONSE);
  const consoleLogRequested = flag('OTP_LOG_TO_CONSOLE', input.OTP_LOG_TO_CONSOLE);
  const anyDevelopmentCapability = localOtpMode || echoRequested || consoleLogRequested;

  if (nodeEnv === 'production' && anyDevelopmentCapability) {
    throw new Error('Invalid Auth configuration: development OTP capabilities are forbidden in production.');
  }

  if (anyDevelopmentCapability) {
    if (!['development', 'test'].includes(nodeEnv) || !localOtpMode || !isLocalAhealthDatabase(input.DATABASE_URL)) {
      throw new Error('Invalid Auth configuration: OTP development capabilities require explicit local mode and a local non-5432 AHP database.');
    }
  }

  return {
    OTP_ECHO_IN_RESPONSE: echoRequested,
    OTP_LOG_TO_CONSOLE: consoleLogRequested,
    OTP_VERIFICATION_BYPASS: false,
  };
}
