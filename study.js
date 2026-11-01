/* 听课本 — 学习工具：手写画板、重点/记忆卡片/测验、思维导图、问 AI、录音总结、课件翻译、截止日期。
   依赖 app.js 里的 $, $$, esc, md, toast, modal, fmtTime, fmtDate, State, DB, AI, Settings。 */

/* ---------- PDF 渲染（左栏课件、画板背景共用） ---------- */
const Pdf = (() => {
  const docs = new Map();
  async function doc(fileId) {
    if (!docs.has(fileId)) {
      docs.set(fileId, (async () => {
        const f = await DB.get('files', fileId);
        let blob = await DB.getBlob(fileId);
        if (!blob && f) { await Sync.ensureBlob(f); blob = await DB.getBlob(fileId); }
        if (!blob) throw new Error(f && f.hasBlob ? '课件还在云端，连上网再打开' : '找不到这个课件的原文件');
        return pdfjsLib.getDocument({ data: await blob.arrayBuffer() }).promise;
      })());
    }
    try { return await docs.get(fileId); } catch (e) { docs.delete(fileId); throw e; }
  }
  const cache = new Map(); // `${fileId}:${page}:${w}` -> canvas
  async function render(fileId, pageNum, widthPx) {
    const key = `${fileId}:${pageNum}:${widthPx}`;
    if (cache.has(key)) return cache.get(key);
    const p = (async () => {
      const d = await doc(fileId);
      const page = await d.getPage(pageNum);
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: widthPx / vp0.width });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      return c;
    })();
    cache.set(key, p);
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    try { return await p; } catch (e) { cache.delete(key); throw e; }
  }
  async function aspect(fileId, pageNum) {
    const d = await doc(fileId); const page = await d.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 }); return vp.height / vp.width;
  }
  async function count(fileId) { return (await doc(fileId)).numPages; }
  return { doc, render, aspect, count };
})();
const isPdf = f => f && /\.pdf$/i.test(f.name);

/* 把带 [第N页] 标记的文字拆成页 */
function splitPages(text) {
  const out = []; const re = /\[第(\d+)页\]\n?/g; let m, last = null;
  while ((m = re.exec(text || ''))) { if (last) out.push({ n: last.n, text: text.slice(last.end, m.index).trim() }); last = { n: Number(m[1]), end: re.lastIndex }; }
  if (last) out.push({ n: last.n, text: text.slice(last.end).trim() });
  if (!out.length && text) out.push({ n: 1, text: text.trim() });
  return out;
}

/* ======================================================================
   进度条：所有 AI 生成任务都登记在这里，页面里和左下角都能看到进度
   ====================================================================== */
const Jobs = (() => {
  const map = new Map(); let tray = null, timer = null;
  function start(id, label) {
    const j = { id, label, t0: Date.now(), lo: 0, hi: .05, len: 0, pt0: Date.now(), expectLen: 0, expectSec: 4, phaseLabel: '正在连接…', sub: '' };
    map.set(id, j); loop();
    const api = {
      phase(label, lo, hi, { expectLen = 0, expectSec = 10 } = {}) { j.lo = Math.max(cur(j), lo); j.hi = hi; j.phaseLabel = label; j.expectLen = expectLen; j.expectSec = expectSec; j.len = 0; j.pt0 = Date.now(); return api; },
      len(n) { j.len = n; return api; },
      sub(t) { j.sub = t; return api; },
      done() { map.delete(id); paint(); return api; },
      get: () => j,
    };
    return api;
  }
  function cur(j) {
    const f = j.expectLen ? 1 - Math.exp(-j.len / j.expectLen * 1.6) : 1 - Math.exp(-(Date.now() - j.pt0) / 1000 / j.expectSec * 1.3);
    return Math.min(.99, j.lo + (j.hi - j.lo) * Math.max(0, f));
  }
  const secs = j => Math.round((Date.now() - j.t0) / 1000);
  function html(id, compact) {
    const j = map.get(id); if (!j) return '';
    const p = Math.round(cur(j) * 100);
    return `<div class="prog${compact ? ' compact' : ''}" data-job="${esc(id)}"><div class="prog-top"><span class="spin"></span><b>${esc(compact ? j.label : j.phaseLabel)}</b><span class="grow"></span><span class="prog-n">${p}% · ${secs(j)} 秒</span></div><div class="prog-bar"><i style="width:${p}%"></i></div>${!compact && j.sub ? `<div class="hint">${esc(j.sub)}</div>` : compact ? `<div class="hint">${esc(j.phaseLabel)}</div>` : ''}</div>`;
  }
  /* 页面里的进度块：el 里放一个 [data-job-slot="id"]，这里会自动刷新 */
  function paint() {
    $$('[data-job-slot]').forEach(el => { const id = el.dataset.jobSlot; el.innerHTML = map.has(id) ? html(id) : ''; });
    // 左下角任务托盘：当前页面没显示的任务放这里
    const shown = new Set($$('[data-job-slot]').map(el => el.dataset.jobSlot));
    const rest = [...map.keys()].filter(id => !shown.has(id));
    if (!tray) { tray = document.createElement('div'); tray.className = 'job-tray'; document.body.appendChild(tray); }
    tray.hidden = !rest.length;
    tray.innerHTML = rest.map(id => html(id, true)).join('');
  }
  function loop() { if (timer) return; timer = setInterval(() => { paint(); if (!map.size) { clearInterval(timer); timer = null; } }, 400); paint(); }
  const slot = id => `<div data-job-slot="${esc(id)}">${html(id)}</div>`;
  return { start, slot, has: id => map.has(id), get: id => map.get(id), paint };
})();

/* ======================================================================
   手写画板：Apple Pencil 写字，手指只滚动；笔落下时手掌碰屏不算
   ====================================================================== */
