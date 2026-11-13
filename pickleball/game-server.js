// Server online cho "Pickle Ball - Bạn nói thế rồi ok đi".
// Server là "trọng tài": nhận vị trí + cú đánh từ người chơi, chạy luật (match.js),
// vật lý (physics.js) và bot (ai.js) – dùng lại đúng các file mà trình duyệt đang dùng.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { accept } = require('./ws-lite');
const cfg = require('./assets/config.js');
const { Physics } = require('./assets/physics.js');
const { Match } = require('./assets/match.js');
const { BotBrain } = require('./assets/ai.js');
const { Protocol } = require('./assets/protocol.js');

const { C, CHARACTERS } = cfg;
const T0 = Date.now();
const now = () => (Date.now() - T0) / 1000;
const SERVE_LEAD = 0.25;          // giống client: báo trước cú giao của bot
const START_DELAY = 2.5;          // chờ client dựng xong sân rồi mới bắt đầu giao bóng
const GRACE_MATCH = 30;           // giây chờ người mất kết nối quay lại trong trận
const GRACE_LOBBY = 20;
const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const players = new Map();        // pid -> {pid, deviceId, name, char, look, conn, room, spec, timer}
const rooms = new Map();          // code -> room
const queues = { '1v1': [], '2v2': [] };   // [{pid, t}]
let matchSeq = 0, botSeq = 0;

/* ---------------- bảng xếp hạng (lưu file, tốt nhất có thể) ---------------- */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const LB_FILE = path.join(DATA_DIR, 'leaderboard.json');
let lb = {};
try { lb = JSON.parse(fs.readFileSync(LB_FILE, 'utf8')); } catch (e) { lb = {}; }
let lbDirty = false;
setInterval(() => {
  if (!lbDirty) return;
  lbDirty = false;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(LB_FILE, JSON.stringify(lb)); } catch (e) { /* bỏ qua */ }
}, 15000).unref();
function lbTop() {
  return Object.values(lb).sort((a, b) => b.wins - a.wins || a.losses - b.losses).slice(0, 20)
    .map((r) => ({ name: r.name, wins: r.wins, losses: r.losses }));
}

/* ---------------- tiện ích gửi ---------------- */
const send = (conn, obj) => { if (conn && conn.open) conn.send(JSON.stringify(obj)); };
const sendP = (p, obj) => { if (p && p.conn) send(p.conn, obj); };
const err = (p, code, message) => sendP(p, { t: 'error', code, message });
function genCode() {
  const A = Protocol.ROOM_ALPHABET;
  for (;;) {
    let s = '';
    for (let i = 0; i < 4; i++) s += A[(Math.random() * A.length) | 0];
    if (!rooms.has(s)) return s;
  }
}
const sizeOf = (room) => (room.mode === '2v2' ? 2 : 1);
const member = (room, pid) => room.members.find((m) => m.pid === pid);
const humansOnline = (room) => room.members.filter((m) => players.get(m.pid) && players.get(m.pid).conn);

function roomState(room) {
  return {
    t: 'room_state', code: room.code, mode: room.mode, quick: room.quick, hostId: room.hostId,
    settings: room.settings, fillBots: room.fillBots, botLevel: room.botLevel, inMatch: room.inMatch,
    players: room.members.map((m) => {
      const p = players.get(m.pid);
      return { id: m.pid, name: p.name, char: p.char, team: m.team, ready: m.ready, connected: !!p.conn };
    }),
  };
}
function broadcastRoom(room, obj, exceptPid) {
  const s = JSON.stringify(obj);
  for (const m of room.members) { const p = players.get(m.pid); if (p && p.conn && m.pid !== exceptPid) p.conn.send(s); }
  for (const pid of room.spectators) { const p = players.get(pid); if (p && p.conn && pid !== exceptPid) p.conn.send(s); }
}
const pushRoomState = (room) => broadcastRoom(room, roomState(room));
function sysChat(room, text) { broadcastRoom(room, { t: 'chat', name: '', text, sys: true }); }

