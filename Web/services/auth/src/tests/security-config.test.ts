import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertLocalAuthSeedEnvironment, isLocalAhealthDatabase, resolveAuthSecuritySettings } from '../config/security.js';

const localDevDatabase = 'postgresql://localhost:55432/ahealth_dev?schema=public';
const localTestDatabase = 'postgresql://localhost:55437/ahealth_test?schema=public';

describe('fail-closed Auth OTP configuration', () => {
  it('rejects missing, empty and unrecognized NODE_ENV values', () => {
    for (const NODE_ENV of [undefined, '', 'staging']) {
      assert.throws(() => resolveAuthSecuritySettings({ NODE_ENV }));
    }
  });

  it('keeps all development OTP capabilities off without explicit opt-in', () => {
    const settings = resolveAuthSecuritySettings({ NODE_ENV: 'development' });
    assert.equal(settings.OTP_ECHO_IN_RESPONSE, false);
    assert.equal(settings.OTP_LOG_TO_CONSOLE, false);
    assert.equal(settings.OTP_VERIFICATION_BYPASS, false);
  });

  it('requires explicit local mode and a local non-5432 database for OTP echo', () => {
    assert.throws(() => resolveAuthSecuritySettings({
      NODE_ENV: 'development',
      OTP_ECHO_IN_RESPONSE: 'true',
      DATABASE_URL: localDevDatabase,
    }));
    const settings = resolveAuthSecuritySettings({
      NODE_ENV: 'development',
      AUTH_LOCAL_OTP_MODE: 'true',
      OTP_ECHO_IN_RESPONSE: 'true',
      DATABASE_URL: localDevDatabase,
    });
    assert.equal(settings.OTP_ECHO_IN_RESPONSE, true);
    assert.equal(settings.OTP_LOG_TO_CONSOLE, false);
    assert.equal(settings.OTP_VERIFICATION_BYPASS, false);
  });

  it('keeps console OTP logging independent from response echo', () => {
    const settings = resolveAuthSecuritySettings({
      NODE_ENV: 'development',
      AUTH_LOCAL_OTP_MODE: 'true',
      OTP_LOG_TO_CONSOLE: 'true',
      DATABASE_URL: localDevDatabase,
    });
    assert.equal(settings.OTP_LOG_TO_CONSOLE, true);
    assert.equal(settings.OTP_ECHO_IN_RESPONSE, false);
    assert.equal(settings.OTP_VERIFICATION_BYPASS, false);
  });

  it('allows controlled test echo only for the isolated local test database', () => {
    const settings = resolveAuthSecuritySettings({
      NODE_ENV: 'test',
      AUTH_LOCAL_OTP_MODE: 'true',
      OTP_ECHO_IN_RESPONSE: 'true',
      DATABASE_URL: localTestDatabase,
    });
    assert.equal(settings.OTP_ECHO_IN_RESPONSE, true);
    assert.equal(settings.OTP_LOG_TO_CONSOLE, false);
    assert.equal(settings.OTP_VERIFICATION_BYPASS, false);
    assert.throws(() => resolveAuthSecuritySettings({
      NODE_ENV: 'test',
      AUTH_LOCAL_OTP_MODE: 'true',
      OTP_ECHO_IN_RESPONSE: 'true',
      DATABASE_URL: 'postgresql://db.example/ahealth_test',
    }));
  });

  it('rejects every development capability in production', () => {
    for (const flag of ['AUTH_LOCAL_OTP_MODE', 'OTP_ECHO_IN_RESPONSE', 'OTP_LOG_TO_CONSOLE'] as const) {
      assert.throws(() => resolveAuthSecuritySettings({
        NODE_ENV: 'production',
        [flag]: 'true',
      }));
    }
    const settings = resolveAuthSecuritySettings({ NODE_ENV: 'production' });
    assert.equal(settings.OTP_ECHO_IN_RESPONSE, false);
    assert.equal(settings.OTP_LOG_TO_CONSOLE, false);
    assert.equal(settings.OTP_VERIFICATION_BYPASS, false);
  });

  it('rejects the default database port and database names outside local dev/test', () => {
    assert.equal(isLocalAhealthDatabase(localDevDatabase), true);
    assert.equal(isLocalAhealthDatabase(localTestDatabase), true);
    assert.equal(isLocalAhealthDatabase('postgresql://localhost/ahealth_dev'), false);
    assert.equal(isLocalAhealthDatabase('postgresql://localhost:55432/production'), false);
    assert.equal(isLocalAhealthDatabase(undefined), false);
    assert.throws(() => assertLocalAuthSeedEnvironment({
      NODE_ENV: undefined,
      DATABASE_URL: localDevDatabase,
    }));
    assert.throws(() => assertLocalAuthSeedEnvironment({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost:5432/ahealth_dev',
    }));
    assert.doesNotThrow(() => assertLocalAuthSeedEnvironment({
      NODE_ENV: 'development',
      DATABASE_URL: localDevDatabase,
    }));
  });
});