const Board = (() => {
  const W = 1000; // 逻辑宽度，所有坐标按这个存
  const INK = ['#1B2233', '#2C47A5', '#C0392B', '#2B7A4B'];
  const pref = () => { try { return JSON.parse(localStorage.getItem('tingkeben.board') || '{}'); } catch (e) { return {}; } };
  const savePref = p => { try { localStorage.setItem('tingkeben.board', JSON.stringify(Object.assign(pref(), p))); } catch (e) {} };

  /* ---------- 笔迹渲染 ----------
     原来的写法是「一段一点，每段单独 stroke」，线宽还跟着压力逐段跳。
     屏幕上的点只隔 1–3 像素，圆头端点互相叠在一起，边缘就是一串小鼓包 ——
     拿 Apple Pencil 写字时看到的「毛刺」其实是这个，不是采样率不够。

     现在改成：
       1. 先对点做一次低通平滑（手按得稳的地方磨平，快速划过的地方跟得紧，不会把大字磨圆）；
       2. 用「经过各点的二次贝塞尔」串成一条连续曲线，而不是一根根直线；
       3. 线宽按 12 个点一小段取平均（变化很缓），首尾略收细，看起来像笔锋。
     连续曲线的边缘是光滑的，这才是字迹清楚的关键。 */
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  function smoothPts(raw) {
    const n = raw.length;
    if (n < 3) return raw;
    const out = new Array(n);
    out[0] = raw[0];
    let sx = raw[0][0], sy = raw[0][1], sp = raw[0][2] == null ? .5 : raw[0][2];
    for (let i = 1; i < n; i++) {
      const p = raw[i];
      const d = Math.hypot(p[0] - sx, p[1] - sy);
      const a = Math.min(.9, .3 + d / 16);
      sx += (p[0] - sx) * a; sy += (p[1] - sy) * a;
      sp += ((p[2] == null ? .5 : p[2]) - sp) * .25;
      out[i] = [sx, sy, sp];
    }
    return out;
  }
  /* 把 pts[i0..i1] 画成一条平滑的路径：每段以相邻两点的中点为终点，原点是控制点 */
  function pathRange(ctx, pts, scale, i0, i1) {
    ctx.beginPath();
    if (i0 === 0) ctx.moveTo(pts[0][0] * scale, pts[0][1] * scale);
    else { const m = mid(pts[i0 - 1], pts[i0]); ctx.moveTo(m[0] * scale, m[1] * scale); }
    for (let i = i0; i < i1; i++) {
      const m = mid(pts[i], pts[i + 1]);
      ctx.quadraticCurveTo(pts[i][0] * scale, pts[i][1] * scale, m[0] * scale, m[1] * scale);
    }
    if (i1 === pts.length - 1) ctx.lineTo(pts[i1][0] * scale, pts[i1][1] * scale);
  }
  function drawStroke(ctx, s, scale, ocr, bold = 1) {
    const raw = s.pts; if (!raw || !raw.length) return;
    const pts = smoothPts(raw);
    const hl = s.tool === 'hl';
    // bold：交给 AI 识别时把笔迹加粗一点，细笔写完的整页放大后不至于断成虚线
    const base = hl ? (s.w || 18) : (s.w || 3) * bold;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = s.c; ctx.fillStyle = s.c;
    if (hl) ctx.globalAlpha = ocr ? .82 : .3;

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0] * scale, pts[0][1] * scale, Math.max(.55, base * scale * .5), 0, Math.PI * 2);
      ctx.fill(); ctx.restore(); return;
    }
    if (hl) {
      // 交给 AI 识别时荧光笔要画实一点，不然只剩一层几乎看不见的淡黄
      ctx.lineWidth = Math.max(1, base * scale);
      pathRange(ctx, pts, scale, 0, pts.length - 1);
      ctx.stroke(); ctx.restore(); return;
    }

    const CH = 12, n = pts.length;
    const widthAt = pr => base * scale * (.6 + Math.min(1, Math.max(0, pr)) * .8);
    // 首尾各有一点点收细（笔锋），中间保持满宽
    const taper = i => Math.min(1, .58 + Math.min(i + 1, n - i) / 6);
    for (let i0 = 0; i0 < n - 1; i0 += CH) {
      const i1 = Math.min(n - 1, i0 + CH);
      let acc = 0; for (let k = i0; k <= i1; k++) acc += pts[k][2];
      ctx.lineWidth = Math.max(.55, widthAt(acc / (i1 - i0 + 1)) * Math.min(taper(i0), taper(i1)));
      pathRange(ctx, pts, scale, i0, i1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function mount(host, note, { course, onChange } = {}) {
    note.board = note.board || { pages: [{ bg: null, h: 1414, strokes: [] }] };
    if (!note.board.pages.length) note.board.pages.push({ bg: null, h: 1414, strokes: [] });
    const P = Object.assign({ tool: 'pen', color: INK[0], size: 3, penOnly: true }, pref());
    const undo = [], redo = [];
    host.innerHTML = `
      <div class="board-tools noprint">
        <div class="seg" role="group" aria-label="工具">
          <button data-tool="pen" title="笔（再点一下切成橡皮）">✎ 笔</button><button data-tool="hl" title="荧光笔（再点一下切成橡皮）">▮ 荧光</button><button data-tool="er" title="橡皮（擦掉整笔；再点一下切回笔）">⌫ 橡皮</button>
        </div>
        <div class="seg colors">${INK.map(c => `<button data-color="${c}" style="--sw:${c}" aria-label="颜色"></button>`).join('')}</div>
        <div class="seg"><button data-size="2">细</button><button data-size="3">中</button><button data-size="5">粗</button></div>
        <div class="seg"><button data-act="undo" title="撤销">↶</button><button data-act="redo" title="重做">↷</button></div>
        <label class="switch small" title="开着时只有 Apple Pencil 能写，手指用来滚动"><input type="checkbox" id="b-pen" ${P.penOnly ? 'checked' : ''}>只用笔写</label>
        <span class="grow"></span>
        <button class="btn small" data-act="add">＋空白页</button>
        <button class="btn small" data-act="addpdf">＋课件页</button>
        <button class="btn small ghost" data-act="export">导出图片</button>
        <button class="btn small" data-act="hw" title="用 Gemini 免费识别手写，整理后放进笔记">识别手写 → 笔记</button>
      </div>
      ${Device.touch && !pref().hintSeen ? `<div class="board-hint noprint">小技巧：再点一下正在用的笔 = 切成橡皮，再点一下切回来 · 两指轻点 = 撤销 · 三指轻点 = 重做 · 手指滑动 = 翻页 <button class="btn small ghost" data-act="hint-x">知道了</button></div>` : ''}
      <div class="board-pages"></div>`;
    const hx = $('[data-act=hint-x]', host); if (hx) hx.onclick = () => { savePref({ hintSeen: 1 }); hx.parentElement.remove(); };
    const pagesEl = $('.board-pages', host);
    let save = null;
    const persist = () => { clearTimeout(save); save = setTimeout(async () => { await DB.put('notes', note); onChange && onChange(); }, 700); };

    const syncTools = () => {
      $$('[data-tool]', host).forEach(b => b.classList.toggle('on', b.dataset.tool === P.tool));
      $$('[data-color]', host).forEach(b => b.classList.toggle('on', b.dataset.color === P.color));
      $$('[data-size]', host).forEach(b => b.classList.toggle('on', Number(b.dataset.size) === P.size));
      $$('.board-page', host).forEach(el => { el.style.touchAction = P.penOnly ? 'pan-x pan-y pinch-zoom' : 'none'; });
    };
    // 再点一下正在用的笔 → 切成橡皮；在橡皮上再点 → 切回刚才的笔（不用移动手去找按钮）
    let prevTool = P.tool === 'er' ? 'pen' : P.tool;
    $$('[data-tool]', host).forEach(b => b.onclick = () => {
      const t = b.dataset.tool;
      if (t === P.tool && t !== 'er') { prevTool = t; P.tool = 'er'; }
      else if (t === 'er' && P.tool === 'er') P.tool = prevTool;
      else { if (t !== 'er') prevTool = t; P.tool = t; }
      savePref({ tool: P.tool }); syncTools();
    });
    $$('[data-color]', host).forEach(b => b.onclick = () => { P.color = b.dataset.color; if (P.tool === 'er') P.tool = 'pen'; savePref({ color: P.color, tool: P.tool }); syncTools(); });
    $$('[data-size]', host).forEach(b => b.onclick = () => { P.size = Number(b.dataset.size); savePref({ size: P.size }); syncTools(); });
    $('#b-pen', host).onchange = e => { P.penOnly = e.target.checked; savePref({ penOnly: P.penOnly }); syncTools(); };

    const pageViews = [];
    function layoutPage(pv) {
      const cssW = pv.el.clientWidth || 600, dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const cssH = cssW * pv.page.h / W;
      const bw = Math.round(cssW * dpr), bh = Math.round(cssH * dpr);
      for (const c of [pv.bgC, pv.ink, pv.live]) { c.width = bw; c.height = bh; c.style.height = cssH + 'px'; }
      pv.scale = cssW / W;
      // 用「实际像素宽 / css 宽」当倍率，避免四舍五入带来的整体半像素模糊
      pv.dpr = bw / cssW;
      paintBg(pv); paintInk(pv);
    }
    async function paintBg(pv) {
      const ctx = pv.bgC.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, pv.bgC.width, pv.bgC.height);
      if (pv.page.bg) {
        try {
          const c = await Pdf.render(pv.page.bg.fileId, pv.page.bg.page, Math.min(2000, pv.bgC.width));
          ctx.drawImage(c, 0, 0, pv.bgC.width, pv.bgC.height);
        } catch (e) { ctx.fillStyle = '#999'; ctx.font = '28px sans-serif'; ctx.fillText('课件页加载失败：' + e.message, 30, 60); }
      } else {
        // 淡淡的横线，像笔记本
        ctx.strokeStyle = 'rgba(44,71,165,.10)'; ctx.lineWidth = 1;
        const step = 40 * pv.scale * pv.dpr;
        for (let y = step * 2; y < pv.bgC.height; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(pv.bgC.width, y); ctx.stroke(); }
      }
    }
    function paintInk(pv) {
      const ctx = pv.ink.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, pv.ink.width, pv.ink.height);
      const lc = pv.live && pv.live.getContext('2d');
      if (lc) { lc.setTransform(1, 0, 0, 1, 0, 0); lc.clearRect(0, 0, pv.live.width, pv.live.height); }
      const sc = pv.scale * pv.dpr;
      for (const s of pv.page.strokes) drawStroke(ctx, s, sc);
    }
    function build() {
      pagesEl.innerHTML = '';
      pageViews.length = 0;
      note.board.pages.forEach((page, i) => {
        const el = document.createElement('div'); el.className = 'board-page';
        el.innerHTML = `<canvas class="bg"></canvas><canvas class="ink"></canvas><canvas class="live"></canvas><div class="pno">${i + 1}${page.bg ? ' · 课件第 ' + page.bg.page + ' 页' : ''}<button class="btn small ghost" data-del="${i}" title="删除这一页">删除</button></div>`;
        pagesEl.appendChild(el);
        const pv = { el, page, bgC: $('.bg', el), ink: $('.ink', el), live: $('.live', el), scale: 1, dpr: 1 };
        pageViews.push(pv);
        attach(pv);
        confirmClick($('[data-del]', el), '确认删除这页', () => { note.board.pages.splice(i, 1); if (!note.board.pages.length) note.board.pages.push({ bg: null, h: 1414, strokes: [] }); persist(); build(); });
      });
      requestAnimationFrame(() => pageViews.forEach(layoutPage));
      syncTools();
    }

    function attach(pv) {
      let cur = null, penDown = false;
      const sc = () => pv.scale * pv.dpr;
      const pos = e => {
        const r = pv.ink.getBoundingClientRect();
        return [
          (e.clientX - r.left) / (pv.scale || 1),
          (e.clientY - r.top) / (pv.scale || 1),
          e.pointerType === 'pen' ? (e.pressure || .5) : .5,
        ];
      };
      const allowed = e => {
        if (e.pointerType === 'pen') return true;
        if (e.pointerType === 'touch') return !P.penOnly && !penDown;
        return e.button === 0 || e.buttons === 1; // 鼠标 / 触控板
      };
      // 正在写的那一笔画在单独一层上，松手才落到纸上。
      // 好处是每帧只重画这一笔，不用把整页几百笔重画一遍，iPad 上不会掉帧。
      const liveCtx = pv.live.getContext('2d');
      const liveClear = () => { liveCtx.setTransform(1, 0, 0, 1, 0, 0); liveCtx.clearRect(0, 0, pv.live.width, pv.live.height); };
      const liveDraw = () => { liveClear(); if (cur && !cur.er) drawStroke(liveCtx, cur.s, sc()); };
      // 阻止 Apple Pencil 拖动时页面跟着滚
      pv.el.addEventListener('touchstart', e => { if ([...e.touches].some(t => t.touchType === 'stylus') || !P.penOnly) e.preventDefault(); }, { passive: false });
      pv.el.addEventListener('touchmove', e => { if ([...e.touches].some(t => t.touchType === 'stylus') || (!P.penOnly && cur)) e.preventDefault(); }, { passive: false });
      pv.ink.addEventListener('pointerdown', e => {
        if (!allowed(e)) return;
        if (e.pointerType === 'pen') penDown = true;
        e.preventDefault();
        try { pv.ink.setPointerCapture(e.pointerId); } catch (err) {}
        const p = pos(e);
        if (P.tool === 'er') { cur = { er: true, id: e.pointerId, removed: [] }; eraseAt(pv, p, cur); return; }
        cur = { id: e.pointerId, s: { tool: P.tool, c: P.tool === 'hl' ? '#FFD400' : P.color, w: P.tool === 'hl' ? 18 : P.size, pts: [p] } };
        liveDraw();
      });
      pv.ink.addEventListener('pointermove', e => {
        if (!cur || e.pointerId !== cur.id) return;
        e.preventDefault();
        const co = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        const evs = co.length ? co : [e];
        let added = false;
        for (const ev of evs) {
          const p = pos(ev);
          if (cur.er) { eraseAt(pv, p, cur); continue; }
          const pts = cur.s.pts, last = pts[pts.length - 1];
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) < .7) continue;
          pts.push(p); added = true;
        }
        if (added) liveDraw();
      });
      const end = e => {
        if (e.pointerType === 'pen') penDown = false;
        if (!cur || e.pointerId !== cur.id) return;
        if (cur.er) { if (cur.removed.length) { undo.push({ type: 'erase', page: pv.page, strokes: cur.removed }); redo.length = 0; persist(); } }
        else {
          pv.page.strokes.push(cur.s);
          // 松手时把这一笔按最终形态画到纸上（和纸上其它笔迹同一套算法，前后一致）
          drawStroke(pv.ink.getContext('2d'), cur.s, sc());
          undo.push({ type: 'add', page: pv.page, stroke: cur.s }); redo.length = 0; persist();
        }
        liveClear();
        cur = null;
      };
      pv.ink.addEventListener('pointerup', end);
      pv.ink.addEventListener('pointercancel', end);
    }
    function eraseAt(pv, p, cur) {
      const r = 14;
      const keep = [];
      let hit = false;
      for (const s of pv.page.strokes) {
        if (s.pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < r + s.w / 2)) { cur.removed.push(s); hit = true; } else keep.push(s);
      }
      if (hit) { pv.page.strokes = keep; paintInk(pv); }
    }
    const doUndo = (quiet) => {
      const a = undo.pop(); if (!a) { if (!quiet) toast('没有可以撤销的'); return; }
      if (a.type === 'add') a.page.strokes = a.page.strokes.filter(s => s !== a.stroke); else a.page.strokes.push(...a.strokes);
      redo.push(a); pageViews.forEach(paintInk); persist();
      if (quiet) toast('已撤销', 900);
    };
    const doRedo = (quiet) => {
      const a = redo.pop(); if (!a) { if (!quiet) toast('没有可以重做的'); return; }
      if (a.type === 'add') a.page.strokes.push(a.stroke); else a.page.strokes = a.page.strokes.filter(s => !a.strokes.includes(s));
      undo.push(a); pageViews.forEach(paintInk); persist();
      if (quiet) toast('已重做', 900);
    };
    $('[data-act=undo]', host).onclick = () => doUndo();
    $('[data-act=redo]', host).onclick = () => doRedo();
    // 手势：两指轻点 = 撤销，三指轻点 = 重做（手指没怎么移动、很快抬起才算，滚动不会误触发）
    let tap = null;
    pagesEl.addEventListener('touchstart', e => {
      const fingers = [...e.touches].filter(t => t.touchType !== 'stylus');
      if (fingers.length !== e.touches.length) { tap = null; return; }
      if (fingers.length >= 2) tap = { n: Math.max(tap ? tap.n : 0, fingers.length), t: tap ? tap.t : Date.now(), pts: fingers.map(f => [f.identifier, f.clientX, f.clientY]), moved: tap ? tap.moved : false };
      else if (fingers.length === 1) tap = { n: 1, t: Date.now(), pts: [[fingers[0].identifier, fingers[0].clientX, fingers[0].clientY]], moved: false };
    }, { passive: true });
    pagesEl.addEventListener('touchmove', e => {
      if (!tap) return;
      for (const t of e.touches) { const p = tap.pts.find(q => q[0] === t.identifier); if (p && Math.hypot(t.clientX - p[1], t.clientY - p[2]) > 12) tap.moved = true; }
    }, { passive: true });
    pagesEl.addEventListener('touchend', e => {
      if (!tap || e.touches.length) return;
      const t = tap; tap = null;
      if (t.moved || Date.now() - t.t > 350) return;
      if (t.n === 2) doUndo(true); else if (t.n === 3) doRedo(true);
    });
    pagesEl.addEventListener('touchcancel', () => { tap = null; });
    $('[data-act=add]', host).onclick = () => { note.board.pages.push({ bg: null, h: 1414, strokes: [] }); persist(); build(); pagesEl.lastElementChild?.scrollIntoView({ behavior: 'smooth' }); };
    $('[data-act=addpdf]', host).onclick = () => addPdfPages(note, course, async () => { persist(); build(); });
    $('[data-act=export]', host).onclick = () => exportImages(note);
    $('[data-act=hw]', host).onclick = async () => {
      const b = $('[data-act=hw]', host); b.disabled = true; const old = b.textContent;
      try { clearTimeout(save); await DB.put('notes', note); await Recap.handwritingMerge(note, course, t => { b.textContent = t; }); toast('手写已经整理进笔记（笔记最下面「我的手写笔记」）'); }
      catch (e) { toast(e.message, 6000); }
      b.disabled = false; b.textContent = old;
    };
    let rz; const ro = new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => pageViews.forEach(layoutPage), 120); });
    ro.observe(pagesEl);
    build();
    return { addPdfPage: async (fileId, page) => { const h = Math.round(W * await Pdf.aspect(fileId, page)); note.board.pages.push({ bg: { fileId, page }, h, strokes: [] }); persist(); build(); pagesEl.lastElementChild?.scrollIntoView({ behavior: 'smooth' }); } };
  }

  async function addPdfPages(note, course, done) {
    const files = (await DB.byIndex('files', 'courseId', note.courseId)).filter(isPdf);
    if (!files.length) { toast('这门课还没有 PDF 课件（PPT 要先在电脑上另存为 PDF 再导入）'); return; }
    modal(`<h2>把课件页加进画板</h2>
      <div class="field"><label for="ap-f">课件</label><select id="ap-f">${sortFiles(files).map(f => `<option value="${f.id}" ${(note.sourceFileIds || []).includes(f.id) ? 'selected' : ''}>${esc(weekOf(f).label)} · ${esc(f.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="ap-r">哪几页</label><input id="ap-r" type="text" placeholder="例如 1-5, 8；不填就是全部"><span class="hint" id="ap-n"></span></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="ap-go">加进去</button></div>`, (box, close) => {
      const upd = async () => { try { $('#ap-n', box).textContent = `共 ${await Pdf.count($('#ap-f', box).value)} 页`; } catch (e) { $('#ap-n', box).textContent = e.message; } };
      $('#ap-f', box).onchange = upd; upd();
      $('#ap-go', box).onclick = async () => {
        const fid = $('#ap-f', box).value; const n = await Pdf.count(fid);
        const raw = $('#ap-r', box).value.trim(); const pages = [];
        if (!raw) for (let i = 1; i <= n; i++) pages.push(i);
        else raw.split(/[,，\s]+/).forEach(part => { const [a, b] = part.split('-').map(Number); if (a) for (let i = a; i <= (b || a); i++) if (i >= 1 && i <= n) pages.push(i); });
        if (!pages.length) { toast('页码不对'); return; }
        if (pages.length > 60) { toast('一次最多加 60 页'); return; }
        close(); toast('正在加入 ' + pages.length + ' 页…');
        // 如果只有一张没写过的空白页，就替换掉它
        const bp = note.board.pages;
        if (bp.length === 1 && !bp[0].bg && !bp[0].strokes.length) bp.length = 0;
        for (const p of pages) bp.push({ bg: { fileId: fid, page: p }, h: Math.round(W * await Pdf.aspect(fid, p)), strokes: [] });
        await done();
      };
    });
  }

  /* 画板每页渲染成 PNG（导出 / 交给 Gemini 识别手写） */
  async function pageImage(page, width = 1000, withBg = true) {
    const c = document.createElement('canvas'); const sc = width / W;
    c.width = width; c.height = Math.round(page.h * sc);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    if (withBg && page.bg) { try { ctx.drawImage(await Pdf.render(page.bg.fileId, page.bg.page, width), 0, 0, c.width, c.height); } catch (e) {} }
    for (const s of page.strokes) drawStroke(ctx, s, sc);
    return c;
  }
  /* 只画笔迹、自动裁到有字的区域：识别手写用这个。
     原来是把整页（含课件印刷体）压到 1000px 宽再识别，笔迹只有 1–2 像素，
     模型基本认不出来；裁到笔迹范围再放大，同样一张图能清楚好几倍。 */
  function inkBox(page) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of page.strokes || []) for (const p of s.pts || []) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return isFinite(x0) ? { x0, y0, x1, y1 } : null;
  }
  function inkImage(page, targetW = 1600, maxPx = 4.2e6, bold = 1, region) {
    const b = region ? {
      x0: Math.max(0, region.x0), y0: Math.max(0, region.y0),
      x1: Math.min(W, region.x1), y1: Math.min(page.h || 1414, region.y1),
    } : inkBox(page);
    if (!b || b.x1 - b.x0 < 4 || b.y1 - b.y0 < 4) return null;
    const pad = region ? 14 : 40;
    const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad);
    const x1 = Math.min(W, b.x1 + pad), y1 = Math.min(page.h || 1414, b.y1 + pad);
    const bw = Math.max(80, x1 - x0), bh = Math.max(80, y1 - y0);
    let sc = targetW / bw;
    if (bw * bh * sc * sc > maxPx) sc = Math.sqrt(maxPx / (bw * bh)); // 别超过 iOS 的 canvas 上限
    sc = Math.max(sc, 0.8);
    const c = document.createElement('canvas');
    c.width = Math.round(bw * sc); c.height = Math.round(bh * sc);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.translate(-x0 * sc, -y0 * sc);
    for (const s of page.strokes) drawStroke(ctx, s, sc, true, bold);
    return c;
  }
  /* iOS Safari 对没挂在页面上的 canvas 调 toDataURL 有时会返回全白，先挂上去再截 */
  function shoot(canvas, mime, quality) {
    canvas.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(canvas);
    let out;
    try { out = canvas.toDataURL(mime, quality); } finally { canvas.remove(); }
    return out;
  }

  async function exportImages(note) {
    const pages = (note.board?.pages || []).filter(p => p.strokes.length || p.bg);
    if (!pages.length) { toast('画板还是空的'); return; }
    toast('正在生成图片…');
    const w = window.open('', '_blank');
    if (!w) { toast('浏览器拦截了新窗口，允许弹出窗口后再试'); return; }
    const imgs = [];
    for (const p of pages) imgs.push((await pageImage(p, 1400)).toDataURL('image/jpeg', .9));
    w.document.write(`<title>${esc(note.title)} · 手写</title><style>body{margin:0;background:#888}img{display:block;width:100%;max-width:900px;margin:12px auto;background:#fff}@media print{body{background:#fff}img{margin:0;page-break-after:always;max-width:none}}</style>${imgs.map(s => `<img src="${s}">`).join('')}<script>setTimeout(()=>print(),400)<\/script>`);
    w.document.close();
  }
  const hasInk = note => (note.board?.pages || []).some(p => p.strokes.length);
  return { mount, pageImage, inkImage, inkBox, shoot, hasInk, drawStroke, INK };
})();

/* ======================================================================
   重点 / 记忆卡片 / 测验
   ====================================================================== */
const Study = (() => {
  async function sourcesExcerpt(note, max = 30000) {
    const files = (await Promise.all((note.sourceFileIds || []).map(id => DB.get('files', id)))).filter(Boolean);
    let out = '', per = Math.floor(max / Math.max(1, files.length));
    for (const f of files) out += `\n# ${f.name}\n${(f.text || '').slice(0, per)}`;
    return out.trim();
  }
  const PART_NAME = { points: '重点', cards: '记忆卡片', quiz: '测验题' };
  // 把新生成的几样合并进笔记，没重新生成的保留原样
  function merge(note, pack) {
    note.study = Object.assign({ points: [], cards: [], quiz: [] }, note.study || {});
    if (pack.points) { note.study.points = pack.points; note.mastered = {}; }
    if (pack.cards) { note.study.cards = pack.cards; note.hardCards = []; }
    if (pack.quiz) { note.study.quiz = pack.quiz; note.quizLog = null; }
    note.study.at = pack.at;
  }
  const doneMsg = pack => '生成了 ' + [pack.points && `${pack.points.length} 个重点`, pack.cards && `${pack.cards.length} 张卡片`, pack.quiz && `${pack.quiz.length} 道题`].filter(Boolean).join('、');
  async function run(note, parts, job) {
    let first = true;
    const label = parts.map(k => PART_NAME[k]).join('、');
    const pack = await AI.studyPack({ title: note.title, parts, points: (note.study && note.study.points) || [], markdown: (note.markdown || '').slice(0, 80000), sources: await sourcesExcerpt(note, note.markdown ? 20000 : 60000), onText: t => { if (first) { first = false; job.phase('正在出' + label, .08, .97, { expectLen: parts.length * 2500 }); } job.len(t.length).sub(`已写 ${t.length} 字`); } });
    if (pack.points && !pack.points.length) throw new Error('没有生成出知识点，再试一次');
    return pack;
  }
  async function generate(note, el, after, parts = ['points', 'cards', 'quiz']) {
    if (!Settings.load().deepseekKey) { toast('先去设置里填 DeepSeek key'); return; }
    if (!note.markdown && !(note.sourceFileIds || []).length) { toast('这份笔记还是空的，先生成笔记或选课件'); return; }
    const job = Jobs.start('study:' + note.id, '出' + parts.map(k => PART_NAME[k]).join('、') + '：' + note.title);
    el.innerHTML = Jobs.slot('study:' + note.id);
    try {
      const pack = await run(note, parts, job);
      const fresh = await DB.get('notes', note.id) || note; merge(fresh, pack); Object.assign(note, fresh);
      await DB.put('notes', fresh);
      toast(doneMsg(pack));
    } catch (e) { toast(e.message, 6000); }
    job.done();
    after();
  }
  function emptyGen(note, el, after, part) {
    if (State.studyGens.has(note.id) || Jobs.has('study:' + note.id)) { el.innerHTML = Jobs.slot('study:' + note.id) + '<p class="hint">好了会自动显示，可以先去看别的。</p>'; return; }
    const st = note.study || {};
    const missing = ['points', 'cards', 'quiz'].filter(k => !(st[k] || []).length);
    el.innerHTML = `<div class="empty"><strong>还没有${PART_NAME[part]}</strong>只生成${PART_NAME[part]}，用${note.markdown ? '笔记和课件' : '选中的课件'}来出（DeepSeek，不开思考，大约 ¥0.01–0.02）。
      <div class="row" style="justify-content:center;margin-top:14px"><button class="btn primary" id="st-gen">${ICON.spark}生成${PART_NAME[part]}</button>${missing.length > 1 ? `<button class="btn" id="st-gen-all">${missing.map(k => PART_NAME[k]).join(' + ')} 一起生成</button>` : ''}</div></div>`;
    $('#st-gen', el).onclick = () => generate(note, el, after, [part]);
    const all = $('#st-gen-all', el); if (all) all.onclick = () => generate(note, el, after, missing);
  }

  function points(note, el, { focus } = {}) {
    const st = note.study; if (!st || !(st.points || []).length) return emptyGen(note, el, () => points(note, el), 'points');
    note.mastered = note.mastered || {};
    const n = st.points.filter(p => note.mastered[p.id]).length;
    el.innerHTML = `
      <div class="study-head"><div class="grow"><b>已掌握 ${n} / ${st.points.length}</b><div class="level" style="width:100%;height:6px;margin-top:6px"><i style="width:${Math.round(n / st.points.length * 100)}%"></i></div></div>
        <button class="btn small ghost" id="st-re">重新生成</button></div>
      <div class="points">${st.points.map((p, i) => `
        <div class="kp ${note.mastered[p.id] ? 'done' : ''} ${focus === p.id ? 'focus' : ''}" data-id="${esc(p.id)}">
          <div class="kp-h"><b class="grow">${esc(p.title)}</b>${p.page ? `<span class="hint">${esc(p.page)}</span>` : ''}
            <button class="mbtn ${note.mastered[p.id] ? 'on' : ''}" data-m>${note.mastered[p.id] ? '✓ 已掌握' : '○ 未掌握'}</button></div>
          <ol class="kp-items">${(p.items || [p.detail || '']).map((t, k) => `<li><span class="kn">${String(k + 1).padStart(2, '0')}</span><span class="md">${md(t)}</span></li>`).join('')}</ol>
        </div>`).join('')}</div>`;
    $$('.kp', el).forEach(row => $('[data-m]', row).onclick = async () => {
      const id = row.dataset.id; note.mastered[id] = !note.mastered[id]; await DB.put('notes', note); points(note, el);
    });
    confirmClick($('#st-re', el), '再点一次：重新生成重点（会清掉掌握记录）', () => generate(note, el, () => points(note, el), ['points']));
    if (focus) setTimeout(() => $('.kp.focus', el)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }

  function cards(note, el) {
    const st = note.study; if (!st || !(st.cards || []).length) return emptyGen(note, el, () => cards(note, el), 'cards');
    let order = st.cards.map((_, i) => i), i = 0, flipped = false, onlyHard = false;
    const hard = new Set(note.hardCards || []);
    const pool = () => onlyHard ? order.filter(k => hard.has(k)) : order;
    const paint = () => {
      const list = pool();
      if (!list.length) { el.innerHTML = `<div class="empty"><strong>没有不熟的卡片了 👍</strong><div class="row" style="justify-content:center;margin-top:10px"><button class="btn" id="fc-all">看全部</button></div></div>`; $('#fc-all', el).onclick = () => { onlyHard = false; i = 0; paint(); }; return; }
      i = Math.max(0, Math.min(i, list.length - 1));
      const k = list[i], c = st.cards[k], pt = st.points.find(p => p.id === c.point);
      el.innerHTML = `
        <div class="flash ${flipped ? 'flipped' : ''}" id="fc" tabindex="0" role="button" aria-label="点击翻面">
          ${pt ? `<span class="pill mute fc-tag">${esc(pt.title)}</span>` : ''}
          <div class="fc-body">${flipped ? `<div class="fc-q">${esc(c.q)}</div><div class="md fc-a">${md(c.a)}</div>` : `<div class="fc-front">${esc(c.q)}</div>`}</div>
          <div class="hint">${flipped ? '' : '先想几秒，再点一下看答案'}</div>
        </div>
        <div class="row" style="justify-content:space-between;margin-top:12px">
          <span class="hint">${i + 1} / ${list.length}${onlyHard ? '（只看不熟的）' : ''}</span>
          <div class="row"><button class="btn small ${hard.has(k) ? 'danger' : ''}" id="fc-hard">${hard.has(k) ? '★ 不熟' : '☆ 标为不熟'}</button><button class="btn small" id="fc-only">${onlyHard ? '看全部' : `只看不熟的（${hard.size}）`}</button><button class="btn small" id="fc-shuf">随机顺序</button></div>
        </div>
        <div class="row" style="justify-content:space-between;margin-top:10px"><button class="btn" id="fc-prev">‹ 上一张</button><button class="btn primary" id="fc-next">下一张 ›</button></div>`;
      const fc = $('#fc', el); fc.onclick = () => { flipped = !flipped; paint(); };
      fc.onkeydown = e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fc.click(); } };
      $('#fc-prev', el).onclick = () => { i = (i - 1 + list.length) % list.length; flipped = false; paint(); };
      $('#fc-next', el).onclick = () => { i = (i + 1) % list.length; flipped = false; paint(); };
      $('#fc-shuf', el).onclick = () => { order = order.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]); i = 0; flipped = false; paint(); };
      $('#fc-only', el).onclick = () => { onlyHard = !onlyHard; i = 0; flipped = false; paint(); };
      $('#fc-hard', el).onclick = async () => { hard.has(k) ? hard.delete(k) : hard.add(k); note.hardCards = [...hard]; await DB.put('notes', note); paint(); };
    };
    paint();
  }

  function quiz(note, el, { gotoPoint } = {}) {
    const st = note.study; if (!st || !(st.quiz || []).length) return emptyGen(note, el, () => quiz(note, el, { gotoPoint }), 'quiz');
    let set = st.quiz.map((_, i) => i), i = 0, picked = null, score = 0, wrong = [];
    const L = 'ABCDEF';
    const paint = () => {
      if (i >= set.length) {
        note.quizLog = { at: Date.now(), score, total: set.length, wrong }; DB.put('notes', note);
        el.innerHTML = `<div class="card pad" style="text-align:center"><div style="font-size:40px;font-weight:800">${score} / ${set.length}</div><div class="hint">${score === set.length ? '全对！' : `错了 ${wrong.length} 道，点下面的知识点回去看看`}</div>
          ${wrong.length ? `<div class="points" style="text-align:left;margin-top:14px">${wrong.map(k => { const q = st.quiz[k], pt = st.points.find(p => p.id === q.point); return `<div class="point"><div class="grow"><div class="pt">${esc(q.q)}</div><div class="hint">正确答案：${L[q.answer]}. ${esc(q.options[q.answer])}</div></div>${pt ? `<button class="btn small" data-go="${esc(pt.id)}">看重点</button>` : ''}</div>`; }).join('')}</div>` : ''}
          <div class="row" style="justify-content:center;margin-top:14px">${wrong.length ? '<button class="btn" id="qz-wrong">只做错题</button>' : ''}<button class="btn primary" id="qz-again">再做一遍</button></div></div>`;
        $$('[data-go]', el).forEach(b => b.onclick = () => gotoPoint && gotoPoint(b.dataset.go));
        const w = $('#qz-wrong', el); if (w) w.onclick = () => { set = wrong.slice(); i = 0; score = 0; wrong = []; picked = null; paint(); };
        $('#qz-again', el).onclick = () => { set = st.quiz.map((_, k) => k).sort(() => Math.random() - .5); i = 0; score = 0; wrong = []; picked = null; paint(); };
        return;
      }
      const q = st.quiz[set[i]], pt = st.points.find(p => p.id === q.point);
      el.innerHTML = `
        <div class="row" style="justify-content:space-between"><span class="hint">第 ${i + 1} / ${set.length} 题 · 答对 ${score}</span>${note.quizLog ? `<span class="hint">上次 ${note.quizLog.score}/${note.quizLog.total}</span>` : ''}</div>
        <div class="card pad quiz">
          <div class="qq">${esc(q.q)}</div>
          <div class="opts">${q.options.map((o, k) => `<button class="opt ${picked !== null ? (k === q.answer ? 'right' : k === picked ? 'wrong' : '') : ''}" data-k="${k}" ${picked !== null ? 'disabled' : ''}><b>${L[k]}</b><span>${esc(o)}</span></button>`).join('')}</div>
          ${picked !== null ? `<div class="explain ${picked === q.answer ? 'ok' : 'bad'}"><b>${picked === q.answer ? '答对了。' : `不对，正确答案是 ${L[q.answer]}。`}</b> ${esc(q.explain)}
            ${picked !== q.answer && pt ? `<div style="margin-top:8px"><button class="btn small" id="qz-pt">回到知识点：${esc(pt.title)}</button></div>` : ''}</div>` : ''}
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:10px">${picked !== null ? `<button class="btn primary" id="qz-next">${i + 1 < set.length ? '下一题 ›' : '看成绩'}</button>` : ''}</div>`;
      $$('.opt', el).forEach(b => b.onclick = () => { picked = Number(b.dataset.k); if (picked === q.answer) score++; else wrong.push(set[i]); paint(); });
      const n = $('#qz-next', el); if (n) n.onclick = () => { i++; picked = null; paint(); };
      const g = $('#qz-pt', el); if (g) g.onclick = () => gotoPoint && gotoPoint(q.point);
    };
    paint();
  }
  /* 笔记生成完自动出重点/卡片/测验（后台跑，不挡界面） */
  async function background(noteId, parts = ['points', 'cards', 'quiz']) {
    if (State.studyGens.has(noteId) || !Settings.load().deepseekKey) return;
    State.studyGens.add(noteId); refreshTabs(noteId);
    let job = null;
    try {
      const note = await DB.get('notes', noteId);
      if (!note || (!note.markdown && !(note.sourceFileIds || []).length)) return;
      job = Jobs.start('study:' + noteId, '出' + parts.map(k => PART_NAME[k]).join('、') + '：' + note.title);
      const pack = await run(note, parts, job);
      const fresh = await DB.get('notes', noteId); if (!fresh) return;
      merge(fresh, pack);
      await DB.put('notes', fresh);
      toast(`「${fresh.title}」${doneMsg(pack)}`);
    } catch (e) { toast('出复习材料失败：' + e.message, 5000); }
    finally { job && job.done(); State.studyGens.delete(noteId); refreshTabs(noteId, true); }
  }
  function refreshTabs(noteId, done) {
    const h = location.hash.slice(1);
    if (h.startsWith('note-' + noteId)) { const tab = h.split('~')[1] || 'note'; if (done && tab !== 'note' && tab !== 'board') renderNote(noteId, tab); else DB.get('notes', noteId).then(n => { const t = $('#n-tabs'); if (t && n) { t.innerHTML = noteTabsHTML(tab, n); $$('[data-ntab]', t).forEach(b => b.onclick = () => { history.replaceState(null, '', '#note-' + noteId + (b.dataset.ntab === 'note' ? '' : '~' + b.dataset.ntab)); renderNote(noteId, b.dataset.ntab); }); } }); }
  }
  const progress = note => { const pts = (note.study && note.study.points) || []; return { done: pts.filter(p => (note.mastered || {})[p.id]).length, total: pts.length }; };
  return { points, cards, quiz, progress, generate, background };
})();