/* ---------------- phòng ---------------- */
function pickTeam(room) {
  const size = sizeOf(room);
  const a = room.members.filter((m) => m.team === 'A').length, b = room.members.filter((m) => m.team === 'B').length;
  if (a >= size && b >= size) return null;
  if (a >= size) return 'B';
  if (b >= size) return 'A';
  return a <= b ? 'A' : 'B';
}
function createRoom(host, mode, settings, quick) {
  leaveRoom(host);
  const room = {
    code: genCode(), mode, settings, hostId: host.pid, fillBots: false, botLevel: 'pro', quick: !!quick,
    members: [], spectators: new Set(), match: null, inMatch: false, rematch: new Set(), lobbyTimers: new Map(),
  };
  rooms.set(room.code, room);
  addMember(room, host);
  return room;
}
function addMember(room, p) {
  const team = pickTeam(room);
  room.members.push({ pid: p.pid, team, ready: !!room.quick });
  p.room = room;
}
function destroyRoomIfEmpty(room) {
  if (room.members.length || room.spectators.size) return;
  if (room.match) endMatchObj(room);
  rooms.delete(room.code);
}
function leaveRoom(p, silent) {
  if (p.spec) { p.spec.spectators.delete(p.pid); const sr = p.spec; p.spec = null; destroyRoomIfEmpty(sr); }
  const room = p.room;
  if (!room) return;
  const mem = member(room, p.pid);
  if (!mem) { p.room = null; return; }
  if (room.match && room.match.running) {
    handOver(room, p.pid);       // bot thay thế / xử thua
  }
  room.members = room.members.filter((m) => m.pid !== p.pid);
  room.rematch.delete(p.pid);
  const t = room.lobbyTimers.get(p.pid); if (t) { clearTimeout(t); room.lobbyTimers.delete(p.pid); }
  p.room = null;
  if (!silent) sendP(p, { t: 'room_left' });
  if (room.hostId === p.pid && room.members.length) room.hostId = room.members[0].pid;
  if (room.members.length) pushRoomState(room);
  destroyRoomIfEmpty(room);
}

/* ---------------- trận đấu ---------------- */
function endMatchObj(room) {
  const M = room.match;
  if (!M) return;
  M.running = false;
  for (const t of M.timers.values()) clearTimeout(t);
  if (M.startTimer) clearTimeout(M.startTimer);
  room.match = null; room.inMatch = false;
}

function matchStartMsg(room, forPid) {
  const M = room.match, m = M.m;
  const mem = member(room, forPid);
  const msg = {
    t: 'match_start', matchId: M.id,
    settings: { teamSize: sizeOf(room), target: room.settings.target, scoring: room.settings.scoring, venue: room.settings.venue },
    players: M.roster,
  };
  if (mem) msg.yourTeam = mem.team;
  return msg;
}

function startMatch(room) {
  if (room.match) endMatchObj(room);
  const size = sizeOf(room);
  const roster = [], plist = [], used = new Set();
  for (const team of ['A', 'B']) {
    const hs = room.members.filter((m) => m.team === team).slice(0, size);
    for (const h of hs) {
      const p = players.get(h.pid); used.add(p.char);
      roster.push({ id: p.pid, team, char: p.char, name: p.name, isBot: false, look: p.look });
      plist.push({ id: p.pid, team });
    }
    for (let i = hs.length; i < size; i++) {
      const pool = CHARACTERS.filter((c) => !used.has(c.id));
      const ch = pool[(Math.random() * pool.length) | 0] || CHARACTERS[0];
      used.add(ch.id);
      const id = 'bot' + (++botSeq);
      roster.push({ id, team, char: ch.id, name: ch.name, isBot: true, look: {} });
      plist.push({ id, team });
    }
  }
  const seed = (Math.random() * 1e9) | 0;
  const m = new Match({ teamSize: size, target: room.settings.target, scoring: room.settings.scoring,
    venue: room.settings.venue, seed, grace: C.GRACE_ONLINE || 0.2, players: plist });
  const M = { id: ++matchSeq, m, roster, bots: [], sw: new Map(), timers: new Map(), running: true, lastT: now(), lastState: 0, startTimer: null };
  roster.filter((r) => r.isBot).forEach((r, i) => {
    M.bots.push({ id: r.id, brain: new BotBrain(m.player(r.id), room.botLevel, Physics.mulberry32(seed + i + 1)), swingKey: '' });
  });
  room.match = M; room.inMatch = true; room.rematch.clear();
  for (const mem of room.members) mem.ready = !!room.quick || mem.pid === room.hostId ? mem.ready : false;
  pushRoomState(room);
  for (const mem of room.members) sendP(players.get(mem.pid), matchStartMsg(room, mem.pid));
  for (const pid of room.spectators) sendP(players.get(pid), matchStartMsg(room, pid));
  // bắt đầu giao bóng sau khi client dựng sân xong
  M.startTimer = setTimeout(() => {
    M.startTimer = null;
    if (!M.running) return;
    m.start(now(), Math.random() < 0.5 ? 'A' : 'B');
    flush(room);
  }, START_DELAY * 1000);
}

