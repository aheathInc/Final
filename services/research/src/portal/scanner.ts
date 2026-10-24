import { connect } from 'node:net';
import { PortalError } from './policy.js';
/** ClamAV INSTREAM; only an exact OK terminator permits evidence storage. */
export async function scanEvidence(bytes:Buffer):Promise<'clean'> {
  const host=process.env.RESEARCH_CLAMD_HOST??'127.0.0.1',port=Number(process.env.RESEARCH_CLAMD_PORT??3310);
  if(!['127.0.0.1','::1','localhost'].includes(host)||!Number.isInteger(port)||port<1||port>65535)throw new PortalError(503,'SCANNER_CONFIGURATION','Use a trusted loopback clamd sidecar.');
  return new Promise((resolve,reject)=>{
    const socket=connect({host,port});let result=Buffer.alloc(0),done=false;
    const finish=(error?:Error)=>{if(done)return;done=true;socket.destroy();error?reject(error):resolve('clean');};
    socket.setTimeout(5000,()=>finish(new PortalError(503,'DOCUMENT_SCANNER_UNAVAILABLE','Document scanner timed out.')));
    socket.on('error',()=>finish(new PortalError(503,'DOCUMENT_SCANNER_UNAVAILABLE','Document scanner is unavailable.')));
    socket.on('connect',()=>{socket.write(Buffer.from('zINSTREAM\0'));for(let i=0;i<bytes.length;i+=65536){const part=bytes.subarray(i,i+65536),size=Buffer.alloc(4);size.writeUInt32BE(part.length);socket.write(size);socket.write(part);}socket.write(Buffer.alloc(4));});
    const verify=()=>{const text=result.toString('utf8').replace(/[\0\r\n]+$/,'');if(text==='stream: OK')finish();else finish(new PortalError(422,'DOCUMENT_SCAN_FAILED','The document did not pass malware scanning.'));};
    socket.on('data',chunk=>{result=Buffer.concat([result, typeof chunk==='string'?Buffer.from(chunk):chunk]);if(result.length>1024)return finish(new PortalError(503,'DOCUMENT_SCANNER_UNAVAILABLE','Invalid scanner response.'));if(result.includes(0))verify();});
    socket.on('end',verify);
    socket.on('close',()=>{if(!done)finish(new PortalError(503,'DOCUMENT_SCANNER_UNAVAILABLE','Incomplete scanner response.'));});
  });
}