/* ======================================================================
   思维导图：直接用笔记的标题层级画，不花 token
   ====================================================================== */
const MindMap = (() => {
  function tree(markdown, title) {
    const root = { t: title || '笔记', kids: [], d: 0 };
    const stack = [root];
    let lastHead = root;
    const clean = s => s.replace(/\*\*|__|`|\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/<[^>]+>/g, '').replace(/[（(]第\s*\d+\s*页[）)]/g, '').trim();
    for (const line of (markdown || '').split('\n')) {
      const h = line.match(/^(#{1,4})\s+(.+)/);
      if (h) {
        let lvl = h[1].length; if (lvl === 1) { root.t = clean(h[2]); continue; }
        const node = { t: clean(h[2]), kids: [], d: lvl - 1 };
        while (stack.length > 1 && stack[stack.length - 1].d >= node.d) stack.pop();
        stack[stack.length - 1].kids.push(node); stack.push(node); lastHead = node; continue;
      }
      const b = line.match(/^(\s{0,3})[-*+]\s+(.+)/) || line.match(/^(\s{0,3})\d+[.)]\s+(.+)/);
      if (b && lastHead !== root && lastHead.kids.filter(k => k.leaf).length < 6) {
        const t = clean(b[2]).split(/[：:。；;]/)[0];
        if (t && t.length > 1) lastHead.kids.push({ t: t.length > 34 ? t.slice(0, 33) + '…' : t, kids: [], d: lastHead.d + 1, leaf: true });
      }
    }
    return root;
  }
  function mount(el, note) {
    const root = tree(note.markdown, note.title);
    if (!root.kids.length) { el.innerHTML = '<div class="empty"><strong>笔记还没有内容</strong>生成笔记之后，这里会按笔记的标题自动画出思维导图。</div>'; return; }
    let zoom = 1;
    const collapsed = new Set();
    el.innerHTML = `<div class="mm-tools noprint"><button class="btn small" data-z="-">−</button><button class="btn small" data-z="0">适应宽度</button><button class="btn small" data-z="+">＋</button><button class="btn small ghost" id="mm-all">全部展开</button><span class="hint">点圆点可以收起 / 展开</span></div><div class="mm-wrap"><svg class="mm"></svg></div>`;
    const svg = $('svg', el), wrap = $('.mm-wrap', el);
    const COLORS_ = ['#2C47A5', '#2B7A4B', '#B5532A', '#7A4BB0', '#A23B62', '#1F7A8C', '#8A6D1F'];
    const measure = (() => { const c = document.createElement('canvas').getContext('2d'); return (t, bold) => { c.font = `${bold ? 700 : 500} 14px ${getComputedStyle(document.body).fontFamily}`; return c.measureText(t).width; }; })();
    function draw() {
      const nodes = [], links = [];
      let y = 0; const ROW = 34, PADX = 14;
      // 文字超过节点宽度就截断加省略号，否则长句子会画到框外、被面板边缘切掉
      const fitText = (t, maxW, bold) => {
        if (measure(t, bold) <= maxW) return t;
        let s = t;
        while (s.length > 1 && measure(s + '…', bold) > maxW) s = s.slice(0, -1);
        return s + '…';
      };
      const colX = [];
      (function walk(n, depth, color, id) {
        n.id = id; n.depth = depth; n.color = color;
        n.w = Math.min(300, measure(n.t, depth < 2) + PADX * 2);
        colX[depth] = Math.max(colX[depth] || 0, n.w);
        const kids = collapsed.has(id) ? [] : n.kids;
        if (!kids.length) { n.y = y; y += ROW; }
        else { kids.forEach((k, i) => walk(k, depth + 1, depth === 0 ? COLORS_[i % COLORS_.length] : color, id + '.' + i)); n.y = (kids[0].y + kids[kids.length - 1].y) / 2; }
        nodes.push(n); kids.forEach(k => links.push([n, k]));
      })(root, 0, '#1B2233', 'r');
      const xs = [20]; for (let d = 1; d < colX.length; d++) xs[d] = xs[d - 1] + colX[d - 1] + 46;
      const W = xs[colX.length - 1] + colX[colX.length - 1] + 30, H = y + 20;
      const X = n => xs[n.depth], Y = n => n.y + 20;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.style.width = W * zoom + 'px'; svg.style.height = H * zoom + 'px';
      svg.innerHTML = links.map(([a, b]) => { const x1 = X(a) + a.w, y1 = Y(a), x2 = X(b), y2 = Y(b), mx = (x1 + x2) / 2; return `<path d="M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" stroke="${b.color}" stroke-opacity=".55" stroke-width="1.6" fill="none"/>`; }).join('') +
        nodes.map(n => `<g class="mm-n ${n.depth === 0 ? 'root' : ''}" data-id="${n.id}">
          <rect x="${X(n)}" y="${Y(n) - 13}" width="${n.w}" height="26" rx="${n.depth === 0 ? 7 : 13}" fill="${n.depth === 0 ? '#1B2233' : n.depth === 1 ? n.color : 'var(--sheet)'}" stroke="${n.color}" stroke-opacity="${n.depth > 1 ? .45 : 1}"/>
          <text x="${X(n) + PADX}" y="${Y(n) + 5}" font-size="14" font-weight="${n.depth < 2 ? 700 : 500}" fill="${n.depth < 2 ? '#fff' : 'var(--ink)'}">${esc(fitText(n.t, n.w - PADX * 2, n.depth < 2))}</text>
          ${n.kids.length && n.depth > 0 ? `<circle cx="${X(n) + n.w + 7}" cy="${Y(n)}" r="6" fill="var(--sheet)" stroke="${n.color}" class="mm-tg"/>${collapsed.has(n.id) ? `<text x="${X(n) + n.w + 7}" y="${Y(n) + 4}" font-size="11" text-anchor="middle" fill="${n.color}" pointer-events="none">${n.kids.length}</text>` : ''}` : ''}
        </g>`).join('');
      $$('.mm-n', svg).forEach(g => g.onclick = () => { const id = g.dataset.id; if (id === 'r') return; collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); draw(); });
    }
    $$('[data-z]', el).forEach(b => b.onclick = () => {
      const z = b.dataset.z;
      if (z === '0') { const vb = svg.viewBox.baseVal; zoom = Math.min(1.4, (wrap.clientWidth - 10) / vb.width); }
      else zoom = Math.max(.3, Math.min(2.5, zoom * (z === '+' ? 1.2 : 1 / 1.2)));
      draw();
    });
    $('#mm-all', el).onclick = () => { collapsed.clear(); draw(); };
    draw();
    // 太宽就先缩到适应宽度
    const vb = svg.viewBox.baseVal; if (vb.width > wrap.clientWidth && wrap.clientWidth) { zoom = Math.max(.45, (wrap.clientWidth - 10) / vb.width); draw(); }
  }
  return { mount, tree };
})();

/* ======================================================================
   问 AI：围绕笔记 / 课件 / 录音；「老师刚才问了什么」只用最近一分钟的录音
   ====================================================================== */
const CHAT_WINDOWS = [[0, '全部'], [10, '10秒'], [30, '30秒'], [60, '1分'], [120, '2分'], [180, '3分'], [300, '5分']];
const ChatOpt = {
  get() { try { return Object.assign({ win: 0, mode: 'fast' }, JSON.parse(localStorage.getItem('tingkeben.chatopt') || '{}')); } catch (e) { return { win: 0, mode: 'fast' }; } },
  set(p) { try { localStorage.setItem('tingkeben.chatopt', JSON.stringify(Object.assign(this.get(), p))); } catch (e) {} },
};
const Chat = (() => {
  let quote = ''; // 选中的文字
  // 引用：选中文字后点浮出来的「问 AI」（SelPop）


  function segText(segs) { return segs.map(g => `[${fmtTime(g.t)}] ${g.en}${g.zh ? '\n　' + g.zh : ''}`).join('\n'); }

  async function buildContext({ note, course, fileIds, session, pageHint }) {
    const parts = [];
    if (note && note.markdown) parts.push(`## 笔记：${note.title}\n${note.markdown.slice(0, 50000)}`);
    const ids = [...new Set([...(fileIds || []), ...((note && note.sourceFileIds) || [])])];
    const files = (await Promise.all(ids.map(id => DB.get('files', id)))).filter(f => f && f.text);
    let budget = note && note.markdown ? 50000 : 120000;
    for (const f of files) { const t = f.text.slice(0, Math.max(4000, Math.floor(budget / files.length))); parts.push(`## 课件：${f.name}\n${t}`); }
    if (pageHint) parts.push(`## 学生正在看的课件页：${pageHint.name} 第${pageHint.page}页\n${pageHint.text || ''}`);
    const segs = session ? session.segments : [];
    if (segs.length) { const t = segText(segs); parts.push(`## 课堂录音转写（${session.title || ''}）\n${t.length > 40000 ? '……（前面省略）\n' + t.slice(-40000) : t}`); }
    return parts.join('\n\n') || '（还没有材料）';
  }

  /* host: 放聊天框的元素；opts.getLive() 返回正在录的 LiveSession；opts.getPage() 返回 {fileId,name,page,text} */
  function mount(host, { note, course, getLive, getPage, getFileIds, getExtra, compact, suggestions } = {}) {
    const store = note || course; // 聊天记录存在笔记里；没有笔记就存在课程里
    store.chat = store.chat || [];
    let busy = null;
    host.innerHTML = `
      <div class="chat ${compact ? 'compact' : ''}">
        <div class="chat-log" id="chat-log"></div>
        <div class="chat-quick" id="chat-quick">${suggestions ? suggestions.map(t => `<button data-s="${esc(t)}">${esc(t)}</button>`).join('') : `
          <button data-q="teacher">🙋 老师刚才问了什么？</button>
          <button data-q="hard">解释最难的概念</button>
          <button data-q="page">总结这一页</button>
          <button data-q="quiz">考考我</button>`}
        </div>
        <div class="chat-quote" id="chat-quote" hidden>引用：<span></span><button aria-label="去掉引用">×</button></div>
        <div class="chat-opts">
          <div class="chat-opt"><span>老师讲的</span><div class="seg" id="chat-win" role="radiogroup" aria-label="用老师最近多久讲的内容">${CHAT_WINDOWS.map(([v, l]) => `<button data-w="${v}">${l}</button>`).join('')}</div></div>
          <div class="chat-opt"><span>模式</span><div class="seg" id="chat-mode" role="radiogroup" aria-label="回答模式"><button data-m="fast" title="不思考，直接简短回答，一两秒出字">⚡ 快速</button><button data-m="deep" title="先认真想再回答，慢一些、更准、更详细">🧠 详细思考</button></div></div>
        </div>
        <div class="chat-in">
          <textarea id="chat-text" rows="2" placeholder="问任何问题…（Enter 发送，Shift+Enter 换行）"></textarea>
          <div class="row" style="justify-content:space-between">
            <div class="row"><button class="btn small ghost" id="chat-clear">清空</button><button class="btn small primary" id="chat-send">发送</button></div>
          </div>
        </div>
      </div>`;
    const log = $('#chat-log', host), input = $('#chat-text', host);
    const paint = () => {
      log.innerHTML = store.chat.length ? store.chat.map(m => `<div class="msg ${m.role}">${m.role === 'user' ? esc(m.content) : md(m.content)}${m.note ? `<div class="hint">${esc(m.note)}</div>` : ''}</div>`).join('')
        : `<div class="chat-empty"><b>围绕${note ? '这份笔记' : '这门课'}提问</b><br>解释、总结、翻译、出题都行。上课时点「老师刚才问了什么」，只用最近一分钟的录音来回答，又快又省。</div>`;
      if (busy) log.insertAdjacentHTML('beforeend', `<div class="msg assistant">${busy.text ? md(busy.text) : busy.think ? `<div class="hint"><span class="spin"></span> 正在思考…（${busy.think.length} 字）</div>` : '<span class="spin"></span>'}</div>`);
      log.scrollTop = log.scrollHeight;
    };
    const qbox = $('#chat-quote', host);
    $('button', qbox).onclick = () => { quote = ''; qbox.hidden = true; };
    if (quote) { qbox.hidden = false; $('span', qbox).textContent = quote.slice(0, 60); }

    // 选项：老师讲的时间范围 + 快速/详细思考，记在本机
    const opt = ChatOpt.get();
    const syncOpts = () => {
      $$('#chat-win [data-w]', host).forEach(b => b.classList.toggle('on', Number(b.dataset.w) === opt.win));
      $$('#chat-mode [data-m]', host).forEach(b => b.classList.toggle('on', b.dataset.m === opt.mode));
    };
    $$('#chat-win [data-w]', host).forEach(b => b.onclick = () => { opt.win = Number(b.dataset.w); ChatOpt.set({ win: opt.win }); syncOpts(); });
    $$('#chat-mode [data-m]', host).forEach(b => b.onclick = () => { opt.mode = b.dataset.m; ChatOpt.set({ mode: opt.mode }); syncOpts(); });
    syncOpts();

    async function send(text, { scope, label, win } = {}) {
      if (busy) return;
      if (!Settings.load().deepseekKey) { toast('先去设置里填 DeepSeek key'); return; }
      const w = win != null ? win : opt.win; // 秒；0 = 全部材料
      scope = scope || (w ? 'recent' : 'all');
      const live = getLive && getLive();
      const sessionId = note && note.sessionId;
      const session = live ? { segments: live.segments, title: '正在录的这节课' } : sessionId ? await DB.get('sessions', sessionId) : null;
      let context, noteLine = '';
      if (scope === 'recent') {
        const secs = w || 60;
        const human = secs < 60 ? secs + ' 秒' : Math.round(secs / 60) + ' 分钟';
        const segs = (session ? session.segments : []);
        const end = live ? live.elapsed() : (segs.length ? segs[segs.length - 1].t + 10 : 0);
        const recent = segs.filter(g => g.t >= end - secs);
        const interim = live && live.turn ? `\n[正在说] ${live.turn.text || ''}` : '';
        if (!recent.length && !interim.trim()) { toast(live ? `最近 ${human}还没有转写内容` : '现在没有在听课本里录音，用不了「老师讲的」时间范围。选「全部」就会看笔记和课件来回答。', 6000); return; }
        context = `## 老师最近 ${human}说的话（语音识别，可能有错字）\n${segText(recent)}${interim}` + (note && note.markdown ? `\n\n## 这节课的笔记（参考）\n${note.markdown.slice(0, 12000)}` : '');
        noteLine = `用了老师最近 ${human}讲的（${recent.length} 句）`;
      } else {
        context = await buildContext({ note, course, fileIds: getFileIds && getFileIds(), session, pageHint: getPage && await getPage() });
        if (getExtra) context += '\n\n' + await getExtra();
      }
      const q = quote ? `关于这段：「${quote}」\n${text}` : text;
      quote = ''; qbox.hidden = true;
      store.chat.push({ role: 'user', content: label || q, t: Date.now() });
      busy = { text: '', ctl: new AbortController() }; paint();
      const history = store.chat.slice(-9, -1).filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
      try {
        const ans = await AI.deepseekStream({
          system: AI.chatSystem({ courseName: course && course.name, context }) + (opt.mode === 'deep' ? '\n\n【详细思考模式】把道理讲透：先给结论，再分步骤解释，必要时举例、指出容易混淆的地方。' : '\n\n【快速模式】回答要短：先一句话给结论，最多再补 3 个要点，不要铺垫。'),
          messages: [...history, { role: 'user', content: q }],
          thinking: opt.mode === 'deep', maxTokens: opt.mode === 'deep' ? 8000 : 1500, signal: busy.ctl.signal, purpose: 'chat',
          onThinking: opt.mode === 'deep' ? t => { busy.think = t; paint(); } : undefined,
          onText: t => { busy.text = t; paint(); },
        });
        store.chat.push({ role: 'assistant', content: ans, t: Date.now(), note: [noteLine, opt.mode === 'deep' ? '详细思考' : '快速'].filter(Boolean).join(' · ') });
      } catch (e) {
        store.chat.push({ role: 'assistant', content: '（出错了：' + e.message + '）', t: Date.now() });
      }
      if (store.chat.length > 80) store.chat = store.chat.slice(-80);
      busy = null; paint();
      await DB.put(note ? 'notes' : 'courses', store);
    }
    $('#chat-send', host).onclick = () => { const t = input.value.trim(); if (!t) { toast('先在框里输入问题，或者点上面的快捷问题'); input.focus(); return; } input.value = ''; send(t); };
    input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#chat-send', host).click(); } };
    confirmClick($('#chat-clear', host), '确认清空', async () => { store.chat = []; await DB.put(note ? 'notes' : 'courses', store); paint(); });
    $$('[data-s]', host).forEach(b => b.onclick = () => send(b.dataset.s));
    $$('[data-q]', host).forEach(b => b.onclick = async () => {
      const k = b.dataset.q;
      if (k === 'teacher') return send('老师刚才问了什么问题？请先用一句中文复述老师的问题（附英文原话），再给出答案和简单解释；如果老师是在让大家讨论或做练习，也说清楚要做什么。如果最近没有提问，就用三句话总结老师刚才讲了什么。', { scope: 'recent', win: opt.win || 60, label: '🙋 老师刚才问了什么？' });
      if (k === 'hard') return send('这份材料里最难懂的 3 个概念是什么？每个用大白话解释，再举一个例子。');
      if (k === 'page') {
        const p = getPage && await getPage();
        if (!p) return send('用要点总结这份笔记的核心内容（不超过 8 条）。', { label: '总结这一页' });
        return send(`总结我正在看的课件《${p.name}》第 ${p.page} 页：讲了什么、关键词、可能怎么考。`, { label: `总结这一页（${p.name} 第 ${p.page} 页）` });
      }
      if (k === 'quiz') return send('根据材料出 3 道考试风格的题（选择或计算），答案和解析直接写在每道题下面。');
    });
    paint();
    return { send };
  }
  function setQuote(t) { quote = t; const q = $('#chat-quote'); if (q) { q.hidden = false; $('span', q).textContent = t.length > 60 ? t.slice(0, 60) + '…' : t; } }
  return { mount, setQuote };
})();

/* 右侧抽屉（笔记页用） */
function chatDrawer(opts) {
  let d = $('#drawer');
  if (!d) { d = document.createElement('aside'); d.id = 'drawer'; d.className = 'drawer'; document.body.appendChild(d); }
  d.innerHTML = `<div class="drawer-head"><b>问 AI</b><span class="grow"></span><button class="btn small ghost" id="dr-x" aria-label="关闭">✕</button></div><div class="drawer-body"></div>`;
  d.hidden = false; requestAnimationFrame(() => d.classList.add('open'));
  $('#dr-x', d).onclick = () => { d.classList.remove('open'); setTimeout(() => { d.hidden = true; }, 200); };
  Chat.mount($('.drawer-body', d), opts);
  setTimeout(() => $('#chat-text', d)?.focus(), 250);
}
window.addEventListener('hashchange', () => { const d = $('#drawer'); if (d) { d.classList.remove('open'); d.hidden = true; } });

/* ======================================================================
   手写笔记 + 课堂录音：把老师讲的 + 我的手写，整理进笔记下半部分
   ====================================================================== */
const Recap = (() => {
  const START = '<!-- 课堂总结 开始 -->', END = '<!-- 课堂总结 结束 -->';
  const SYSTEM = `你是给英语不好的中国留学生（Monash 马来西亚分校商科 Diploma）整理课堂笔记的助教。用简体中文写，专业术语写成「中文（English）」。
你会拿到：已经根据课件写好的笔记、这节课的录音转写（语音识别，有错字，自己结合上下文纠正）、学生在课上手写的内容、学生标记的重点时间点。
任务：写笔记的下半部分「课堂上老师提到的」，只写课件笔记里没有、或者老师特别强调的东西，不要把课件笔记再抄一遍。
格式（Markdown，没有的小节直接省略）：
## 课堂上老师提到的
### 老师特别强调的（可能考）
### 课件之外的补充（例子、解释、经验）
### 考试 / 作业 / 截止日期相关
### 课堂上的提问和答案
### 我没听懂的地方（用中文讲清楚）
### 我的手写笔记整理
### 这节课讲了课件的哪些部分
每条后面标时间，例如（12:30）。拿不准的标「（不确定）」。简洁，用要点。`;

  /* ---------- 手写识别 ----------
     旧做法：把最多 10 页塞进同一次请求 —— 图被挤小、模型在几张图之间来回对齐，
     越往后的页认得越差，而且一页失败全军覆没。
     现在改成一次一页，每页带自检：认得不干净就自动换模型 / 画得更大 /
     把一页切成上下两半分开认，几份结果里留最好的那份。 */
  const HW_MAX_PAGES = 14;
  /* 词组级的「没认出来」：只有这些字样时继续往下试 */
  const HW_EMPTY = /^(?:[（(\[【]?\s*(?:看不清|高亮|空白)\s*[）)\]】]?|[\s\-—–·.,，。、→*#])+$/;
  const hwPrompt = which => `这是一张 iPad 上 Apple Pencil 手写笔记的截图（${which}，已裁好，只剩笔迹）。请只转写手写的内容。
规则：
1. 按书写顺序逐行输出，保留原本的分行和缩进；两栏并排的字先左栏后右栏。
2. 圈、划、箭头、大括号用文字说清楚：「圈出：elasticity」「下划线：demand curve」「→ 考点」。
3. 公式写成普通文字：x^2、a/b、ΔQ/ΔP、MC=MR。
4. 中英文照抄，不要翻译、不要补全、不要总结，不要加标题或序号。
5. 认不出的单个字用「□」，整行认不出写「（看不清）」。宁可留空也不要编，图里没有的字一个都不许出现。
6. 只有荧光笔、没有写字的地方写「（高亮）」；图里没有任何笔迹就只输出「（空白）」。
只输出转写结果，不要任何前言和解释。`;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isRateErr = e => !!e && (e.status === 429 || /429|resource_exhausted|rate limit/i.test(String(e.message || '')));
  /* 这页认得干不干净：「看不清/□」太多，或者写了厚厚一页却只认出几个字，都算不行 */
  function hwPoor(text, page) {
    if (!text || HW_EMPTY.test(text)) return true;
    const body = text.replace(/\s/g, '');
    const bad = (text.match(/看不清|□/g) || []).length;
    if (bad >= 4 || bad * 6 > body.length) return true;
    const strokes = (page.strokes || []).length;
    if (strokes >= 18 && body.length < strokes * 2) return true;
    return false;
  }
  /* 几次尝试里留最好的一份：字越多越好，「看不清/□」越多越扣分 */
  const hwScore = t => !t ? -1 : t.replace(/\s/g, '').length - (t.match(/看不清|□/g) || []).length * 6;

  async function handwriting(note, onProgress) {
    const s = Settings.load();
    if (!s.geminiKey) throw new Error('识别手写要用 Gemini（免费），先到「设置 → AI 和 API key」填 Gemini key');
    const pages = (note.board?.pages || []).map((p, i) => ({ p, n: i + 1 })).filter(x => x.p.strokes && x.p.strokes.length);
    if (!pages.length) return '';
    const use = pages.slice(0, HW_MAX_PAGES);

    // 手写识别比翻译难，用「聪明」那档模型，不是 fastest 那档
    const strong = s.geminiSmartModel || 'gemini-3.8-flash';
    const fast = s.geminiFastModel || 'gemini-3.1-flash-lite';

    /* 一页 → 一张 PNG：裁到笔迹范围再放大，字才够清楚 */
    function shot(page, w, bold, region) {
      const c = Board.inkImage(page, w, 4.2e6, bold, region);
      if (!c) return null;
      const data = Board.shoot(c, 'image/png').split(',')[1] || '';
      return data.length > 64 ? data : null;
    }
    async function one(data, which, model) {
      if (!data) throw new Error('这一页没有笔迹');
      const txt = await AI.gemini({
        model, temperature: .05, maxTokens: 2800,
        parts: [{ inlineData: { mimeType: 'image/png', data } }, { text: hwPrompt(which) }],
      });
      return String(txt || '').trim();
    }
    /* 整页写得密密麻麻认不干净时：切成上下两半（中间留一点重叠）分开认 */
    async function halves(page, model) {
      const b = Board.inkBox(page); if (!b) return '';
      const midY = (b.y0 + b.y1) / 2, ov = Math.max(30, (b.y1 - b.y0) * .06);
      const out = [];
      const parts = [
        [{ x0: b.x0, y0: b.y0, x1: b.x1, y1: midY + ov }, '上半部分'],
        [{ x0: b.x0, y0: midY - ov, x1: b.x1, y1: b.y1 }, '下半部分'],
      ];
      for (const [r, which] of parts) {
        const d = shot(page, 2000, 1.12, r); if (!d) continue;
        const t = await one(d, '同一页手写笔记的' + which, model);
        if (t && !HW_EMPTY.test(t)) out.push(t);
      }
      return out.join('\n\n');
    }

    const chunks = [], failed = [];
    let missRow = 0;
    for (let i = 0; i < use.length; i++) {
      const { p, n } = use[i];
      onProgress && onProgress(`正在识别手写 ${i + 1}/${use.length} 页…`);
      // 一页最多四次机会：强模型 → 换个模型再看一遍 → 画大一点、笔迹加粗 → 切成上下两半
      const tries = [
        () => one(shot(p, 2000, 1), '整页', strong),
        () => one(shot(p, 2000, 1), '整页', fast),
        () => one(shot(p, 2800, 1.18), '整页', strong),
        () => halves(p, strong),
      ];
      let best = '', bestScore = -1;
      for (const fn of tries) {
        let t = '';
        try { t = await fn(); }
        catch (e) {
          if (!isRateErr(e)) continue;
          await sleep(12000); // 撞到每分钟限额：等一下，把这次试完
          try { t = await fn(); } catch (e2) { continue; }
        }
        const sc = hwScore(t);
        if (sc > bestScore) { best = t; bestScore = sc; }
        if (!hwPoor(t, p)) break; // 这一页已经认干净，后面的机会留给别的页
      }
      if (best && !HW_EMPTY.test(best)) { chunks.push(`[第${n}页]\n${best}`); missRow = 0; }
      else if (!/^[（(\[【]?\s*空白\s*[）)\]】]?$/.test(best || '')) {
        failed.push(n);
        // 连着几页全认不出，多半是笔迹/拍照问题，别把免费次数烧完
        if (++missRow >= 3 && i < use.length - 1) { onProgress && onProgress('连着几页都没认出来，先停了'); break; }
      }
    }

    if (!chunks.length) throw new Error('手写没认出来（笔迹太淡或太乱），换清楚一点的一页再试');
    if (failed.length) toast(`第 ${failed.join('、')} 页没认出来，已经跳过`, 6000);
    return chunks.join('\n\n');
  }

  async function run(note, course, { onStatus } = {}) {
    const session = note.sessionId ? await DB.get('sessions', note.sessionId) : null;
    if (!session || !session.segments.length) throw new Error('这份笔记还没有关联课堂录音');
    if (!Settings.load().deepseekKey) throw new Error('先去设置里填 DeepSeek key');
    const job = Jobs.start('recap:' + note.id, '整理这节课：' + note.title);
    try { return await runInner(note, course, session, job, onStatus); } finally { job.done(); }
  }
  async function runInner(note, course, session, job, onStatus) {
    const inkPages = (note.board?.pages || []).filter(p => p.strokes && p.strokes.length).length;
    if (inkPages) job.phase('正在识别画板上的手写', 0, .3, { expectSec: Math.min(90, 6 + inkPages * 4) });
    onStatus && onStatus('正在识别手写…');
    let hw = '';
    try {
      hw = await handwriting(note, t => { job.sub(t); onStatus && onStatus(t); });
    }
    catch (e) { toast('手写识别没成功（' + String(e.message).slice(0, 70) + '），这次先用录音整理', 6000); }
    const body = (note.markdown || '').split(START)[0].trim();
    // 笔记还是空的：直接走完整的笔记生成（课件 + 录音 + 手写一起）
    if (!body) return { full: true, handwriting: hw };
    onStatus && onStatus('正在整理老师讲的内容…');
    job.phase('正在读录音转写（老师讲了什么）', .3, .4, { expectSec: 8 });
    const user = `课程：${course ? course.name : ''}\n笔记标题：${note.title}\n\n<课件笔记>\n${body.slice(0, 60000)}\n</课件笔记>\n\n<学生标记的重点时间>\n${(session.highlights || []).map(h => `[${fmtTime(h.t)}] ${h.near || ''}`).join('\n') || '（没有）'}\n</学生标记的重点时间>\n\n<学生没听懂的地方（请在「课堂上老师提到的」里加一个小节「我没听懂的地方」，用中文讲清楚）>\n${(session.confused || []).map(c => `[${fmtTime(c.t)}] ${c.near || ''}`).join('\n') || '（没有）'}\n</学生没听懂的地方>\n\n<学生手写>\n${hw || '（没有手写）'}\n</学生手写>\n\n<录音转写>\n${sessionTranscript(session).slice(0, 150000)}\n</录音转写>`;
    let out = '';
    out = await AI.deepseekStream({ system: SYSTEM, user, thinking: false, maxTokens: 8000, purpose: 'recap', onText: t => { if (!out) job.phase('正在写「课堂上老师提到的」', .4, .97, { expectLen: 3500 }); out = t; job.len(t.length).sub(`已写 ${t.length} 字`); onStatus && onStatus(`正在写课堂总结…（${t.length} 字）`); } });
    note.markdown = `${body}\n\n${START}\n${out.trim()}\n${END}\n`;
    note.recapAt = Date.now();
    await DB.put('notes', note);
    return { full: false };
  }
  /* 只有手写、没有录音：识别手写，整理后并入笔记 */
  const HS = '<!-- 手写整理 开始 -->', HE = '<!-- 手写整理 结束 -->';
  async function handwritingMerge(note, course, onStatus) {
    if (!Board.hasInk(note)) throw new Error('画板上还没有手写');
    if (!Settings.load().geminiKey) throw new Error('识别手写要用 Gemini（免费），先去设置里填 Gemini key');
    const job = Jobs.start('hw:' + note.id, '识别手写：' + note.title);
    try {
    const inkPages = (note.board?.pages || []).filter(p => p.strokes && p.strokes.length).length;
    const total = Math.min(HW_MAX_PAGES, inkPages);
    job.phase('正在识别手写', 0, .55, { expectSec: Math.min(90, 6 + total * 4) });
    onStatus && onStatus('正在识别手写…');
    const hw = await handwriting(note, t => { job.sub(t); onStatus && onStatus(t); });
    if (!hw.trim()) throw new Error('没有识别出手写内容');
    let out = hw;
    if (Settings.load().deepseekKey) {
      onStatus && onStatus('正在整理…');
      job.phase('正在整理手写笔记', .55, .97, { expectLen: 1500 });
      out = await AI.deepseekStream({ onText: t => job.len(t.length), system: '你在帮英语不好的中国留学生整理他自己上课时的手写笔记。保留他写的内容和意思，只把顺序理清、错字改正、补上缺的英文术语。中文解释，术语写成 中文（English）。不要编他没写的东西。输出 Markdown 要点，不要标题。', user: `课程：${course ? course.name : ''}\n笔记：${note.title}\n\n<课件笔记（参考，用来对上术语）>\n${(note.markdown || '').split(HS)[0].slice(0, 20000)}\n</课件笔记>\n\n<手写识别结果>\n${hw}\n</手写识别结果>`, thinking: false, maxTokens: 4000, purpose: 'recap' });
    }
    const base = (note.markdown || '').replace(new RegExp(HS + '[\\s\\S]*?' + HE + '\\n?'), '').trimEnd();
    note.markdown = `${base}\n\n${HS}\n## 我的手写笔记\n${out.trim()}\n${HE}\n`;
    await DB.put('notes', note);
    } finally { job.done(); }
  }
  return { run, START, END, handwritingMerge };
})();

/* ======================================================================
   课件全文翻译（DeepSeek，不开思考，按页分批）
   ====================================================================== */
const DocTr = (() => {
  const running = new Map();
  async function translate(f, onProgress) {
    if (running.has(f.id)) return running.get(f.id);
    const job = Jobs.start('tr:' + f.id, '翻译课件：' + f.name);
    const p = (async () => {
      const pages = splitPages(f.text);
      const chunks = []; let cur = '';
      for (const pg of pages) { const block = `[第${pg.n}页]\n${pg.text}\n\n`; if (cur && cur.length + block.length > 6000) { chunks.push(cur); cur = ''; } cur += block; }
      if (cur) chunks.push(cur);
      let done = '';
      for (let i = 0; i < chunks.length; i++) {
        job.phase(`正在翻译 第 ${i + 1} / ${chunks.length} 段`, i / chunks.length, (i + 1) / chunks.length, { expectLen: chunks[i].length * .8 });
        const piece = await AI.deepseekStream({ system: AI.DOC_TR_SYSTEM, user: AI.docTranslatePrompt(chunks[i]), thinking: false, maxTokens: 8000, purpose: 'doctr', onText: t => { job.len(t.length); onProgress && onProgress(done + t, i + 1, chunks.length); } });
        done += piece.trim() + '\n\n';
        f.translation = done; await DB.put('files', f);
      }
      f.translation = done; f.translationDone = true; await DB.put('files', f);
      return done;
    })().finally(() => job.done());
    running.set(f.id, p);
    try { return await p; } finally { running.delete(f.id); }
  }
  const estimate = f => { const chars = (f.text || '').length; return Math.max(0.01, (chars / 3.5 * 2 + chars * 0.9 * 8) / 1e6); };
  return { translate, estimate, running };
})();

/* PDF 一页：画布 + 透明文字层（可以选中文字复制 / 翻译） */
async function renderPdfPageInto(el, fileId, pageNum) {
  const d = await Pdf.doc(fileId); const page = await d.getPage(pageNum);
  const cssW = el.clientWidth || 600, dpr = Math.min(2, devicePixelRatio || 1);
  const vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: cssW / vp0.width });
  const c = await Pdf.render(fileId, pageNum, Math.min(2400, Math.round(cssW * dpr)));
  const canvas = document.createElement('canvas'); canvas.width = c.width; canvas.height = c.height; canvas.getContext('2d').drawImage(c, 0, 0);
  el.innerHTML = ''; el.style.aspectRatio = 'auto'; el.appendChild(canvas);
  try {
    const tl = document.createElement('div'); tl.className = 'textLayer';
    tl.style.width = vp.width + 'px'; tl.style.height = vp.height + 'px'; tl.style.setProperty('--scale-factor', vp.scale);
    el.appendChild(tl);
    const tc = await page.getTextContent();
    const task = pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: vp, textDivs: [] });
    await (task.promise || task);
  } catch (e) { /* 没有文字层也能看 */ }
}