function flush(room) {
  const M = room.match; if (!M) return;
  for (const e of M.m.drain()) {
    broadcastRoom(room, Object.assign({ matchId: M.id }, e));
    if (e.t === 'over') onOver(room, e);
  }
}

function onOver(room, e) {
  const M = room.match;
  const humans = M.roster.filter((r) => !r.isBot && room.members.some((m) => m.pid === r.id));
  if (humans.length) {
    for (const h of humans) {
      const p = players.get(h.id); if (!p) continue;
      const rec = lb[p.pid] || (lb[p.pid] = { name: p.name, wins: 0, losses: 0 });
      rec.name = p.name;
      if (h.team === e.winner) rec.wins++; else rec.losses++;
    }
    lbDirty = true;
  }
  M.running = false;
  for (const t of M.timers.values()) clearTimeout(t);
  M.timers.clear();
  room.inMatch = false;
  for (const mem of room.members) mem.ready = !!room.quick;
  pushRoomState(room);
}

/** Người chơi rời trận (chủ động hoặc hết thời gian chờ): 1v1 xử thua, 2v2 bot thay thế */
function handOver(room, pid) {
  const M = room.match;
  if (!M || !M.running) return;
  const m = M.m, mp = m.player(pid);
  if (!mp) return;
  const tm = M.timers.get(pid); if (tm) { clearTimeout(tm); M.timers.delete(pid); }
  const stay = room.members.filter((x) => x.pid !== pid && players.get(x.pid) && players.get(x.pid).conn);
  if (sizeOf(room) === 1 || !stay.length) {
    m.forfeit(mp.team);
    flush(room);
    return;
  }
  const r = M.roster.find((x) => x.id === pid);
  const pool = CHARACTERS.filter((c) => !M.roster.some((x) => x.char === c.id));
  const ch = pool[(Math.random() * pool.length) | 0] || CHARACTERS[0];
  r.isBot = true; r.char = ch.id; r.name = ch.name;
  M.bots.push({ id: pid, brain: new BotBrain(mp, room.botLevel, Physics.mulberry32((Math.random() * 1e9) | 0)), swingKey: '' });
  broadcastRoom(room, { t: 'player_replaced', matchId: M.id, id: pid, name: ch.name });
  resumeIfReady(room);
}

function resumeIfReady(room) {
  const M = room.match; if (!M || !M.running) return;
  const waiting = M.roster.some((r) => !r.isBot && !(players.get(r.id) && players.get(r.id).conn));
  if (!waiting && M.m.phase === 'paused') { M.m.resume(now()); flush(room); }
}

