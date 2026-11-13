// WebSocket server tối giản (RFC 6455), không cần cài thư viện nào.
// Hỗ trợ: handshake, khung text, ping/pong, close, khung phân mảnh.
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 256 * 1024;

class WSConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.open = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }

  _closed() {
    if (!this.open) return;
    this.open = false;
    this.emit('close');
  }

  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_PAYLOAD || !masked) return this.terminate();
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 0x8) { this._write(0x8, Buffer.alloc(0)); return this.terminate(); }
      if (op === 0x9) { this._write(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        this.frags.push(payload);
        if (fin) {
          const msg = Buffer.concat(this.frags).toString('utf8');
          this.frags = [];
          this.emit('message', msg);
        }
      }
    }
  }

  _write(op, payload) {
    if (!this.open) return;
    const n = payload.length;
    let head;
    if (n < 126) head = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    try { this.socket.write(Buffer.concat([head, payload])); } catch (e) { /* bỏ qua */ }
  }

  send(str) { this._write(0x1, Buffer.from(str, 'utf8')); }
  ping() { this._write(0x9, Buffer.alloc(0)); }
  terminate() { try { this.socket.destroy(); } catch (e) { /* bỏ qua */ } this._closed(); }
}

/** Gọi trong sự kiện 'upgrade' của http.Server; trả về WSConn hoặc null */
function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const acc = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  return new WSConn(socket);
}

module.exports = { accept };
