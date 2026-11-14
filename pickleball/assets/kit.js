/* Tủ đồ VIP – nhận ảnh KIT (áo / quần / vợt) từ máy người chơi, lưu trong trình duyệt và dán lên nhân vật.
 * Ảnh chỉ nằm trên máy này (localStorage), không gửi lên server. Phạm vi: 'all' (mọi nhân vật) hoặc id nhân vật. */
(function (PP) {
  'use strict';
  const SLOTS = ['shirt', 'shorts', 'paddle'];
  const PFX = 'pp-kit:';
  const MAX_DIM = 512, MAX_FILE = 12 * 1024 * 1024;
  const store = {};            // 'scope:slot' -> { url, canvas, avg, key }
  const listeners = [];
  let uid = 0;

  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { localStorage.setItem(k, v); },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* bỏ qua */ } },
    keys() { const r = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(PFX) === 0) r.push(k); } } catch (e) { /* bỏ qua */ } return r; },
  };
  const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { /* bỏ qua */ } });

  function averageColor(cv) {
    const s = document.createElement('canvas'); s.width = s.height = 8;
    const g = s.getContext('2d'); g.drawImage(cv, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 40) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
    if (!n) return '#cccccc';
    const h = (v) => ('0' + Math.round(v / n).toString(16)).slice(-2);
    return '#' + h(r) + h(gg) + h(b);
  }
  function hasAlpha(cv) {
    try {
      const g = cv.getContext('2d'), d = g.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    } catch (e) { /* bỏ qua */ }
    return false;
  }
  function entryFrom(url, cv) { return { url, canvas: cv, avg: averageColor(cv), key: 'k' + (++uid) }; }
  function loadImage(url) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Không đọc được ảnh')); im.src = url; });
  }
  function toCanvas(im) {
    const sc = Math.min(1, MAX_DIM / Math.max(im.naturalWidth || im.width, im.naturalHeight || im.height));
    const w = Math.max(1, Math.round((im.naturalWidth || im.width) * sc)), h = Math.max(1, Math.round((im.naturalHeight || im.height) * sc));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(im, 0, 0, w, h);
    return cv;
  }

  /** Nạp lại mọi kit đã lưu (gọi một lần lúc mở game) */
  function init() {
    const jobs = ls.keys().map((k) => {
      const url = ls.get(k); const id = k.slice(PFX.length);
      if (!url) return Promise.resolve();
      return loadImage(url).then((im) => { store[id] = entryFrom(url, toCanvas(im)); }).catch(() => { ls.del(k); });
    });
    return Promise.all(jobs).then(emit);
  }
  const get = (charId, slot) => store[charId + ':' + slot] || store['all:' + slot] || null;
  const own = (scope, slot) => store[scope + ':' + slot] || null;
  const has = (charId) => SLOTS.some((s) => !!get(charId, s));
  /** Gói kit dùng để dựng nhân vật: { shirt, shorts, paddle } (mỗi mục có thể null) */
  const resolve = (charId) => ({ shirt: get(charId, 'shirt'), shorts: get(charId, 'shorts'), paddle: get(charId, 'paddle') });

  function add(file, scope, slot) {
    if (SLOTS.indexOf(slot) < 0) return Promise.reject(new Error('Mục không hợp lệ'));
    if (!file || !/^image\//.test(file.type || '')) return Promise.reject(new Error('Hãy chọn một file ảnh (PNG, JPG, WEBP)'));
    if (file.size > MAX_FILE) return Promise.reject(new Error('Ảnh quá lớn (tối đa 12 MB)'));
    const src = URL.createObjectURL(file);
    return loadImage(src).then((im) => {
      URL.revokeObjectURL(src);
      const cv = toCanvas(im);
      const url = hasAlpha(cv) ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.88);
      try { ls.set(PFX + scope + ':' + slot, url); }
      catch (e) { throw new Error('Bộ nhớ trình duyệt đã đầy. Hãy xóa bớt kit cũ rồi thử lại'); }
      store[scope + ':' + slot] = entryFrom(url, cv);
      emit();
      return store[scope + ':' + slot];
    }, (e) => { URL.revokeObjectURL(src); throw e; });
  }
  function clear(scope, slot) {
    const slots = slot ? [slot] : SLOTS;
    slots.forEach((s) => { delete store[scope + ':' + s]; ls.del(PFX + scope + ':' + s); });
    emit();
  }

  /** Ảnh mẫu để người chơi vẽ/biên tập kit theo đúng khung dán lên nhân vật */
  function template(slot) {
    const W = slot === 'paddle' ? 320 : 1024, H = slot === 'paddle' ? 460 : slot === 'shorts' ? 256 : 512;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    g.fillStyle = '#f4f6fb'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c9d2e6'; g.lineWidth = 1;
    for (let x = 0; x <= W; x += W / 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += H / 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.textAlign = 'center'; g.fillStyle = '#3a4a7a'; g.font = 'bold ' + Math.round(H / 14) + 'px Arial, sans-serif';
    if (slot === 'paddle') {
      g.strokeStyle = '#ff6f91'; g.lineWidth = 4; g.beginPath(); g.ellipse(W / 2, H / 2, W * 0.46, H * 0.46, 0, 0, Math.PI * 2); g.stroke();
      g.fillText('MẶT VỢT – vẽ hình vào đây', W / 2, H / 2);
    } else {
      g.fillStyle = 'rgba(255,111,145,0.18)'; g.fillRect(W * 0.25, 0, W * 0.5, H);
      g.fillStyle = '#3a4a7a';
      g.fillText('MẶT TRƯỚC (ở giữa ảnh)', W / 2, H / 2);
      g.fillText('MẶT SAU', W * 0.1, H / 2); g.fillText('MẶT SAU', W * 0.9, H / 2);
      g.strokeStyle = '#ff6f91'; g.lineWidth = 3; g.setLineDash([10, 8]);
      g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
    }
    return cv;
  }

  PP.Kit = { SLOTS, init, get, own, has, resolve, add, clear, template, onChange(f) { listeners.push(f); } };
})(window.PP);
