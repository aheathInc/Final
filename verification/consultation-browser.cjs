const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module'), { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
const fixture = JSON.parse(fs.readFileSync(path.join(root, '.local/consultation-live.json')));
const { chromium } = createRequire(path.join(root, 'apps/staff-web/package.json'))('@playwright/test');
const jwt = createRequire(path.join(root, 'packages/http/package.json'))('jsonwebtoken');
const token = jwt.sign({ sub: fixture.userId, ppid: fixture.patientId, role: 'patient', status: 'active', jti: randomUUID() }, env.JWT_SECRET,
  { issuer: env.JWT_ISSUER || 'a-health', audience: env.JWT_AUDIENCE || 'a-health-api', expiresIn: 3600 });
const output = path.join(root, '.impeccable/review/consultation-modes'); fs.mkdirSync(output, { recursive: true });
async function api(route, body, port = 4005) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await res.json(); assert.ok(res.ok, `${route} ${res.status}: ${data.error?.message}`); return data;
}
async function capture(page, name) {
  if (process.argv.includes('--skip-capture')) return;
  for (const [kind, width, height] of [['desktop',1440,1000], ['mobile',390,844]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: path.join(output, `${name}-${kind}.png`), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} ${kind} overflow`);
  }
  await page.setViewportSize({ width:1440, height:1000 });
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ permissions: ['camera', 'microphone'], viewport: { width:1440, height:1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(90000);
  try {
    await page.goto('http://localhost:3000/login'); await page.waitForLoadState('networkidle'); await page.request.get('http://localhost:3000/api/auth/csrf');
    await page.getByLabel('Email', {exact:true}).fill(fixture.email); await page.getByLabel('Password', {exact:true}).fill(env.AHP_LOCAL_TEST_PASSWORD);
    await page.getByRole('button', {name:'Sign in', exact:true}).click(); await page.waitForURL('**/doctor/queue');
    console.log('Clinician browser login: PASS');
    await page.goto('http://localhost:3000/doctor/case/' + fixture.consultations.in_person);
    await page.getByRole('heading', {name:'Hospital consultation', exact:true}).waitFor();
    assert.equal(await page.getByRole('heading', {name:'Issue a consultation bill'}).count(), 0);
    await capture(page, 'hospital-case');
    const patientContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
    const patientPage = await patientContext.newPage();
    await patientPage.goto('http://localhost:3000/login');
    await patientPage.exposeFunction('patientApi', (route, body) => api(route, body));
    for (const mode of ['video', 'voice']) {
      const id = fixture.consultations[mode];
      const stale = (await api(`/consultations/${id}/call`)).call;
      if (stale) await api(`/consultations/${id}/call/${stale.id}/end`, {});
      await page.goto('http://localhost:3000/doctor/case/' + id);
      await page.getByRole('button', {name:`Start ${mode === 'video' ? 'video' : 'audio'} call`, exact:true}).click();
      let state;
      for (let i=0;i<60;i++) { state=await api(`/consultations/${id}/call`); if(state.call) break; await new Promise(r=>setTimeout(r,500)); }
      assert.ok(state.call, 'Doctor did not publish offer');
      await patientPage.evaluate(async ({ id, mode, state }) => {
        const media = await navigator.mediaDevices.getUserMedia({ audio:true, video:mode === 'video' });
        window.testMedia = media;
        const pc = new RTCPeerConnection({ iceServers:state.ice_servers }); window.testPeer=pc;
        media.getTracks().forEach(t=>pc.addTrack(t,media));
        const remote = document.createElement('video');remote.autoplay=true;remote.muted=true;document.body.append(remote);
        pc.ontrack=e=>{remote.srcObject=e.streams[0];};
        await pc.setRemoteDescription({type:'offer',sdp:state.call.offer}); await pc.setLocalDescription(await pc.createAnswer());
        await new Promise(resolve=>{if(pc.iceGatheringState==='complete')return resolve();const timer=setTimeout(resolve,12000);pc.onicegatheringstatechange=()=>{if(pc.iceGatheringState==='complete'){clearTimeout(timer);resolve();}};});
        await window.patientApi(`/consultations/${id}/call/${state.call.id}/answer`,{sdp:pc.localDescription.sdp});
      }, {id,mode,state});
      try { await page.getByText('Connected', {exact:true}).waitFor({timeout:45000}); }
      catch (e) {
        console.log('Call diagnostic', mode, await page.locator('[role="status"]').allTextContents(), await patientPage.evaluate(()=>({ice:window.testPeer.iceConnectionState,connection:window.testPeer.connectionState,signaling:window.testPeer.signalingState})));
        throw e;
      }
      await patientPage.waitForFunction(async () => { const stats=await window.testPeer.getStats();return [...stats.values()].some(s=>s.type==='inbound-rtp'&&s.bytesReceived>0); }, undefined, {timeout:30000});
      const doctorTracks = await page.locator('video[aria-label="Other participant"]').evaluate(v => ({ audio:v.srcObject?.getAudioTracks().length, video:v.srcObject?.getVideoTracks().length }));
      assert.equal(doctorTracks.audio,1);assert.equal(doctorTracks.video,mode==='video'?1:0);
      if(mode==='video') {
        await capture(page,'doctor-video-call');
        await page.getByRole('button',{name:'Enter fullscreen',exact:true}).click();
        await page.waitForFunction(()=>document.fullscreenElement?.getAttribute('aria-label')==='Consultation call room');
        await page.getByRole('button',{name:'End call',exact:true}).waitFor();
        if(!process.argv.includes('--skip-capture')) await page.screenshot({path:path.join(output,'doctor-video-fullscreen.png')});
        await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
        await page.waitForFunction(()=>document.fullscreenElement===null);
        await page.getByText('Connected',{exact:true}).waitFor();
        console.log('Fullscreen entry/exit preserves active media: PASS');
      }
      await page.getByRole('button',{name:'Mute microphone',exact:true}).click();await page.getByRole('button',{name:'Unmute microphone',exact:true}).waitFor();
      await Promise.all([page.waitForResponse(r=>r.url().endsWith(`/${state.call.id}/end`) && r.request().method()==='POST'), page.getByRole('button',{name:'End call',exact:true}).click()]);
      assert.ok((await api(`/consultations/${id}/call`)).call===null, 'Call must be cleared after confirmed end');
      await patientPage.evaluate(()=>{window.testMedia.getTracks().forEach(t=>t.stop());window.testPeer.close();});
      console.log(`${mode}: real WebRTC media, mute and end: PASS (synthetic media)`);
    }
    const chatId=fixture.consultations.chat;
    await page.goto('http://localhost:3000/doctor/case/' + chatId);
    await page.getByText('Live chat connected',{exact:true}).waitFor();
    const consultation=await api(`/consultations/${chatId}`);
    const body='Synthetic live chat '+Date.now();
    await api(`/care-threads/${consultation.care_thread_id}/messages`,{body},4006);
    await page.getByText(body,{exact:true}).waitFor({timeout:6000});
    console.log('Patient-to-clinician live chat: PASS');
    const reply = `Synthetic clinician reply ${Date.now()}`;
    await page.getByPlaceholder('Write a message...').fill(reply);
    await page.getByRole('button',{name:'Send',exact:true}).click();
    await page.getByText(reply,{exact:true}).waitFor();
    assert.ok((await api(`/care-threads/${consultation.care_thread_id}/messages`,undefined,4006)).data.some(m=>m.body===reply));
    console.log('Clinician-to-patient persisted reply: PASS');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