/* 把中文翻译按「## 第N页」拆开 */
function trByPage(tr) {
  const out = {}; const re = /^#{1,3}\s*第\s*(\d+)\s*页\s*$/gm; let m, last = null;
  while ((m = re.exec(tr || ''))) { if (last) out[last.n] = tr.slice(last.end, m.index).trim(); last = { n: Number(m[1]), end: re.lastIndex }; }
  if (last) out[last.n] = tr.slice(last.end).trim();
  return out;
}
/* 笔记里引用了第 N 页的段落 */
function noteRefsByPage(markdown) {
  const out = {};
  (markdown || '').split('\n').forEach(line => {
    const t = line.trim(); if (!t || /^#/.test(t)) return;
    const re = /\[p\.?\s*(\d+)/g; let m;
    while ((m = re.exec(t))) { const n = Number(m[1]); (out[n] = out[n] || []).push(t.replace(/^[-*]\s*/, '')); }
  });
  return out;
}

/* 看课件：原文 / 对照（逐页，课件和中文一起滑）/ 中文 / 预习 */
/* ======================================================================
   课件标注：在 PDF 课件页上直接写字 / 划重点。笔迹存在课件记录里（f.ink），会跟着云同步
   iPad：Apple Pencil 写，手指照常滚动；Mac：打开「标注」后用鼠标写
   ====================================================================== */
const DocInk = (() => {
  const W = 1000;
  const pref = () => { try { return Object.assign({ tool: 'pen', color: Board.INK[2], size: 3 }, JSON.parse(localStorage.getItem('tingkeben.docink') || '{}')); } catch (e) { return { tool: 'pen', color: '#C0392B', size: 3 }; } };
  const savePref = p => { try { localStorage.setItem('tingkeben.docink', JSON.stringify(Object.assign(pref(), p))); } catch (e) {} };

  // 一份课件一个控制器：管工具、撤销、保存
  function controller(f) {
    f.ink = f.ink || {};
    const P = pref(), undo = [], layers = new Map();
    let on = false, save = null, penDown = false;
    const persist = () => { clearTimeout(save); save = setTimeout(async () => { const full = await DB.get('files', f.id); if (!full) return; full.ink = f.ink; await DB.put('files', full); }, 800); };
    const paint = (L) => {
      const ctx = L.c.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, L.c.width, L.c.height);
      const sc = L.c.width / W; (f.ink[L.p] || []).forEach(st => Board.drawStroke(ctx, st, sc));
    };
    function attach(pageEl, p) {
      // 同一页重新渲染时（换栏宽、重新打开）只把原来的手写层放回去，不重复绑定事件
      if (pageEl._ink) { const L0 = pageEl._ink; if (!L0.c.isConnected) pageEl.appendChild(L0.c); layers.set(p, L0); size(L0); L0.c.style.pointerEvents = on ? 'auto' : ''; return; }
      const c = document.createElement('canvas'); c.className = 'docink';
      pageEl.appendChild(c);
      const L = { el: pageEl, c, p }; layers.set(p, L); pageEl._ink = L;
      size(L);
      let cur = null;
      const pos = e => { const r = c.getBoundingClientRect(); const k = W / r.width; return [Math.round((e.clientX - r.left) * k * 10) / 10, Math.round((e.clientY - r.top) * k * 10) / 10, e.pointerType === 'pen' ? (e.pressure || .5) : .5]; };
      // Apple Pencil 不管开没开标注都能写（像在纸上一样）；鼠标要先打开「标注」；手指永远是滚动
      const allowed = e => e.pointerType === 'pen' ? true : e.pointerType === 'touch' ? false : on && e.button === 0;
      pageEl.addEventListener('touchstart', e => { if ([...e.touches].some(t => t.touchType === 'stylus')) e.preventDefault(); }, { passive: false });
      pageEl.addEventListener('touchmove', e => { if ([...e.touches].some(t => t.touchType === 'stylus')) e.preventDefault(); }, { passive: false });
      pageEl.addEventListener('pointerdown', e => {
        if (!allowed(e)) return;
        if (e.pointerType === 'pen') penDown = true;
        e.preventDefault(); try { pageEl.setPointerCapture(e.pointerId); } catch (err) {}
        const pt = pos(e);
        if (P.tool === 'er') { cur = { er: true, id: e.pointerId, removed: [] }; erase(L, pt, cur); return; }
        cur = { id: e.pointerId, s: { tool: P.tool, c: P.tool === 'hl' ? '#FFD400' : P.color, w: P.tool === 'hl' ? 22 : P.size, pts: [pt] } };
      });
      pageEl.addEventListener('pointermove', e => {
        if (!cur || e.pointerId !== cur.id) return;
        e.preventDefault();
        const co = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const ev of (co.length ? co : [e])) {
          const pt = pos(ev);
          if (cur.er) { erase(L, pt, cur); continue; }
          const pts = cur.s.pts, last = pts[pts.length - 1];
          if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 1.2) continue;
          pts.push(pt);
          const ctx = c.getContext('2d'), sc = c.width / W;
          if (cur.s.tool === 'hl') { paint(L); Board.drawStroke(ctx, cur.s, sc); } else Board.drawStroke(ctx, { ...cur.s, pts: [last, pt] }, sc);
        }
      });
      const end = e => {
        if (e.pointerType === 'pen') penDown = false;
        if (!cur || e.pointerId !== cur.id) return;
        if (cur.er) { if (cur.removed.length) { undo.push({ p, er: cur.removed }); persist(); } }
        else { (f.ink[p] = f.ink[p] || []).push(cur.s); undo.push({ p, add: cur.s }); persist(); }
        cur = null;
      };
      pageEl.addEventListener('pointerup', end); pageEl.addEventListener('pointercancel', end);
      c.style.pointerEvents = on ? 'auto' : '';
    }
    function size(L) {
      const r = L.el.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      if (!r.width) return;
      L.c.width = Math.round(r.width * dpr); L.c.height = Math.round(r.height * dpr);
      paint(L);
    }
    function erase(L, pt, cur) {
      const list = f.ink[L.p] || [], keep = [];
      let hit = false;
      for (const st of list) { if (st.pts.some(q => Math.hypot(q[0] - pt[0], q[1] - pt[1]) < 16 + st.w / 2)) { cur.removed.push(st); hit = true; } else keep.push(st); }
      if (hit) { f.ink[L.p] = keep; paint(L); }
    }
    return {
      attach, resize: () => layers.forEach(size),
      get on() { return on; },
      setOn(v) { on = v; layers.forEach(L => { L.c.style.pointerEvents = v ? 'auto' : ''; L.el.classList.toggle('inking', v); }); },
      tool: () => P,
      setTool(patch) { Object.assign(P, patch); savePref(patch); },
      undo() { const a = undo.pop(); if (!a) { toast('没有可以撤销的'); return; } if (a.add) f.ink[a.p] = (f.ink[a.p] || []).filter(x => x !== a.add); else (f.ink[a.p] = f.ink[a.p] || []).push(...a.er); const L = layers.get(a.p); if (L) paint(L); persist(); },
      clearPage(p) { const had = f.ink[p] || []; if (!had.length) return false; undo.push({ p, er: had }); f.ink[p] = []; const L = layers.get(p); if (L) paint(L); persist(); return true; },
      count: () => Object.values(f.ink).reduce((a, l) => a + l.length, 0),
    };
  }
  return { controller };
})();

