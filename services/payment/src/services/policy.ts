import { createHmac, timingSafeEqual } from 'node:crypto';
export const carriers = ['mpesa','tigo_pesa','airtel_money'] as const;
export type Carrier = typeof carriers[number];
export function exactMinor(value: unknown): bigint {
  const text=String(value); if (!/^\d{1,10}(\.\d{1,2})?$/.test(text)) throw new Error('Invalid amount');
  const [whole,fraction='']=text.split('.'); return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
export function requireTzs(value:unknown,currency:string):number {
  const minor=exactMinor(value); if(currency!=='TZS'||minor<100n||minor%100n!==0n||minor>214748364700n) throw new Error('Invalid TZS amount');
  return Number(minor/100n);
}
export function verifyProviderSignature(raw:string,signature:string|undefined,secret:string,scheme:'hmac_sha256'|'verif_hash'):boolean {
  if(!secret||!signature) return false;
  const expected=scheme==='hmac_sha256'?createHmac('sha256',secret).update(raw,'utf8').digest('base64'):secret;
  const a=Buffer.from(expected),b=Buffer.from(signature);return a.length===b.length&&timingSafeEqual(a,b);
}
export type VerifiedCharge = {transactionId:string; reference:string; amount:string|number;currency:string; status:'succeeded'|'failed'|'pending';network?:string};
export function matchesCharge(expected:{id:string;amount:unknown;currency:string;providerTransactionId?:string|null},charge:VerifiedCharge):boolean {
  try {return charge.reference===expected.id&&charge.currency===expected.currency&&exactMinor(charge.amount)===exactMinor(expected.amount)
    &&(!expected.providerTransactionId||expected.providerTransactionId===charge.transactionId);}catch{return false;}
}
export function resolvePaymentSettings(input:Record<string,string|undefined>) {
  if(!['development','test','production'].includes(input.NODE_ENV??'')) throw new Error('Set NODE_ENV explicitly for Payment.');
  const mode=input.MOBILE_MONEY_PROVIDER??(input.NODE_ENV==='production'?'':'console');
  if(!['console','flutterwave'].includes(mode)) throw new Error('Payment provider is not implemented. Select console locally or flutterwave.');
  const environment=mode==='console'?'simulated':(input.FLW_ENVIRONMENT??'test');
  if(!['simulated','test','live'].includes(environment)) throw new Error('Payment environment is invalid.');
  if(mode==='flutterwave'&&(!input.FLW_SECRET_KEY||!input.FLW_WEBHOOK_SECRET||input.FLW_WEBHOOK_SECRET.length<32)) throw new Error('Configure Flutterwave credentials; values are not shown.');
  if(mode==='flutterwave'&&environment==='test'&&!/^FLWSECK_TEST-/.test(input.FLW_SECRET_KEY??'')) throw new Error('Test mode requires a Flutterwave v3 test secret key; live keys are not permitted.');
  const scheme=input.FLW_WEBHOOK_AUTH??'verif_hash';
  if(!['hmac_sha256','verif_hash'].includes(scheme)) throw new Error('Unsupported webhook authentication scheme.');
  if(environment==='live'&&(input.PAYMENTS_LIVE_ENABLED!=='true'||/TEST|placeholder|change.?me/i.test(input.FLW_SECRET_KEY??''))) throw new Error('Live payment activation has not been approved.');
  if(input.NODE_ENV==='production'&&(mode!=='flutterwave'||environment!=='live')) throw new Error('Production cannot settle simulated or sandbox payments.');
  return {mode:mode as 'console'|'flutterwave',environment:environment as 'simulated'|'test'|'live',scheme:scheme as 'hmac_sha256'|'verif_hash'};
}