function tickRoom(room, t) {
  const M = room.match;
  if (!M || !M.running) return;
  const m = M.m;
  if (m.phase === 'idle') return;
  const dt = clamp(t - M.lastT, 0, 0.1); M.lastT = t;
  m.update(t);
  if (m.phase !== 'paused' && m.phase !== 'over') {
    for (const b of M.bots) {
      const mp = b.brain.p, it = b.brain.intent;
      if (it && m.launch && it.launchId === m.launch.id && b.swingKey !== 'L' + it.launchId && it.t - t <= 0.26) {
        b.swingKey = 'L' + it.launchId;
        broadcastRoom(room, { t: 'swing', matchId: M.id, id: b.id, contactT: it.t, x: it.x, y: it.y, z: it.z, zone: it.zone });
      }
      if (m.phase === 'serve' && m.serverId === b.id && isFinite(b.brain.serveAt) && b.swingKey !== 'R' + m.rallyId && b.brain.serveAt - t <= SERVE_LEAD) {
        b.swingKey = 'R' + m.rallyId;
        const dir = mp.team === 'A' ? -1 : 1;
        broadcastRoom(room, { t: 'swing', matchId: M.id, id: b.id, contactT: b.brain.serveAt, x: mp.x, y: C.SERVE_Y || 0.55, z: mp.z + dir * (C.SERVE_FWD || 0.45), zone: 'serve' });
      }
      const h = b.brain.tick(dt, t, m);
      if (h) m.tryHit(b.id, h, t, false);
    }
  }
  flush(room);
  if (!room.match || !room.match.running) return;
  if (t - M.lastState >= 0.05) {
    M.lastState = t;
    broadcastRoom(room, { t: 'state', matchId: M.id, ts: r3(t),
      players: m.players.map((p) => ({ id: p.id, x: r3(p.x), z: r3(p.z), vx: r3(p.vx), vz: r3(p.vz), sw: M.sw.get(p.id) || 0 })) });
  }
}
setInterval(() => { const t = now(); for (const room of rooms.values()) tickRoom(room, t); }, 1000 / 60);

/* ---------------- ghép nhanh ---------------- */
function broadcastQueue(mode) {
  for (const q of queues[mode]) sendP(players.get(q.pid), { t: 'queue_status', waiting: true, mode, count: queues[mode].length });
}
function dequeue(p) {
  for (const mode of Object.keys(queues)) {
    const i = queues[mode].findIndex((q) => q.pid === p.pid);
    if (i >= 0) { queues[mode].splice(i, 1); broadcastQueue(mode); return true; }
  }
  return false;
}
function launchQuick(mode, list, fill) {
  const host = players.get(list[0].pid);
  const room = createRoom(host, mode, { venue: 'gym', target: 7, scoring: 'sideout' }, true);
  room.fillBots = !!fill;
  for (let i = 1; i < list.length; i++) { const p = players.get(list[i].pid); if (p.room) leaveRoom(p, true); addMember(room, p); }
  for (const q of list) { const p = players.get(q.pid); sendP(p, { t: 'queue_status', waiting: false }); }
  for (const mem of room.members) sendP(players.get(mem.pid), roomState(room));
  startMatch(room);
}
setInterval(() => {
  for (const mode of ['1v1', '2v2']) {
    const q = queues[mode], need = mode === '2v2' ? 4 : 2;
    if (q.length >= need) { const list = q.splice(0, need); launchQuick(mode, list, false); broadcastQueue(mode); }
    else if (mode === '2v2' && q.length >= 2 && Date.now() - q[0].t > 10000) { const list = q.splice(0, q.length); launchQuick(mode, list, true); }
  }
}, 1000).unref();

