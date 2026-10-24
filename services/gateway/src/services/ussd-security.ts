import { createHash,createCipheriv,createDecipheriv,randomBytes,createHmac,timingSafeEqual } from 'node:crypto';
export function contextKey(input:string,shared:string,production:boolean):Buffer {
 if(/^[0-9a-f]{64}$/i.test(input))return Buffer.from(input,'hex');
 if(production||!shared)throw new Error('USSD context encryption configuration missing');
 return createHash('sha256').update(`AHP-USSD-LOCAL-CONTEXT:${shared}`).digest();
}
export function sealContext(data:Record<string,unknown>,key:Buffer,aad:string){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(aad));
 const text=JSON.stringify(data);if(Buffer.byteLength(text)>32768)throw new Error('USSD context too large');
 const encrypted=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
 return {v:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),encrypted:encrypted.toString('base64')};
}
export function openContext(payload:unknown,key:Buffer,aad:string):Record<string,unknown>{
 const p=payload as {v:number;iv:string;tag:string;encrypted:string};
 if(!p||p.v!==1||typeof p.encrypted!=='string'||p.encrypted.length>50000)throw new Error('Invalid USSD context');
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(p.iv,'base64'));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(p.tag,'base64'));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(p.encrypted,'base64')),decipher.final()]).toString('utf8'));
}
export function requestDigest(sessionId:string,phone:string,text:string){return createHash('sha256').update(JSON.stringify([sessionId,phone,text])).digest('hex');}
export function bridgeSignatureValid(raw:Buffer,stamp:string|undefined,signature:string|undefined,secret:string,now=Date.now()):boolean {
 if(!secret||!stamp||!/^\d{10}$/.test(stamp)||!signature||!/^[a-f0-9]{64}$/i.test(signature)||Math.abs(now-Number(stamp)*1000)>120000)return false;
 const expected=createHmac('sha256',secret).update(stamp+'.').update(raw).digest('hex');
 return timingSafeEqual(Buffer.from(expected),Buffer.from(signature.toLowerCase()));
}
export function stableRequestKey(sessionId:string,phone:string,action:string):string {
 const h=createHash('sha256').update(JSON.stringify([sessionId,phone,action])).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
