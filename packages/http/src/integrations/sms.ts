import { randomUUID } from 'node:crypto';

export type SmsMode = 'console' | 'http' | 'africastalking';
export interface SmsSettings {
  mode: SmsMode; production: boolean; environment: 'sandbox' | 'live';
  username: string; apiKey: string; senderId: string; bridgeUrl: string; bridgeKey: string;
}
export interface SmsOutcome {
  ok: boolean; providerRef?: string; failureCode?: string; retryable?: boolean;
  /** Accepted by a gateway is NOT proof of handset delivery. */
  delivery?: 'simulated' | 'accepted';
}
const settingError = () => new Error('SMS provider configuration is invalid; secret values are not shown.');
export function smsSettings(input: Record<string, string | undefined>): SmsSettings {
  if (!['production','development','test'].includes(input.NODE_ENV ?? '')) throw settingError();
  const production = input.NODE_ENV === 'production';
  const mode = input.SMS_PROVIDER ?? (production ? '' : 'console');
  if (!['console','http','africastalking'].includes(mode)) throw settingError();
  const environment = input.AT_ENVIRONMENT ?? 'sandbox';
  if (!['sandbox','live'].includes(environment)) throw settingError();
  const result: SmsSettings = {
    mode: mode as SmsMode, production, environment: environment as 'sandbox' | 'live',
    username: input.AT_USERNAME ?? '', apiKey: input.AT_API_KEY ?? '',
    senderId: input.SMS_SENDER_ID ?? '', bridgeUrl: input.SMS_GATEWAY_URL ?? '', bridgeKey: input.SMS_GATEWAY_KEY ?? '',
  };
  if (production && (mode !== 'africastalking' || environment !== 'live')) throw settingError();
  if (mode === 'africastalking') {
    if (!result.username || !result.apiKey || !result.senderId) throw settingError();
    if (production && /placeholder|replace|change.?me|example/i.test(result.apiKey)) throw settingError();
    if (environment === 'sandbox' && result.username !== 'sandbox') throw settingError();
    if (environment === 'live' && result.username === 'sandbox') throw settingError();
  }
  if (mode === 'http') {
    let url: URL; try { url = new URL(result.bridgeUrl); } catch { throw settingError(); }
    const local = ['127.0.0.1','localhost','[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.hash || !result.bridgeKey) throw settingError();
  }
  return result;
}

export async function smallJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.body) throw new Error('Provider response missing');
  const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 65_536) { await reader.cancel(); throw new Error('Provider response exceeds limit'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const parsed: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Provider response invalid');
  return parsed as Record<string, unknown>;
}

/** Direct Africa's Talking SMS adapter; body/phone/key are never logged. No automatic retransmission of an OTP. */
export async function sendSms(
  settings: SmsSettings, to: string, message: string, requestKey: string,
  transport: typeof fetch = fetch,
): Promise<SmsOutcome> {
  if (!/^\+[1-9]\d{7,14}$/.test(to) || !message || message.length > 1000 || !requestKey) {
    return { ok: false, failureCode: 'SMS_INVALID_INPUT', retryable: false };
  }
  if (settings.production && (settings.mode !== 'africastalking' || settings.environment !== 'live')) {
    return { ok: false, failureCode: 'SMS_PRODUCTION_CONFIG_REJECTED', retryable: false };
  }
  if (settings.mode === 'console') return { ok: true, providerRef: `console-${randomUUID()}`, delivery: 'simulated' };
  try {
    const isAT = settings.mode === 'africastalking';
    const url = isAT ? (settings.environment === 'sandbox'
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging') : settings.bridgeUrl;
    const body = isAT ? new URLSearchParams({ username: settings.username, to, message, from: settings.senderId }).toString()
      : JSON.stringify({ to, from: settings.senderId, message });
    const response = await transport(url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: isAT ? { Accept: 'application/json', apiKey: settings.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' }
        : { Accept: 'application/json', Authorization: `Bearer ${settings.bridgeKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': requestKey },
      body,
    });
    if (!response.ok) return { ok: false, failureCode: `SMS_HTTP_${response.status}`, retryable: response.status >= 500 || response.status === 429 };
    const json = await smallJson(response);
    if (isAT) {
      const data = json.SMSMessageData as { Recipients?: Array<{number?: string; statusCode?: number; messageId?: string}> } | undefined;
      const recipients = data?.Recipients;
      if (!Array.isArray(recipients) || recipients.length !== 1 || recipients[0].number !== to) return { ok:false, failureCode:'SMS_RESPONSE_INVALID', retryable:false };
      const rec = recipients[0];
      if (![100,101,102].includes(Number(rec.statusCode)) || typeof rec.messageId !== 'string' || !rec.messageId || rec.messageId.length > 120) {
        return { ok:false, failureCode:'SMS_RECIPIENT_REJECTED', retryable:false };
      }
      return { ok:true, providerRef:rec.messageId, delivery:'accepted' };
    }
    if (typeof json.id !== 'string' || !json.id || json.id.length > 120) return { ok:false, failureCode:'SMS_RESPONSE_INVALID', retryable:false };
    return { ok:true, providerRef:json.id, delivery:'accepted' };
  } catch {
    // Outcome may be unknown after a timeout. Caller must not claim handset delivery.
    return { ok:false, failureCode:'SMS_TRANSPORT_OR_RESPONSE_FAILURE', retryable:true };
  }
}
