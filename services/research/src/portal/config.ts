import type { PortalConfig } from './types.js';
import { check } from './policy.js';
export function portalConfig(input:NodeJS.ProcessEnv=process.env):PortalConfig {
  const enabled=input.RESEARCH_PORTAL_ENABLED==='true';
  const key=(name:string)=>{const raw=input[name]??'';if(!enabled&&!raw)return Buffer.alloc(0);const b=Buffer.from(raw,'base64');check(b.length===32&&b.toString('base64')===raw,503,'CONFIGURATION_REQUIRED',`${name} must be a distinct 32-byte base64 secret.`);return b;};
  const encryptionKey=key('RESEARCH_ENCRYPTION_KEY'),linkageKey=key('RESEARCH_LINKAGE_KEY');
  if(enabled)check(!encryptionKey.equals(linkageKey),503,'CONFIGURATION_REQUIRED','Research encryption and linkage keys must be different.');
  return {enabled,realDataEnabled:input.RESEARCH_REAL_DATA_INGEST_ENABLED==='true',encryptionKey,linkageKey};
}