/* ---------------- xử lý thông điệp ---------------- */
function handle(conn, m) {
  if (m.t === 'ping') return send(conn, { t: 'pong', c: m.c, s: now() });
  if (m.t === 'hello') return hello(conn, m);
  const p = conn.player;
  if (!p) return;
  switch (m.t) {
    case 'set_profile': {
      p.name = Protocol.cleanName(m.name) || p.name; p.char = m.char; p.look = Protocol.cleanLook(m.look);
      if (p.room && !p.room.inMatch) pushRoomState(p.room);
      break;
    }
    case 'leaderboard': sendP(p, { t: 'leaderboard', top: lbTop() }); break;
    case 'queue_join': {
      if (p.room) leaveRoom(p);
      dequeue(p);
      queues[m.mode].push({ pid: p.pid, t: Date.now() });
      broadcastQueue(m.mode);
      break;
    }
    case 'queue_leave': if (dequeue(p)) sendP(p, { t: 'queue_status', waiting: false }); break;
    case 'room_create': {
      dequeue(p);
      const room = createRoom(p, m.mode, { venue: m.settings.venue, target: m.settings.target, scoring: m.settings.scoring }, false);
      pushRoomState(room);
      break;
    }
    case 'room_join': {
      const room = rooms.get(String(m.code).toUpperCase());
      if (!room) return err(p, 'room_not_found', 'Không tìm thấy phòng ' + m.code);
      if (p.room === room) return pushRoomState(room);
      if (room.inMatch) return err(p, 'room_busy', 'Phòng đang thi đấu. Nhập mã ở mục "Xem trực tiếp" để xem.');
      if (room.quick) return err(p, 'room_full', 'Đây là phòng ghép nhanh');
      if (!pickTeam(room)) return err(p, 'room_full', 'Phòng đã đầy');
      dequeue(p);
      if (p.room) leaveRoom(p, true);
      addMember(room, p);
      pushRoomState(room);
      sysChat(room, p.name + ' đã vào phòng');
      break;
    }
    case 'room_leave': leaveRoom(p); break;
    case 'room_update': {
      const room = p.room; if (!room || room.inMatch) return;
      const host = room.hostId === p.pid;
      if (m.settings && host && !room.quick) room.settings = { venue: m.settings.venue, target: m.settings.target, scoring: m.settings.scoring };
      if (m.fillBots !== undefined && host && !room.quick) room.fillBots = m.fillBots;
      if (m.botLevel !== undefined && host && !room.quick) room.botLevel = m.botLevel;
      if (m.team && room.mode === '2v2' && !room.quick) {
        const mem = member(room, p.pid);
        if (mem && mem.team !== m.team && room.members.filter((x) => x.team === m.team).length < 2) { mem.team = m.team; mem.ready = false; }
      }
      pushRoomState(room);
      break;
    }
    case 'room_ready': {
      const room = p.room; if (!room || room.inMatch) return;
      const mem = member(room, p.pid); if (mem) { mem.ready = m.ready; pushRoomState(room); }
      break;
    }
    case 'room_start': {
      const room = p.room;
      if (!room || room.inMatch || room.hostId !== p.pid || room.quick) return;
      const size = sizeOf(room);
      const nA = room.members.filter((x) => x.team === 'A').length, nB = room.members.filter((x) => x.team === 'B').length;
      if (size === 1 && (nA < 1 || nB < 1)) return err(p, 'need_players', 'Cần đủ 2 người chơi để bắt đầu 1v1');
      if (size === 2 && !room.fillBots && (nA < 2 || nB < 2)) return err(p, 'need_players', 'Cần đủ 4 người, hoặc bật "Bot thay chỗ trống"');
      if (room.members.some((x) => x.pid !== room.hostId && !x.ready)) return err(p, 'not_ready', 'Còn người chưa sẵn sàng');
      startMatch(room);
      break;
    }
    case 'chat': {
      const room = p.room || p.spec; if (!room) return;
      const text = Protocol.cleanChat(m.text); if (!text) return;
      broadcastRoom(room, { t: 'chat', name: p.name, text, sys: false });
      break;
    }
    case 'input': {
      const room = p.room, M = room && room.match; if (!M || !M.running) return;
      const mp = M.m.player(p.pid); if (!mp || m.rid !== M.m.rallyId) return;
      M.m.setPlayerState(p.pid, clamp(m.x, -C.BOUND_X, C.BOUND_X), clamp(m.z, -C.BOUND_BACK, C.BOUND_BACK), m.vx, m.vz);
      M.sw.set(p.pid, m.sw);
      break;
    }
    case 'swing': {
      const room = p.room, M = room && room.match; if (!M || !M.running) return;
      broadcastRoom(room, { t: 'swing', matchId: M.id, id: p.pid, contactT: m.contactT, x: m.x, y: m.y, z: m.z, zone: m.zone }, p.pid);
      break;
    }
    case 'hit': {
      const room = p.room, M = room && room.match; if (!M || !M.running) return;
      const res = M.m.tryHit(p.pid, m, now(), true);
      flush(room);
      if (!res.ok) sendP(p, { t: 'hit_rejected', matchId: M.id, reason: res.reason });
      break;
    }
    case 'rematch': {
      const room = p.room; if (!room || room.inMatch) return;
      room.rematch.add(p.pid);
      sysChat(room, p.name + ' muốn đấu lại');
      const need = humansOnline(room).map((x) => x.pid);
      if (need.length && need.every((id) => room.rematch.has(id))) startMatch(room);
      break;
    }
    case 'spectate': {
      const room = rooms.get(String(m.code).toUpperCase());
      if (!room) return err(p, 'room_not_found', 'Không tìm thấy phòng ' + m.code);
      if (!room.match || !room.match.running) return err(p, 'no_match', 'Phòng này chưa trong trận');
      dequeue(p);
      if (p.room) leaveRoom(p, true);
      if (p.spec) p.spec.spectators.delete(p.pid);
      room.spectators.add(p.pid); p.spec = room;
      sendP(p, matchStartMsg(room, p.pid));
      sendP(p, { t: 'sync', matchId: room.match.id, snapshot: room.match.m.snapshot() });
      break;
    }
    case 'spectate_leave': if (p.spec) { const r = p.spec; r.spectators.delete(p.pid); p.spec = null; destroyRoomIfEmpty(r); } break;
  }
}

