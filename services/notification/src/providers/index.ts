import { sendSms, smsSettings, type SmsOutcome } from '@a-health/http/sms';
import { env } from '../config/env.js';
export type SendResult = SmsOutcome;
export interface NotificationProvider {
  readonly name: string;
  send(to: string, body: string, options?: { idempotencyKey: string }): Promise<SendResult>;
}
const settings = smsSettings({ ...process.env, NODE_ENV:env.NODE_ENV, SMS_PROVIDER:env.SMS_PROVIDER,
  SMS_GATEWAY_URL:env.SMS_GATEWAY_URL, SMS_GATEWAY_KEY:env.SMS_GATEWAY_KEY, SMS_SENDER_ID:env.SMS_SENDER_ID });
export const consoleProvider: NotificationProvider = {
  name:'console', send:(to,body,options) => sendSms({ ...settings, mode:'console' },to,body,options?.idempotencyKey ?? 'notification'),
};
export const httpProvider: NotificationProvider = {
  name:settings.mode, send:(to,body,options) => sendSms(settings,to,body,options?.idempotencyKey ?? 'notification'),
};
export function resolveProvider(): NotificationProvider { return settings.mode === 'console' ? consoleProvider : httpProvider; }
