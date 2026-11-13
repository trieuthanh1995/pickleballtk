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
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(Object.assign({ ok: true }, gameServer.stats()))); }
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(ROOT, url));
  // chỉ cho phép đọc index.html và thư mục assets
  const okPath = file === path.join(ROOT, 'index.html') || file.startsWith(path.join(ROOT, 'assets') + path.sep);
  if (!okPath) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
});
gameServer.attach(server);
server.listen(PORT, () => console.log('Game đang chạy tại http://localhost:' + PORT));