function mountDocViewer(host, f, { onPage, note, course } = {}) {
  let mode = host._mode || 'orig';
  const ink = isPdf(f) ? DocInk.controller(f) : null;
  const modes = [['orig', '原文'], ['pair', '对照'], ['zh', '中文'], ['prep', '课前包']];
  const paint = async () => {
    host._mode = mode;
    host.innerHTML = `
      <div class="doc-tools noprint">
        <div class="seg">${modes.map(([k, l]) => `<button data-m="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="grow hint" id="dv-page"></span>
        <button class="btn small" id="dv-ink" hidden title="在课件上直接写字、划重点（Apple Pencil 不用打开也能写）">✎ 标注</button>
        <button class="btn small ghost" id="dv-add" hidden>＋到画板</button>
      </div>
      <div class="doc-inkbar noprint" id="dv-inkbar" hidden>
        <div class="seg"><button data-it="pen">✎ 笔</button><button data-it="hl">▮ 荧光</button><button data-it="er">⌫ 橡皮</button></div>
        <div class="seg colors">${Board.INK.map(c => `<button data-ic="${c}" style="--sw:${c}" aria-label="颜色"></button>`).join('')}</div>
        <div class="seg"><button data-ia="undo" title="撤销">↶</button><button data-ia="clear" title="清掉这一页的标注">清本页</button></div>
        <span class="hint">${Device.touch ? '用 Apple Pencil 写，手指滚动' : '按住鼠标左键在课件上写'}</span>
      </div>
      <div class="doc-body" id="dv-body"></div>`;
    $$('[data-m]', host).forEach(b => b.onclick = () => { mode = b.dataset.m; paint(); });
    const body = $('#dv-body', host);
    const trNeeded = () => {
      body.innerHTML = `<div class="empty"><strong>还没翻译</strong>整份课件逐页翻成中文，术语保留英文（DeepSeek，约 ¥${DocTr.estimate(f).toFixed(2)}）。翻好之后「中文」和「对照」都能看。<div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="dv-tr">翻译整份课件</button></div></div>`;
      $('#dv-tr', body).onclick = () => run();
    };
    if (mode === 'prep') return Prep.mount(body, f, course);
    if (mode === 'zh') {
      if (!f.translation && !DocTr.running.has(f.id)) return trNeeded();
      body.innerHTML = (DocTr.running.has(f.id) ? Jobs.slot('tr:' + f.id) : '') + `<div class="md tr-text">${md(f.translation || '')}</div>`;
      if (DocTr.running.has(f.id)) DocTr.running.get(f.id).then(() => { if (host.isConnected && mode === 'zh') paint(); });
      return;
    }
    const pdf = isPdf(f);
    let n;
    if (pdf) { try { n = await Pdf.count(f.id); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; } }
    const textPages = splitPages(f.text);
    if (!pdf) n = textPages.length ? Math.max(...textPages.map(p => p.n)) : 0;
    const tr = trByPage(f.translation), refs = noteRefsByPage(note && note.markdown);
    const pageBox = p => pdf ? `<div class="pdfpage" data-p="${p}"><div class="ph">第 ${p} 页</div></div>` : `<div class="docpage" data-p="${p}"><div class="hint">第 ${p} 页</div><div class="doc-text">${esc((textPages.find(x => x.n === p) || {}).text || '')}</div></div>`;
    if (mode === 'pair') {
      if (!f.translation && !DocTr.running.has(f.id) && !Object.keys(refs).length) return trNeeded();
      body.innerHTML = (DocTr.running.has(f.id) ? Jobs.slot('tr:' + f.id) : '') + (f.translation || DocTr.running.has(f.id) ? '' : `<div class="banner"><div class="grow">还没翻译，右边只显示笔记里引用这一页的内容。</div><button class="btn small primary" id="dv-tr2">翻译整份课件</button></div>`) +
        Array.from({ length: n }, (_, i) => i + 1).map(p => `<div class="pair" data-p="${p}">${pageBox(p)}<div class="pair-zh">${tr[p] ? `<div class="md">${md(tr[p])}</div>` : DocTr.running.has(f.id) ? '<div class="hint">翻译中…</div>' : ''}${refs[p] ? `<div class="pair-note"><div class="hint">笔记里讲到这一页</div>${refs[p].map(t => `<div class="md">${md(t)}</div>`).join('')}</div>` : ''}${!tr[p] && !refs[p] && !DocTr.running.has(f.id) ? '<div class="hint">（这页没有内容）</div>' : ''}</div></div>`).join('');
      const t2 = $('#dv-tr2', body); if (t2) t2.onclick = () => run();
      if (DocTr.running.has(f.id)) DocTr.running.get(f.id).then(() => { if (host.isConnected && mode === 'pair') paint(); });
    } else body.innerHTML = Array.from({ length: n }, (_, i) => i + 1).map(pageBox).join('') || '<div class="empty">没有文字</div>';
    if (pdf) {
      const io = new IntersectionObserver(ents => ents.forEach(async en => {
        if (!en.isIntersecting) return; const el = en.target; io.unobserve(el);
        try { await renderPdfPageInto(el, f.id, Number(el.dataset.p)); if (ink && el.isConnected) ink.attach(el, Number(el.dataset.p)); } catch (e) { el.innerHTML = `<div class="ph">第 ${el.dataset.p} 页加载失败</div>`; }
      }), { root: body, rootMargin: '800px' });
      $$('.pdfpage', body).forEach(el => io.observe(el));
    }
    const sel = mode === 'pair' ? '.pair' : pdf ? '.pdfpage' : '.docpage';
    const cur = new IntersectionObserver(ents => ents.forEach(en => { if (en.isIntersecting && en.intersectionRatio > .3) { const p = Number(en.target.dataset.p); host.dataset.page = p; const pg = $('#dv-page', host); if (pg) pg.textContent = `第 ${p} / ${n} 页`; onPage && onPage(p); } }), { root: body, threshold: [.3] });
    $$(sel, body).forEach(el => cur.observe(el));
    host.dataset.page = 1; $('#dv-page', host).textContent = `共 ${n} 页`;
    const goto = e => { if (!host.isConnected) { document.removeEventListener('tkb-goto-page', goto); return; } const el = $(`${sel}[data-p="${e.detail.page}"]`, body); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    document.addEventListener('tkb-goto-page', goto);
    const add = $('#dv-add', host); add.hidden = !(host._onAddPage && pdf); add.onclick = () => host._onAddPage && host._onAddPage(f.id, Number(host.dataset.page || 1));
    if (ink && pdf) {
      const ib = $('#dv-ink', host), bar = $('#dv-inkbar', host);
      ib.hidden = false;
      const syncBar = () => {
        const T = ink.tool();
        ib.classList.toggle('on', ink.on); bar.hidden = !ink.on;
        $$('[data-it]', bar).forEach(b => b.classList.toggle('on', b.dataset.it === T.tool));
        $$('[data-ic]', bar).forEach(b => b.classList.toggle('on', b.dataset.ic === T.color));
      };
      ib.onclick = () => { ink.setOn(!ink.on); syncBar(); };
      $$('[data-it]', bar).forEach(b => b.onclick = () => { const T = ink.tool(); ink.setTool({ tool: b.dataset.it === T.tool && b.dataset.it !== 'er' ? 'er' : b.dataset.it }); syncBar(); });
      $$('[data-ic]', bar).forEach(b => b.onclick = () => { ink.setTool({ color: b.dataset.ic, tool: ink.tool().tool === 'er' ? 'pen' : ink.tool().tool }); syncBar(); });
      $('[data-ia=undo]', bar).onclick = () => ink.undo();
      $('[data-ia=clear]', bar).onclick = () => { if (!ink.clearPage(Number(host.dataset.page || 1))) toast('这一页没有标注'); };
      ink.setOn(ink.on); syncBar();
      let rz; const ro = new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { if (!body.isConnected) { ro.disconnect(); return; } ink.resize(); }, 150); }); ro.observe(body);
    }
  };
  const run = async () => {
    if (!Settings.load().deepseekKey) { toast('先去设置里填 DeepSeek key'); return; }
    const pr = DocTr.translate(f, (t) => { const el = $('.tr-text', host); if (el && mode === 'zh') el.innerHTML = md(t); });
    paint();
    try { await pr; toast('翻译完成：' + f.name); } catch (e) { toast(e.message, 6000); }
    if (host.isConnected) paint();
  };
  paint();
  return { page: () => Number(host.dataset.page || 1) };
}

/* ======================================================================
   课前包：5 分钟预习卡 + 术语表（带发音）
   ====================================================================== */
const Prep = (() => {
  const running = new Map();
  function speak(text) {
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = 'en-GB'; u.rate = .9;
      const v = speechSynthesis.getVoices().find(v => /en-GB/i.test(v.lang)) || speechSynthesis.getVoices().find(v => /^en/i.test(v.lang)); if (v) u.voice = v;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (e) { toast('这个浏览器不支持朗读'); }
  }
  async function make(f, course, onText) {
    if (running.has(f.id)) return running.get(f.id);
    const job = Jobs.start('prep:' + f.id, '课前包：' + f.name);
    let first = true;
    const p = (async () => {
      const full = await DB.get('files', f.id);
      const pack = await AI.prepPack({ name: full.name, text: full.text || '', courseName: course && course.name, onText: t => { if (first) { first = false; job.phase('正在写预习卡和术语表', .08, .97, { expectLen: 4500 }); } job.len(t.length).sub(`已写 ${t.length} 字`); onText && onText(t); } });
      full.prep = pack; await DB.put('files', full); Object.assign(f, { prep: pack });
      return pack;
    })().finally(() => job.done());
    running.set(f.id, p);
    try { return await p; } finally { running.delete(f.id); }
  }
  function mount(el, f, course) {
    const pk = f.prep;
    if (!pk) {
      if (running.has(f.id)) { el.innerHTML = Jobs.slot('prep:' + f.id); running.get(f.id).then(() => el.isConnected && mount(el, f, course)).catch(() => el.isConnected && mount(el, f, course)); return; }
      el.innerHTML = `<div class="empty"><strong>还没有课前包</strong>上课前 5 分钟看一眼：这节讲什么、3 个关键概念、可能听不懂的地方，再加一份中英术语表（带例句和发音）。DeepSeek 约 ¥0.01–0.03。<div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="pp-go">${ICON.spark}生成课前包</button></div></div>`;
      $('#pp-go', el).onclick = async () => {
        if (!Settings.load().deepseekKey) { toast('先去设置里填 DeepSeek key'); return; }
        const pr = make(f, course);
        el.innerHTML = Jobs.slot('prep:' + f.id);
        try { await pr; } catch (e) { toast(e.message, 6000); }
        if (el.isConnected) mount(el, f, course);
      };
      return;
    }
    const v = pk.preview;
    el.innerHTML = `
      <div class="prep">
        <div class="prep-card">
          <div class="prep-k">5 分钟预习</div>
          <p class="prep-sum">${esc(v.summary)}</p>
          <div class="prep-k">3 个关键概念</div>
          <ol class="prep-c">${v.concepts.map(c => `<li><b>${esc(c.term)}</b><span>${esc(c.why)}</span></li>`).join('')}</ol>
          ${v.hard.length ? `<div class="prep-k">上课可能听不懂的地方</div><ul class="prep-h">${v.hard.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
          ${v.listen.length ? `<div class="prep-k">注意听老师说这些</div><div class="prep-l">${v.listen.map(t => `<button class="chip" data-say="${esc(t)}">🔊 ${esc(t)}</button>`).join('')}</div>` : ''}
        </div>
        <div class="row" style="justify-content:space-between;margin:14px 0 6px"><b>术语表 · ${pk.terms.length} 个</b><div class="row" style="gap:4px"><button class="btn small ghost" id="pp-copy">复制</button><button class="btn small ghost" id="pp-re">重新生成</button></div></div>
        <div class="terms">${pk.terms.map(t => `<div class="term"><div class="term-h"><button class="say" data-say="${esc(t.en)}" aria-label="朗读">🔊</button><b>${esc(t.en)}</b><span class="term-zh">${esc(t.zh)}</span></div>${t.explain ? `<div class="term-x">${esc(t.explain)}</div>` : ''}${t.example ? `<div class="term-e"><button class="say small" data-say="${esc(t.example)}" aria-label="朗读例句">🔊</button><span>${esc(t.example)}</span></div><div class="term-ez">${esc(t.example_zh)}</div>` : ''}</div>`).join('')}</div>
      </div>`;
    $$('[data-say]', el).forEach(b => b.onclick = () => speak(b.dataset.say));
    $('#pp-copy', el).onclick = async () => { try { await navigator.clipboard.writeText(pk.terms.map(t => `${t.en}\t${t.zh}\t${t.explain}`).join('\n')); toast('已复制（可以粘贴到 Excel / Anki）'); } catch (e) { toast('复制失败'); } };
    confirmClick($('#pp-re', el), '再点一次重新生成', async () => { f.prep = null; const full = await DB.get('files', f.id); full.prep = null; await DB.put('files', full); mount(el, f, course); $('#pp-go', el)?.click(); });
  }
  return { mount, make, speak, running };
})();