function hello(conn, m) {
  if (m.version !== Protocol.PROTOCOL_VERSION) {
    return send(conn, { t: 'error', code: 'version', message: 'Phiên bản không khớp. Hãy tải lại trang.' });
  }
  const pid = crypto.createHash('sha1').update('pb:' + m.deviceId).digest('hex').slice(0, 10);
  let p = players.get(pid);
  if (!p) { p = { pid, name: '', char: m.char, look: {}, conn: null, room: null, spec: null }; players.set(pid, p); }
  if (p.conn && p.conn !== conn) { p.conn.player = null; p.conn.terminate(); }
  p.conn = conn; conn.player = p;
  p.name = Protocol.cleanName(m.name) || p.name || 'Người chơi';
  p.char = m.char; p.look = Protocol.cleanLook(m.look);
  send(conn, { t: 'welcome', playerId: pid, serverTime: now() });
  const room = p.room;
  if (room) {
    const lt = room.lobbyTimers.get(pid); if (lt) { clearTimeout(lt); room.lobbyTimers.delete(pid); }
    pushRoomState(room);
    const M = room.match;
    if (M && M.running) {
      const tm = M.timers.get(pid); if (tm) { clearTimeout(tm); M.timers.delete(pid); }
      send(conn, matchStartMsg(room, pid));
      send(conn, { t: 'sync', matchId: M.id, snapshot: M.m.snapshot() });
      broadcastRoom(room, { t: 'player_status', matchId: M.id, id: pid, connected: true, graceSec: 0 });
      resumeIfReady(room);
    }
  }
}

function onClose(conn) {
  const p = conn.player;
  if (!p || p.conn !== conn) return;
  p.conn = null;
  dequeue(p);
  if (p.spec) { const r = p.spec; r.spectators.delete(p.pid); p.spec = null; destroyRoomIfEmpty(r); }
  const room = p.room;
  if (!room) { setTimeout(() => { if (!p.conn && !p.room) players.delete(p.pid); }, 60000).unref(); return; }
  const M = room.match;
  if (M && M.running) {
    broadcastRoom(room, { t: 'player_status', matchId: M.id, id: p.pid, connected: false, graceSec: GRACE_MATCH });
    if (M.m.phase !== 'paused' && M.m.phase !== 'over' && M.m.phase !== 'idle') { M.m.pause(); flush(room); }
    M.timers.set(p.pid, setTimeout(() => {
      M.timers.delete(p.pid);
      if (!p.conn) leaveRoom(p, true);
    }, GRACE_MATCH * 1000));
    return;
  }
  pushRoomState(room);
  room.lobbyTimers.set(p.pid, setTimeout(() => { room.lobbyTimers.delete(p.pid); if (!p.conn) leaveRoom(p, true); }, GRACE_LOBBY * 1000));
}

function onConn(conn) {
  conn.player = null;
  conn.on('message', (s) => {
    let m; try { m = JSON.parse(s); } catch (e) { return; }
    if (!Protocol.validate(m)) return;
    try { handle(conn, m); } catch (e) { console.error('Lỗi xử lý', m && m.t, e); }
  });
  conn.on('close', () => onClose(conn));
}

function attach(server) {
  server.on('upgrade', (req, socket) => {
    if ((req.url || '').split('?')[0] !== '/ws') { socket.destroy(); return; }
    const conn = accept(req, socket);
    if (conn) onConn(conn);
  });
  setInterval(() => { for (const p of players.values()) if (p.conn) p.conn.ping(); }, 25000).unref();
}

module.exports = { attach, stats: () => ({ players: players.size, rooms: rooms.size }) };
