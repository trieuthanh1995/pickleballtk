// Server riêng cho "Pickle Ball - Bạn nói thế rồi ok đi"
// Phát file game + chạy server online (WebSocket tại /ws). Không cần cài thêm thư viện.
// Chạy: node server.js  (mặc định cổng 3000)
const http = require('http');
const fs = require('fs');
const path = require('path');

const gameServer = require('./game-server');
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// Máy chủ ICE cho chat thoại. Mặc định chỉ có STUN công cộng. Muốn chắc chắn nối được mọi mạng (4G, wifi công ty),
// đặt biến môi trường TURN_URL (vd: turn:xyz.example.com:443?transport=tcp), TURN_USER, TURN_PASS
// hoặc ICE_SERVERS = chuỗi JSON của mảng iceServers (lấy từ Metered / Cloudflare / Twilio…).
function iceServers() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  try {
    if (process.env.ICE_SERVERS) { const j = JSON.parse(process.env.ICE_SERVERS); if (Array.isArray(j)) return list.concat(j); }
    if (process.env.TURN_URL) list.push({ urls: process.env.TURN_URL.split(',').map((x) => x.trim()).filter(Boolean), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
  } catch (e) { console.error('ICE_SERVERS không hợp lệ:', e.message); }
  return list;
}

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(Object.assign({ ok: true }, gameServer.stats()))); }
  if (url === '/ice') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); return res.end(JSON.stringify({ iceServers: iceServers() })); }
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(ROOT, url));
  // chỉ cho phép đọc index.html và thư mục assets
  const okPath = file === path.join(ROOT, 'index.html') || file.startsWith(path.join(ROOT, 'assets') + path.sep);
  if (!okPath) { res.writeHead(404); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : ext === '.mp3' ? 'public, max-age=86400' : 'public, max-age=3600',
      'Accept-Ranges': 'bytes',
    };
    // iPhone/Safari bắt buộc server hỗ trợ "Range" thì mới phát được nhạc
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? parseInt(m[1], 10) : Math.max(0, st.size - parseInt(m[2], 10));
      let end = m[1] && m[2] ? parseInt(m[2], 10) : st.size - 1;
      if (end >= st.size) end = st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
      res.writeHead(206, Object.assign(headers, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size, 'Content-Length': end - start + 1 }));
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
    fs.createReadStream(file).pipe(res);
  });
});
gameServer.attach(server);
server.listen(PORT, () => console.log('Game đang chạy tại http://localhost:' + PORT));
