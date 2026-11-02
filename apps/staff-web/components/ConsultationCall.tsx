'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Mic, MicOff, Video, VideoOff, Phone, PhoneOff, Volume2, UserRound } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';

type Call = { id: string; is_caller: boolean; offer: string; answer: string | null; expires_at: string };
type State = { call: Call | null; ice_servers: RTCIceServer[]; available: boolean; relay_configured: boolean; can_start: boolean };

async function gather(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === 'complete') return;
  await new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); resolve(); };
    const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(finish, 12000);
    peer.addEventListener('icegatheringstatechange', changed);
  });
}

export function ConsultationCall({ consultationId, video }: { consultationId: string; video: boolean }) {
  const base = `/consultations/${consultationId}/call`;
  const [data, setData] = useState<State | null>(null);
  const [status, setStatus] = useState('Ready when both participants are here.');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const room = useRef<HTMLDivElement>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const callId = useRef<string | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const working = useRef(false);
  const alive = useRef(false);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === room.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === room.current) await document.exitFullscreen();
      else if (room.current?.requestFullscreen) await room.current.requestFullscreen();
      else setError('Fullscreen is not supported in this browser.');
    } catch { setError('Fullscreen could not open. Try again or use your browser window controls.'); }
  }

  function release() {
    peer.current?.close(); peer.current = null;
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    callId.current = null;
    if (alive.current) { setActive(false); setMuted(false); setCameraOff(false); }
  }
  async function end() {
    const id = callId.current ?? data?.call?.id;
    release(); setStatus('Call ended.');
    if (id) {
      try { await api.post(`${base}/${id}/end`, {}); setData(previous => previous ? { ...previous, call: null } : null); }
      catch { setError('Media stopped. The server could not confirm the end; refresh before calling again.'); }
    }
  }

  useEffect(() => {
    alive.current = true;
    let polling = false;
    async function poll() {
      if (polling || working.current) return;
      polling = true;
      try {
        const { data: next } = await api.get<State>(base);
        if (!alive.current) return;
        setData(next);
        if (callId.current && next.call?.id !== callId.current) { release(); setStatus('Call ended or expired.'); }
        else if (next.call?.is_caller && next.call.answer && peer.current && !peer.current.remoteDescription) {
          await peer.current.setRemoteDescription({ type: 'answer', sdp: next.call.answer });
        }
      } catch (e) {
        if (alive.current) setError(errorMessage(e, 'Call status could not be loaded. Check your connection.'));
        const code = (e as { response?: { status?: number } }).response?.status;
        if (code && [401, 403, 404, 409].includes(code)) release();
      } finally { polling = false; }
    }
    void poll(); const timer = setInterval(() => void poll(), 2000);
    return () => { alive.current = false; clearInterval(timer); const id = callId.current; release(); if (id) void api.post(`${base}/${id}/end`, {}).catch(() => undefined); };
    // The peer and media refs belong to this consultation for its entire lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  async function connect(incoming?: Call) {
    if (working.current || !data?.available || (!incoming && !data.can_start)) return;
    working.current = true; setBusy(true); setError(null); setStatus('Connecting camera and microphone…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Use HTTPS or localhost and a browser that supports calls.');
      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      if (!alive.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      if (localVideo.current) localVideo.current.srcObject = media;
      const pc = new RTCPeerConnection({ iceServers: data.ice_servers }); peer.current = pc;
      media.getTracks().forEach(t => pc.addTrack(t, media));
      pc.ontrack = event => { if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0] ?? new MediaStream([event.track]); };
      pc.onconnectionstatechange = () => {
        if (!alive.current) return;
        if (pc.connectionState === 'connected') setStatus('Connected');
        if (pc.connectionState === 'disconnected') setStatus('Connection interrupted. Reconnecting…');
        if (pc.connectionState === 'failed') { setError('The call could not connect. Check the network and relay configuration, then retry.'); void end(); }
      };
      setActive(true);
      if (incoming) {
        await pc.setRemoteDescription({ type: 'offer', sdp: incoming.offer });
        await pc.setLocalDescription(await pc.createAnswer()); await gather(pc);
        if (!alive.current) return;
        callId.current = incoming.id;
        await api.post(`${base}/${incoming.id}/answer`, { sdp: pc.localDescription!.sdp });
        setStatus(pc.connectionState === 'connected' ? 'Connected' : 'Connecting to the other participant…');
      } else {
        await pc.setLocalDescription(await pc.createOffer()); await gather(pc);
        if (!alive.current) return;
        const id = crypto.randomUUID(); callId.current = id;
        const result = await api.post<State>(`${base}/offer`, { call_id: id, sdp: pc.localDescription!.sdp });
        setData(result.data); setStatus('Calling… Waiting for an answer.');
      }
    } catch (e) {
      const id = callId.current; release();
      if (id) void api.post(`${base}/${id}/end`, {}).catch(() => undefined);
      if (alive.current) { setStatus('Call not connected.'); setError(e instanceof DOMException ? 'Allow camera/microphone access in the browser, check your devices and retry.' : errorMessage(e, e instanceof Error ? e.message : 'Could not start the call.')); }
    } finally { working.current = false; if (alive.current) setBusy(false); }
  }

  const control = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-white/10 px-4 py-3 text-sm font-medium text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40';
  return <div ref={room} aria-label="Consultation call room" className={`flex flex-col bg-ink text-white ${fullscreen ? 'h-dvh w-full overflow-auto p-3 sm:p-5' : 'mt-5 rounded-2xl p-4 sm:p-5'}`}>
    <div className="mb-3 flex items-center justify-between gap-3">
      <div><h2 className="text-xl font-semibold">{video ? 'Video consultation' : 'Audio consultation'}</h2>
        <p role="status" className="mt-1 text-sm text-white/80">{status}</p></div>
      {video && <button type="button" className={control} aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => void toggleFullscreen()}>
        {fullscreen ? <Minimize aria-hidden size={20}/> : <Maximize aria-hidden size={20}/>}</button>}
    </div>
    {!data?.available && data && <p role="alert" className="mb-3 text-sm">Calling is unavailable until the service relay is configured.</p>}
    {error && <p role="alert" className="mb-3 rounded-lg border border-white/30 p-3 text-sm">{error}</p>}
    <div className={`relative min-h-[220px] overflow-hidden rounded-xl bg-black/30 ${fullscreen ? 'flex-1' : 'aspect-video'}`}>
      <video aria-label="Other participant" ref={remoteVideo} autoPlay playsInline className={`absolute inset-0 h-full w-full object-contain ${video && active ? '' : 'invisible'}`}/>
      {(!active || !video) && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <div className="rounded-full bg-white/10 p-5"><UserRound aria-hidden size={32}/></div>
        <p className="text-sm">{active ? 'Audio consultation' : 'Ready to call your patient'}</p>
      </div>}
      <span className="absolute bottom-3 left-3 rounded-lg bg-ink px-3 py-1 text-sm">Patient</span>
      <div className={`absolute right-3 top-3 aspect-[3/4] w-20 overflow-hidden rounded-xl bg-ink sm:w-32 ${video && active ? '' : 'invisible'}`}>
        <video aria-label="Your video preview" ref={localVideo} autoPlay playsInline muted className={`h-full w-full object-cover ${cameraOff ? 'invisible' : ''}`}/>
        {cameraOff && <div className="absolute inset-0 grid place-items-center"><VideoOff aria-label="Camera off" size={28}/></div>}
        <span className="absolute bottom-1 left-1 rounded bg-ink px-2 py-1 text-xs">You</span>
      </div>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-center gap-3" role="group" aria-label="Call controls">
      {!active && !data?.call && data?.can_start && <button className={control} disabled={busy || !data.available} onClick={() => void connect()}><Phone aria-hidden size={20}/>Start {video ? 'video' : 'audio'} call</button>}
      {!active && data?.call && !data.call.is_caller && !data.call.answer && <button className={control} disabled={busy} onClick={() => void connect(data.call!)}><Phone aria-hidden size={20}/>Answer call</button>}
      {active && <button className={control} aria-pressed={muted} onClick={() => { stream.current?.getAudioTracks().forEach(t => { t.enabled = muted; }); setMuted(!muted); }}>{muted ? <MicOff aria-hidden size={20}/> : <Mic aria-hidden size={20}/>}<span>{muted ? 'Unmute microphone' : 'Mute microphone'}</span></button>}
      {active && video && <button className={control} aria-pressed={cameraOff} onClick={() => { stream.current?.getVideoTracks().forEach(t => { t.enabled = cameraOff; }); setCameraOff(!cameraOff); }}>{cameraOff ? <VideoOff aria-hidden size={20}/> : <Video aria-hidden size={20}/>}<span>{cameraOff ? 'Turn camera on' : 'Turn camera off'}</span></button>}
      {active && <button className={control} onClick={() => void remoteVideo.current?.play().catch(() => setError('Allow audio playback in the browser.'))}><Volume2 aria-hidden size={20}/>Enable sound</button>}
      {(active || data?.call) && <button className={`${control} !bg-red-700 hover:!bg-red-800`} disabled={busy} onClick={() => void end()}><PhoneOff aria-hidden size={20}/>{active ? 'End call' : 'Cancel call'}</button>}
    </div>
    {!active && <p className="mt-3 text-center text-sm text-white/80">You start the call. The patient chooses when to answer.</p>}
  </div>;
}
