// Local-only synthetic participant fixture. Never use with production data.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { createRequire } = require('node:module'), { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
const fixture = JSON.parse(fs.readFileSync(path.join(root, '.local/consultation-live.json')));
const dbUrl = new URL(env.DATABASE_URL);
if (dbUrl.hostname !== '127.0.0.1' || dbUrl.port !== '55432' || dbUrl.pathname !== '/ahealth_dev' || !fixture.email.endsWith('@dev.local')) throw Error('Local fixtures only');
const jwt = createRequire(path.join(root, 'packages/http/package.json'))('jsonwebtoken');
const { chromium } = createRequire(path.join(root, 'apps/staff-web/package.json'))('@playwright/test');
function token(sub, role) { return jwt.sign({ sub, role, status: 'active', jti: randomUUID(), ...(role==='patient'?{ppid:fixture.patientId}:{}) }, env.JWT_SECRET, {issuer:env.JWT_ISSUER||'a-health', audience:env.JWT_AUDIENCE||'a-health-api', expiresIn:1800}); }
async function api(route,body) {
  const r=await fetch('http://127.0.0.1:4005'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token(fixture.doctorUserId,'clinician'),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok) throw Error('Peer API status '+r.status); return r.json();
}
let browser, page, outcome={state:'idle'};
async function startDoctorCall(id) {
  outcome={state:'starting'};
  if(page) await page.close();
  page=await browser.newPage({permissions:['camera','microphone']});
  await page.goto('http://localhost:3000/login');
  await page.exposeFunction('doctorApi',api);
  const state=await api(`/consultations/${id}/call`);
  if(state.can_start!==true)throw Error('Doctor-only calling contract not loaded');
  const callId=randomUUID();
  await page.evaluate(async({id,state,video,callId})=>{
    const media=await navigator.mediaDevices.getUserMedia({audio:true,video}); window.testMedia=media;
    const pc=new RTCPeerConnection({iceServers:state.ice_servers});window.testPeer=pc;
    media.getTracks().forEach(t=>pc.addTrack(t,media));
    // Do not render, record, or persist the phone's camera/microphone content.
    pc.ontrack=()=>{};
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise(resolve=>{if(pc.iceGatheringState==='complete')return resolve();const timer=setTimeout(resolve,12000);pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}};});
    await window.doctorApi(`/consultations/${id}/call/offer`,{call_id:callId,sdp:pc.localDescription.sdp});
  },{id,state,callId,video:id===fixture.consultations.video});
  outcome={state:'calling'};
  for(let i=0;i<180;i++) {
    const current=(await api(`/consultations/${id}/call`)).call;
    if(!current || current.id!==callId)throw Error('Call ended before patient answered');
    if(current.answer) {
      await page.evaluate(sdp=>window.testPeer.setRemoteDescription({type:'answer',sdp}),current.answer);
      outcome={state:'answered'}; return;
    }
    await new Promise(r=>setTimeout(r,500));
  }
  throw Error('Patient did not answer');
}
(async()=>{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    try {
      if(req.url==='/fixture') return res.end(JSON.stringify({token:token(fixture.userId,'patient'),user:{id:fixture.userId,role:'patient'},consultations:fixture.consultations}));
      const id=req.url.split('/').pop();
      if(![fixture.consultations.video,fixture.consultations.voice].includes(id)) {res.statusCode=404;return res.end('{}');}
      if(req.url.startsWith('/prepare/')&&req.method==='POST') {
        const stale=(await api(`/consultations/${id}/call`)).call;
        if(stale) await api(`/consultations/${id}/call/${stale.id}/end`,{});
        void startDoctorCall(id).catch(e=>{outcome={state:'error',message:e.message};});
        return res.end('{"ready":true}');
      }
      if(req.url.startsWith('/status/')) {
        let media=null;
        if(page) media=await page.evaluate(async()=>{const pc=window.testPeer;if(!pc)return null; const stats=[...(await pc.getStats()).values()];return {connection:pc.connectionState,ice:pc.iceConnectionState,inbound:stats.filter(s=>s.type==='inbound-rtp').map(s=>({kind:s.kind,bytes:s.bytesReceived})),outbound:stats.filter(s=>s.type==='outbound-rtp').map(s=>({kind:s.kind,bytes:s.bytesSent}))};});
        return res.end(JSON.stringify({...outcome,media,ended:(await api(`/consultations/${id}/call`)).call===null}));
      }
      res.statusCode=404;res.end('{}');
    } catch(e) { res.statusCode=500;res.end(JSON.stringify({error:e.message})); }
  });
  server.listen(4040,'127.0.0.1',()=>console.log('Synthetic phone peer ready on local port 4040'));
  const close=async()=>{server.close();await browser.close();process.exit();};process.on('SIGINT',close);process.on('SIGTERM',close);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