/* ======================================================================
   选中文字的小工具条：复制 / 翻译 / 问 AI（课件、笔记、字幕都能用）
   ====================================================================== */
const SelPop = (() => {
  let pop = null, text = '', hideT;
  const ensure = () => {
    if (pop) return pop;
    pop = document.createElement('div'); pop.className = 'selpop'; pop.hidden = true;
    pop.innerHTML = `<div class="row" style="gap:2px"><button data-a="copy">复制</button><button data-a="tr">翻译</button><button data-a="ask">问 AI</button><button data-a="say">🔊</button></div><div class="selpop-out" hidden></div>`;
    document.body.appendChild(pop);
    pop.addEventListener('pointerdown', e => e.preventDefault()); // 点按钮时不丢失选区
    $$('button', pop).forEach(b => b.onclick = () => act(b.dataset.a));
    return pop;
  };
  async function act(a) {
    const out = $('.selpop-out', pop);
    if (a === 'copy') { try { await navigator.clipboard.writeText(text); toast('已复制'); } catch (e) { document.execCommand('copy'); toast('已复制'); } hide(); return; }
    if (a === 'say') { Prep.speak(text); return; }
    if (a === 'ask') { hide(); document.dispatchEvent(new CustomEvent('tkb-ask', { detail: { text } })); return; }
    if (a === 'tr') {
      out.hidden = false; out.innerHTML = '<span class="spin"></span>';
      try {
        const zh = await quickTranslate(text);
        out.innerHTML = `<div>${esc(zh)}</div>`;
      } catch (e) { out.textContent = '翻译失败：' + e.message; }
    }
  }
  async function quickTranslate(t) {
    // 短句先试免费模型池；不行再用 Chrome 内置翻译
    try {
      const r = await AI.translateBatch({ items: [{ id: 's0', en: t.slice(0, 1500) }], context: [], glossary: {}, courseName: '', vocab: [], lean: true });
      const zh = (r.items[0] || {}).zh; if (zh) return zh;
    } catch (e) {}
    const local = await AI.translateDraft({ text: t.slice(0, 1500), context: [], glossary: {}, courseName: '' }).catch(() => '');
    if (local) return local;
    throw new Error('免费翻译暂时都用不了');
  }
  function show() {
    const s = window.getSelection(); if (!s || s.isCollapsed) return hide();
    const t = String(s).trim(); if (t.length < 1 || t.length > 3000) return hide();
    const node = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
    if (!node || !node.closest('.doc-body, .md, .captions')) return hide();
    if (node.closest('textarea, input, .chat-in')) return hide();
    text = t; ensure();
    const r = s.getRangeAt(0).getBoundingClientRect();
    $('.selpop-out', pop).hidden = true;
    pop.hidden = false;
    const w = pop.offsetWidth || 220;
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    const top = r.top - 46; pop.style.top = (top < 8 ? r.bottom + 8 : top) + 'px';
  }
  function hide() { if (pop) pop.hidden = true; }
  document.addEventListener('selectionchange', () => { clearTimeout(hideT); hideT = setTimeout(() => { const s = window.getSelection(); if (!s || s.isCollapsed) hide(); }, 200); });
  ['mouseup', 'touchend', 'keyup'].forEach(ev => document.addEventListener(ev, e => { if (pop && pop.contains(e.target)) return; setTimeout(show, 30); }));
  window.addEventListener('scroll', hide, true);
  return { hide };
})();
/* 没有工作台的页面：选中「问 AI」就打开右侧抽屉 */
document.addEventListener('tkb-ask', async e => {
  Chat.setQuote(e.detail.text);
  if (document.body.classList.contains('desk-mode')) { const b = $('#dk-rtabs [data-r="chat"]'); if (b) { if (b.classList.contains('on')) Chat.setQuote(e.detail.text); else b.click(); setTimeout(() => $('#chat-text')?.focus(), 100); } return; }
  const h = location.hash.slice(1);
  if (h.startsWith('note-')) { const note = await DB.get('notes', h.slice(5).split('~')[0]); if (note) chatDrawer({ note, course: await DB.get('courses', note.courseId) }); }
  else toast('打开一份笔记或上课工作台再问 AI');
});

