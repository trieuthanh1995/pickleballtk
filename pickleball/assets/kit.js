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

  /* ================= Thông số ảnh ================= */
  // out: kích thước ảnh LƯU lại (đúng độ phân giải dùng trong game); rec: cỡ nên chuẩn bị (gấp đôi, để phóng to/cắt vẫn nét);
  // min: cỡ nhỏ nhất vẫn nét; ratio: tỉ lệ rộng : cao. Texture trong game: áo 512×256, quần/váy 256×64 (lưu 512×128), mặt vợt 160×230 (lưu 350×504).
  const SPECS = {
    shirt:  { out: [512, 256],  rec: [1024, 512],  min: [512, 256], ratio: '2 : 1',  wrap: true },
    shorts: { out: [512, 128],  rec: [1024, 256],  min: [512, 128], ratio: '4 : 1',  wrap: true },
    paddle: { out: [350, 504],  rec: [700, 1008],  min: [350, 504], ratio: '25 : 36', wrap: false },
  };
  const FILE_HINT = 'PNG / JPG / WEBP, tối đa 12 MB';
  const specLine = (slot) => {
    const s = SPECS[slot]; if (!s) return '';
    return '📐 Nên dùng ' + s.rec[0] + ' × ' + s.rec[1] + ' px (tỉ lệ ' + s.ratio + ') · tối thiểu ' + s.min[0] + ' × ' + s.min[1] + ' px · ' + FILE_HINT;
  };

  /** Lưu thẳng một canvas đã chỉnh (kết quả của trình chỉnh ảnh) */
  function addCanvas(cv, scope, slot) {
    if (SLOTS.indexOf(slot) < 0) return Promise.reject(new Error('Mục không hợp lệ'));
    const url = hasAlpha(cv) ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.9);
    try { ls.set(PFX + scope + ':' + slot, url); }
    catch (e) { return Promise.reject(new Error('Bộ nhớ trình duyệt đã đầy. Hãy xóa bớt kit cũ rồi thử lại')); }
    store[scope + ':' + slot] = entryFrom(url, cv);
    emit();
    return Promise.resolve(store[scope + ':' + slot]);
  }

  /** Ảnh mẫu: đúng kích thước khuyên dùng, có ghi rõ thông số và các vùng trên ảnh */
  function template(slot, labels) {
    const sp = SPECS[slot] || SPECS.shirt;
    labels = labels || {};
    const W = sp.rec[0], H = sp.rec[1];
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const u = H / (slot === 'paddle' ? 36 : 16);              // đơn vị chữ
    g.fillStyle = '#f4f6fb'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#c9d2e6'; g.lineWidth = 1;
    const cols = slot === 'paddle' ? 10 : 16, rows = slot === 'paddle' ? 14 : slot === 'shorts' ? 4 : 8;
    for (let i = 0; i <= cols; i++) { const x = Math.round(W * i / cols) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let i = 0; i <= rows; i++) { const y = Math.round(H * i / rows) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (slot === 'paddle') {
      const r = W * 0.1;
      g.fillStyle = 'rgba(255,111,145,0.10)';
      g.beginPath(); g.moveTo(r, 0); g.lineTo(W - r, 0); g.quadraticCurveTo(W, 0, W, r); g.lineTo(W, H - r); g.quadraticCurveTo(W, H, W - r, H);
      g.lineTo(r, H); g.quadraticCurveTo(0, H, 0, H - r); g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0); g.closePath(); g.fill();
      g.strokeStyle = '#ff6f91'; g.lineWidth = Math.max(3, W / 150); g.stroke();
      g.fillStyle = '#3a4a7a'; g.font = 'bold ' + Math.round(u * 1.3) + 'px Arial, sans-serif';
      g.fillText('MẶT VỢT', W / 2, H * 0.40);
      g.font = 'bold ' + Math.round(u * 1.9) + 'px Arial, sans-serif';
      g.fillText(W + ' × ' + H + ' px', W / 2, H * 0.50);
      g.font = Math.round(u * 1.1) + 'px Arial, sans-serif';
      g.fillText('tỉ lệ ' + sp.ratio + ' · vẽ hình vào đây', W / 2, H * 0.57);
      g.fillText('Góc bo tròn sẽ bị cắt nhẹ — chừa lề ~8%', W / 2, H * 0.63);
      return cv;
    }
    // áo / quần / váy: giữa ảnh = mặt trước, hai mép = mặt sau
    g.fillStyle = 'rgba(255,111,145,0.16)'; g.fillRect(W * 0.25, 0, W * 0.5, H);
    g.fillStyle = 'rgba(80,110,200,0.10)'; g.fillRect(0, 0, W * 0.25, H); g.fillRect(W * 0.75, 0, W * 0.25, H);
    g.strokeStyle = '#ff6f91'; g.lineWidth = Math.max(2, H / 170); g.setLineDash([H / 40, H / 52]);
    g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#3a4a7a'; g.font = 'bold ' + Math.round(u * (slot === 'shirt' ? 1.0 : 1.6)) + 'px Arial, sans-serif';
    g.fillText('MẶT TRƯỚC (giữa ảnh)', W / 2, H * 0.30);
    g.fillText('MẶT SAU', W * 0.125, H * 0.30); g.fillText('MẶT SAU', W * 0.875, H * 0.30);
    g.font = 'bold ' + Math.round(u * (slot === 'shirt' ? 2.0 : 3.4)) + 'px Arial, sans-serif';
    g.fillText(W + ' × ' + H + ' px', W / 2, H * 0.55);
    g.font = Math.round(u * (slot === 'shirt' ? 1.0 : 1.7)) + 'px Arial, sans-serif';
    g.fillText('tỉ lệ ' + sp.ratio + ' · hai mép trái–phải nối nhau ở giữa lưng', W / 2, H * 0.72);
    g.fillStyle = '#7a86aa'; g.font = 'bold ' + Math.round(u * (slot === 'shirt' ? 0.9 : 1.5)) + 'px Arial, sans-serif';
    g.fillText('▲ ' + (labels.top || (slot === 'shirt' ? 'CỔ ÁO' : 'LƯNG QUẦN')), W / 2, H * 0.07);
    g.fillText('▼ ' + (labels.bottom || (slot === 'shirt' ? 'GẤU ÁO' : 'GẤU QUẦN')), W / 2, H * 0.93);
    g.strokeStyle = '#3a4a7a'; g.lineWidth = Math.max(2, H / 200); g.strokeRect(1, 1, W - 2, H - 2);
    return cv;
  }

  /* ================= Trình chỉnh ảnh: kéo, phóng to / thu nhỏ trước khi dùng ================= */
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  function sourceToCanvas(src) {
    if (src instanceof HTMLCanvasElement) return Promise.resolve(src);
    if (src instanceof HTMLImageElement) return Promise.resolve(src);
    if (!src || !/^image\//.test(src.type || '')) return Promise.reject(new Error('Hãy chọn một file ảnh (PNG, JPG, WEBP)'));
    if (src.size > MAX_FILE) return Promise.reject(new Error('Ảnh quá lớn (tối đa 12 MB)'));
    const u = URL.createObjectURL(src);
    return loadImage(u).then((im) => {
      URL.revokeObjectURL(u);
      const m = Math.max(im.naturalWidth || im.width, im.naturalHeight || im.height);
      if (m <= 2048) { const cv = document.createElement('canvas'); cv.width = im.naturalWidth || im.width; cv.height = im.naturalHeight || im.height; cv.getContext('2d').drawImage(im, 0, 0); return cv; }
      const sc = 2048 / m, cv = document.createElement('canvas');
      cv.width = Math.round((im.naturalWidth || im.width) * sc); cv.height = Math.round((im.naturalHeight || im.height) * sc);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      return cv;
    }, (e) => { URL.revokeObjectURL(u); throw e; });
  }

  /**
   * Mở trình chỉnh ảnh. src: File | canvas | img. slot: 'shirt' | 'shorts' | 'paddle'.
   * opts = { title, labels:{top,bottom} }  → Promise<canvas | null> (null = hủy)
   */
  function edit(src, slot, opts) {
    opts = opts || {};
    const sp = SPECS[slot] || SPECS.shirt;
    return sourceToCanvas(src).then((img) => new Promise((resolve) => {
      const OW = sp.out[0], OH = sp.out[1];
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const st = { s: 1, cx: OW / 2, cy: OH / 2, flip: false, bg: 'none', guides: true };
      const contain = Math.min(OW / iw, OH / ih), cover = Math.max(OW / iw, OH / ih);
      const SMIN = Math.min(contain, cover) * 0.3, SMAX = Math.max(cover * 6, contain * 6);

      const ov = el('div', 'kit-ed');
      const card = el('div', 'kit-ed-card');
      card.append(el('h3', 'kit-ed-title', '✂ Chỉnh ảnh — ' + (opts.title || 'Kit')));
      card.append(el('p', 'kit-ed-spec', specLine(slot) + '. Ảnh gốc của bạn: ' + iw + ' × ' + ih + ' px.'));
      const stageWrap = el('div', 'kit-ed-stage');
      const cv = el('canvas'); cv.width = OW; cv.height = OH;
      stageWrap.append(cv); card.append(stageWrap);
      const hint = el('p', 'kit-ed-hint', slot === 'paddle'
        ? 'Kéo để di chuyển · cuộn chuột / kéo thanh trượt / chụm hai ngón để phóng to – thu nhỏ. Phần ngoài viền hồng sẽ bị cắt bỏ.'
        : 'Kéo để di chuyển · cuộn chuột / kéo thanh trượt / chụm hai ngón để phóng to – thu nhỏ. Giữa khung là mặt trước, hai mép là mặt sau.');
      card.append(hint);
      const q = el('div', 'kit-ed-q'); card.append(q);

      const zrow = el('div', 'kit-ed-row');
      const bMinus = el('button', 'btn tiny ghost', '−'), bPlus = el('button', 'btn tiny ghost', '+');
      const range = el('input'); range.type = 'range'; range.min = '0'; range.max = '1000'; range.step = '1';
      const pct = el('span', 'kit-ed-pct');
      zrow.append(el('span', 'kit-ed-lbl', '🔍 Thu phóng'), bMinus, range, bPlus, pct);
      card.append(zrow);

      const brow = el('div', 'kit-ed-row');
      const bContain = el('button', 'btn tiny', '⤢ Vừa khung'), bCover = el('button', 'btn tiny', '⛶ Phủ kín'),
        bReset = el('button', 'btn tiny ghost', '↺ Đặt lại'), bFlip = el('button', 'btn tiny ghost', '⇋ Lật ngang');
      brow.append(bContain, bCover, bFlip, bReset);
      card.append(brow);

      const grow = el('div', 'kit-ed-row');
      grow.append(el('span', 'kit-ed-lbl', '🎨 Nền chỗ trống'));
      const bgBtns = [['none', 'Trong suốt'], ['#ffffff', 'Trắng'], ['#000000', 'Đen']].map(([v, t]) => { const b = el('button', 'btn tiny ghost', t); b.dataset.v = v; return b; });
      const bgPick = el('input'); bgPick.type = 'color'; bgPick.value = '#ff6f91'; bgPick.title = 'Màu tự chọn';
      bgBtns.forEach((b) => grow.append(b)); grow.append(bgPick);
      const gl = el('label', 'kit-ed-chk'); const gc = el('input'); gc.type = 'checkbox'; gc.checked = true; gl.append(gc, document.createTextNode(' Hiện đường gợi ý'));
      grow.append(gl);
      card.append(grow);

      const act = el('div', 'kit-ed-row kit-ed-act');
      const bCancel = el('button', 'btn ghost', 'Hủy'), bOk = el('button', 'btn big primary', '✔ Dùng ảnh này');
      act.append(bCancel, bOk); card.append(act);
      ov.append(card); document.body.append(ov);

      const g = cv.getContext('2d');
      const clampPos = () => {
        // giữ lại ít nhất một phần ảnh trong khung
        const hw = iw * st.s / 2, hh = ih * st.s / 2, m = 24;
        st.cx = Math.max(m - hw, Math.min(OW - m + hw, st.cx));
        st.cy = Math.max(m - hh, Math.min(OH - m + hh, st.cy));
      };
      function paint(c, withGuides) {
        const x = c.getContext('2d');
        x.clearRect(0, 0, OW, OH);
        if (withGuides) {
          const t = 16; x.fillStyle = '#e9edf6'; x.fillRect(0, 0, OW, OH); x.fillStyle = '#fff';
          for (let yy = 0; yy < OH; yy += t) for (let xx = (yy / t) % 2 ? 0 : t; xx < OW; xx += t * 2) x.fillRect(xx, yy, t, t);
        }
        if (st.bg !== 'none') { x.fillStyle = st.bg; x.fillRect(0, 0, OW, OH); }
        x.save(); x.translate(st.cx, st.cy); x.scale(st.flip ? -st.s : st.s, st.s);
        x.imageSmoothingQuality = 'high';
        x.drawImage(img, -iw / 2, -ih / 2); x.restore();
        if (!withGuides) return;
        if (slot === 'paddle') {
          const r = OW * 0.1;
          x.save(); x.beginPath(); x.rect(0, 0, OW, OH);
          x.moveTo(r, 0); x.quadraticCurveTo(0, 0, 0, r); x.lineTo(0, OH - r); x.quadraticCurveTo(0, OH, r, OH); x.lineTo(OW - r, OH); x.quadraticCurveTo(OW, OH, OW, OH - r);
          x.lineTo(OW, r); x.quadraticCurveTo(OW, 0, OW - r, 0); x.closePath();
          x.fillStyle = 'rgba(20,24,50,0.45)'; x.fill('evenodd'); x.restore();
        }
        if (!st.guides) return;
        x.lineWidth = 2; x.strokeStyle = '#ff6f91'; x.fillStyle = '#ff6f91';
        x.font = 'bold ' + Math.round(OH / 20) + 'px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.strokeRect(1, 1, OW - 2, OH - 2);
        if (sp.wrap) {
          x.setLineDash([8, 6]); x.beginPath(); x.moveTo(OW / 2, 0); x.lineTo(OW / 2, OH); x.stroke(); x.setLineDash([]);
          x.save(); x.fillStyle = 'rgba(255,111,145,0.10)'; x.fillRect(OW * 0.25, 0, OW * 0.5, OH); x.restore();
          x.shadowColor = 'rgba(0,0,0,0.6)'; x.shadowBlur = 4;
          x.fillStyle = '#fff';
          x.fillText('MẶT TRƯỚC', OW / 2, OH * 0.5); x.fillText('SAU', OW * 0.125, OH * 0.5); x.fillText('SAU', OW * 0.875, OH * 0.5);
          x.fillText('▲ ' + (opts.labels && opts.labels.top || (slot === 'shirt' ? 'CỔ ÁO' : 'LƯNG QUẦN')), OW / 2, OH * 0.09);
          x.fillText('▼ ' + (opts.labels && opts.labels.bottom || (slot === 'shirt' ? 'GẤU ÁO' : 'GẤU QUẦN')), OW / 2, OH * 0.92);
        }
      }
      function quality() {
        const k = st.s;                                   // px đầu ra trên mỗi px ảnh gốc
        const eff = Math.round(Math.min(iw, OW / Math.max(k, 1e-6)));
        let msg, cls;
        if (k <= 1.0) { msg = '✅ Độ nét tốt (ảnh gốc ≥ khung)'; cls = 'ok'; }
        else if (k <= 1.6) { msg = '⚠️ Hơi mờ: ảnh gốc nhỏ hơn khung. Nên tìm ảnh lớn hơn hoặc thu nhỏ lại.'; cls = 'warn'; }
        else { msg = '❗ Ảnh bị phóng quá mức, sẽ bị mờ / vỡ hạt.'; cls = 'bad'; }
        q.className = 'kit-ed-q ' + cls; q.textContent = msg + ' (đang hiển thị ảnh ở ' + Math.round(k * 100) + '% kích thước gốc)';
      }
      function sync() {
        clampPos(); paint(cv, true);
        const t = Math.log(st.s / SMIN) / Math.log(SMAX / SMIN);
        range.value = String(Math.round(Math.max(0, Math.min(1, t)) * 1000));
        pct.textContent = Math.round(st.s / contain * 100) + '%';
        bgBtns.forEach((b) => b.classList.toggle('sel', b.dataset.v === st.bg));
        quality();
      }
      const setScale = (s, ax, ay) => {            // phóng quanh điểm (ax, ay) trong hệ đầu ra
        s = Math.max(SMIN, Math.min(SMAX, s));
        if (ax == null) { ax = OW / 2; ay = OH / 2; }
        const k = s / st.s; st.cx = ax + (st.cx - ax) * k; st.cy = ay + (st.cy - ay) * k; st.s = s; sync();
      };
      const fit = (mode) => { st.s = mode === 'cover' ? cover : contain; st.cx = OW / 2; st.cy = OH / 2; sync(); };

      range.oninput = () => setScale(SMIN * Math.pow(SMAX / SMIN, (+range.value) / 1000));
      bMinus.onclick = () => setScale(st.s / 1.1); bPlus.onclick = () => setScale(st.s * 1.1);
      bContain.onclick = () => fit('contain'); bCover.onclick = () => fit('cover');
      bReset.onclick = () => { st.flip = false; st.bg = 'none'; fit('contain'); };
      bFlip.onclick = () => { st.flip = !st.flip; sync(); };
      bgBtns.forEach((b) => { b.onclick = () => { st.bg = b.dataset.v; sync(); }; });
      bgPick.oninput = () => { st.bg = bgPick.value; sync(); };
      gc.onchange = () => { st.guides = gc.checked; sync(); };

      // kéo / chụm (pointer events: chuột + cảm ứng)
      const ptrs = new Map(); let pinch = null;
      const toOut = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * OW / r.width, y: (e.clientY - r.top) * OH / r.height }; };
      cv.style.touchAction = 'none';
      cv.onpointerdown = (e) => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, toOut(e)); pinch = null; };
      cv.onpointermove = (e) => {
        if (!ptrs.has(e.pointerId)) return;
        const prev = ptrs.get(e.pointerId), cur = toOut(e); ptrs.set(e.pointerId, cur);
        if (ptrs.size === 1) { st.cx += cur.x - prev.x; st.cy += cur.y - prev.y; sync(); }
        else if (ptrs.size >= 2) {
          const [a, b] = Array.from(ptrs.values());
          const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (pinch) { st.cx += mx - pinch.mx; st.cy += my - pinch.my; setScale(st.s * d / (pinch.d || d), mx, my); }
          pinch = { d, mx, my };
        }
      };
      const up = (e) => { ptrs.delete(e.pointerId); pinch = null; };
      cv.onpointerup = up; cv.onpointercancel = up;
      cv.onwheel = (e) => { e.preventDefault(); const o = toOut(e); setScale(st.s * Math.exp(-e.deltaY * 0.0015), o.x, o.y); };

      const finish = (out) => { window.removeEventListener('keydown', onKey, true); ov.remove(); resolve(out); };
      const onKey = (e) => { if (e.code === 'Escape') { e.stopPropagation(); finish(null); } };
      window.addEventListener('keydown', onKey, true);
      bCancel.onclick = () => finish(null);
      bOk.onclick = () => { const out = document.createElement('canvas'); out.width = OW; out.height = OH; paint(out, false); finish(out); };

      fit(slot === 'paddle' ? 'cover' : 'contain');
    }));
  }

  PP.Kit = { SLOTS, SPECS, specLine, init, get, own, has, resolve, add, addCanvas, clear, template, edit, onChange(f) { listeners.push(f); } };
})(window.PP);
