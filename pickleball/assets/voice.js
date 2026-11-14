/* Pickle Ball – chat thoại trong phòng online (WebRTC, nối trực tiếp giữa các máy).
 * Server chỉ chuyển tin "báo hiệu" (offer/answer/ICE) giữa người trong cùng phòng, KHÔNG nhận hay lưu âm thanh.
 * Quy tắc nối: người VÀO thoại sau gửi offer cho những người đã ở trong thoại → không bao giờ bị "va" offer.
 * Chế độ: 'open' (mở mic liên tục, có nút tắt tiếng) hoặc 'ptt' (giữ nút / giữ phím T để nói). */
(function (PP) {
  'use strict';
  const FALLBACK_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const SPEAK_LEVEL = 0.05;

  const V = {
    active: false,          // đang tham gia thoại
    listenOnly: false,      // không có mic (từ chối quyền) → chỉ nghe
    muted: false,           // tự tắt mic
    mode: 'open',           // 'open' | 'ptt'
    pttDown: false,
    sendFn: null,           // (msg) => bool
    onChange: null,         // () => void : cập nhật giao diện
    onNote: null,           // (text) => void : thông báo ngắn
    local: null,            // MediaStream mic
    peers: new Map(),       // id -> { pc, audio, stream, pending:[], remoteSet, state, vol, muted, level, analyser, data }
    levels: { me: 0 },
    ice: FALLBACK_ICE,
    ctx: null, meAn: null, meData: null, timer: 0, starting: null, audioBlocked: false,
  };

  const note = (t) => { if (V.onNote) V.onNote(t); };
  const changed = () => { if (V.onChange) V.onChange(); };
  const send = (m) => (V.sendFn ? V.sendFn(m) : false);

  V.supported = () => !!(window.RTCPeerConnection && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  V.secure = () => window.isSecureContext !== false;
  V.unsupportedReason = () => {
    if (!window.RTCPeerConnection) return 'Trình duyệt này chưa hỗ trợ chat thoại (WebRTC).';
    if (!V.secure() || !(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return 'Chat thoại cần mở game bằng HTTPS (hoặc localhost) để dùng được micro.';
    return '';
  };

  function audioCtx() {
    if (!V.ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { try { V.ctx = new AC(); } catch (e) { V.ctx = null; } } }
    if (V.ctx && V.ctx.state === 'suspended') V.ctx.resume().catch(() => {});
    return V.ctx;
  }
  function makeAnalyser(stream) {
    const ctx = audioCtx(); if (!ctx) return null;
    try {
      const src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 512; src.connect(an);          // không nối ra loa: chỉ để đo mức âm
      return { an, data: new Uint8Array(an.fftSize), src };
    } catch (e) { return null; }
  }
  function rms(a) {
    if (!a) return 0;
    a.an.getByteTimeDomainData(a.data);
    let s = 0; for (let i = 0; i < a.data.length; i++) { const v = (a.data[i] - 128) / 128; s += v * v; }
    return Math.min(1, Math.sqrt(s / a.data.length) * 3);
  }
  function tickLevels() {
    let diff = false;
    const me = (V.active && !V.listenOnly && micOn()) ? rms(V.meAn) : 0;
    if ((me > SPEAK_LEVEL) !== (V.levels.me > SPEAK_LEVEL)) diff = true;
    V.levels.me = me;
    for (const [id, p] of V.peers) {
      const l = p.muted ? 0 : rms(p.an);
      if ((l > SPEAK_LEVEL) !== ((V.levels[id] || 0) > SPEAK_LEVEL)) diff = true;
      V.levels[id] = l;
    }
    if (diff) changed();
  }

  /* ---------- mic ---------- */
  const micOn = () => !!(V.local && !V.muted && (V.mode === 'open' || V.pttDown));
  function applyMic() {
    if (V.local) for (const t of V.local.getAudioTracks()) t.enabled = micOn();
    changed();
  }
  V.setMode = (m) => { V.mode = m === 'ptt' ? 'ptt' : 'open'; V.pttDown = false; applyMic(); };
  V.setMuted = (b) => { V.muted = !!b; applyMic(); send({ t: 'voice_mute', muted: V.muted }); };
  V.toggleMute = () => V.setMuted(!V.muted);
  V.setPtt = (down) => { if (V.mode !== 'ptt' || !V.active) return; V.pttDown = !!down; applyMic(); };
  V.micLive = micOn;

  /* ---------- kết nối ngang hàng ---------- */
  function sendSig(to, data) { send({ t: 'voice_signal', to, data }); }

  function attachRemote(id, stream) {
    const p = V.peers.get(id); if (!p) return;
    p.stream = stream;
    if (!p.audio) {
      const a = document.createElement('audio');
      a.autoplay = true; a.playsInline = true; a.setAttribute('playsinline', ''); a.style.display = 'none';
      document.body.append(a); p.audio = a;
    }
    p.audio.srcObject = stream;
    p.audio.volume = p.vol; p.audio.muted = p.muted;
    const pr = p.audio.play();
    if (pr && pr.catch) pr.catch(() => { V.audioBlocked = true; note('Chạm vào màn hình một lần để nghe được tiếng của mọi người.'); changed(); });
    if (p.an && p.an.src) { try { p.an.src.disconnect(); } catch (e) { /* bỏ qua */ } }
    p.an = makeAnalyser(stream);
  }

  function makePeer(id) {
    const old = V.peers.get(id); if (old) closePeer(id);
    const pc = new RTCPeerConnection({ iceServers: V.ice });
    const p = { id, pc, audio: null, stream: null, pending: [], remoteSet: false, state: 'connecting', vol: 1, muted: false, an: null, initiator: false };
    V.peers.set(id, p);
    if (V.local) for (const t of V.local.getTracks()) pc.addTrack(t, V.local);
    else pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => { if (e.candidate) sendSig(id, { c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
    pc.ontrack = (e) => attachRemote(id, (e.streams && e.streams[0]) || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      p.state = s === 'connected' ? 'connected' : (s === 'failed' || s === 'closed') ? 'failed' : 'connecting';
      if (s === 'failed') {
        if (p.initiator && V.peers.get(id) === p && !p.restarted) { p.restarted = true; restartIce(p); }       // thử nối lại 1 lần
        else note('Không nối được thoại với một người chơi (mạng chặn). Quản trị có thể cấu hình máy chủ TURN.');
      }
      changed();
    };
    return p;
  }
  function closePeer(id) {
    const p = V.peers.get(id); if (!p) return;
    V.peers.delete(id); delete V.levels[id];
    try { p.pc.onicecandidate = p.pc.ontrack = p.pc.onconnectionstatechange = p.pc.onnegotiationneeded = null; p.pc.close(); } catch (e) { /* bỏ qua */ }
    if (p.audio) { try { p.audio.pause(); p.audio.srcObject = null; p.audio.remove(); } catch (e) { /* bỏ qua */ } }
    if (p.an && p.an.src) { try { p.an.src.disconnect(); } catch (e) { /* bỏ qua */ } }
  }
  async function callPeer(id) {                 // mình là người vào sau → mình gửi offer
    const p = makePeer(id); p.initiator = true;
    try {
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      sendSig(id, { d: p.pc.localDescription && p.pc.localDescription.toJSON ? p.pc.localDescription.toJSON() : p.pc.localDescription });
    } catch (e) { closePeer(id); }
    changed();
  }
  async function restartIce(p) {
    try {
      const offer = await p.pc.createOffer({ iceRestart: true });
      await p.pc.setLocalDescription(offer);
      sendSig(p.id, { d: p.pc.localDescription && p.pc.localDescription.toJSON ? p.pc.localDescription.toJSON() : p.pc.localDescription });
    } catch (e) { /* bỏ qua */ }
  }
  async function flushPending(p) {
    p.remoteSet = true;
    for (const c of p.pending.splice(0)) { try { await p.pc.addIceCandidate(c); } catch (e) { /* bỏ qua */ } }
  }
  async function onSignal(from, data) {
    if (!V.active || !data) return;
    try {
      if (data.d) {
        const d = data.d;
        if (d.type === 'offer') {
          const p = V.peers.get(from) && !V.peers.get(from).initiator ? V.peers.get(from) : makePeer(from);
          await p.pc.setRemoteDescription(d);
          await flushPending(p);
          const ans = await p.pc.createAnswer();
          await p.pc.setLocalDescription(ans);
          sendSig(from, { d: p.pc.localDescription && p.pc.localDescription.toJSON ? p.pc.localDescription.toJSON() : p.pc.localDescription });
        } else if (d.type === 'answer') {
          const p = V.peers.get(from); if (!p) return;
          await p.pc.setRemoteDescription(d);
          await flushPending(p);
        }
      } else if (data.c) {
        const p = V.peers.get(from); if (!p) return;
        if (p.remoteSet) { try { await p.pc.addIceCandidate(data.c); } catch (e) { /* bỏ qua */ } }
        else p.pending.push(data.c);
      }
    } catch (e) { /* tin báo hiệu lỗi: bỏ qua */ }
    changed();
  }

  /* ---------- bật / tắt ---------- */
  async function loadIce() {
    try {
      const r = await fetch('/ice', { cache: 'no-store' });
      if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.iceServers) && j.iceServers.length) V.ice = j.iceServers; }
    } catch (e) { /* dùng STUN mặc định */ }
  }
  V.enable = function () {
    if (V.active) return Promise.resolve(true);
    if (V.starting) return V.starting;
    const why = V.unsupportedReason();
    if (why) { note(why); return Promise.resolve(false); }
    V.starting = (async () => {
      audioCtx();
      await loadIce();
      V.listenOnly = false;
      try {
        V.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch (e) {
        V.local = null; V.listenOnly = true;
        note('Không bật được micro (' + ((e && e.name) || 'lỗi') + '). Bạn vào chế độ chỉ nghe; cấp quyền micro rồi bật lại để nói.');
      }
      V.active = true;
      if (V.local) { V.meAn = makeAnalyser(V.local); }
      applyMic();
      if (!V.timer) V.timer = setInterval(tickLevels, 120);
      send({ t: 'voice_join' });
      changed();
      return true;
    })().finally(() => { V.starting = null; });
    return V.starting;
  };
  V.disable = function (silent) {
    const was = V.active;
    V.active = false; V.listenOnly = false; V.pttDown = false;
    for (const id of Array.from(V.peers.keys())) closePeer(id);
    if (V.local) { for (const t of V.local.getTracks()) { try { t.stop(); } catch (e) { /* bỏ qua */ } } V.local = null; }
    if (V.meAn && V.meAn.src) { try { V.meAn.src.disconnect(); } catch (e) { /* bỏ qua */ } }
    V.meAn = null; V.levels = { me: 0 };
    if (V.timer) { clearInterval(V.timer); V.timer = 0; }
    if (was && !silent) send({ t: 'voice_leave' });
    V.muted = false;
    changed();
  };
  /** Mất / có lại kết nối WebSocket: server đã coi mình rời thoại → nối lại từ đầu */
  V.onSocketOpen = function () {
    if (!V.active) return;
    for (const id of Array.from(V.peers.keys())) closePeer(id);
    send({ t: 'voice_join' });
    if (V.muted) send({ t: 'voice_mute', muted: true });
  };

  /** Tin từ server */
  V.handle = function (m) {
    switch (m.t) {
      case 'voice_peers': if (V.active) for (const id of m.ids || []) callPeer(id); break;
      case 'voice_joined': if (V.active && V.peers.has(m.id)) closePeer(m.id); break;   // người đó vào lại: chờ offer mới
      case 'voice_left': closePeer(m.id); changed(); break;
      case 'voice_signal': onSignal(m.from, m.data); break;
      default: break;
    }
  };
  /** Đồng bộ danh sách người trong phòng (từ room_state): bỏ kết nối với ai đã rời phòng / rời thoại */
  V.syncRoster = function (players) {
    const alive = new Set((players || []).filter((p) => p.voice).map((p) => p.id));
    for (const id of Array.from(V.peers.keys())) if (!alive.has(id)) closePeer(id);
    changed();
  };

  /* ---------- điều chỉnh từng người ---------- */
  V.setVolume = (id, v) => { const p = V.peers.get(id); if (!p) return; p.vol = Math.max(0, Math.min(1, v)); if (p.audio) p.audio.volume = p.vol; };
  V.setPeerMuted = (id, b) => { const p = V.peers.get(id); if (!p) return; p.muted = !!b; if (p.audio) p.audio.muted = p.muted; changed(); };
  V.peerInfo = (id) => { const p = V.peers.get(id); return p ? { state: p.state, vol: p.vol, muted: p.muted } : null; };
  V.speaking = (id) => (id === 'me' ? V.levels.me : (V.levels[id] || 0)) > SPEAK_LEVEL;

  // iOS/Safari: nếu loa bị chặn tự phát, chạm màn hình để mở lại
  document.addEventListener('pointerdown', () => {
    if (!V.active) return;
    audioCtx();
    if (V.audioBlocked) { V.audioBlocked = false; for (const p of V.peers.values()) if (p.audio) p.audio.play().catch(() => {}); changed(); }
  }, true);

  PP.Voice = V;
})(window.PP);