/* ======================================================================
   截止日期（Moodle 时间线 + 手动添加），存在本机
   ====================================================================== */
const Deadlines = (() => {
  const KEY = 'tingkeben.deadlines';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{"items":[]}'); } catch (e) { return { items: [] }; } };
  const save = d => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} };
  async function refresh(silent) {
    if (!Ext.version()) { if (!silent) toast('要先装「听课本助手」扩展，才能读 Moodle 的截止日期'); return false; }
    try {
      const ev = await Ext.call('listDeadlines', {}, 60000);
      const d = load();
      const manual = d.items.filter(x => x.manual);
      d.items = [...manual, ...ev.map(e => ({ ...e, id: 'm' + e.id }))]; d.at = Date.now(); save(d);
      if (!silent) toast(`更新了 ${ev.length} 个截止日期`);
      return true;
    } catch (e) {
      if (!silent) toast(e.code === 'cmd' ? '扩展版本太旧，换成新版「听课本助手」再试' : (e.message || '读取失败'), 6000);
      return false;
    }
  }
  function upcoming(n = 6) { const now = Date.now() - 3600e3; return load().items.filter(x => x.due > now && !x.done).sort((a, b) => a.due - b.due).slice(0, n); }
  function left(t) {
    const h = (t - Date.now()) / 3600e3;
    if (h < 0) return '已过';
    if (h < 24) return `还剩 ${Math.max(1, Math.round(h))} 小时`;
    return `还剩 ${Math.round(h / 24)} 天`;
  }
  function addModal(after) {
    modal(`<h2>添加截止日期</h2>
      <div class="field"><label for="dl-n">内容</label><input id="dl-n" type="text" placeholder="例如 Assignment 1 提交"></div>
      <div class="field"><label for="dl-c">课程</label><select id="dl-c"><option value="">不选</option>${State.courses.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="dl-t">截止时间</label><input id="dl-t" type="datetime-local"></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="dl-go">添加</button></div>`, (box, close) => {
      $('#dl-go', box).onclick = () => {
        const name = $('#dl-n', box).value.trim(), t = new Date($('#dl-t', box).value).getTime();
        if (!name || !t) { toast('内容和时间都要填'); return; }
        const d = load(); d.items.push({ id: DB.uid('d_'), name, course: $('#dl-c', box).value, due: t, manual: true }); save(d);
        close(); after && after();
      };
    });
  }
  function remove(id) { const d = load(); d.items = d.items.filter(x => x.id !== id); save(d); }
  return { load, refresh, upcoming, left, addModal, remove };
})();

/* ======================================================================
   上课工作台：左课件 · 中笔记/画板 · 右实时翻译/问 AI
   ====================================================================== */
/* 工作台布局偏好：Mac 和 iPad 分开记（iPad 默认：课件 + 画板，不开右栏） */
const DeskPref = {
  key: () => 'tingkeben.desk' + (Device.ipad ? '.ipad' : ''),
  defaults: () => Device.ipad ? { left: true, mid: true, right: false, rtab: 'chat', one: 'left', split: true, mtab: 'board', w: { left: 1, mid: 1, right: .8 }, rmin: false } : { left: true, mid: true, right: true, rtab: 'chat', one: 'mid', split: false, mtab: 'note', w: { left: 1, mid: 1.15, right: .85 }, rmin: false },
  get() { try { return Object.assign(this.defaults(), JSON.parse(localStorage.getItem(this.key()) || '{}')); } catch (e) { return this.defaults(); } },
  set(p) { try { localStorage.setItem(this.key(), JSON.stringify(Object.assign(this.get(), p))); } catch (e) {} },
};

async function renderDesk(noteId) {
  if (location.hash.slice(1) !== 'desk-' + noteId) return; // 已经离开这页了
  const note = await DB.get('notes', noteId);
  if (!note) { location.hash = 'home'; return; }
  const course = await DB.get('courses', note.courseId);
  const files = sortFiles((await DB.byIndex('files', 'courseId', note.courseId)).filter(f => f.status === 'ready' || isPdf(f)));
  const notes = (await DB.byIndex('notes', 'courseId', note.courseId)).sort((a, b) => b.createdAt - a.createdAt);
  const P = DeskPref.get();
  let fileId = note.deskFile && files.some(f => f.id === note.deskFile) ? note.deskFile : (note.sourceFileIds || []).find(id => files.some(f => f.id === id)) || (files[0] && files[0].id);
  let midTab = 'note', viewer = null;
  view.innerHTML = `
    <div class="desk">
      <div class="desk-top noprint">
        <a class="btn small ghost" href="#note-${note.id}" title="退出工作台">←</a>
        <select id="dk-note" class="dk-sel" title="切换笔记">${notes.map(n => `<option value="${n.id}" ${n.id === note.id ? 'selected' : ''}>${esc(n.title)}</option>`).join('')}<option value="__new">＋ 新建空白笔记</option></select>
        <span class="grow"></span>
        <div class="seg dk-toggles" role="group" aria-label="显示哪几栏">
          <button data-col="left">课件</button><button data-col="mid">笔记</button><button data-col="right">翻译 / AI</button>
        </div>
        <button class="btn small" id="dk-split" hidden title="竖屏时上面看课件、下面写笔记">上下分屏</button>
      </div>
      <div class="desk-cols" id="dk-cols">
        <section class="dcol" data-col="left">
          <div class="dhead"><select id="dk-file" class="dk-sel">${files.length ? files.map(f => `<option value="${f.id}" ${f.id === fileId ? 'selected' : ''}>${esc(weekOf(f).label)}${phaseOf(f) ? '·' + phaseOf(f) : ''} · ${esc(f.name)}</option>`).join('') : '<option value="">这门课还没有课件</option>'}</select></div>
          <div class="dbody" id="dk-doc"></div>
        </section>
        <div class="dk-divider" id="dk-divider" hidden role="separator" aria-label="拖动调整上下高度"><span></span></div>
        <section class="dcol" data-col="mid">
          <div class="dhead tabs" id="dk-mtabs">${noteTabsHTML('note', note)}</div>
          <div class="dbody" id="dk-mid"></div>
        </section>
        <section class="dcol" data-col="right">
          <div class="dhead tabs" id="dk-rtabs"><button data-r="chat">问 AI</button><button data-r="live">实时翻译</button><span class="grow"></span><button class="dk-min" id="dk-rmin" title="收成一个圆按钮" aria-label="把 AI 栏收起来">—</button></div>
          <div class="dbody" id="dk-right"></div>
        </section>
      </div>
      <button class="dk-fab" id="dk-fab" aria-label="展开 AI 问答" aria-hidden="true" tabindex="-1" title="展开 AI 问答">AI</button>
    </div>`;

  // 栏的显示 / 隐藏
  // Mac 窄窗口：一次一栏。iPad 竖屏：上下分屏（上面课件、下面笔记/画板），也可以切成一次一栏
  const cols = $('#dk-cols');
  const ipadPortrait = () => Device.ipad && Device.portrait();
  const narrow = () => !Device.ipad && window.innerWidth < 900;
  const stacked = () => ipadPortrait() && DeskPref.get().split;
  const single = () => narrow() || (ipadPortrait() && !DeskPref.get().split);
  // AI 栏收起来时变成一个圆形按钮（不占栏位），点一下再弹回来
  const fabOn = () => { const p = DeskPref.get(); return !!p.rmin && !stacked() && !single() && p.right; };
  // 只按当前偏好重算各栏宽度（拖动时用，不重建分隔条）
  const layoutTpl = () => {
    const p = DeskPref.get();
    const vis = $$('.dcol', cols).filter(c => !c.hidden).map(c => c.dataset.col);
    const tpl = [];
    vis.forEach((k, i) => {
      if (i) tpl.push('12px');
      tpl.push(`minmax(${k === 'right' ? 260 : 200}px,${(p.w && p.w[k]) || 1}fr)`);
    });
    cols.style.gridTemplateColumns = tpl.join(' ') || '1fr';
  };
  const applyCols = () => {
    const p = DeskPref.get();
    $$('.dk-gut', cols).forEach(g => g.remove());
    cols.classList.toggle('stacked', stacked());
    const rcol = $('.dcol[data-col=right]', cols);
    if (stacked()) {
      $$('.dcol', cols).forEach(c => { c.hidden = c.dataset.col === 'right' ? true : false; });
      cols.style.gridTemplateColumns = '1fr';
      cols.style.gridTemplateRows = `minmax(0,${p.splitRatio || 0.42}fr) auto minmax(0,${1 - (p.splitRatio || 0.42)}fr)`;
    } else {
      cols.style.gridTemplateRows = '';
      $$('.dcol', cols).forEach(c => { const k = c.dataset.col; c.hidden = single() ? p.one !== k : !p[k]; });
      rcol.classList.remove('mini');
      // 收成圆按钮：右栏整个从排版里拿掉，把宽度让给课件和笔记
      if (fabOn()) rcol.hidden = true;
      const vis = $$('.dcol', cols).filter(c => !c.hidden).map(c => c.dataset.col);
      $$('.dk-gut', cols).forEach(g => g.remove());
      vis.forEach((k, i) => { if (i) { const g = document.createElement('div'); g.className = 'dk-gut'; g.dataset.a = vis[i - 1]; g.dataset.b = k; g.setAttribute('role', 'separator'); g.title = '拖动调整宽度（双击恢复默认）'; $(`.dcol[data-col=${k}]`, cols).before(g); } });
      layoutTpl();
      $$('.dk-gut', cols).forEach(g => bindGut(g));
    }
    $$('.dk-toggles button[data-col]').forEach(b => b.classList.toggle('on', stacked() ? b.dataset.col !== 'right' : single() ? p.one === b.dataset.col : p[b.dataset.col]));
    const sp = $('#dk-split'); if (sp) { sp.hidden = !ipadPortrait(); sp.classList.toggle('on', !!p.split); }
    const dv = $('#dk-divider'); if (dv) dv.hidden = !stacked();
    const fab = $('#dk-fab');
    if (fab) {
      const on = fabOn();
      fab.classList.toggle('on', on);
      fab.setAttribute('aria-hidden', on ? 'false' : 'true');
      fab.tabIndex = on ? 0 : -1;
    }
    // 刚出现的栏轻轻滑进来（收起 AI 栏再展开、切分屏时都能看到）
    const nowVis = $$('.dcol', cols).filter(c => !c.hidden).map(c => c.dataset.col).join(',');
    if (prevVis) for (const c of $$('.dcol', cols)) {
      if (!c.hidden && !prevVis.split(',').includes(c.dataset.col)) {
        c.classList.remove('dk-enter'); void c.offsetWidth; c.classList.add('dk-enter');
        setTimeout(() => c.classList.remove('dk-enter'), 340);
      }
    }
    prevVis = nowVis;
  };
  let prevVis = '';
  // 拖动分隔条：左右两栏按比例分宽度，记在本机（Mac 和 iPad 各记各的）
  function bindGut(g) {
    g.onpointerdown = e => {
      e.preventDefault(); try { g.setPointerCapture(e.pointerId); } catch (err) {}
      const A = $(`.dcol[data-col=${g.dataset.a}]`, cols), B = $(`.dcol[data-col=${g.dataset.b}]`, cols);
      const wa = A.getBoundingClientRect().width, wb = B.getBoundingClientRect().width, x0 = e.clientX;
      const p = DeskPref.get(), w = Object.assign({}, p.w), fa = w[g.dataset.a] || 1, fb = w[g.dataset.b] || 1, tot = fa + fb;
      const min = k => k === 'right' ? 260 : 200;
      g.classList.add('drag'); document.body.classList.add('dk-dragging');
      const move = ev => {
        let na = wa + (ev.clientX - x0); na = Math.max(min(g.dataset.a), Math.min(wa + wb - min(g.dataset.b), na));
        w[g.dataset.a] = Math.round(tot * na / (wa + wb) * 100) / 100; w[g.dataset.b] = Math.round((tot - w[g.dataset.a]) * 100) / 100;
        DeskPref.set({ w }); layoutTpl();
      };
      const up = () => { g.classList.remove('drag'); document.body.classList.remove('dk-dragging'); g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
    };
    g.ondblclick = () => { const p = DeskPref.get(); DeskPref.set({ w: Object.assign({}, p.w, DeskPref.defaults().w) }); applyCols(); };
  }
  // AI 栏收成一个圆按钮 / 再弹回来
  const setRmin = v => { DeskPref.set({ rmin: v }); applyCols(); };
  $('#dk-rmin').onclick = () => setRmin(true);
  const fabBtn = $('#dk-fab'); if (fabBtn) fabBtn.onclick = () => setRmin(false);
  $$('.dk-toggles button[data-col]').forEach(b => b.onclick = () => {
    const k = b.dataset.col, p = DeskPref.get();
    if (stacked()) DeskPref.set({ split: false, one: k });
    else if (single()) DeskPref.set({ one: k });
    else if (k === 'right' && p.right && p.rmin) DeskPref.set({ rmin: false });
    else { const next = !p[k]; if (!next && ['left', 'mid', 'right'].filter(x => p[x]).length <= 1) return; DeskPref.set({ [k]: next }); }
    applyCols();
  });
  const spb = $('#dk-split'); if (spb) spb.onclick = () => { DeskPref.set({ split: !DeskPref.get().split }); applyCols(); };
  // 上下分屏中间的拖动条：手指或笔拖动调整课件和笔记的高度
  const dv = $('#dk-divider');
  if (dv) dv.addEventListener('pointerdown', e => {
    e.preventDefault(); try { dv.setPointerCapture(e.pointerId); } catch (err) {}
    const r = cols.getBoundingClientRect();
    const move = ev => { const ratio = Math.min(0.75, Math.max(0.2, (ev.clientY - r.top) / r.height)); DeskPref.set({ splitRatio: Math.round(ratio * 100) / 100 }); applyCols(); };
    const up = () => { dv.removeEventListener('pointermove', move); dv.removeEventListener('pointerup', up); dv.removeEventListener('pointercancel', up); };
    dv.addEventListener('pointermove', move); dv.addEventListener('pointerup', up); dv.addEventListener('pointercancel', up);
  });
  applyCols();
  const onResize = () => { if (!cols.isConnected) { window.removeEventListener('resize', onResize); return; } applyCols(); };
  window.addEventListener('resize', onResize);

  $('#dk-note').onchange = async e => {
    if (e.target.value === '__new') {
      const n = { id: DB.uid('n_'), courseId: note.courseId, createdAt: Date.now(), title: `${new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 课堂笔记`, markdown: '', status: 'done', sourceFileIds: fileId ? [fileId] : [], model: '' };
      await DB.put('notes', n); location.hash = 'desk-' + n.id;
    } else location.hash = 'desk-' + e.target.value;
  };

  // 左栏：课件
  const left = $('#dk-doc');
  const showDoc = async () => {
    const f = files.find(x => x.id === fileId);
    if (!f) { left.innerHTML = '<div class="empty">这门课还没有课件。先在课程页导入或从 Moodle 同步。</div>'; return; }
    const full = await DB.get('files', f.id);
    left._onAddPage = async (fid, page) => {
      note.board = note.board || { pages: [] };
      const bp = note.board.pages; if (bp.length === 1 && !bp[0].bg && !bp[0].strokes.length) bp.length = 0;
      bp.push({ bg: { fileId: fid, page }, h: Math.round(1000 * await Pdf.aspect(fid, page)), strokes: [] });
      await DB.put('notes', note); toast(`课件第 ${page} 页已加到画板，去中间「画板」写`);
      if (midTab === 'board') showMid('board');
    };
    viewer = mountDocViewer(left, full, { note, course });
  };
  $('#dk-file').onchange = async e => { fileId = e.target.value; note.deskFile = fileId; if (!(note.sourceFileIds || []).includes(fileId)) note.sourceFileIds = [...(note.sourceFileIds || []), fileId]; await DB.put('notes', note); showDoc(); };
  showDoc();

  // 中栏：笔记和学习工具
  const mid = $('#dk-mid');
  const showMid = (tab, opt = {}) => {
    midTab = tab; DeskPref.set({ mtab: tab });
    $('#dk-mtabs').innerHTML = noteTabsHTML(tab, note);
    $$('#dk-mtabs [data-ntab]').forEach(b => b.onclick = () => showMid(b.dataset.ntab));
    mid.className = 'dbody' + (tab === 'board' ? ' flush' : '');
    if (tab === 'note') return deskNote(note, course, mid, () => showMid('note'));
    mountNoteTool(tab, note, course, mid, { focus: opt.focus, toPoint: pid => showMid('points', { focus: pid }) });
  };
  showMid(['note', 'board', 'points', 'cards', 'quiz', 'map'].includes(P.mtab) ? P.mtab : 'note');

  // 右栏：实时翻译 / 问 AI
  const right = $('#dk-right');
  const showRight = tab => {
    DeskPref.set({ rtab: tab });
    $$('#dk-rtabs [data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === tab));
    if (tab === 'chat') {
      Chat.mount(right, { note, course, compact: true, getLive: () => State.live, getFileIds: () => fileId ? [fileId] : [],
        getPage: async () => { const f = files.find(x => x.id === fileId); if (!f || !viewer) return null; const p = viewer.page(); const full = await DB.get('files', f.id); return { fileId, name: f.name, page: p, text: (splitPages(full.text).find(x => x.n === p) || {}).text || '' }; } });
    } else deskLive(note, course, right);
  };
  $$('#dk-rtabs [data-r]').forEach(b => b.onclick = () => showRight(b.dataset.r));
  showRight(P.rtab || 'chat');
}

/* 工作台中栏的「笔记」：看 / 编辑 / 录音总结 */
function deskNote(note, course, el, again) {
  const gen = State.gens.get(note.id);
  if (gen) {
    el.innerHTML = '<div class="md" id="dn-body"></div>';
    const b = $('#dn-body', el);
    const paint = () => { if (!b.isConnected) { gen.listeners.delete(paint); return; } if (!State.gens.has(note.id)) { gen.listeners.delete(paint); DB.get('notes', note.id).then(n => { Object.assign(note, n); again(); }); return; } b.innerHTML = `<div class="prog-sticky">${Jobs.slot('note:' + note.id)}</div>` + (gen.text ? md(gen.text) : ''); };
    gen.listeners.add(paint); paint(); return;
  }
  el.innerHTML = `
    <div class="row noprint" style="justify-content:flex-end;gap:6px;margin-bottom:8px">
      ${note.sessionId || Board.hasInk(note) ? `<button class="btn small primary" id="dn-recap">${ICON.spark}手写笔记 + 课堂录音优化笔记</button>` : ''}
      <button class="btn small" id="dn-gen">${note.markdown ? '重新生成' : ICON.spark + '用课件生成'}</button>
      <button class="btn small" id="dn-edit">编辑</button>
    </div>
    <div class="md" id="dn-body">${note.markdown ? md(note.markdown) : '<div class="empty"><strong>空白笔记</strong>上课时可以：点「编辑」打字记，切到「画板」用 Apple Pencil 写；下课后点「手写笔记 + 课堂录音优化笔记」，AI 把老师讲的和你手写的整理进来。</div>'}</div>`;
  linkPageRefs($('#dn-body', el), note);
  const rc = $('#dn-recap', el); if (rc) rc.onclick = () => enhanceNote(note, course, async () => { Object.assign(note, await DB.get('notes', note.id)); again(); });
  $('#dn-gen', el).onclick = () => {
    if (!course) return;
    if (!(note.sourceFileIds || []).length && !note.sessionId) { toast('先在左边选课件'); return; }
    const go = () => startGeneration({ course, fileIds: note.sourceFileIds || [], sessionId: note.sessionId, title: note.title, style: note.style || 'detailed', extra: note.extra, noteId: note.id }).then(() => setTimeout(again, 50));
    if (note.markdown) confirmClick($('#dn-gen', el), '再点一次：覆盖重写', go), $('#dn-gen', el).click(); else go();
  };
  $('#dn-edit', el).onclick = () => {
    el.innerHTML = `<textarea id="dn-text" style="min-height:60vh;font-family:var(--mono);font-size:14px">${esc(note.markdown)}</textarea>
      <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn small" id="dn-cancel">取消</button><button class="btn small primary" id="dn-save">保存</button></div>`;
    const ta = $('#dn-text', el); ta.focus();
    $('#dn-cancel', el).onclick = again;
    $('#dn-save', el).onclick = async () => { note.markdown = ta.value; await DB.put('notes', note); toast('已保存'); again(); };
  };
}

/* 工作台右栏：实时转写翻译（和「课堂录音」页共用 liveUI） */
function deskLive(note, course, el) {
  const s = Settings.load();
  const sess = State.live;
  if (sess && sess.course && course && sess.course.id !== course.id) {
    el.innerHTML = `<div class="empty"><strong>正在录另一门课</strong>${esc(sess.course.name)}<div class="row" style="justify-content:center;margin-top:10px"><a class="btn" href="#live">去看</a></div></div>`; return;
  }
  if (!sess) {
    el.innerHTML = `
      <div class="dk-rec">
        <button class="recbtn" id="dk-start" aria-label="开始录音"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg></button>
        <div><strong>开始录音</strong><div class="hint">实时转写英文 + 中文字幕，录音会关联到这份笔记</div></div>
      </div>
      ${!s.geminiKey ? '<div class="banner"><div class="grow">还没填 Gemini API key</div><a class="btn small primary" href="#settings~ai">去设置</a></div>' : ''}
      ${note.sessionId ? `<div class="hint" style="margin-top:12px">这份笔记已经关联了一段录音，再录会换成新的那段。<a href="#session-${note.sessionId}">看上次的录音</a></div>` : ''}`;
    $('#dk-start', el).onclick = async () => {
      if ((Settings.load().draftMode || 'free') === 'free') AI.prepareLocalTranslator();
      const btn = $('#dk-start', el); btn.disabled = true;
      const live = new LiveSession({ course, onUpdate: segs => liveUI.update(segs), onInterim: t => liveUI.interim(t), onStatus: st => liveUI.status(st), onError: m => liveUI.error(m), onLevel: r => liveUI.level(r) });
      live.focusFileId = note.deskFile || (note.sourceFileIds || [])[0];
      try { await live.start(); live.noteId = note.id; State.live = live; renderSide(); deskLive(note, course, el); }
      catch (e) { btn.disabled = false; toast(e.name === 'NotAllowedError' ? '没有麦克风权限。到浏览器设置里允许这个网站使用麦克风。' : e.name === 'NotFoundError' ? '没找到麦克风。检查麦克风有没有接好，或在「设置」里换一个麦克风。' : e.message, 6000); try { live.capture && live.capture.stop(); } catch (x) {} }
    };
    return;
  }
  liveUI.els = new Map(); liveUI.follow = true;
  el.innerHTML = `
    <div class="dk-live-top">
      <button class="recbtn on small" id="dk-stop" aria-label="停止录音"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg></button>
      <div class="clock" id="l-clock">0:00</div><span class="pill" id="l-status">实时转写中</span><div class="level"><i id="l-level"></i></div>
      <span class="grow"></span><button class="btn small" id="dk-mark">${ICON.star}重点</button><button class="btn small" id="dk-cf" title="课后会用中文重新讲这一段">❓ 没听懂</button>
    </div>
    <div class="banner" id="l-err" hidden></div>
    <div class="captions dk-caps" id="captions"></div>
    <div class="interim" id="interim"></div>
    <button class="btn small jump" id="l-jump" hidden>↓ 回到最新</button>`;
  const box = $('#captions', el);
  box.style.setProperty('--cap', Math.max(15, (s.captionSize || 20) - 3) + 'px'); $('#interim', el).style.setProperty('--cap', Math.max(15, (s.captionSize || 20) - 3) + 'px');
  box.addEventListener('scroll', () => { liveUI.follow = box.scrollTop + box.clientHeight > box.scrollHeight - 40; $('#l-jump', el).hidden = liveUI.follow; });
  $('#l-jump', el).onclick = () => { liveUI.follow = true; box.scrollTop = box.scrollHeight; $('#l-jump', el).hidden = true; };
  $('#dk-mark', el).onclick = () => toast('已标记 ' + fmtTime(sess.mark()));
  $('#dk-cf', el).onclick = () => toast('记下了 ' + fmtTime(sess.confused()) + '，课后用中文重讲');
  liveUI.update(sess.segments);
  const tick = setInterval(() => { const c = $('#l-clock', el); if (!c || !State.live) { clearInterval(tick); return; } c.textContent = fmtTime(sess.elapsed()); }, 500);
  $('#dk-stop', el).onclick = async () => {
    const b = $('#dk-stop', el); b.disabled = true; $('#l-status', el).textContent = '正在收尾…';
    const rec = await sess.stop();
    State.live = null; clearInterval(tick); renderSide();
    const fresh = await DB.get('notes', note.id) || note;
    fresh.sessionId = rec.id; await DB.put('notes', fresh); Object.assign(note, fresh);
    el.innerHTML = `<div class="empty"><strong>录好了 · ${fmtTime(rec.duration)} · ${rec.segments.length} 句</strong>下一步：把老师讲的和你的手写一起整理进笔记。<div class="row" style="justify-content:center;margin-top:12px"><a class="btn" href="#session-${rec.id}">看转写回放</a><button class="btn primary" id="dk-recap">${ICON.spark}手写笔记 + 课堂录音优化笔记</button></div></div>`;
    $('#dk-recap', el).onclick = () => enhanceNote(note, course, () => renderDesk(note.id));
  };
}

/* ======================================================================
   问 AI（全局）：选一门课，问考试、进度、学习计划
   ====================================================================== */
async function renderAsk(courseId) {
  const courses = State.courses;
  if (!courses.length) { view.innerHTML = '<div class="empty"><strong>还没有课程</strong>先从 Moodle 同步课程，AI 才有材料可以参考。</div>'; return; }
  const course = await DB.get('courses', courseId || localStorage.getItem('tingkeben.askCourse') || courses[0].id) || await DB.get('courses', courses[0].id);
  try { localStorage.setItem('tingkeben.askCourse', course.id); } catch (e) {}
  view.innerHTML = `
    <div class="head"><div><h1>问 AI</h1><div class="meta">AI 会参考这门课所有笔记的重点、截止日期和学习进度</div></div>
      <div class="row"><button class="btn" id="ak-study">${ICON.mic}手写笔记 + 课堂录音优化笔记</button>
        <select id="ak-c" style="width:auto">${courses.map(c => `<option value="${c.id}" ${c.id === course.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
    <div class="card ask-card" id="ak-chat"></div>`;
  $('#ak-c').onchange = e => { location.hash = 'ask-' + e.target.value; };
  $('#ak-study').onclick = () => studyFlow({ courseId: course.id });
  const notes = (await DB.byIndex('notes', 'courseId', course.id)).sort((a, b) => a.createdAt - b.createdAt);
  Chat.mount($('#ak-chat'), {
    course,
    suggestions: ['最近有什么作业或考试要准备？', '我这门课的学习进度怎么样？哪些还没掌握？', '帮我安排下周的复习计划', '把这门课到现在的重点串起来讲一遍'],
    getExtra: async () => {
      const dl = Deadlines.upcoming(12).map(d => `- ${new Date(d.due).toLocaleString('zh-CN')} · ${d.course || ''} · ${d.name}`).join('\n');
      let notesTxt = '', budget = 60000;
      for (const n of notes) {
        const pg = Study.progress(n);
        const pts = n.study ? n.study.points.map(p => `  - ${(n.mastered || {})[p.id] ? '[已掌握]' : '[未掌握]'} ${p.title}`).join('\n') : '';
        const body = (n.markdown || '').slice(0, Math.max(2000, Math.floor(budget / Math.max(1, notes.length))));
        notesTxt += `\n### 笔记：${n.title}（${fmtDate(n.createdAt)}，知识点掌握 ${pg.done}/${pg.total}）\n${pts}\n${body}\n`;
      }
      return `## 今天\n${new Date().toLocaleString('zh-CN')}\n\n## 截止日期\n${dl || '（没有记录）'}\n\n## 这门课的笔记\n${notesTxt || '（还没有笔记）'}${course.examDate ? `\n\n## 考试日期\n${course.examDate}` : ''}`;
    },
  });
}

/* ======================================================================
   课程级：知识点总结 / 模拟考试（用各笔记已生成的题，不额外花钱）
   ====================================================================== */
async function coursePointsModal(course) {
  const notes = (await DB.byIndex('notes', 'courseId', course.id)).filter(n => n.study).sort((a, b) => a.createdAt - b.createdAt);
  const total = notes.reduce((n, x) => n + x.study.points.length, 0), done = notes.reduce((n, x) => n + Study.progress(x).done, 0);
  modal(`<h2>课程知识点总结</h2><div class="hint">共 ${notes.length} 篇笔记、${total} 个知识点，已掌握 ${done} 个</div>
    <div class="kp-sum">${notes.map(n => `<details><summary><b>${esc(n.title)}</b> <span class="hint">${Study.progress(n).done}/${n.study.points.length}</span></summary>
      ${n.study.points.map(p => `<div class="kp-line ${(n.mastered || {})[p.id] ? 'done' : ''}"><span>${(n.mastered || {})[p.id] ? '✓' : '○'}</span><a href="#note-${n.id}~points">${esc(p.title)}</a></div>`).join('')}</details>`).join('') || '<div class="empty">还没有笔记生成过重点内容</div>'}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>关闭</button></div>`);
}
async function mockExamModal(course) {
  const notes = (await DB.byIndex('notes', 'courseId', course.id)).filter(n => n.study && n.study.quiz.length).sort((a, b) => a.createdAt - b.createdAt);
  if (!notes.length) { toast('还没有笔记生成过测验题'); return; }
  modal(`<h2>模拟考试</h2><p class="hint" style="margin:0">从选中的笔记里随机抽题，限时作答，交卷后看成绩和解析。</p>
    <div class="checklist">${notes.map(n => `<label><input type="checkbox" value="${n.id}" checked>${esc(n.title)} <span class="hint">${n.study.quiz.length} 题</span></label>`).join('')}</div>
    <div class="row"><div class="field grow"><label for="me-n">题数</label><input id="me-n" type="number" min="5" max="60" value="20"></div><div class="field grow"><label for="me-t">限时（分钟）</label><input id="me-t" type="number" min="5" max="180" value="30"></div></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="me-go">开始考试</button></div>`, (box, close) => {
    $('#me-go', box).onclick = () => {
      const ids = $$('.checklist input:checked', box).map(i => i.value);
      const pool = notes.filter(n => ids.includes(n.id)).flatMap(n => n.study.quiz.map(q => ({ ...q, noteId: n.id, noteTitle: n.title })));
      if (!pool.length) { toast('至少选一篇'); return; }
      const qs = pool.sort(() => Math.random() - .5).slice(0, Math.max(5, Number($('#me-n', box).value) || 20));
      const mins = Math.max(5, Number($('#me-t', box).value) || 30);
      close(); runExam(course, qs, mins);
    };
  });
}
function runExam(course, qs, minutes) {
  const ans = new Array(qs.length).fill(null), end = Date.now() + minutes * 60e3, L = 'ABCDEF';
  view.innerHTML = `<div class="head"><div><h1>模拟考试 · ${esc(course.name)}</h1><div class="meta">${qs.length} 题 · 限时 ${minutes} 分钟</div></div><div class="row"><span class="clock" id="ex-clock"></span><button class="btn primary" id="ex-submit">交卷</button></div></div>
    <div class="exam">${qs.map((q, i) => `<div class="card pad quiz" data-i="${i}"><div class="qq">${i + 1}. ${esc(q.q)}</div><div class="opts">${q.options.map((o, k) => `<button class="opt" data-k="${k}"><b>${L[k]}</b><span>${esc(o)}</span></button>`).join('')}</div></div>`).join('')}</div>`;
  $$('.exam .quiz').forEach(c => $$('.opt', c).forEach(b => b.onclick = () => { ans[Number(c.dataset.i)] = Number(b.dataset.k); $$('.opt', c).forEach(x => x.classList.toggle('sel', x === b)); }));
  const tick = setInterval(() => { const c = $('#ex-clock'); if (!c) { clearInterval(tick); return; } const left = Math.max(0, end - Date.now()); c.textContent = fmtTime(left / 1000); if (!left) submit(); }, 500);
  const submit = () => {
    clearInterval(tick);
    const score = qs.filter((q, i) => ans[i] === q.answer).length;
    view.innerHTML = `<div class="head"><div><h1>成绩：${score} / ${qs.length}</h1><div class="meta">${Math.round(score / qs.length * 100)} 分 · 错题下面有解析</div></div><a class="btn" href="#course-${course.id}~notes">回课程</a></div>
      <div class="exam">${qs.map((q, i) => `<div class="card pad quiz"><div class="qq">${i + 1}. ${esc(q.q)}</div><div class="opts">${q.options.map((o, k) => `<div class="opt ${k === q.answer ? 'right' : k === ans[i] ? 'wrong' : ''}"><b>${L[k]}</b><span>${esc(o)}</span></div>`).join('')}</div>
        <div class="explain ${ans[i] === q.answer ? 'ok' : 'bad'}"><b>${ans[i] === q.answer ? '对' : ans[i] === null ? '没答' : '错'}</b> · ${esc(q.explain)} <a href="#note-${q.noteId}~points">（${esc(q.noteTitle)}）</a></div></div>`).join('')}</div>`;
    window.scrollTo(0, 0);
  };
  $('#ex-submit').onclick = () => { const blank = ans.filter(a => a === null).length; if (blank && !$('#ex-submit').dataset.armed) { $('#ex-submit').dataset.armed = 1; $('#ex-submit').textContent = `还有 ${blank} 题没答，再点交卷`; return; } submit(); };
}
