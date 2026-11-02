/* 听课本 — 学习工具：课件顺序的笔记 + 手写画板、重点/测验、词汇表、思维导图、问 AI、录音总结、课件翻译、截止日期。
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
  const W = 1000;                 // 兼容旧的坐标/导出
  const COL = 680;                // 笔记文字列宽（世界坐标）
  const GAP = 120;                // 板块之间的空隙
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
  /* 平滑后的点和外框按 pts 数组缓存：平移/缩放时每帧重画几百笔，不用每次重算 */
  const SM = new WeakMap();
  function strokeInfo(s) {
    const raw = s.pts || [];
    let v = SM.get(raw);
    if (!v || v.n !== raw.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of raw) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
      const pad = (s.w || 3) + 2;
      v = { n: raw.length, sm: smoothPts(raw), box: [x0 - pad, y0 - pad, x1 + pad, y1 + pad] };
      SM.set(raw, v);
    }
    return v;
  }
  /* 深色模式：显示时把深色墨水换成亮色（存的还是原色，导出/识别仍然是白底黑字） */
  const DARK_INK = { '#1b2233': '#E8ECF6', '#1a2030': '#E8ECF6', '#2c47a5': '#8FAAFF', '#c0392b': '#FF8A7A', '#2b7a4b': '#63D69E', '#b93434': '#FF8A7A' };
  const isDark = () => document.documentElement.dataset.theme === 'dark';
  const shown = c => (isDark() && DARK_INK[String(c || '').toLowerCase()]) || c;
  function drawStroke(ctx, s, scale, ocr, bold = 1) {
    const raw = s.pts; if (!raw || !raw.length) return;
    const pts = strokeInfo(s).sm;
    const hl = s.tool === 'hl';
    // bold：交给 AI 识别时把笔迹加粗一点，细笔写完的整页放大后不至于断成虚线
    const base = hl ? (s.w || 18) : (s.w || 3) * bold;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const col = ocr ? s.c : shown(s.c);
    ctx.strokeStyle = col; ctx.fillStyle = col;
    if (hl) ctx.globalAlpha = ocr ? .82 : (isDark() ? .38 : .3);

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

  /* 在笔记上改完字，把 HTML 变回 Markdown（只覆盖笔记用到的那几种格式） */
  function htmlToMd(root) {
    const inline = node => {
      let out = '';
      node.childNodes.forEach(n => {
        if (n.nodeType === 3) { out += n.textContent.replace(/\s+/g, ' '); return; }
        if (n.nodeType !== 1) return;
        if (n.dataset && n.dataset.ref) { out += n.dataset.ref; return; } // 课件页码小标签 → 还原成 [p.N]
        const t = n.tagName.toLowerCase(), inner = inline(n);
        if (t === 'strong' || t === 'b') out += inner.trim() ? `**${inner.trim()}**` : '';
        else if (t === 'em' || t === 'i') out += inner.trim() ? `*${inner.trim()}*` : '';
        else if (t === 'code') out += '`' + inner + '`';
        else if (t === 'a') out += `[${inner.trim()}](${n.getAttribute('href') || ''})`;
        else if (t === 'br') out += '\n';
        else out += inner;
      });
      return out.replace(/[ \t]+/g, ' ');
    };
    const out = [];
    const push = (s, br) => { if (s.trim()) out.push(br ? (out.length ? '\n\n' + s.trim() : s.trim()) : s.trim()); };
    root.childNodes.forEach(n => {
      if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) push(t, out.length > 0); return; }
      if (n.nodeType !== 1) return;
      const t = n.tagName.toLowerCase();
      if (/^h[1-6]$/.test(t)) push('#'.repeat(Number(t[1])) + ' ' + inline(n).trim(), out.length > 0);
      else if (t === 'ul' || t === 'ol') {
        const items = [...n.children].map((li, i) => (t === 'ol' ? `${i + 1}. ` : '- ') + inline(li).trim()).filter(s => s.length > 2);
        if (items.length) push(items.join('\n'), out.length > 0);
      } else if (t === 'blockquote') push('> ' + inline(n).trim(), out.length > 0);
      else if (t === 'pre') push('```\n' + n.textContent.replace(/\s+$/, '') + '\n```', out.length > 0);
      else if (t === 'hr') push('---', out.length > 0);
      else if (t === 'table') {
        const rows = [...n.querySelectorAll('tr')].map(tr => '| ' + [...tr.children].map(td => inline(td).trim()).join(' | ') + ' |');
        if (rows.length) { rows.splice(1, 0, '|' + rows[0].split('|').slice(1, -1).map(() => ' --- ').join('|') + '|'); push(rows.join('\n'), out.length > 0); }
      } else push(inline(n).trim().replace(/\n{2,}/g, '\n'), out.length > 0);
    });
    return out.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------- 世界：一整块无限画布 ----------
     以前是「一页一页固定大小的纸」，笔只能在纸里写。
     现在整份笔记是一块无限大的画布：课文页的要点是一块块「板块」，手写可以写在任何地方，
     上下左右都不封边；缩放/平移随意。老数据在打开时自动搬过来。 */
  function blockH(text) { return Math.max(820, 300 + Math.ceil(String(text || '').length / 36) * 30 + 320); }
  function world(note) {
    note.board = note.board || {};
    const b = note.board;
    if (b.world && Array.isArray(b.world.blocks)) {
      // 老数据：只有一块空的、但正文有内容 —— 直接把正文切成块，别让笔记看不见
      const w = b.world;
      if (w.blocks.length === 1 && !String(w.blocks[0].text || '').trim() && String(note.markdown || '').trim()) {
        w.blocks = blocksFromMd(note.markdown);
        layout(w);
      } else if (w.mdSig && w.mdSig !== mdSig(note.markdown) && String(note.markdown || '').trim()) {
        // 正文在别处改过（编辑正文 / 重新生成 / 手写整理进笔记）：板块跟着换，手写按页码留在原来那块旁边
        const oldY = new Map(w.blocks.map(b => [b.p, b.y]));
        w.blocks = blocksFromMd(note.markdown);
        layout(w);
        shiftInk(w, oldY);
      }
      w.mdSig = mdSig(note.markdown);
      return w;
    }
    const blocks = [], strokes = [];
    let y = 0;
    (b.pages || []).forEach((pg, i) => {
      const text = pg.text || '';
      const p = pg.p || (pg.bg && pg.bg.page) || (i + 1);
      blocks.push({ p, y, text });
      (pg.strokes || []).forEach(s => strokes.push(Object.assign({}, s, { p, pts: (s.pts || []).map(q => [q[0], q[1] + y, q[2]]) })));
      y += Math.max(pg.h || 0, blockH(text)) + GAP;
    });
    if (!blocks.length) blocks.push(...blocksFromMd(note.markdown || ''));
    if (!blocks.length) blocks.push({ p: 1, y: 0, text: '' });
    b.world = { strokes, blocks, mdSig: mdSig(note.markdown) };
    delete b.pages;
    return b.world;
  }
  /* 把正文切成一块块（按二级标题分，太长再按段落切开） */
  function blocksFromMd(md, startP = 1) {
    const text = String(md || '').trim();
    if (!text) return [];
    const parts = [];
    let buf = '';
    const push = () => { if (buf.trim()) { parts.push(buf.trim()); buf = ''; } };
    for (const line of text.split('\n')) {
      if (/^##\s/.test(line)) push();
      buf += (buf ? '\n' : '') + line;
      if (buf.length > 1400) {
        const cut = buf.lastIndexOf('\n', 1400);
        if (cut > 400) { parts.push(buf.slice(0, cut).trim()); buf = buf.slice(cut); }
      }
    }
    push();
    // 只有一个大标题（# 标题）的那一块并到下一块里，不然开头是一块几乎空白的板块
    if (parts.length > 1 && /^#\s[^\n]*$/.test(parts[0])) parts.splice(0, 2, parts[0] + '\n\n' + parts[1]);
    // 板块编号尽量用正文里的课件页码 [p.N]，左边课件才能对上；用过的页码不重复
    const used = new Set(), out = [];
    parts.forEach(t => {
      const m = [...t.matchAll(/\[p\.?\s*(\d+)/g)].map(x => Number(x[1])).find(n => n >= 1 && !used.has(n));
      if (m) used.add(m);
      out.push({ p: m || 0, text: t });
    });
    let k = Math.max(startP - 1, ...used, out.length);
    out.forEach(b => { if (!b.p) b.p = ++k; });
    return out;
  }
  const mdSig = s => { s = String(s || ''); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ':' + h; };

  /* 估算排版。手写永远跟着它所在的那一块走：块挪了多少，那一块的笔迹就挪多少。
     （以前每次打开笔记都先按估算高度排一次、再按实际高度排一次，中间笔迹没跟着挪，
       于是每打开一次手写就往上跑一截 —— 这是「手写和文字错位」的根源） */
  function layout(wd) {
    const oldY = new Map(wd.blocks.filter(b => typeof b.y === 'number').map(b => [b.p, b.y]));
    let y = 0;
    wd.blocks.forEach(bl => { bl.y = y; y += blockH(bl.text) + GAP; });
    wd.h = y;
    shiftInk(wd, oldY);
    return wd;
  }
  function shiftInk(wd, oldY) {
    const ny = new Map(wd.blocks.map(b => [b.p, b.y]));
    wd.strokes.forEach(s => {
      const oy = oldY.get(s.p), y2 = ny.get(s.p);
      if (oy == null || y2 == null || oy === y2) return;
      const d = y2 - oy; s.pts = s.pts.map(q => [q[0], q[1] + d, q[2]]);
    });
    // 打字文本框也跟着所在的那一块走
    (wd.texts || []).forEach(t => {
      const oy = oldY.get(t.p), y2 = ny.get(t.p);
      if (oy == null || y2 == null || oy === y2) return;
      t.y += y2 - oy;
    });
  }
  const sections = note => {
    const wd = world(note);
    return wd.blocks.map(bl => ({ p: bl.p, y: bl.y, text: bl.text, strokes: wd.strokes.filter(s => s.p === bl.p) }));
  };
  const hasInk = note => {
    try { return world(note).strokes.length > 0; } catch (e) { return false; }
  };
  const blockOf = (wd, y) => { let best = wd.blocks[0]; for (const b of wd.blocks) if (y >= b.y - 40) best = b; return best; };
  /* 在笔记最后接一段新内容：只新增板块，原来板块的编号（手写跟着编号走）一个都不改 */
  function appendMd(note, add) {
    const wd = world(note);
    const old = String(note.markdown || '').trim();
    note.markdown = old ? old + '\n\n' + add : add;
    const taken = new Set(wd.blocks.map(b => b.p));
    let next = Math.max(0, ...taken);
    const nb = blocksFromMd(add).map(b => { if (!b.p || taken.has(b.p)) b.p = ++next; else next = Math.max(next, b.p); taken.add(b.p); return { p: b.p, text: b.text }; });
    const last = wd.blocks[wd.blocks.length - 1];
    // 原来只有一块空白（还没写过正文）：直接换掉
    if (wd.blocks.length === 1 && !String(last.text || '').trim()) wd.blocks = [];
    if (wd.blocks.every(b => typeof b.y === 'number')) {
      const lb = wd.blocks[wd.blocks.length - 1];
      let y = Math.max(wd.h || 0, lb ? lb.y + blockH(lb.text) + GAP : 0);
      nb.forEach(b => { b.y = y; y += blockH(b.text) + GAP; wd.blocks.push(b); });
      wd.h = y;
    } else nb.forEach(b => wd.blocks.push(b));   // 位置还没排过：打开画布时会自动排（已有板块的位置不动）
    wd.mdSig = mdSig(note.markdown);
    return wd;
  }

  /* 把一块区域画成图（导出 / 交给 Gemini 认手写） */
  function inkImage(src, targetW = 1600, maxPx = 4.2e6, bold = 1, region) {
    const strokes = src.strokes || [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    if (region) { x0 = region.x0; y0 = region.y0; x1 = region.x1; y1 = region.y1; }
    else for (const s of strokes) for (const p of s.pts || []) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    if (!isFinite(x0)) return null;
    const pad = region ? 14 : 40;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const bw = Math.max(80, x1 - x0), bh = Math.max(80, y1 - y0);
    let sc = targetW / bw;
    if (bw * bh * sc * sc > maxPx) sc = Math.sqrt(maxPx / (bw * bh));
    sc = Math.max(sc, .8);
    const c = document.createElement('canvas');
    c.width = Math.round(bw * sc); c.height = Math.round(bh * sc);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.translate(-x0 * sc, -y0 * sc);
    for (const s of strokes) drawStroke(ctx, s, sc, true, bold);
    return c;
  }
  const inkBox = src => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of (src && src.strokes) || []) for (const p of s.pts || []) {
      if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
    }
    return isFinite(x0) ? { x0, y0, x1, y1 } : null;
  };
  /* iOS Safari 对没挂在页面上的 canvas 调 toDataURL 有时会返回全白，先挂上去再截 */
  function shoot(canvas, mime, quality) {
    canvas.style.cssText = 'position:fixed;left:-99999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(canvas);
    let out;
    try { out = canvas.toDataURL(mime, quality); } finally { canvas.remove(); }
    return out;
  }

  /* ---------- 挂载 ---------- */
  let current = null;

  function mount(host, note, { course, onPageJump } = {}) {
    const onPageChange = null;   // 不再随滚动自动联动左边课件
    const wd = world(note);
    // 只有出现还没排过的块（新加的、刚切出来的）才估算一次；排好的位置原样保留
    if (wd.blocks.some(b => typeof b.y !== 'number')) layout(wd);
    const P = Object.assign({ tool: 'select', color: INK[0], size: 3, penOnly: true }, pref());
    // 顺手把老页面里「第几页」的板书信息记下来，供左边课件联动
    // 每份笔记各记各的位置和缩放（以前是全局一个，换一份笔记会停在奇怪的地方）
    const savedView = null;   // 每次打开笔记都从最上面、100% 开始（不回到上次看到的位置）
    let view = Object.assign({ x: 0, y: -24, z: 1 }, savedView || {});
    const NS = { size: Math.min(24, Math.max(11, Number(P.noteSize) || 15)), bold: !!P.noteBold, ink: P.noteInk || '#1A2030' };

    host.innerHTML = `
      <div class="board-tools noprint">
        <div class="seg tools" role="group" aria-label="工具">
          <button data-tool="select" title="选择：双击改字、拖空白处移动（V）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3l14 8-6 1.5L10 19z"/></svg><span class="lbl">选择</span></button>
          <button data-tool="hand" title="手：拖动画布（H / 按住空格）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11V5.5a1.5 1.5 0 013 0V10m0-4.5a1.5 1.5 0 013 0V10m0-3a1.5 1.5 0 013 0v6.5A6.5 6.5 0 0110.5 20 5.5 5.5 0 015.6 17L3.8 13a1.4 1.4 0 012.4-1.4L8 14"/></svg><span class="lbl">手</span></button>
          <button data-tool="pen" title="笔（P；再点一下切成橡皮）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14 7l3 3"/></svg><span class="lbl">笔</span></button>
          <button data-tool="hl" title="荧光笔"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 15l-3 3H3v-2l3-3"/><path d="M8 12l7.5-7.5a2 2 0 013 3L11 15z"/><path d="M14 21h7"/></svg><span class="lbl">荧光</span></button>
          <button data-tool="er" title="橡皮（E）"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21h12"/><path d="M5.5 15.5l9-9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L13 18H8z"/></svg><span class="lbl">橡皮</span></button>
          <button data-tool="text" title="文字（T）：点画布任意位置放一个文本框，直接打字"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/></svg><span class="lbl">文字</span></button>
        </div>
        <div class="seg colors" role="group" aria-label="笔的颜色">${INK.map(c => `<button data-color="${c}" style="--sw:${c}" aria-label="颜色"></button>`).join('')}</div>
        <div class="seg sizes" role="group" aria-label="粗细"><button data-size="2" title="细" aria-label="细"><i style="--d:4px"></i></button><button data-size="3" title="中" aria-label="中"><i style="--d:7px"></i></button><button data-size="5" title="粗" aria-label="粗"><i style="--d:10px"></i></button></div>
        <div class="seg"><button data-act="undo" title="撤销（⌘Z · 两指轻点）" aria-label="撤销"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-2"/></svg></button><button data-act="redo" title="重做（⇧⌘Z · 三指轻点）" aria-label="重做"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h2"/></svg></button></div>
        <div class="seg nav" role="group" aria-label="块">
          <button data-nav="-1" aria-label="上一块" title="上一块">‹</button>
          <span class="zoom-pct" id="ic-nav" title="第几块 / 共几块">1/1</span>
          <button data-nav="1" aria-label="下一块" title="下一块">›</button>
        </div>
        <div class="seg zoom" role="group" aria-label="缩放">
          <button data-zoom="-" title="缩小（⌘− · 捏合）" aria-label="缩小">−</button>
          <button data-zoom="fit" class="zoom-pct" id="b-zoom" title="点一下回到 100%">100%</button>
          <button data-zoom="+" title="放大（⌘+）" aria-label="放大">＋</button>
        </div>
        <span class="grow"></span>
        <button class="btn small ghost icon-btn" data-act="find" title="在笔记里找字（⌘F）" aria-label="查找"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg></button>
        <details class="more">
          <summary class="btn small">更多</summary>
          <div class="more-menu">
            <div class="mm-row"><span class="mm-lbl">笔记文字</span><button data-nfont="-" title="字小一点">A−</button><button data-nfont="+" title="字大一点">A+</button><button data-nbold="1" title="加粗"><b>B</b></button></div>
            <div class="mm-row"><span class="mm-lbl">文字颜色</span><button data-ncolor="#1A2030" class="nsw" style="--sw:#1A2030" aria-label="墨黑"></button><button data-ncolor="#2C47A5" class="nsw" style="--sw:#2C47A5" aria-label="蓝"></button><button data-ncolor="#B93434" class="nsw" style="--sw:#B93434" aria-label="红"></button></div>
            <button data-act="add" title="在最后加一块空白笔记">＋ 加一块空白</button>
            <button data-act="center" title="回到当前这一块">回到当前块</button>
            <label class="more-check"><input type="checkbox" id="b-pen" ${P.penOnly ? 'checked' : ''}>只用 Apple Pencil 写（手指只移动）</label>
            <button data-act="doc" title="按课件页码把要点排成一块块（手写都留着）">跟课件排页</button>
            <button data-act="export">导出手写图片</button>
            <button data-act="hw" title="用 Gemini 免费识别手写，整理后放进笔记">识别手写 → 笔记</button>
          </div>
        </details>
      </div>
      ${Device.touch && !pref().hintSeen ? `<div class="board-hint noprint">小技巧：Apple Pencil 在任何工具下都能直接写，写字时手掌压着屏幕也没关系 · 一指拖动、两指捏合缩放 · 两指轻点撤销、三指轻点重做 · 双击文字（或用笔点两下）就能改 <button class="btn small ghost" data-act="hint-x">知道了</button></div>` : ''}
      <div class="ic-stage" id="ic-stage">
        <div class="ic-world" id="ic-world"></div>
        <canvas class="ic-ink" id="ic-ink"></canvas>
        <canvas class="ic-live" id="ic-live"></canvas>
      </div>`;
    const hx = $('[data-act=hint-x]', host); if (hx) hx.onclick = () => { savePref({ hintSeen: 1 }); hx.parentElement.remove(); };

    const stage = $('#ic-stage', host), worldEl = $('#ic-world', host);
    const ink = $('#ic-ink', host), live = $('#ic-live', host);
    const ictx = ink.getContext('2d'), lctx = live.getContext('2d');
    let dpr = 1;
    let save = null;
    const saveView = () => {
      if (pref().views) savePref({ views: null });   // 以前存的「上次看到哪」清掉，不再记
    };
    let viewT = null;
    const persistView = () => { clearTimeout(viewT); viewT = setTimeout(saveView, 400); };
    let pending = false, cleaned = false;
    const persist = () => { pending = true; clearTimeout(save); save = setTimeout(async () => { pending = false; saveView(); await DB.put('notes', note); }, 500); };

    /* ---- 视图 ---- */
    let raf = 0;
    const applyView = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        worldEl.style.transform = `translate(${-view.x * view.z}px, ${-view.y * view.z}px) scale(${view.z})`;
        const lab = $('#b-zoom', host); if (lab) lab.textContent = Math.round(view.z * 100) + '%';
        paint();
      });
    };
    // 画布高度按「屏幕上还剩多少」算，保证整块都在可视区里，不用滚页面找
    const fitStage = () => {
      const offset = stage.getBoundingClientRect().top + (window.scrollY || 0);
      const avail = Math.max(360, window.innerHeight - offset - 16);
      if (Math.abs(stage.clientHeight - avail) > 4) stage.style.height = avail + 'px';
    };
    const resize = () => {
      fitStage();
      dpr = Math.min(2.5, window.devicePixelRatio || 1);
      for (const c of [ink, live]) { c.width = Math.round(stage.clientWidth * dpr); c.height = Math.round(stage.clientHeight * dpr); }
      paint();
    };
    const toWorld = (cx, cy) => {
      const r = stage.getBoundingClientRect();
      return [view.x + (cx - r.left) / view.z, view.y + (cy - r.top) / view.z];
    };

    /* ---- 画 ---- */
    function paint() {
      const w = ink.width, h = ink.height;
      ictx.setTransform(1, 0, 0, 1, 0, 0);
      ictx.clearRect(0, 0, w, h); // 纯白画布：不画横线，整块都是写字的地方
      ictx.setTransform(view.z * dpr, 0, 0, view.z * dpr, -view.x * view.z * dpr, -view.y * view.z * dpr);
      // 只画看得见的笔画：长笔记几百笔时平移也不卡
      const vx0 = view.x, vy0 = view.y, vx1 = view.x + w / dpr / view.z, vy1 = view.y + h / dpr / view.z;
      for (const s of wd.strokes) {
        const b = strokeInfo(s).box;
        if (b[2] < vx0 || b[0] > vx1 || b[3] < vy0 || b[1] > vy1) continue;
        drawStroke(ictx, s, 1);
      }
      ictx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /* ---- 板块（笔记文字）---- */
    const renderBlocks = () => {
      worldEl.innerHTML = wd.blocks.map((bl, i) => `<div class="ic-block" data-p="${bl.p}" data-i="${i}" style="top:${bl.y}px;width:${COL}px">
        ${bl.text ? `<div class="md"></div>` : `<div class="hint ic-empty">这一块还没有字，双击可以写</div>`}
        <div class="ic-tag">P${bl.p}</div>
      </div>`).join('');
      $$('.ic-block', worldEl).forEach((el, i) => {
        const bl = wd.blocks[i];
        if (bl.text) {
          const box = $('.md', el);
          // 页码引用 [p.3] 显示成小标签：点一下左边课件跳到那页；改字时不会被弄丢
          box.innerHTML = md(String(bl.text).replace(/\[p\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?\]/g, (m, a, b2) => ` <span class="pref" data-ref="${m}" data-pg="${a}">p${a}${b2 ? '–' + b2 : ''}</span>`));
          $$('.pref', box).forEach(r => { r.contentEditable = 'false'; r.onclick = ev => { if (box.isContentEditable) return; ev.stopPropagation(); if (onPageJump) onPageJump(Number(r.dataset.pg)); }; });
        }
        el.addEventListener('dblclick', e => { e.preventDefault(); startEdit(i, e); });
        // 选块：点一下把它设为「当前块」（居中/联动用）
        el.addEventListener('pointerdown', () => { curBlock = i; });
      });
      curBlock = Math.min(curBlock, wd.blocks.length - 1);
      renderTexts();
    };

    /* ---- 文字工具：画布上任意位置的文本框（像 GoodNotes 的 T） ----
       存在 world.texts：{ id, p, x, y, text, size, c }，坐标是世界坐标，随缩放一起变；
       跟着所在那一块挪（shiftInk）。空的文本框离开编辑时自动删掉。 */
    wd.texts = wd.texts || [];
    function renderTexts() {
      $$('.ic-text', worldEl).forEach(el => el.remove());
      for (const t of wd.texts) worldEl.appendChild(textEl(t));
    }
    function textEl(t) {
      const el = document.createElement('div');
      el.className = 'ic-text'; el.dataset.id = t.id;
      el.style.left = t.x + 'px'; el.style.top = t.y + 'px';
      el.style.setProperty('--tsize', (t.size || 16) + 'px'); el.style.setProperty('--tc', shown(t.c || '#1A2030'));
      el.innerHTML = `<span class="ic-grip" title="拖动移动位置" aria-hidden="true">⠿</span><button class="ic-tx-del" title="删除这个文本框" aria-label="删除这个文本框">×</button><div class="ic-tx-body"></div>`;
      const body = $('.ic-tx-body', el); body.textContent = t.text || '';
      body.addEventListener('pointerdown', e => { if (['pen', 'hl', 'er'].includes(P.tool)) return; e.stopPropagation(); if (!body.isContentEditable) { e.preventDefault(); editText(t, el, e); } });
      $('.ic-tx-del', el).addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); removeText(t); });
      // 拖着左上角的小点挪位置
      const grip = $('.ic-grip', el);
      grip.addEventListener('pointerdown', e => {
        e.stopPropagation(); e.preventDefault();
        try { grip.setPointerCapture(e.pointerId); } catch (err) {}
        const sx = e.clientX, sy = e.clientY, ox = t.x, oy = t.y;
        const mv = ev => { t.x = ox + (ev.clientX - sx) / view.z; t.y = oy + (ev.clientY - sy) / view.z; el.style.left = t.x + 'px'; el.style.top = t.y + 'px'; };
        const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); const b = blockOf(wd, t.y); t.p = b ? b.p : t.p; persist(); };
        grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
      });
      return el;
    }
    function editText(t, el, ev) {
      const body = $('.ic-tx-body', el);
      el.classList.add('editing');
      body.contentEditable = 'plaintext-only';
      if (body.contentEditable !== 'plaintext-only') body.contentEditable = 'true';
      body.spellcheck = false;
      body.focus();
      try {
        const sel = window.getSelection(); let range = null;
        if (ev && document.caretRangeFromPoint) range = document.caretRangeFromPoint(ev.clientX, ev.clientY);
        if (!range || !body.contains(range.startContainer)) { range = document.createRange(); range.selectNodeContents(body); range.collapse(false); }
        sel.removeAllRanges(); sel.addRange(range);
      } catch (e) {}
      const done = () => {
        body.removeEventListener('blur', done);
        body.contentEditable = 'false'; el.classList.remove('editing');
        t.text = body.innerText.replace(/\n+$/, '');
        if (!t.text.trim()) { removeText(t, true); return; }
        persist();
      };
      body.addEventListener('blur', done);
      body.addEventListener('keydown', k => { if (k.key === 'Escape') { k.preventDefault(); body.blur(); } k.stopPropagation(); });
    }
    function addText(cx, cy) {
      const [x, y] = toWorld(cx, cy);
      const b = blockOf(wd, y);
      const t = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), p: b ? b.p : null, x: Math.round(x), y: Math.round(y - 10), text: '', size: Math.round(NS.size + 1), c: P.tool === 'text' && P.color ? P.color : NS.ink };
      wd.texts.push(t);
      const el = textEl(t); worldEl.appendChild(el);
      undo.push({ type: 'text', t }); redo.length = 0;
      editText(t, el, null);
    }
    function removeText(t, quiet) {
      wd.texts = wd.texts.filter(x => x !== t);
      const el = $(`.ic-text[data-id="${t.id}"]`, worldEl); if (el) el.remove();
      persist(); if (!quiet) toast('删掉了文本框', 1200);
    }

    let curBlock = 0;

    /* 用真实渲染高度重排：估计值要么留大空隙、要么重叠，量一次最准。手写跟着块一起挪。 */
    function relayout() {
      const els = $$('.ic-block', worldEl);
      // 画布被藏起来（切到别的分栏 / 还没显示）时量出来全是 0，这时重排会把手写全挪乱
      if (!els.length || els.some(el => !el.offsetHeight)) { paint(); return; }
      const oldY = new Map(wd.blocks.map(b => [b.p, b.y]));
      let y = 0;
      wd.blocks.forEach((bl, i) => {
        bl.y = y;
        y += (els[i] ? els[i].offsetHeight + 56 : blockH(bl.text) + GAP);
      });
      wd.h = y;
      els.forEach((el, i) => { el.style.top = wd.blocks[i].y + 'px'; });
      shiftInk(wd, oldY);
      updateNav();
      paint();
    }

    function startEdit(i, ev) {
      if (P.tool !== 'select') return;
      const el = $$('.ic-block', worldEl)[i]; if (!el) return;
      let body = $('.md', el);
      if (!body || !body.textContent.trim() && !wd.blocks[i].text) {
        el.innerHTML = '<div class="md"></div><div class="ic-tag">P' + wd.blocks[i].p + '</div>';
        body = $('.md', el);
      }
      const before = wd.blocks[i].text || '';
      body.contentEditable = 'true'; body.spellcheck = false; body.classList.add('editing'); body.focus();
      const snap = htmlToMd(body);           // 进入编辑时的样子：没改就什么都不动
      // 光标落在你双击的地方，不要跳到末尾
      try {
        let range = null;
        if (ev && document.caretRangeFromPoint) range = document.caretRangeFromPoint(ev.clientX, ev.clientY);
        else if (ev && document.caretPositionFromPoint) { const cp = document.caretPositionFromPoint(ev.clientX, ev.clientY); if (cp) { range = document.createRange(); range.setStart(cp.offsetNode, cp.offset); } }
        const sel = window.getSelection();
        if (range && body.contains(range.startContainer)) { sel.removeAllRanges(); sel.addRange(range); }
      } catch (err) {}
      // 编辑时块会变高：实时把下面的块推开，不会盖住
      const grow = () => requestAnimationFrame(relayout);
      body.addEventListener('input', grow);
      const finish = async () => {
        body.removeEventListener('blur', finish);
        body.removeEventListener('input', grow);
        body.contentEditable = 'false'; body.classList.remove('editing');
        const newMd = htmlToMd(body);
        if (newMd === snap) { renderBlocks(); relayout(); return; }
        let doc = String(note.markdown || '');
        const at = before ? doc.indexOf(before) : -1;
        if (at >= 0) doc = doc.slice(0, at) + newMd + doc.slice(at + before.length);   // 不用 replace：正文里的 $ 会被当成特殊符号
        else {
          // 这一块不是从正文原样切出来的（比如按课件重排过）：用所有板块重新拼出正文，避免越改越重复
          wd.blocks[i].text = newMd;
          doc = wd.blocks.map(b => String(b.text || '').trim()).filter(Boolean).join('\n\n');
        }
        note.markdown = doc;
        wd.blocks[i].text = newMd;
        wd.mdSig = mdSig(doc);
        renderBlocks(); relayout(); persist();
        toast('改好了', 1200);
      };
      body.addEventListener('blur', finish);
      body.addEventListener('keydown', ev => {
        if (ev.key === 'Escape' || ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter')) { ev.preventDefault(); body.blur(); }
      });
    }

    /* ---- 工具 ---- */
    const syncTools = () => {
      $$('[data-tool]', host).forEach(b => b.classList.toggle('on', b.dataset.tool === P.tool));
      $$('[data-color]', host).forEach(b => b.classList.toggle('on', b.dataset.color === P.color));
      $$('[data-size]', host).forEach(b => b.classList.toggle('on', Number(b.dataset.size) === P.size));
      const draw = ['pen', 'hl', 'er'].includes(P.tool);
      stage.classList.toggle('mode-select', P.tool === 'select');
      stage.classList.toggle('mode-hand', P.tool === 'hand');
      stage.classList.toggle('mode-ink', draw);
      stage.classList.toggle('mode-text', P.tool === 'text');
      stage.style.cursor = P.tool === 'hand' ? 'grab' : draw ? 'crosshair' : P.tool === 'text' ? 'text' : 'default';
      $$('[data-nbold]', host).forEach(b => b.classList.toggle('on', NS.bold));
      $$('[data-ncolor]', host).forEach(b => { b.classList.toggle('on', b.dataset.ncolor === NS.ink); b.style.setProperty('--sw', shown(b.dataset.ncolor)); });
      $$('[data-color]', host).forEach(b => b.style.setProperty('--sw', shown(b.dataset.color)));
      host.style.setProperty('--note-size', NS.size + 'px');
      host.style.setProperty('--note-weight', NS.bold ? '600' : '400');
      host.style.setProperty('--note-ink', shown(NS.ink));
    };
    let prevTool = 'pen';
    $$('[data-tool]', host).forEach(b => b.onclick = () => {
      const t = b.dataset.tool;
      if (t === 'select' || t === 'hand' || t === 'text') { P.tool = t; savePref({ tool: t }); syncTools(); return; }
      if (t === P.tool && t !== 'er') { prevTool = t; P.tool = 'er'; }
      else if (t === 'er' && P.tool === 'er') P.tool = prevTool;
      else { if (t !== 'er') prevTool = t; P.tool = t; }
      savePref({ tool: P.tool }); syncTools();
    });
    $$('[data-color]', host).forEach(b => b.onclick = () => { P.color = b.dataset.color; if (P.tool === 'er') P.tool = 'pen'; savePref({ color: P.color, tool: P.tool }); syncTools(); });
    $$('[data-size]', host).forEach(b => b.onclick = () => { P.size = Number(b.dataset.size); savePref({ size: P.size }); syncTools(); });
    $('#b-pen', host).onchange = e => { P.penOnly = e.target.checked; savePref({ penOnly: P.penOnly }); };
    $$('[data-nfont]', host).forEach(b => b.onclick = () => { NS.size = Math.min(24, Math.max(11, NS.size + (b.dataset.nfont === '+' ? 1.5 : -1.5))); savePref({ noteSize: NS.size }); syncTools(); renderBlocks(); requestAnimationFrame(relayout); });
    $$('[data-nbold]', host).forEach(b => b.onclick = () => { NS.bold = !NS.bold; savePref({ noteBold: NS.bold }); syncTools(); requestAnimationFrame(relayout); });
    $$('[data-ncolor]', host).forEach(b => b.onclick = () => { NS.ink = b.dataset.ncolor; savePref({ noteInk: NS.ink }); syncTools(); });

    /* ---- 缩放 ---- */
    const zoomAt = (k, cx, cy) => {
      const r = stage.getBoundingClientRect();
      const px = cx == null ? r.width / 2 : cx - r.left, py = cy == null ? r.height / 2 : cy - r.top;
      const wx = view.x + px / view.z, wy = view.y + py / view.z;
      const z = Math.min(3, Math.max(.2, view.z * k));
      if (z === view.z) return;
      view.z = z; view.x = wx - px / z; view.y = wy - py / z;
      applyView(); persistView();
    };
    $$('[data-zoom]', host).forEach(b => b.onclick = () => {
      const z = b.dataset.zoom;
      if (z === 'fit') { zoomTo(1); return; }
      zoomAt(z === '+' ? 1.2 : 1 / 1.2);
    });
    // 回到 100%：以画布中心为准，不会突然跳到别处
    const zoomTo = z => zoomAt(Math.min(3, Math.max(.2, z)) / view.z);

    stage.addEventListener('wheel', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX, e.clientY); return; }
      // 普通滚轮 = 平移画布（这是无限画布，页面本身不滚）
      e.preventDefault();
      view.x += (e.shiftKey ? e.deltaY : e.deltaX) / view.z;
      view.y += (e.shiftKey ? 0 : e.deltaY) / view.z;
      applyView(); persistView(); notify();
    }, { passive: false });

    /* ---- 画 / 拖 ----
       手势规则（iPad 和 Mac 一样）：
       · 笔 / 鼠标左键：按当前工具写、涂、擦
       · 一根手指（开了「只用笔写」）/ 手工具 / 空格 / 中键 / 选择模式拖空白处：移动画布
       · 两根手指：捏合缩放 + 一起拖动；两指轻点 = 撤销，三指轻点 = 重做 */
    let cur = null, pan = null, spaceTmp = null;
    const pos = e => {
      const [x, y] = toWorld(e.clientX, e.clientY);
      return [x, y, e.pointerType === 'pen' ? (e.pressure || .5) : .5];
    };
    const allowed = e => {
      if (e.pointerType === 'pen') return true;
      if (e.pointerType === 'touch') return !P.penOnly;
      return e.button === 0 || e.buttons === 1;
    };
    const liveClear = () => { lctx.setTransform(1, 0, 0, 1, 0, 0); lctx.clearRect(0, 0, live.width, live.height); };
    const liveDraw = () => {
      liveClear();
      if (!cur || cur.er) return;
      lctx.setTransform(view.z * dpr, 0, 0, view.z * dpr, -view.x * view.z * dpr, -view.y * view.z * dpr);
      drawStroke(lctx, cur.s, 1);
      lctx.setTransform(1, 0, 0, 1, 0, 0);
    };

    const startPan = e => {
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      pan = { id: e.pointerId, touch: e.pointerType === 'touch', t: Date.now(), x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
      stage.classList.add('panning');
    };
    // 触屏：记下每根手指，用来做捏合和多指轻点
    const touches = new Map();
    let pinch = null, tap = null, touchLock = false, lastTap = null;
    const mid2 = () => { const [a, b] = [...touches.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; };
    // 手掌 / 卡住的触点：
    //  · 新的「第一根手指」落下时，之前记着的触点一定都已经抬起了（抬起事件可能落在画布外没收到），先清空，
    //    不然 touchLock 会一直开着，画布就再也拖不动了；
    //  · 笔一落下（PenGuard 发 tk:pendown），正在按着的手指全部当手掌作废，手掌刚才拖动 / 缩放画布的那一下也撤回。
    const dropTouches = restore => {
      if (restore && pan && pan.touch && Date.now() - pan.t < 900) { view.x = pan.vx; view.y = pan.vy; applyView(); }
      if (restore && pinch && pinch.v0 && Date.now() - pinch.t < 900) { view.x = pinch.v0.x; view.y = pinch.v0.y; view.z = pinch.v0.z; applyView(); }
      touches.clear(); pinch = null; tap = null; touchLock = false;
      if (pan && pan.touch) { pan = null; stage.classList.remove('panning'); }
      if (cur && cur.touch) { cur = null; liveClear(); }
    };
    const onPenDown = () => { if (!host.isConnected) { window.removeEventListener('tk:pendown', onPenDown); return; } if (touches.size || (pan && pan.touch) || (cur && cur.touch)) dropTouches(true); };
    window.addEventListener('tk:pendown', onPenDown);
    stage.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      if (e.isPrimary && touches.size) dropTouches(false);
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
      if (touches.size === 1) tap = { n: 1, t: Date.now(), moved: false };
      else if (tap) tap.n = Math.max(tap.n, touches.size);
      if (touches.size >= 2) {
        // 第二根手指落下：取消单指拖动和正在写的那一笔（手指写的），改成捏合
        pan = null; touchLock = true;
        if (cur && !cur.er && cur.touch) { cur = null; liveClear(); }
        const m = mid2(), r = stage.getBoundingClientRect();
        pinch = { t: Date.now(), v0: { x: (pan && pan.touch ? pan.vx : view.x), y: (pan && pan.touch ? pan.vy : view.y), z: view.z }, d: m.d, z: view.z, wx: view.x + (m.x - r.left) / view.z, wy: view.y + (m.y - r.top) / view.z };
      }
    }, true);
    stage.addEventListener('pointermove', e => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      const t = touches.get(e.pointerId); t.x = e.clientX; t.y = e.clientY;
      if (tap && Math.hypot(t.x - t.x0, t.y - t.y0) > 12) tap.moved = true;
      if (pinch && touches.size >= 2) {
        e.preventDefault();
        const m = mid2(), r = stage.getBoundingClientRect();
        view.z = Math.min(3, Math.max(.2, pinch.z * m.d / pinch.d));
        view.x = pinch.wx - (m.x - r.left) / view.z;
        view.y = pinch.wy - (m.y - r.top) / view.z;
        applyView();
      }
    }, true);
    const touchUp = e => {
      if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
      touches.delete(e.pointerId);
      if (touches.size < 2 && pinch) { pinch = null; persistView(); notify(); }
      if (touches.size === 0) {
        if (tap && !tap.moved && e.type === 'pointerup' && Date.now() - tap.t < 320) {
          // 刚用笔写过（1.5 秒内）的多指轻点多半是手掌抬起，不当成撤销 / 重做
          if (!(typeof PenGuard !== 'undefined' && PenGuard.recent(1500))) { if (tap.n === 2) doUndo(true); else if (tap.n >= 3) doRedo(true); }
        }
        tap = null; touchLock = false;
      }
    };
    stage.addEventListener('pointerup', touchUp, true);
    stage.addEventListener('pointercancel', touchUp, true);
    // 手指拖到画布外面才抬起：画布收不到 pointerup，在 window 上补收
    const winUp = e => { if (!host.isConnected) { window.removeEventListener('pointerup', winUp); window.removeEventListener('pointercancel', winUp); return; } if (!stage.contains(e.target)) touchUp(e); };
    window.addEventListener('pointerup', winUp);
    window.addEventListener('pointercancel', winUp);

    // 移动画布：在整块舞台上接（选择模式下笔画层不接事件，拖空白处也要能挪）
    stage.addEventListener('pointerdown', e => {
      if (pan || cur) return;
      if (e.pointerType === 'touch' && touchLock) return;
      const editing = e.target.closest && e.target.closest('.md.editing');
      if (editing) return;
      const onBlock = e.target.closest && e.target.closest('.ic-block');
      if (e.target.closest && e.target.closest('.ic-text')) return;   // 文本框自己处理（编辑 / 拖动）
      // 正在改字时点了别处：先把改动收下（下面会 preventDefault，浏览器就不会自己失焦了）
      const ae = document.activeElement;
      if (ae && ae.isContentEditable && stage.contains(ae)) ae.blur();
      const drawTool = ['pen', 'hl', 'er'].includes(P.tool);
      const wantsPan = P.tool === 'hand' || spaceTmp || e.button === 1 || P.tool === 'text'
        || (e.pointerType === 'touch' && (P.penOnly || !drawTool))
        || (P.tool === 'select' && !onBlock && e.pointerType !== 'pen');
      if (!wantsPan) return;
      // 触屏在块上：判断双击（自己判断，触屏上浏览器的 dblclick 不可靠）
      if (e.pointerType === 'touch' && onBlock && P.tool === 'select') {
        const now = Date.now();
        if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
          lastTap = null; e.preventDefault(); startEdit(Number(onBlock.dataset.i), e); return;
        }
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
      e.preventDefault();
      startPan(e);
    });
    stage.addEventListener('pointermove', e => {
      if (!pan || e.pointerId !== pan.id) return;
      if (touchLock && e.pointerType === 'touch') { pan = null; return; }
      if (Math.abs(e.clientX - pan.x) + Math.abs(e.clientY - pan.y) > 3) pan.moved = true;
      view.x = pan.vx - (e.clientX - pan.x) / view.z;
      view.y = pan.vy - (e.clientY - pan.y) / view.z;
      applyView();
    });
    const panEnd = e => {
      if (!pan || (e && e.pointerId !== pan.id)) return;
      const tap = !pan.moved && P.tool === 'text' && !spaceTmp && e && e.type === 'pointerup' && !touchLock;
      const at = pan;
      pan = null; stage.classList.remove('panning'); persistView(); notify();
      // 文字工具：点一下（没拖动）就在这里放一个文本框
      if (tap) addText(at.x, at.y);
    };
    stage.addEventListener('pointerup', panEnd);
    stage.addEventListener('pointercancel', panEnd);

    const inkDown = (e, el, tool, extra) => {
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      const p = pos(e);
      const blk = blockOf(wd, p[1]);
      curBlock = wd.blocks.indexOf(blk);
      if (tool === 'er') { cur = Object.assign({ er: true, id: e.pointerId, removed: [] }, extra); eraseAt(p, cur); return; }
      cur = Object.assign({ id: e.pointerId, t0: Date.now(), touch: e.pointerType === 'touch', s: { tool, c: tool === 'hl' ? '#FFD400' : P.color, w: tool === 'hl' ? 18 : P.size, pts: [p], p: blk ? blk.p : null } }, extra);
      liveDraw();
    };
    ink.addEventListener('pointerdown', e => {
      if (P.tool === 'hand' || P.tool === 'select' || P.tool === 'text' || spaceTmp || e.button === 1) return; // 交给上面的「移动画布」
      if (!allowed(e)) return;
      if (e.pointerType === 'touch' && (touchLock || touches.size > 1)) return;
      inkDown(e, ink, P.tool);
    });
    // Apple Pencil 在「选择」「手」模式下也直接写字（跟 GoodNotes 一样，笔永远是笔），
    // 不会因为手掌不小心点到了别的工具，笔就写不出来了。
    // 选择模式下用笔在文字上快速点两下 = 改字（双击）。
    let penTap = null;
    stage.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'pen' || cur) return;
      if (!(P.tool === 'select' || P.tool === 'hand') || spaceTmp) return;
      const t = e.target;
      if (t.closest && (t.closest('.ic-text') || t.closest('.md.editing'))) return;
      const blockEl = t.closest && t.closest('.ic-block');
      inkDown(e, stage, ['pen', 'hl'].includes(prevTool) ? prevTool : 'pen', { viaStage: true, sel: P.tool === 'select', blockEl, x: e.clientX, y: e.clientY });
    }, true);
    stage.addEventListener('pointermove', e => { if (cur && cur.viaStage && e.pointerId === cur.id) inkMove(e); });
    stage.addEventListener('pointerup', e => { if (cur && cur.viaStage && e.pointerId === cur.id) end(e); });
    stage.addEventListener('pointercancel', e => { if (cur && cur.viaStage && e.pointerId === cur.id) end(e); });
    const inkMove = e => {
      if (!cur || e.pointerId !== cur.id) return;
      e.preventDefault();
      const co = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const evs = co.length ? co : [e];
      let added = false;
      for (const ev of evs) {
        const p = pos(ev);
        if (cur.er) { eraseAt(p, cur); continue; }
        const pts = cur.s.pts, last = pts[pts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) < .7 / view.z) continue;
        pts.push(p); added = true;
      }
      if (added && !liveRaf) liveRaf = requestAnimationFrame(() => { liveRaf = 0; liveDraw(); });
    };
    ink.addEventListener('pointermove', e => { if (cur && !cur.viaStage) inkMove(e); });
    let liveRaf = 0;
    const end = e => {
      if (!cur || (e && e.pointerId !== cur.id)) return;
      if (cur.er) { if (cur.removed.length) { undo.push({ type: 'erase', strokes: cur.removed }); redo.length = 0; persist(); paint(); } }
      else {
        wd.strokes.push(cur.s);
        undo.push({ type: 'add', stroke: cur.s }); redo.length = 0;
        paint(); persist();
        // 选择模式下用笔在文字块上快速点两下：撤回这两个小点，进入改字
        if (cur.sel && cur.blockEl) {
          const ps = cur.s.pts, xs = ps.map(q => q[0]), ys = ps.map(q => q[1]);
          const tiny = Math.max(...xs) - Math.min(...xs) < 4 && Math.max(...ys) - Math.min(...ys) < 4 && Date.now() - cur.t0 < 300;
          if (tiny && penTap && Date.now() - penTap.t < 380 && Math.hypot(cur.x - penTap.x, cur.y - penTap.y) < 24 && penTap.el === cur.blockEl) {
            wd.strokes = wd.strokes.filter(s => s !== cur.s && s !== penTap.s);
            undo.splice(-2, 2); paint(); persist();
            const i = Number(cur.blockEl.dataset.i), ev = { clientX: cur.x, clientY: cur.y };
            penTap = null; liveClear(); cur = null;
            startEdit(i, ev); return;
          }
          penTap = tiny ? { t: Date.now(), x: cur.x, y: cur.y, el: cur.blockEl, s: cur.s } : null;
        }
      }
      cancelAnimationFrame(liveRaf); liveRaf = 0;
      liveClear(); cur = null;
    };
    ink.addEventListener('pointerup', e => { if (cur && !cur.viaStage) end(e); });
    ink.addEventListener('pointercancel', e => { if (cur && !cur.viaStage) end(e); });
    function eraseAt(p, c) {
      const r = 14 / view.z;
      const keep = [];
      let hit = false;
      for (const s of wd.strokes) {
        const bx = strokeInfo(s).box;
        const near = p[0] > bx[0] - r && p[0] < bx[2] + r && p[1] > bx[1] - r && p[1] < bx[3] + r;
        if (near && s.pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < r + s.w / 2)) { c.removed.push(s); hit = true; } else keep.push(s);
      }
      if (hit) { wd.strokes = keep; paint(); }
    }

    /* ---- 撤销 ---- */
    const undo = [], redo = [];
    const doUndo = quiet => {
      const a = undo.pop(); if (!a) { if (!quiet) toast('没有可以撤销的'); return; }
      if (a.type === 'add') wd.strokes = wd.strokes.filter(s => s !== a.stroke);
      else if (a.type === 'text') { wd.texts = wd.texts.filter(x => x !== a.t); renderTexts(); }
      else wd.strokes.push(...a.strokes);
      redo.push(a); paint(); persist(); if (quiet) toast('已撤销', 900);
    };
    const doRedo = quiet => {
      const a = redo.pop(); if (!a) { if (!quiet) toast('没有可以重做的'); return; }
      if (a.type === 'add') wd.strokes.push(a.stroke);
      else if (a.type === 'text') { if (!wd.texts.includes(a.t)) wd.texts.push(a.t); renderTexts(); }
      else wd.strokes = wd.strokes.filter(s => !a.strokes.includes(s));
      undo.push(a); paint(); persist(); if (quiet) toast('已重做', 900);
    };
    $('[data-act=undo]', host).onclick = () => doUndo();
    $('[data-act=redo]', host).onclick = () => doRedo();

    /* ---- 键盘 ---- */
    const onKey = e => {
      if (!host.isConnected) { document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onUp); return; }
      const t = e.target;
      if (t && (/input|textarea|select/i.test(t.tagName) || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
        if (e.key === '0') zoomTo(1); else zoomAt(e.key === '-' ? 1 / 1.2 : 1.2);
        return;
      }
      if (e.code === 'Space' && !spaceTmp) { spaceTmp = P.tool; P.tool = 'hand'; syncTools(); e.preventDefault(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); findModal(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo(true) : doUndo(true); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'e') { P.tool = 'er'; syncTools(); }
      else if (k === 't') { P.tool = 'text'; syncTools(); }
      else if (k === 'v') { P.tool = 'select'; syncTools(); }
      else if (k === 'h') { P.tool = 'hand'; syncTools(); }
      else if (k === 'p') { P.tool = 'pen'; syncTools(); }
    };
    const onUp = e => { if (e.code === 'Space' && spaceTmp) { P.tool = spaceTmp; spaceTmp = null; syncTools(); } };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onUp);

    /* ---- 加块 / 排版 / 导出 ---- */
    $('[data-act=add]', host).onclick = () => {
      const maxP = wd.blocks.reduce((m, b) => Math.max(m, Number(b.p) || 0), 0);
      wd.blocks.push({ p: maxP + 1, y: wd.h || 0, text: '' });
      renderBlocks(); relayout(); persist();
      gotoBlock(wd.blocks.length - 1);
    };
    const centerBtn = $('[data-act=center]', host);
    if (centerBtn) centerBtn.onclick = () => gotoBlock(curBlock);
    function updateNav() {
      const el = $('#ic-nav', host); if (!el) return;
      el.textContent = (Math.min(curBlock, wd.blocks.length - 1) + 1) + '/' + wd.blocks.length;
    }
    $$('[data-nav]', host).forEach(b => b.onclick = () => {
      const i = Math.max(0, Math.min(wd.blocks.length - 1, curBlock + Number(b.dataset.nav)));
      curBlock = i; gotoBlock(i); updateNav();
    });

    async function gotoBlock(i, smooth) {
      const bl = wd.blocks[Math.max(0, Math.min(i, wd.blocks.length - 1))]; if (!bl) return;
      curBlock = wd.blocks.indexOf(bl); updateNav();
      view.y = bl.y - 24;
      view.x = centerX();
      applyView(); persistView(); notify();
    }

    async function docLayout(quiet) {
      const files = (await Promise.all((note.sourceFileIds || []).map(id => DB.get('files', id)))).filter(Boolean);
      const f = files.find(x => /\.pdf$/i.test(x.name) && x.pages) || files.find(x => x.pages);
      if (!f) { if (!quiet) toast('这份笔记没有关联带页码的课件，先用「＋加一块」自己写'); return false; }
      const n = f.pages || await Pdf.count(f.id).catch(() => 0);
      if (!n) { if (!quiet) toast('读不到这份课件的页数'); return false; }
      const byPage = {}, loose = [];
      let head = '';
      for (const raw of String(note.markdown || '').split('\n')) {
        const t = raw.trim();
        if (!t || /^<!--/.test(t)) continue;
        if (/^#{1,4}\s+/.test(t)) { head = t.replace(/^#+\s*/, '').trim(); continue; }
        const ps = [...new Set([...t.matchAll(/\[p\.?\s*(\d+)/g)].map(m => Number(m[1])))].filter(x => x >= 1 && x <= n);
        if (!ps.length) { loose.push(t); continue; }
        for (const pg of ps) {
          const b = byPage[pg] = byPage[pg] || [];
          const last = b[b.length - 1];
          if (!last || last.h !== head) b.push({ h: head, lines: [t] });
          else last.lines.push(t);
        }
      }
      const plan = [];
      for (const pg of Object.keys(byPage).map(Number).sort((a, b) => a - b)) {
        const b = byPage[pg];
        plan.push({ p: pg, text: b.map(x => (x.h ? `#### ${x.h}\n` : '') + x.lines.join('\n')).join('\n\n') });
      }
      let buf = '';
      const flush = () => { if (buf.trim()) plan.push({ p: 0, text: buf.trim() }); buf = ''; };
      for (const line of loose) { if ((buf + line).length > 800) flush(); buf += (buf ? '\n' : '') + line; }
      flush();
      if (!plan.length) { if (!quiet) toast('笔记里还没有标了页码 [p.N] 的段落'); return false; }
      // 保留手写：按页码把旧位置的偏移带过来
      const oldY = new Map(wd.blocks.map(b => [b.p, b.y]));
      let k = Math.max(n, plan.length, ...plan.map(x => x.p));   // 不在课件里的段落：编号排在课件页码后面，不会撞号
      plan.forEach(x => { if (!x.p) x.p = ++k; });
      wd.blocks = plan;
      layout(wd);
      shiftInk(wd, oldY);
      renderBlocks(); relayout(); persist();
      if (!quiet) toast(`按课件排好了 ${plan.length} 块，手写都留着`);
      return true;
    }
    $('[data-act=doc]', host).onclick = () => {
      const b = $('[data-act=doc]', host);
      if (wd.strokes.length && !b.dataset.armed) {
        b.dataset.armed = 1; const old = b.textContent; b.textContent = '再点一次：重排（手写会留着）';
        setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = old; } }, 3200);
        return;
      }
      docLayout(false);
    };
    $('[data-act=export]', host).onclick = () => exportImages(note, wd);
    $('[data-act=hw]', host).onclick = async () => {
      const b = $('[data-act=hw]', host); b.disabled = true; const old = b.textContent;
      try { clearTimeout(save); await DB.put('notes', note); await Recap.handwritingMerge(note, course, t => { b.textContent = t; }); toast('手写已经整理进笔记'); }
      catch (e) { toast(e.message, 6000); }
      b.disabled = false; b.textContent = old;
    };

    function exportImages(note, wd) {
      const secs = wd.blocks.filter(bl => wd.strokes.some(s => s.p === bl.p) || bl.text);
      if (!secs.length) { toast('画布还是空的'); return; }
      toast('正在生成图片…');
      const w = window.open('', '_blank');
      if (!w) { toast('浏览器拦截了新窗口，允许弹出窗口后再试'); return; }
      const imgs = secs.map(bl => {
        const c = inkImage({ strokes: wd.strokes.filter(s => s.p === bl.p) }, 1400);
        return c ? `<h3 style="font:600 15px -apple-system">P${bl.p}</h3><img src="${c.toDataURL('image/jpeg', .9)}">` : '';
      });
      w.document.write(`<title>${esc(note.title)} · 手写</title><style>body{margin:0;background:#888}img{display:block;width:100%;max-width:900px;margin:12px auto;background:#fff}h3{max-width:900px;margin:16px auto 0;color:#fff}@media print{body{background:#fff}img{margin:0;page-break-after:always;max-width:none}h3{color:#000}}</style>${imgs.join('')}<script>setTimeout(()=>print(),400)<\/script>`);
      w.document.close();
    }

    // 双击空白处：在最后加一块并跳过去
    stage.addEventListener('dblclick', e => {
      if (P.tool !== 'select' || e.target.closest('.ic-block') || e.target.closest('.ic-text')) return;
      const wy = toWorld(e.clientX, e.clientY)[1];
      let idx = wd.blocks.findIndex(bl => wy < bl.y + 120);
      if (idx < 0) idx = wd.blocks.length;
      const maxP = wd.blocks.reduce((m, b) => Math.max(m, Number(b.p) || 0), 0);
      wd.blocks.splice(idx, 0, { p: maxP + 1, y: idx < wd.blocks.length ? wd.blocks[idx].y : (wd.h || 0), text: '' });
      renderBlocks(); relayout(); persist();
      gotoBlock(idx);
      setTimeout(() => startEdit(idx, e), 60);
    });

    /* ---- 查找 ---- */
    function findModal() {
      modal(`<h2>在笔记里找</h2>
        <div class="field"><input id="fd-q" type="search" placeholder="输入几个字…" autocomplete="off"></div>
        <div class="fd-list" id="fd-list"><div class="hint">输入后回车，或者直接点结果跳过去</div></div>`, (box, close) => {
        const q = $('#fd-q', box), list = $('#fd-list', box);
        const search = () => {
          const k = q.value.trim().toLowerCase();
          if (!k) { list.innerHTML = '<div class="hint">输入后回车，或者直接点结果跳过去</div>'; return; }
          const hits = wd.blocks.map((b, i) => ({ b, i })).filter(x => (x.b.text || '').toLowerCase().includes(k)).slice(0, 20);
          list.innerHTML = hits.length ? hits.map(({ b, i }) => {
            const t = String(b.text || '');
            const at = t.toLowerCase().indexOf(k);
            const snip = t.slice(Math.max(0, at - 30), at + k.length + 50).replace(/\n/g, ' ');
            return `<button class="fd-item" data-i="${i}"><span class="pill mute">P${b.p}</span><span>${esc(snip)}</span></button>`;
          }).join('') : '<div class="hint">没找到</div>';
          $$('.fd-item', list).forEach(btn => btn.onclick = () => { close(); gotoBlock(Number(btn.dataset.i)); flashBlock(Number(btn.dataset.i)); });
        };
        q.oninput = search;
        q.onkeydown = e => { if (e.key === 'Enter') { const first = $('.fd-item', list); if (first) first.click(); } };
        q.focus();
      });
    }
    function flashBlock(i) {
      const el = $$('.ic-block', worldEl)[i]; if (!el) return;
      el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
    }
    const findBtn = $('[data-act=find]', host); if (findBtn) findBtn.onclick = findModal;

    /* ---- 左边课件联动：画布挪到哪一块，就告诉左边显示第几页 ---- */
    let pageT = null;
    const notify = () => {
      if (!onPageChange) return;
      clearTimeout(pageT);
      pageT = setTimeout(() => {
        const bl = blockOf(wd, view.y + stage.clientHeight / view.z / 2);
        if (bl) onPageChange(bl.p);
      }, 260);
    };

    const pageBlock = p => wd.blocks.findIndex(b => b.p === p);
    function centerX() {
      const w = stage.clientWidth / view.z;
      return w >= COL + 24 ? -(w - COL) / 2 : -12 / view.z;
    }
    current = {
      gotoPage(p, quiet) {
        const i = pageBlock(p); if (i < 0) return;
        curBlock = i; updateNav();
        view.y = wd.blocks[i].y - 24;
        applyView(); persistView();
      },
      pageAtCenter() { const bl = blockOf(wd, view.y + stage.clientHeight / view.z / 2); return bl ? bl.p : null; },
      destroy() { current = null; },
      note, world: wd,
    };

    // 首次进来 / 换了窗口大小之后，如果一块都看不见，就把视图拉回第一块
    const anyVisible = () => {
      const x0 = view.x, y0 = view.y;
      const x1 = x0 + stage.clientWidth / view.z, y1 = y0 + stage.clientHeight / view.z;
      return wd.blocks.some(bl => bl.y < y1 && bl.y + 160 > y0 && COL > x0 - 40 && 0 < x1 + 40);
    };
    resize();
    if (!savedView || !anyVisible()) {
      // 第一次打开：缩到文字那一列刚好放得下（手机上也不会被切掉一半）
      view.z = Math.min(1, Math.max(.55, (stage.clientWidth - 28) / COL));
      view.x = centerX();
      view.y = -24;
    }
    renderBlocks();
    relayout();
    syncTools();
    applyView();
    // 页面刚渲染出来时上方的卡片高度还会变一次，多贴合几次
    requestAnimationFrame(() => resize());
    setTimeout(() => { if (stage.isConnected) resize(); }, 260);
    setTimeout(() => { if (stage.isConnected) resize(); }, 800);

    const onTheme = () => { if (!stage.isConnected) { document.removeEventListener('tk-theme', onTheme); return; } syncTools(); paint(); renderTexts(); };
    document.addEventListener('tk-theme', onTheme);
    const ro = new ResizeObserver(() => { if (stage.isConnected) resize(); else cleanup(); });
    ro.observe(stage);
    // 上面那块「还没搞懂的」展开/收起、窗口缩放，画布都跟着重新贴合
    let fitT = null;
    const refit = () => {
      if (!stage.isConnected) { cleanup(); return; }
      clearTimeout(fitT); fitT = setTimeout(() => { if (stage.isConnected) resize(); }, 120);
    };
    window.addEventListener('resize', refit);
    const bodyRo = new ResizeObserver(refit); bodyRo.observe(document.body);
    // 离开这页就把监听全撤掉（以前每打开一次笔记就多挂一组，越用越卡）
    function cleanup() {
      if (cleaned) return; cleaned = true;
      ro.disconnect(); bodyRo.disconnect(); window.removeEventListener('resize', refit);
      document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onUp);
      if (pending) { clearTimeout(save); pending = false; DB.put('notes', note).catch(() => {}); }
    }
    // 磁盘里的手写有变化（别的设备同步过来）
    return { gotoPage: p => current && current.gotoPage(p) };
  }

  return { mount, pageImage: inkImage, inkImage, inkBox, shoot, hasInk, drawStroke, INK, world, sections, layout, blockOf, appendMd, get current() { return current; } };
})();

/* ======================================================================
   重点 / 测验
   ====================================================================== */
const Study = (() => {
  async function sourcesExcerpt(note, max = 30000) {
    const files = (await Promise.all((note.sourceFileIds || []).map(id => DB.get('files', id)))).filter(Boolean);
    let out = '', per = Math.floor(max / Math.max(1, files.length));
    for (const f of files) out += `\n# ${f.name}\n${(f.text || '').slice(0, per)}`;
    return out.trim();
  }
  const PART_NAME = { points: '重点', quiz: '测验题' };
  // 把新生成的几样合并进笔记，没重新生成的保留原样
  function merge(note, pack) {
    note.study = Object.assign({ points: [], quiz: [] }, note.study || {});
    if (pack.points) { note.study.points = pack.points; note.mastered = {}; }
    if (pack.quiz) { note.study.quiz = pack.quiz; note.quizLog = null; }
    note.study.at = pack.at;
  }
  const doneMsg = pack => '生成了 ' + [pack.points && `${pack.points.length} 个重点`, pack.quiz && `${pack.quiz.length} 道题`].filter(Boolean).join('、');
  async function run(note, parts, job) {
    let first = true;
    const label = parts.map(k => PART_NAME[k]).join('、');
    const pack = await AI.studyPack({ title: note.title, parts, points: (note.study && note.study.points) || [], markdown: (note.markdown || '').slice(0, 80000), sources: await sourcesExcerpt(note, note.markdown ? 20000 : 60000), onText: t => { if (first) { first = false; job.phase('正在出' + label, .08, .97, { expectLen: parts.length * 2500 }); } job.len(t.length).sub(`已写 ${t.length} 字`); } });
    if (pack.points && !pack.points.length) throw new Error('没有生成出知识点，再试一次');
    return pack;
  }
  async function generate(note, el, after, parts = ['points', 'quiz']) {
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
    const missing = ['points', 'quiz'].filter(k => !(st[k] || []).length);
    el.innerHTML = `<div class="empty"><strong>还没有${PART_NAME[part]}</strong>只生成${PART_NAME[part]}，用${note.markdown ? '笔记和课件' : '选中的课件'}来出。
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
      $$('.opt', el).forEach(b => b.onclick = () => {
        picked = Number(b.dataset.k);
        const qi = set[i];
        if (picked === q.answer) {
          score++;
          const rec = (note.wrong || []).find(x => x.qi === qi);
          if (rec) { rec.ok = (rec.ok || 0) + 1; if (rec.ok >= 2) note.wrong = note.wrong.filter(x => x !== rec); DB.put('notes', note); }
        } else { wrong.push(qi); Learn.wrongAdd(note, qi); DB.put('notes', note); }
        paint();
      });
      const n = $('#qz-next', el); if (n) n.onclick = () => { i++; picked = null; paint(); };
      const g = $('#qz-pt', el); if (g) g.onclick = () => gotoPoint && gotoPoint(q.point);
    };
    paint();
  }
  /* 笔记生成完自动出重点/卡片/测验（后台跑，不挡界面） */
  async function background(noteId, parts = ['points', 'quiz']) {
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
    if (h.startsWith('note-' + noteId)) { const tab = h.split('~')[1] || 'note'; if (done && tab !== 'note') renderNote(noteId, tab); else DB.get('notes', noteId).then(n => { const t = $('#n-tabs'); if (t && n) { t.innerHTML = noteTabsHTML(tab, n); $$('[data-ntab]', t).forEach(b => b.onclick = () => noteTabGo(noteId, b.dataset.ntab)); } }); }
  }
  const progress = note => { const pts = (note.study && note.study.points) || []; return { done: pts.filter(p => (note.mastered || {})[p.id]).length, total: pts.length }; };
  return { points, quiz, progress, generate, background };
})();

/* ======================================================================
   笔记里的两个平行标签：课件（一页一页对应）· 词汇（术语 + 音标）
   ====================================================================== */
async function docTab(note, course, el) {
  const files = (await Promise.all((note.sourceFileIds || []).map(id => DB.get('files', id)))).filter(Boolean);
  const f = files.find(x => x.pages) || files[0];
  if (!f) { el.innerHTML = '<div class="empty"><strong>这份笔记还没关联课件</strong>生成笔记时选了课件，这里就会一页一页给出要点。</div>'; return; }
  const pages = splitPages(f.text);
  const total = Math.max(f.pages || 0, ...pages.map(x => x.n), 1);
  let kp = new Map(((f.keypoints) || []).map(x => [x.n, x]));
  const pdf = isPdf(f);

  const rowsHTML = () => {
    const list = Array.from({ length: total }, (_, i) => i + 1);
    return list.map(n => {
      const k = kp.get(n);
      const page = pages.find(x => x.n === n);
      const firstLine = (page && page.text || '').split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
      const has = new RegExp(`\\[p\\.?\\s*${n}(?:\\b|\\])`).test(note.markdown || '');
      return `<div class="kp-page" data-p="${n}">
        <div class="kp-head">
          <span class="dm-p">P${n}</span>
          <b class="grow">${esc(k && k.title ? k.title : (firstLine ? firstLine.slice(0, 24) + (firstLine.length > 24 ? '…' : '') : '第 ' + n + ' 页'))}</b>
          <button class="btn small ghost" data-open="${n}" ${pdf || page ? '' : 'disabled'}>看课件</button>
          <button class="btn small ${k ? 'primary' : ''}" data-send="${n}" ${k ? '' : 'disabled'}>${has ? '已写进笔记' : '写进笔记'}</button>
        </div>
        ${k && k.points.length
          ? `<ul class="kp-points">${k.points.map(x => `<li class="${x.strong ? 'strong' : ''}">${esc(x.t)}</li>`).join('')}</ul>`
          : `<div class="hint kp-empty">${k ? '这一页没有可提炼的文字（可能是纯图）。' : '还没提取这一页的要点。'}</div>`}
      </div>`;
    }).join('');
  };

  el.innerHTML = `<div class="kp-wrap">
    <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:12px">
      <div class="grow"><b>${esc(f.name)}</b><div class="hint">${total} 页 · 每页几句中文要点，重点加粗；想边看课件边写就进「上课工作台」</div></div>
      <button class="btn small" id="dp-ai">${kp.size ? '重新提取' : ICON.spark + '提取每页要点'}</button>
    </div>
    <div class="kp-list" id="kp-list">${rowsHTML()}</div>
  </div>`;

  const bind = () => {
    $$('[data-open]', el).forEach(b => b.onclick = () => {
      const p = Number(b.dataset.open);
      openDocModal(f.id);
      let n = 0; const jump = () => {
        const t = document.querySelector(`#dv-host .pdfpage[data-p="${p}"], #dv-host .docpage[data-p="${p}"]`);
        if (t) { t.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
        if (n++ < 20) setTimeout(jump, 200);
      };
      setTimeout(jump, 300);
    });
    $$('[data-send]', el).forEach(b => b.onclick = () => writePage(Number(b.dataset.send)));
  };

  async function writePage(p) {
    const k = kp.get(p); if (!k) return;
    const block = `### 第 ${p} 页要点\n${k.points.map(x => `- ${x.t} [p.${p}]`).join('\n')}\n`;
    let md = String(note.markdown || '');
    const re = new RegExp(`###\\s*第\\s*${p}\\s*页要点\\n(?:[-*].*\\n)*`, 'g');
    md = md.replace(re, '').replace(/\n{3,}/g, '\n\n').trimEnd();
    note.markdown = md ? md + '\n\n' + block : block;
    note.board = note.board || { pages: [{ bg: null, h: 1414, strokes: [] }] };
    if (note.board.layout === 'doc') note.board.dirty = 1;
    await DB.put('notes', note);
    toast(`第 ${p} 页的要点写进笔记了`);
    $('#kp-list', el).innerHTML = rowsHTML(); bind();
  }

  bind();

  const ai = $('#dp-ai', el);
  ai.onclick = async () => {
    if (!Settings.load().deepseekKey) { toast('先去设置里填 DeepSeek key'); return; }
    ai.disabled = true; ai.textContent = '正在提取…';
    const job = Jobs.start('kp:' + f.id, '提取每页要点：' + f.name);
    try {
      const list = await AI.pagePoints({ name: f.name, pages: pages.map(x => ({ n: x.n, text: x.text })), onText: t => job.len(t.length) });
      job.done();
      const fresh = await DB.get('files', f.id);
      fresh.keypoints = list; await DB.put('files', fresh);
      kp = new Map(list.map(x => [x.n, x]));
      toast(`把 ${list.length} 页的要点都提出来了`);
      $('#kp-list', el).innerHTML = rowsHTML(); bind();
    } catch (e) { job.done(); toast(e.message, 6000); }
    ai.disabled = false; ai.textContent = '重新提取';
  };

  // 第一次进来还没提取过：直接开始（省一次点击）
  if (!kp.size && Settings.load().deepseekKey) setTimeout(() => { if (ai.isConnected) ai.click(); }, 400);
}

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
    el.innerHTML = `<div class="mm-tools noprint"><button class="btn small" data-z="-">−</button><button class="btn small" data-z="0">适应宽度</button><button class="btn small" data-z="+">＋</button><button class="btn small ghost" id="mm-all">全部展开</button><span class="hint">按住拖动可以平移 · 滚轮放大缩小 · 点圆点收起 / 展开</span></div><div class="mm-wrap" id="mm-wrap"><svg class="mm"></svg></div>`;
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
      $$('.mm-n', svg).forEach(g => g.onclick = () => {
        if (suppressClick) return; // 刚才是在拖地图，不是点节点
        const id = g.dataset.id; if (id === 'r') return;
        collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); draw();
      });
    }
    $$('[data-z]', el).forEach(b => b.onclick = () => {
      const z = b.dataset.z;
      if (z === '0') { const vb = svg.viewBox.baseVal; zoom = Math.min(1.4, (wrap.clientWidth - 10) / vb.width); }
      else zoom = Math.max(.3, Math.min(2.5, zoom * (z === '+' ? 1.2 : 1 / 1.2)));
      draw();
    });
    $('#mm-all', el).onclick = () => { collapsed.clear(); draw(); };
    draw();

    /* ---------- 拖动平移 / 滚轮缩放（只在地图上生效，滚轮不拦页面其它地方） ---------- */
    let drag = null, suppressClick = false;
    const beginDrag = e => {
      if (e.pointerType === 'touch') return; // 触屏留给页面滚动
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop, moved: false };
      wrap.classList.add('panning');
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
    };
    const moveDrag = e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      wrap.scrollLeft = drag.sl - dx;
      wrap.scrollTop = drag.st - dy;
    };
    const endDrag = () => {
      if (!drag) return;
      suppressClick = drag.moved;
      if (drag.moved) setTimeout(() => { suppressClick = false; }, 60);
      drag = null; wrap.classList.remove('panning');
    };
    wrap.addEventListener('pointerdown', beginDrag);
    wrap.addEventListener('pointermove', moveDrag);
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);
    wrap.addEventListener('pointerleave', endDrag);

    function zoomAt(k, cx, cy) {
      const next = Math.max(.25, Math.min(3, zoom * k));
      if (next === zoom) return;
      const r = wrap.getBoundingClientRect();
      const ox = cx - r.left + wrap.scrollLeft, oy = cy - r.top + wrap.scrollTop;
      const ratio = next / zoom;
      zoom = next;
      draw();
      // 让鼠标下面那个点留在原地，缩放时地图不会「跳走」
      wrap.scrollLeft = ox * ratio - (cx - r.left);
      wrap.scrollTop = oy * ratio - (cy - r.top);
    }
    wrap.addEventListener('wheel', e => {
      if (e.ctrlKey && Math.abs(e.deltaY) < 2) return; // 触控板捏合交给浏览器
      e.preventDefault();
      const step = e.deltaMode === 1 ? 0.16 : 0.0012; // 滚轮按「行」给的时候也不同
      zoomAt(Math.exp(-e.deltaY * step), e.clientX, e.clientY);
    }, { passive: false });
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
  get() { try { return Object.assign({ win: 0, mode: 'fast', src: 'all' }, JSON.parse(localStorage.getItem('tingkeben.chatopt') || '{}')); } catch (e) { return { win: 0, mode: 'fast', src: 'all' }; } },
  set(p) { try { localStorage.setItem('tingkeben.chatopt', JSON.stringify(Object.assign(this.get(), p))); } catch (e) {} },
};
const Chat = (() => {
  let quote = ''; // 选中的文字
  // 引用：选中文字后点浮出来的「问 AI」（SelPop）


  function segText(segs) { return segs.map(g => `[${fmtTime(g.t)}] ${g.en}${g.zh ? '\n　' + g.zh : ''}`).join('\n'); }

  async function buildContext({ note, course, fileIds, session, sessions, pageHint }) {
    const parts = [];
    if (note && note.markdown) parts.push(`## 笔记：${note.title}\n${note.markdown.slice(0, 50000)}`);
    const ids = [...new Set([...(fileIds || []), ...((note && note.sourceFileIds) || [])])];
    const files = (await Promise.all(ids.map(id => DB.get('files', id)))).filter(f => f && f.text);
    let budget = note && note.markdown ? 50000 : 120000;
    for (const f of files) { const t = f.text.slice(0, Math.max(4000, Math.floor(budget / files.length))); parts.push(`## 课件：${f.name}\n${t}`); }
    if (pageHint) parts.push(`## 学生正在看的课件页：${pageHint.name} 第${pageHint.page}页\n${pageHint.text || ''}`);
    // 一份笔记可以录好几段（每节课一段）：按时间顺序全部带上，总长超了就从最早那段开始省略，最近那段保证完整
    const list = (sessions && sessions.length ? sessions : session ? [session] : []).filter(x => x && (x.segments || []).length);
    if (list.length) {
      let budget = 40000;
      const blocks = [];
      for (let i = list.length - 1; i >= 0 && budget > 0; i--) {
        let t = segText(list[i].segments);
        if (t.length > budget) t = '……（前面省略）\n' + t.slice(-budget);
        budget -= t.length;
        blocks.unshift(`### 第 ${i + 1} 段${list.length > 1 && i === list.length - 1 ? '（最近一段）' : ''}${list[i].title ? '：' + list[i].title : ''}\n${t}`);
      }
      parts.push(`## 课堂录音转写（共 ${list.length} 段${blocks.length < list.length ? '，最早的几段太长省略了' : ''}）\n${blocks.join('\n\n')}`);
    }
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
          <div class="chat-opt"><span>资料</span><div class="seg" id="chat-src" role="radiogroup" aria-label="要不要读材料"><button data-s2="all" title="读这门课的笔记、课件和录音再回答">📚 读资料</button><button data-s2="none" title="什么都不读，直接聊天（更快、不占上下文）">💬 直接聊</button></div></div>
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
      $$('#chat-src [data-s2]', host).forEach(b => b.classList.toggle('on', b.dataset.s2 === opt.src));
      const winWrap = $('#chat-win', host);
      if (winWrap) winWrap.closest('.chat-opt').style.opacity = opt.src === 'none' ? '.45' : '';
    };
    $$('#chat-win [data-w]', host).forEach(b => b.onclick = () => { opt.win = Number(b.dataset.w); ChatOpt.set({ win: opt.win }); syncOpts(); });
    $$('#chat-mode [data-m]', host).forEach(b => b.onclick = () => { opt.mode = b.dataset.m; ChatOpt.set({ mode: opt.mode }); syncOpts(); });
    $$('#chat-src [data-s2]', host).forEach(b => b.onclick = () => { opt.src = b.dataset.s2; ChatOpt.set({ src: opt.src }); syncOpts(); });
    syncOpts();

    async function send(text, { scope, label, win } = {}) {
      if (busy) return;
      if (!Settings.load().deepseekKey) { toast('先去设置里填 DeepSeek key'); return; }
      const w = win != null ? win : opt.win; // 秒；0 = 全部材料
      scope = scope || (w ? 'recent' : 'all');
      const live = getLive && getLive();
      // 这份笔记的所有录音段：「老师讲的 N 秒/分钟」只看正在录的、或者最近那一段；「全部」把每一段都带上
      const sids = note ? [...new Set([].concat(note.sessionIds || [], note.sessionId || []).filter(Boolean))] : [];
      const saved = (await Promise.all(sids.map(id => DB.get('sessions', id)))).filter(Boolean).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
      const liveId = live && live.record ? live.record.id : null;
      const liveSeg = live ? { id: liveId, segments: live.segments, title: '正在录的这节课' } : null;
      const session = liveSeg || saved.find(x => x.id === (note && note.sessionId)) || saved[saved.length - 1] || null;
      const allSessions = liveSeg ? saved.filter(x => x.id !== liveId).concat(liveSeg) : saved;
      let context, noteLine = '';
      const pure = opt.src === 'none' && scope !== 'recent';
      if (pure) {
        context = '';
        noteLine = '直接聊 · 没读资料';
      } else if (scope === 'recent') {
        const secs = w || 60;
        const human = secs < 60 ? secs + ' 秒' : Math.round(secs / 60) + ' 分钟';
        const segs = (session ? session.segments : []);
        const end = live ? live.elapsed() : (segs.length ? segs[segs.length - 1].t + 10 : 0);
        const recent = segs.filter(g => g.t >= end - secs);
        const interim = live && live.turn ? `\n[正在说] ${live.turn.text || ''}` : '';
        if (!recent.length && !interim.trim()) { toast(live ? `最近 ${human}还没有转写内容` : '现在没有在听课本里录音，用不了「老师讲的」时间范围。选「全部」就会看笔记和课件来回答。', 6000); return; }
        context = `## 老师最近 ${human}说的话（语音识别，可能有错字）\n${segText(recent)}${interim}` + (note && note.markdown ? `\n\n## 这节课的笔记（参考）\n${note.markdown.slice(0, 12000)}` : '');
        noteLine = `用了老师最近 ${human}讲的（${recent.length} 句${live ? '，正在录的这段' : allSessions.length > 1 ? '，最近一段录音' : ''}）`;
      } else {
        context = await buildContext({ note, course, fileIds: getFileIds && getFileIds(), session, sessions: allSessions, pageHint: getPage && await getPage() });
        noteLine = '读了笔记和课件' + (allSessions.length ? `，${allSessions.length} 段录音` : '');
        if (getExtra) context += '\n\n' + await getExtra();
      }
      const q = quote ? `关于这段：「${quote}」\n${text}` : text;
      quote = ''; qbox.hidden = true;
      store.chat.push({ role: 'user', content: label || q, t: Date.now() });
      busy = { text: '', ctl: new AbortController() }; paint();
      const history = store.chat.slice(-9, -1).filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({ role: m.role, content: m.content }));
      try {
        const ans = await AI.deepseekStream({
          system: AI.chatSystem({ courseName: course && course.name, context, free: pure }) + (opt.mode === 'deep' ? '\n\n【详细思考模式】把道理讲透：先给结论，再分步骤解释，必要时举例、指出容易混淆的地方。' : '\n\n【快速模式】回答要短：先一句话给结论，最多再补 3 个要点，不要铺垫。'),
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
    // 无限画布：按「板块」取图，每块单独认
    const pages = Board.sections(note).filter(x => (x.strokes || []).length).map((x, i) => ({ p: x, n: i + 1 }));
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
    // 同一份笔记可能录了好几节课，全部一起整理，后录的不会顶掉前面的
    const sessions = (await noteSessions(note)).filter(s => (s.segments || []).length);
    if (!sessions.length) throw new Error('这份笔记还没有关联课堂录音');
    if (!Settings.load().deepseekKey) throw new Error('先去设置里填 DeepSeek key');
    const job = Jobs.start('recap:' + note.id, '整理这节课：' + note.title);
    try { return await runInner(note, course, sessions, job, onStatus); } finally { job.done(); }
  }
  async function runInner(note, course, sessions, job, onStatus) {
    const inkPages = Board.sections(note).filter(x => (x.strokes || []).length).length;
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
    const marks = sessions.flatMap(x => (x.highlights || []).map(h => `[${x.title} ${fmtTime(h.t)}] ${h.near || ''}`));
    const cfs = sessions.flatMap(x => (x.confused || []).map(c => `[${x.title} ${fmtTime(c.t)}] ${c.near || ''}`));
    // 多段录音按时间顺序拼起来，每段前面标个标题，AI 才知道是同一门课的第几次
    const transcript = sessions.map((x, i) => (sessions.length > 1 ? `### 第 ${i + 1} 段 · ${x.title}（${fmtDate(x.startedAt)}）\n` : '') + sessionTranscript(x)).join('\n\n');
    const user = `课程：${course ? course.name : ''}\n笔记标题：${note.title}\n\n<课件笔记>\n${body.slice(0, 60000)}\n</课件笔记>\n\n<学生标记的重点时间>\n${marks.join('\n') || '（没有）'}\n</学生标记的重点时间>\n\n<学生没听懂的地方（请在「课堂上老师提到的」里加一个小节「我没听懂的地方」，用中文讲清楚）>\n${cfs.join('\n') || '（没有）'}\n</学生没听懂的地方>\n\n<学生手写>\n${hw || '（没有手写）'}\n</学生手写>\n\n<录音转写${sessions.length > 1 ? '（这门课录了 ' + sessions.length + ' 段）' : ''}>\n${transcript.slice(0, 180000)}\n</录音转写>`;
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
    const inkPages = Board.sections(note).filter(x => (x.strokes || []).length).length;
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

/* 课件逐页解析（上课工作台「对照」）：一段段生成，生成一段就存一段，中途关掉下次接着来 */
const DocEx = (() => {
  const running = new Map();
  async function explain(f, course, onProgress) {
    if (running.has(f.id)) return running.get(f.id);
    const job = Jobs.start('ex:' + f.id, '解析课件：' + f.name);
    const p = (async () => {
      const pages = splitPages(f.text);
      const have = trByPage(f.explain || '');
      const todo = pages.filter(pg => !have[pg.n]);
      const chunks = []; let cur = '';
      for (const pg of todo) { const block = `[第${pg.n}页]\n${pg.text}\n\n`; if (cur && cur.length + block.length > 6000) { chunks.push(cur); cur = ''; } cur += block; }
      if (cur) chunks.push(cur);
      let done = String(f.explain || '').trim();
      for (let i = 0; i < chunks.length; i++) {
        job.phase(`正在解析 第 ${i + 1} / ${chunks.length} 段`, i / chunks.length, (i + 1) / chunks.length, { expectLen: chunks[i].length * .9 });
        const piece = await AI.deepseekStream({ system: AI.DOC_EX_SYSTEM, user: AI.docExplainPrompt(chunks[i], course && course.name), thinking: false, maxTokens: 8000, purpose: 'docex',
          onText: t => { job.len(t.length); onProgress && onProgress((done ? done + '\n\n' : '') + t); } });
        done = (done ? done + '\n\n' : '') + piece.trim();
        const full = await DB.get('files', f.id) || f; full.explain = done; await DB.put('files', full); f.explain = done;
      }
      const full = await DB.get('files', f.id) || f; full.explain = done; full.explainDone = true; await DB.put('files', full);
      f.explain = done; f.explainDone = true;
      return done;
    })().finally(() => job.done());
    running.set(f.id, p);
    try { return await p; } finally { running.delete(f.id); }
  }
  const estimate = f => { const chars = (f.text || '').length; return Math.max(0.01, (chars / 3.5 * 2 + chars * 1.2 * 8) / 1e6); };
  return { explain, estimate, running };
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
  // 画上去之后把页码徽标补回来（清空 innerHTML 会把它一起删掉）
  const badge = document.createElement('span');
  badge.className = 'pnum'; badge.textContent = 'P' + pageNum;
  el.appendChild(badge);
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
      body.innerHTML = `<div class="empty"><strong>还没翻译</strong>整份课件逐页翻成中文，术语保留英文。翻好之后「中文」和「对照」都能看。<div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="dv-tr">翻译整份课件</button></div></div>`;
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
    // 每页右下角标一个页码，和笔记里的 [p.N] 对得上
    const pageBox = p => pdf
      ? `<div class="pdfpage" data-p="${p}"><div class="ph">第 ${p} 页</div><span class="pnum">P${p}</span></div>`
      : `<div class="docpage" data-p="${p}"><div class="hint">第 ${p} 页</div><div class="doc-text">${esc((textPages.find(x => x.n === p) || {}).text || '')}</div><span class="pnum">P${p}</span></div>`;
    if (mode === 'pair') {
      // 对照：一页课件 → 这一页的中文解析 → 下一页课件 …（竖着往下滑，不再左右分栏）
      const ex = trByPage(f.explain), busy = DocEx.running.has(f.id);
      const exHas = Object.keys(ex).length;
      const head = busy ? Jobs.slot('ex:' + f.id)
        : !String(f.text || '').trim() ? `<div class="banner"><div class="grow">这份课件读不出文字（可能是扫描件），先在课程页用 Gemini 识别文字，才能逐页解析。</div></div>`
        : !f.explainDone ? `<div class="banner"><div class="grow">${exHas ? `已经解析了 ${exHas} 页，还有没解析完的。` : '每页课件下面会跟一段中文讲解，像老师边翻 PPT 边讲。'}<span class="hint"> 约 ¥${(DocEx.estimate(f) * 7.2).toFixed(2)}（不确定）</span></div><button class="btn small primary" id="dv-ex">${exHas ? '接着解析' : '逐页解析这份课件'}</button></div>` : '';
      body.innerHTML = head + Array.from({ length: n }, (_, i) => i + 1).map(p => `<div class="pair pair-v" data-p="${p}">${pageBox(p)}<div class="pair-ex">${ex[p] ? `<div class="pair-ex-h">第 ${p} 页 · 解析</div><div class="md">${md(ex[p])}</div>` : busy ? '<div class="hint">解析中…</div>' : f.explainDone ? '<div class="hint">（这页没有内容）</div>' : ''}${refs[p] ? `<details class="pair-note"><summary class="hint">笔记里讲到这一页（${refs[p].length}）</summary>${refs[p].map(t => `<div class="md">${md(t)}</div>`).join('')}</details>` : ''}</div></div>`).join('');
      const eb = $('#dv-ex', body); if (eb) eb.onclick = () => runEx();
      if (busy) DocEx.running.get(f.id).then(() => { if (host.isConnected && mode === 'pair') paint(); }, () => { if (host.isConnected && mode === 'pair') paint(); });
    } else body.innerHTML = Array.from({ length: n }, (_, i) => i + 1).map(pageBox).join('') || '<div class="empty">没有文字</div>';
    if (pdf) {
      const io = new IntersectionObserver(ents => ents.forEach(async en => {
        if (!en.isIntersecting) return; const el = en.target; io.unobserve(el);
        try { await renderPdfPageInto(el, f.id, Number(el.dataset.p)); if (ink && el.isConnected) ink.attach(el, Number(el.dataset.p)); } catch (e) { el.innerHTML = `<div class="ph">第 ${el.dataset.p} 页加载失败</div>`; }
      }), { root: body, rootMargin: '800px' });
      $$('.pdfpage', body).forEach(el => io.observe(el));
    }
    const sel = mode === 'pair' ? '.pair' : pdf ? '.pdfpage' : '.docpage';
    const cur = new IntersectionObserver(ents => ents.forEach(en => { if (en.isIntersecting && en.intersectionRatio > .3) { const p = Number(en.target.dataset.p); host.dataset.page = p; const pg = $('#dv-page', host); if (pg) pg.textContent = `${p}/${n}`; onPage && onPage(p); } }), { root: body, threshold: [.3] });
    $$(sel, body).forEach(el => cur.observe(el));
    host.dataset.page = 1; $('#dv-page', host).textContent = `1/${n}`;
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
  const runEx = async () => {
    if (!Settings.load().deepseekKey) { toast('先去设置里填 DeepSeek key'); return; }
    const pr = DocEx.explain(f, course);
    paint();
    try { await pr; toast('解析完成：' + f.name); } catch (e) { toast(e.message, 6000); }
    if (host.isConnected && mode === 'pair') paint();
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
      el.innerHTML = `<div class="empty"><strong>还没有课前包</strong>上课前 5 分钟看一眼：这节讲什么、3 个关键概念、可能听不懂的地方，再加一份中英术语表（带例句和发音）。<div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="pp-go">${ICON.spark}生成课前包</button></div></div>`;
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
    const hard = f.hard;
    el.innerHTML = `
      <div class="prep">
        ${hard && hard.pages.length ? `<div class="prep-card hard-card">
          <div class="prep-k">先啃这几页 · 最难的 ${hard.pages.length} 页</div>
          <div class="hard-list">${hard.pages.map(p => `<div class="hard-item"><span class="hard-p">P${p.page}</span><div class="grow">${esc(p.why)}</div></div>`).join('')}</div>
          ${hard.overall ? `<div class="hint" style="margin-top:8px">${esc(hard.overall)}</div>` : ''}
        </div>` : `<div class="row" style="justify-content:flex-end"><button class="btn small ghost" id="pp-diff">${ICON.spark}标出最难读的 3 页</button></div>`}
        <div class="prep-card">
          <div class="prep-k">5 分钟预习</div>
          <p class="prep-sum">${esc(v.summary)}</p>
          <div class="prep-k">3 个关键概念</div>
          <ol class="prep-c">${v.concepts.map(c => `<li><b>${esc(c.term)}</b><span>${esc(c.why)}</span></li>`).join('')}</ol>
          ${v.hard.length ? `<div class="prep-k">上课可能听不懂的地方</div><ul class="prep-h">${v.hard.map(h => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
          ${v.listen.length ? `<div class="prep-k">注意听老师说这些</div><div class="prep-l">${v.listen.map(t => `<button class="chip" data-say="${esc(t)}">🔊 ${esc(t)}</button>`).join('')}</div>` : ''}
        </div>
        <div class="row" style="justify-content:space-between;margin:14px 0 6px"><b>术语表 · ${pk.terms.length} 个</b><a class="hint" href="#vocab~${f.courseId}" title="整理出来的术语先筛一遍：不会的才进生词本">去筛词 ›</a></div>
        <div class="row" style="justify-content:flex-end;margin:-6px 0 6px"><div class="row" style="gap:4px"><button class="btn small ghost" id="pp-copy">复制</button><button class="btn small ghost" id="pp-re">重新生成</button></div></div>
        <div class="terms">${pk.terms.map(t => `<div class="term"><div class="term-h"><button class="say" data-say="${esc(t.en)}" aria-label="朗读">🔊</button><b>${esc(t.en)}</b><span class="term-zh">${esc(t.zh)}</span></div>${t.explain ? `<div class="term-x">${esc(t.explain)}</div>` : ''}${t.example ? `<div class="term-e"><button class="say small" data-say="${esc(t.example)}" aria-label="朗读例句">🔊</button><span>${esc(t.example)}</span></div><div class="term-ez">${esc(t.example_zh)}</div>` : ''}</div>`).join('')}</div>
      </div>`;
    $$('[data-say]', el).forEach(b => b.onclick = () => speak(b.dataset.say));
    const pd = $('#pp-diff', el);
    if (pd) pd.onclick = async () => { pd.disabled = true; pd.textContent = '正在读…'; try { await Learn.diffFile(f, course && course.name); mount(el, f, course); } catch (e) { toast(e.message, 6000); pd.disabled = false; pd.textContent = '标出最难读的 3 页'; } };
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
    pop.innerHTML = `<div class="row" style="gap:2px"><button data-a="copy">复制</button><button data-a="tr">翻译</button><button data-a="ask">问 AI</button><button data-a="vocab">＋生词本</button><button data-a="say">🔊</button></div><div class="selpop-out" hidden></div>`;
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
    if (a === 'vocab') { addToVocab(text, out); return; }
    if (a === 'tr') {
      out.hidden = false; out.innerHTML = '<span class="spin"></span>';
      try {
        const zh = await quickTranslate(text);
        out.innerHTML = `<div>${esc(zh)}</div>`;
      } catch (e) { out.textContent = '翻译失败：' + e.message; }
    }
  }
  /* 选中的词 / 短语 → 生词本。课程按你现在所在的页面判断（课程页、笔记、工作台、复习都行） */
  async function courseHere() {
    const h = location.hash.slice(1);
    if (h.startsWith('course-')) return h.slice(7).split('~')[0];
    if (h.startsWith('vocab~')) return h.split('~')[1];
    const m = h.match(/^(?:note|desk|review)-([^~]+)/);
    if (m) { const n = await DB.get('notes', m[1]); return n && n.courseId; }
    return null;
  }
  async function addToVocab(t, out) {
    const en = String(t || '').replace(/\s+/g, ' ').trim().replace(/^[^A-Za-z]+|[^A-Za-z)]+$/g, '');
    if (!en || en.length > 60 || en.split(' ').length > 6) { toast('选一个词或者短语（6 个词以内）再加'); return; }
    if (!/[A-Za-z]/.test(en)) { toast('生词本只收英文词'); return; }
    const cid = await courseHere();
    if (!cid) { toast('先进入一门课的笔记或课件页面，再加生词'); return; }
    out.hidden = false; out.innerHTML = '<span class="spin"></span> 正在查意思…';
    let w = { en, from: '自己加的' };
    try {
      if (Settings.load().deepseekKey) {
        const ctx = (() => { try { const r = window.getSelection().getRangeAt(0); return (r.startContainer.parentElement || {}).textContent || ''; } catch (e) { return ''; } })().slice(0, 400);
        const raw = await AI.deepseekStream({ thinking: false, json: true, maxTokens: 400, purpose: 'chat',
          system: '你是英汉词典，给英语不好的中国商科留学生解释单词。只输出 JSON。',
          user: `词：${en}\n上下文：${ctx}\n输出 JSON：{"zh":"简短中文意思（按上下文）","explain":"一句中文解释","example":"一个简单英文例句","example_zh":"例句中文"}` });
        const j = AI.parseJSON(raw);
        w = Object.assign(w, { zh: String(j.zh || ''), explain: String(j.explain || ''), example: String(j.example || ''), example_zh: String(j.example_zh || '') });
      } else w.zh = await quickTranslate(en).catch(() => '');
    } catch (e) { try { w.zh = await quickTranslate(en); } catch (x) {} }
    await Learn.addWord(cid, w);
    out.innerHTML = `<div><b>${esc(en)}</b> ${esc(w.zh || '')}</div><div class="hint">已加入生词本</div>`;
    toast('已加入生词本：' + en, 1600);
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
  /* 选区 → 屏幕坐标。
     一行和好几行的差别很大：getBoundingClientRect() 给的是「整块的外框」，
     多行选区时会顶到第一行的顶上，工具栏飞到很远的地方或者盖住第一行。
     所以这里按每一行的 clientRect 来算：
       · 上面放得下就浮在第一行上方；
       · 放不下（贴着屏幕顶、或者多行已经占满）就落到最后一行的下面。 */
  let range = null;
  function rects() {
    try { return [...range.getClientRects()].filter(r => (r.width || r.height) && r.bottom > -2000); } catch (e) { return []; }
  }
  function place() {
    if (!pop || pop.hidden || !range) return;
    const rs = rects(); if (!rs.length) return hide();
    const first = rs[0], last = rs[rs.length - 1];
    const top = Math.min(...rs.map(r => r.top)), bottom = Math.max(...rs.map(r => r.bottom));
    if (bottom < 0 || top > window.innerHeight) return hide(); // 整段已经滚出屏幕
    const w = pop.offsetWidth || 220, h = pop.offsetHeight || 40;
    // 横向跟第一行（或最后一行）的中点对齐，别用整块的宽度
    const anchor = top - h - 10 >= 8 ? first : last;
    const cx = anchor.left + Math.min(anchor.width, 260) / 2;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, cx - w / 2));
    let y = top - h - 10;
    if (y < 8) y = bottom + 10;                       // 上面放不下就放下面
    if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(y) + 'px';
  }
  function show() {
    const s = window.getSelection(); if (!s || s.isCollapsed) return hide();
    const t = String(s).trim(); if (t.length < 1 || t.length > 3000) return hide();
    const node = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
    if (!node || !node.closest('.doc-body, .md, .captions')) return hide();
    if (node.closest('textarea, input, .chat-in')) return hide();
    text = t; ensure();
    range = s.getRangeAt(0).cloneRange();
    $('.selpop-out', pop).hidden = true;
    pop.hidden = false;
    place();
    // 工具栏尺寸要等它显示出来才知道（第一次可能是 0）
    if (!pop.offsetWidth) requestAnimationFrame(place);
  }
  function hide() { range = null; if (pop) pop.hidden = true; }
  document.addEventListener('selectionchange', () => { clearTimeout(hideT); hideT = setTimeout(() => { const s = window.getSelection(); if (!s || s.isCollapsed) hide(); }, 200); });
  ['mouseup', 'touchend', 'keyup'].forEach(ev => document.addEventListener(ev, e => { if (pop && pop.contains(e.target)) return; setTimeout(show, 30); }));
  /* 滚动时跟着选区走：原来的做法是一滚就把它收掉，多行段落滚一点就点不到了。
     现在重新量一次位置；只有整段滚出屏幕才收起。 */
  let raf = 0;
  const follow = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; place(); });
  };
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);
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
      const doneIds = new Set(d.items.filter(x => x.done).map(x => x.id));
      d.items = [...manual, ...ev.map(e => ({ ...e, id: 'm' + e.id, done: doneIds.has('m' + e.id) }))]; d.at = Date.now(); save(d);
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
  defaults: () => Device.ipad ? { left: true, mid: true, right: false, rtab: 'chat', one: 'left', split: true, mtab: 'note', w: { left: 1, mid: 1, right: .8 }, rmin: false } : { left: true, mid: true, right: true, rtab: 'chat', one: 'mid', split: false, mtab: 'note', w: { left: 1, mid: 1.15, right: .85 }, rmin: false },
  // 只记在这次打开的内存里：退出听课本再打开，工作台回到默认的样子（不记上次停在哪）
  mem: null,
  get() { if (!this.mem) { this.mem = this.defaults(); try { localStorage.removeItem(this.key()); } catch (e) {} } return Object.assign(this.defaults(), this.mem); },
  set(p) { this.mem = Object.assign(this.get(), p); },
};

async function renderDesk(noteId) {
  if (location.hash.slice(1) !== 'desk-' + noteId) return; // 已经离开这页了
  const note = await DB.get('notes', noteId);
  if (!note) { Nav.replace('home'); return; }
  const course = await DB.get('courses', note.courseId);
  const files = sortFiles((await DB.byIndex('files', 'courseId', note.courseId)).filter(f => f.status === 'ready' || isPdf(f)));
  const notes = (await DB.byIndex('notes', 'courseId', note.courseId)).sort((a, b) => b.createdAt - a.createdAt);
  const P = DeskPref.get();
  let fileId = note.deskFile && files.some(f => f.id === note.deskFile) ? note.deskFile : (note.sourceFileIds || []).find(id => files.some(f => f.id === id)) || (files[0] && files[0].id);
  let midTab = 'note', viewer = null;
  view.innerHTML = `
    <div class="desk">
      <div class="desk-top noprint">
        ${Nav.crumb('note-' + note.id, '笔记', 'btn small ghost', '←')}
        <select id="dk-note" class="dk-sel" title="切换笔记">${notes.map(n => `<option value="${n.id}" ${n.id === note.id ? 'selected' : ''}>${esc(n.title)}</option>`).join('')}<option value="__new">＋ 新建空白笔记</option></select>
        <span class="grow"></span>
        <div class="seg dk-toggles" role="group" aria-label="显示哪几栏">
          <button data-col="left">课件</button><button data-col="mid">笔记</button><button data-col="right">翻译 / AI</button>
        </div>
        <button class="btn small" id="dk-split" hidden title="竖屏时上面看课件、下面写笔记">上下分屏</button>
      </div>
      <div class="desk-cols" id="dk-cols">
        <section class="dcol" data-col="left">
          <div class="dhead"><select id="dk-file" class="dk-sel">${files.length ? files.map(f => `<option value="${f.id}" ${f.id === fileId ? 'selected' : ''}>${esc(weekOf(f).label)}${phaseOf(f) ? '·' + phaseOf(f) : ''} · ${esc(f.name)}</option>`).join('') : '<option value="">这门课还没有课件</option>'}<option value="__add">＋ 上传 / 管理课件…</option></select></div>
          <div class="dbody" id="dk-doc"></div>
        </section>
        <div class="dk-divider" id="dk-divider" hidden role="separator" aria-label="拖动调整上下高度"><span></span></div>
        <section class="dcol" data-col="mid">
          <div class="dhead tabs" id="dk-mtabs">${noteTabsHTML('note', note)}</div>
          <div class="dbody" id="dk-mid"></div>
        </section>
        <section class="dcol" data-col="right">
          <div class="dhead tabs" id="dk-rtabs"><button data-r="chat">问 AI</button><button data-r="live">${Settings.load().liveEnglishOnly !== false ? '录音转写' : '实时翻译'}</button><span class="grow"></span><button class="dk-min" id="dk-rmin" title="收成一个圆按钮" aria-label="把 AI 栏收起来">—</button></div>
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
      await DB.put('notes', n); Nav.replace('desk-' + n.id);
    } else Nav.replace('desk-' + e.target.value);
  };

  // 左栏：课件
  const left = $('#dk-doc');
  let deskLock = () => {};
  const showDoc = async () => {
    const f = files.find(x => x.id === fileId);
    if (!f) { left.innerHTML = '<div class="empty">这门课还没有课件。先在课程页导入或从 Moodle 同步。</div>'; return; }
    const full = await DB.get('files', f.id);
    // 「＋到画板」：在笔记画布里给这一页开一块（已经有就直接跳过去），去中间写
    // （以前写进了旧的 board.pages，换成无限画布后那里已经不显示了，点了没反应）
    left._onAddPage = async (fid, page) => {
      const wd = Board.world(note);
      let i = wd.blocks.findIndex(b => b.p === page);
      if (i < 0) {
        // 放在「页码比它小的最后一块」后面，保持跟课件顺序一致
        let last = -1; wd.blocks.forEach((b, k) => { if (b.p < page) last = k; });
        i = last + 1;
        if (wd.blocks.length === 1 && !String(wd.blocks[0].text || '').trim() && !wd.strokes.length) { wd.blocks = []; i = 0; }
        wd.blocks.splice(i, 0, { p: page, y: i < wd.blocks.length ? wd.blocks[i].y : (wd.h || 0), text: '' });
        await DB.put('notes', note);
        toast(`第 ${page} 页已经在笔记里开了一块，直接写`);
      }
      showMid('note');
      setTimeout(() => Board.current && Board.current.gotoPage(page), 80);
    };
    let lockBoard = 0;
    viewer = mountDocViewer(left, full, { note, course });   // 不自动联动，页码自己看
    deskLock = ms => { lockBoard = Date.now() + ms; };
  };
  $('#dk-file').onchange = async e => { if (e.target.value === '__add') { e.target.value = fileId || ''; noteFilesModal(note, course, () => renderDesk(note.id)); return; } fileId = e.target.value; note.deskFile = fileId; if (!(note.sourceFileIds || []).includes(fileId)) note.sourceFileIds = [...(note.sourceFileIds || []), fileId]; await DB.put('notes', note); showDoc(); };
  showDoc();

  // 中栏：笔记和学习工具
  const mid = $('#dk-mid');
  const showMid = (tab, opt = {}) => {
    midTab = tab; DeskPref.set({ mtab: tab });
    $('#dk-mtabs').innerHTML = noteTabsHTML(tab, note);
    $$('#dk-mtabs [data-ntab]').forEach(b => b.onclick = () => showMid(b.dataset.ntab));
    mid.className = 'dbody';
    // 「笔记」就是白板：课件顺序的文字 + 手写，和笔记页里是同一个东西
    if (tab === 'note') {
      mid.className = 'dbody flush';
      // 画布挪到哪一块，左边课件跟到那一页（双向联动，和笔记页一样）
      return Board.mount(mid, note, { course, onPageJump: p => document.dispatchEvent(new CustomEvent('tkb-goto-page', { detail: { page: p } })) });
    }
    mountNoteTool(tab, note, course, mid, { focus: opt.focus, toPoint: pid => showMid('points', { focus: pid }) });
  };
  showMid(['note', 'vocab', 'points', 'quiz', 'text'].includes(P.mtab) ? P.mtab : 'note');

  // 右栏：实时翻译 / 问 AI
  const right = $('#dk-right');
  const showRight = tab => {
    DeskPref.set({ rtab: tab });
    $$('#dk-rtabs [data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === tab));
    if (tab === 'chat') {
      Chat.mount(right, { note, course, compact: true, getLive: () => (State.live && (!State.live.noteId || State.live.noteId === note.id) ? State.live : null), getFileIds: () => fileId ? [fileId] : [],
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
    const enOnly = s.liveEnglishOnly !== false;
    el.innerHTML = `
      <div class="dk-rec">
        <button class="recbtn" id="dk-start" aria-label="开始录音"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg></button>
        <div><strong>开始录音</strong><div class="hint">${enOnly ? '只转写英文（不翻中文），录完用来整理笔记' : '实时转写英文 + 中文字幕'}；这是一段新的录音，之前的都留着</div></div>
      </div>
      <label class="switch small" style="margin-top:10px"><input type="checkbox" id="dk-enonly" ${enOnly ? 'checked' : ''}>只录英文，不翻中文（省额度，笔记照样能整理）</label>
      ${!s.geminiKey ? '<div class="banner"><div class="grow">还没填 Gemini API key</div><a class="btn small primary" href="#settings~ai">去设置</a></div>' : ''}
      <div class="hint" style="margin-top:10px">开始录音后，这里会出现「★ 重点」和「❓ 没听懂」两个按钮。老师讲到关键处点一下，课后会单独列出来。</div>
      <div id="dk-prev" class="dk-prev"></div>`;
    $('#dk-enonly', el).onchange = e => { Settings.save({ liveEnglishOnly: e.target.checked }); deskLive(note, course, el); };
    (async () => {
      const list = await noteSessions(note);
      const host = $('#dk-prev', el); if (!host) return;
      host.innerHTML = list.length ? `<div class="hint" style="margin:14px 0 6px">${list.length > 1 ? `这份笔记以前录过 ${list.length} 段（都还在）。` : '这份笔记录过音。'}再点开始会<b>接着最近那一段继续录</b>，不会再分新的一段：</div>${list.slice().reverse().map((x, i) => `<a class="dk-prev-item" href="#session-${x.id}"><span class="grow">第 ${list.length - i} 段 · ${fmtTime(x.duration)} · ${(x.segments || []).length} 句</span><span class="hint">${fmtDate(x.startedAt)}</span></a>`).join('')}` : '';
    })();
    $('#dk-start', el).onclick = async () => {
      if (await micState() === 'denied') { micHelp(() => $('#dk-start', el).click()); return; }
      if ((Settings.load().liveEnglishOnly !== false) === false && (Settings.load().draftMode || 'free') === 'free') AI.prepareLocalTranslator();
      const btn = $('#dk-start', el); btn.disabled = true;
      // 这份笔记录过音：接着最近那一段继续录，不分新的一段
      const prevList = await noteSessions(note);
      const resume = prevList.length ? prevList[prevList.length - 1] : null;
      const live = new LiveSession({ course, resume, onUpdate: segs => liveUI.update(segs), onInterim: t => liveUI.interim(t), onStatus: st => liveUI.status(st), onError: m => liveUI.error(m), onLevel: r => liveUI.level(r) });
      live.focusFileId = note.deskFile || (note.sourceFileIds || [])[0];
      try { await live.start(); live.noteId = note.id; State.live = live; renderSide(); deskLive(note, course, el); }
      catch (e) {
        btn.disabled = false;
        if (e.name === 'NotAllowedError' || /permission|denied/i.test(String(e.message || ''))) micHelp(() => $('#dk-start', el).click());
        else toast(e.name === 'NotFoundError' ? '没找到麦克风。检查麦克风有没有接好，或在「设置」里换一个麦克风。' : e.message, 6000);
        try { live.capture && live.capture.stop(); } catch (x) {}
      }
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
    await linkSession(fresh, rec.id); Object.assign(note, fresh);
    const total = (fresh.sessionIds || []).length;
    el.innerHTML = `<div class="empty"><strong>录好了 · ${fmtTime(rec.duration)} · ${rec.segments.length} 句</strong>${total > 1 ? `这是第 ${total} 段，前面几段都留着，整理笔记时会一起用上。` : '下一步：把老师讲的和你的手写一起整理进笔记。'}<div class="row" style="justify-content:center;margin-top:12px"><a class="btn" href="#session-${rec.id}">看转写回放</a><button class="btn" id="dk-again">再录一段</button><button class="btn primary" id="dk-recap">${ICON.spark}手写笔记 + 课堂录音优化笔记</button></div></div>`;
    $('#dk-again', el).onclick = () => deskLive(note, course, el);
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
  $('#ak-c').onchange = e => { Nav.replace('ask-' + e.target.value); };
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
  const notes = (await DB.byIndex('notes', 'courseId', course.id)).filter(n => n.study && (n.study.quiz || []).length).sort((a, b) => a.createdAt - b.createdAt);
  if (!notes.length) { toast('还没有笔记生成过测验题 —— 先去笔记里出一次「测验」'); return; }
  // 笔记 → 周次（从来源课件推断），用来按 Topic 范围筛
  const weeks = {};
  for (const n of notes) {
    const fs = await Promise.all((n.sourceFileIds || []).map(id => DB.get('files', id)));
    const w = fs.filter(Boolean).map(f => weekOf(f).n).filter(x => x && x < 900);
    weeks[n.id] = w.length ? Math.min(...w) : 0;
  }
  const cfg = (course.exams && course.exams[0]) || { weights: {} };
  const wOf = id => (cfg.weights || {})[id] ?? 1;
  const minW = Math.min(...notes.map(n => weeks[n.id] || 99)), maxW = Math.max(...notes.map(n => weeks[n.id] || 0));
  modal(`<h2>模拟考试 · 按权重组卷</h2>
    <p class="hint" style="margin:0">真考试里各 topic 占分不一样。给每份笔记填一个权重（1 = 正常，2 = 考得多，0 = 不考），题目按权重分，不是平均抽。</p>
    <div class="row" style="margin-top:12px"><div class="field grow"><label for="me-from">从 Week</label><input id="me-from" type="number" min="0" value="${minW === 99 ? 1 : minW}"></div>
      <div class="field grow"><label for="me-to">到 Week</label><input id="me-to" type="number" min="0" value="${maxW || 12}"></div>
      <div class="field grow"><label for="me-n">题数</label><input id="me-n" type="number" min="5" max="60" value="${cfg.count || 20}"></div>
      <div class="field grow"><label for="me-t">限时（分钟）</label><input id="me-t" type="number" min="5" max="180" value="30"></div></div>
    <div class="mk-weights">${notes.map(n => `<div class="wk-row"><span class="grow">${esc(n.title)} <span class="hint">${weeks[n.id] ? 'Week ' + weeks[n.id] + ' · ' : ''}${n.study.quiz.length} 题</span></span><input type="number" min="0" max="10" step="0.5" value="${wOf(n.id)}" data-w="${n.id}"></div>`).join('')}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="me-go">组卷</button></div>`, (box, close) => {
    const applyRange = () => {
      const a = Number($('#me-from', box).value) || 0, b = Number($('#me-to', box).value) || 999;
      $$('[data-w]', box).forEach(inp => { const w = weeks[inp.dataset.w]; if (w && w >= 900) return; inp.value = (!w || (w >= a && w <= b)) ? (Number(inp.value) || 1) : 0; });
    };
    $('#me-from', box).onchange = applyRange; $('#me-to', box).onchange = applyRange;
    $('#me-go', box).onclick = async () => {
      const weights = {}; $$('[data-w]', box).forEach(i => { weights[i.dataset.w] = Number(i.value) || 0; });
      const count = Math.max(5, Math.min(60, Number($('#me-n', box).value) || 20));
      const mins = Math.max(5, Number($('#me-t', box).value) || 30);
      const c2 = await DB.get('courses', course.id);
      c2.exams = [{ id: (c2.exams && c2.exams[0] && c2.exams[0].id) || DB.uid('ex_'), count, weights, at: Date.now() }];
      await DB.put('courses', c2);
      Object.assign(course, { exams: c2.exams });
      close();
      try {
        const { qs, pools } = await Learn.paperFor(course, { weights, count });
        if (!qs.length) { toast('没有抽到题，把权重调回来试试'); return; }
        Learn.runPaper(course, qs, mins, {
          title: '模拟考试', meta: `${pools.length} 个 topic 按权重组卷`,
          onWrong: q => Learn.wrongHit(q.noteId, q.qi, false),
          onRight: q => Learn.wrongHit(q.noteId, q.qi, true),
        });
      } catch (e) { toast(e.message, 6000); }
    };
  });
}
/* ======================================================================
   一段课件可以上好几节课：每次录音都是新的一段，追加到 note.sessionIds，
   note.sessionId 只表示「最近那一段」。
   ====================================================================== */
async function noteSessions(note) {
  const ids = [...new Set([].concat(note.sessionIds || [], note.sessionId || []).filter(Boolean))];
  const out = [];
  for (const id of ids) { const s = await DB.get('sessions', id); if (s) out.push(s); }
  return out.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
}
async function linkSession(note, sid) {
  note.sessionIds = [...new Set([...(note.sessionIds || []), sid])];
  note.sessionId = sid; // 最近一段，老代码仍然读这个字段
  await DB.put('notes', note);
  return note;
}

/* ======================================================================
   5.0 学习闭环（2026-11-01）
   —— 生词本（艾宾浩斯）/ 课件难度预判 / 没听懂清单 / 老师划的重点 /
      录音按话题分段 / 复习优先级 / 错题本 / 加权模考 / 复制给 AI

   三条原则：
   1. 能用本地数据算出来的（优先级、错题、进度）绝不调用 AI；
   2. 必须用 AI 的（难度预判、没听懂重讲、话题分段、划重点整理）都是
      手指点一下才跑，能省的一次都不多花；
   3. 状态全部写回 courses / files / notes / sessions，跟着云同步走。
   ====================================================================== */
const Learn = (() => {
  const DAY = 86400e3;
  const weekStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };

  /* ==================== 1. 生词本（艾宾浩斯） ==================== */
  const BOX = [1, 3, 7, 16, 35, 60]; // 第 n 次答对后隔几天再见
  const vocCache = new Map();
  const dirty = new Set();
  let flushT = null;
  function flushLater(course) {
    dirty.add(course.id);
    clearTimeout(flushT);
    // 攒 1.2 秒再存，避免每点一个词就写一次库、触发一次云同步
    flushT = setTimeout(async () => {
      const ids = [...dirty]; dirty.clear();
      for (const id of ids) {
        const c = await DB.get('courses', id);
        const hit = vocCache.get(id);
        if (c && hit && hit.course) { c.vocab = hit.course.vocab || {}; await DB.put('courses', c); }
      }
    }, 1200);
  }
  async function vocab(courseId) {
    if (vocCache.has(courseId)) return vocCache.get(courseId);
    const [files, course] = await Promise.all([DB.byIndex('files', 'courseId', courseId), DB.get('courses', courseId)]);
    const map = new Map();
    for (const f of files) for (const t of ((f.prep && f.prep.terms) || [])) {
      const k = String(t.en || '').toLowerCase().trim();
      if (!k || map.has(k)) continue;
      map.set(k, { key: k, en: String(t.en), zh: t.zh || '', explain: t.explain || '', example: t.example || '', example_zh: t.example_zh || '', from: f.name });
    }
    // 自己选中加进来的词（课件 / 笔记里选中 → 加入生词本）
    for (const x of Object.values((course && course.vocabExtra) || {})) {
      const k = String(x.en || '').toLowerCase().trim();
      if (!k) continue;
      const base = map.get(k) || { key: k, en: String(x.en), zh: '', explain: '', example: '', example_zh: '', from: '' };
      map.set(k, Object.assign(base, { zh: x.zh || base.zh, explain: x.explain || base.explain, example: x.example || base.example, example_zh: x.example_zh || base.example_zh, from: x.from || base.from }));
    }
    const st = (course && course.vocab) || {};
    // status：in = 在生词本里要背；known = 筛词时说「会」；没有 = 还没筛过的新词
    // （老数据：背过的词都算在生词本里）
    const items = [...map.values()].map(v => {
      const s = st[v.key];
      const status = s ? (s.status || (s.seen ? 'in' : '')) : '';
      return Object.assign(v, { status, box: s && s.box != null ? s.box : -1, due: s && s.due ? s.due : 0, ok: (s && s.ok) || 0, seen: (s && s.seen) || 0 });
    });
    const out = { course, items };
    vocCache.set(courseId, out);
    return out;
  }
  const inBook = v => v.items.filter(i => i.status === 'in');
  const pending = v => v.items.filter(i => !i.status);
  const dueItems = v => inBook(v).filter(i => i.due <= Date.now()).sort((a, b) => a.due - b.due);
  const vstats = v => ({
    total: inBook(v).length,
    due: dueItems(v).length,
    learned: inBook(v).filter(i => i.box >= 0).length,
    solid: inBook(v).filter(i => i.box >= 3).length,
    pending: pending(v).length,
    known: v.items.filter(i => i.status === 'known').length,
  });
  /* 筛词：整理出来的术语先一个个问你「会不会」，不会的才进生词本 */
  async function screenWord(courseId, item, known) {
    const v = await vocab(courseId); if (!v.course) return;
    const c = v.course; c.vocab = c.vocab || {};
    const cur = c.vocab[item.key] || { box: -1, ok: 0, seen: 0 };
    cur.status = known ? 'known' : 'in'; cur.at = Date.now();
    if (!known) { cur.box = -1; cur.due = Date.now(); }
    c.vocab[item.key] = cur;
    item.status = cur.status; item.box = cur.box; item.due = cur.due || 0;
    flushLater(c);
  }
  /* 选中文字 → 加入生词本：直接进生词本（你自己挑的就是不会的） */
  async function addWord(courseId, w) {
    const en = String(w.en || '').trim(); if (!en) return null;
    const key = en.toLowerCase();
    const c = await DB.get('courses', courseId); if (!c) return null;
    c.vocabExtra = c.vocabExtra || {};
    c.vocabExtra[key] = Object.assign({}, c.vocabExtra[key] || {}, { en, zh: w.zh || '', explain: w.explain || '', example: w.example || '', example_zh: w.example_zh || '', from: w.from || '', at: Date.now() });
    c.vocab = c.vocab || {};
    const cur = c.vocab[key] || { box: -1, ok: 0, seen: 0 };
    if (cur.status !== 'in') { cur.status = 'in'; cur.box = -1; cur.due = Date.now(); }
    c.vocab[key] = cur;
    await DB.put('courses', c);
    vocCache.delete(courseId);
    return key;
  }
  async function gradeWord(courseId, item, good) {
    const v = await vocab(courseId);
    if (!v.course) return;
    const c = v.course;
    c.vocab = c.vocab || {};
    const cur = c.vocab[item.key] || { box: -1, ok: 0, seen: 0 };
    if (good) { cur.box = Math.min(BOX.length - 1, cur.box + 1); cur.ok = (cur.ok || 0) + 1; }
    else { cur.box = 0; cur.ok = 0; } // 忘了就从头开始，10 分钟后再考一次
    cur.seen = (cur.seen || 0) + 1;
    cur.due = Date.now() + (good ? BOX[cur.box] * DAY : 10 * 60e3);
    cur.at = Date.now(); cur.status = 'in';
    c.vocab[item.key] = cur;
    item.box = cur.box; item.due = cur.due; item.seen = cur.seen; item.ok = cur.ok; item.status = 'in';
    flushLater(c);
  }
  /* 走一遍今天该背的词：先英→中，再点「认识 / 不认识」 */
  function vocabPage(el, courses, courseId) {
    const cid = courseId || (courses[0] && courses[0].id);
    if (cid) vocCache.delete(cid);   // 课前包刚生成过 / 别的设备同步过来新词：进来时重新读一次
    if (!cid) { el.innerHTML = '<div class="empty"><strong>还没有课程</strong>先建一门课、生成课前包，术语会自动进生词本。</div>'; return; }
    let idx = 0, show = false, order = [], screening = false, sOrder = [], sIdx = 0, sShow = false;
    const paint = async () => {
      const v = await vocab(cid);
      const st = vstats(v);
      if (screening) return paintScreen(v);
      if (!v.items.length) {
        el.innerHTML = `<div class="empty"><strong>这门课还没有生词</strong>课前包里的术语表会自动收进生词本 —— 到「课件 → 课前包」生成一份，回来这里就有词可背了。</div>`;
        return;
      }
      const screenBar = st.pending ? `<div class="card pad vocab-screen-bar"><div class="row"><div class="grow"><b>${st.pending} 个新整理出来的词还没筛</b><div class="hint">一个个看：会的直接跳过，不会的才放进生词本</div></div><button class="btn primary" id="vs-go">开始筛词</button></div></div>` : '';
      if (!st.total) {
        el.innerHTML = screenBar + `<div class="empty"><strong>生词本还是空的</strong>${st.pending ? '先筛一遍上面的新词，不会的会放进来。' : '在课件或笔记里选中一个词，点「加入生词本」；生成课前包后整理出来的术语也会让你先筛。'}</div>`;
        const g = $('#vs-go', el); if (g) g.onclick = startScreen;
        return;
      }
      if (!order.length) order = dueItems(v).slice(0, 20).map(i => i.key);
      const now = order.map(k => v.items.find(i => i.key === k)).filter(Boolean);
      const head = `<div class="card pad vocab-top"><div class="row" style="justify-content:space-between;align-items:flex-start">
        <div class="grow"><b>今天要背 ${st.due} 个</b><div class="hint">总共 ${st.total} 个 · 背过 ${st.learned} · 记牢 ${st.solid}（答对 4 次以上）</div>
        <div class="sb-bar green" style="margin-top:8px"><i style="width:${st.total ? Math.round(st.solid / st.total * 100) : 0}%"></i></div></div>
        <div class="row"><button class="btn small ${show ? '' : 'on'}" data-mode="all">看全部 ${st.total}</button></div></div></div>`;
      if (!now.length) {
        el.innerHTML = screenBar + head + `<div class="empty"><strong>今天的词都背完了 👍</strong>明天这个时候再来。想多背可以点上面的「看全部」。</div>`;
        const all = $('[data-mode=all]', el); if (all) all.onclick = async () => {
          const v2 = await vocab(cid); order = v2.items.slice().sort((a, b) => a.box - b.box).map(i => i.key); paint();
        };
        return;
      }
      idx = Math.max(0, Math.min(idx, now.length - 1));
      const w = now[idx];
      el.innerHTML = screenBar + head + `
        <div class="vword" id="vw">
          <div class="vw-en"><button class="say" data-say="${esc(w.en)}" aria-label="朗读">🔊</button>${esc(w.en)}</div>
          ${show ? `<div class="vw-zh">${esc(w.zh)}</div>${w.explain ? `<div class="vw-ex">${esc(w.explain)}</div>` : ''}${w.example ? `<div class="vw-sent"><button class="say small" data-say="${esc(w.example)}" aria-label="朗读例句">🔊</button><span>${esc(w.example)}</span><em>${esc(w.example_zh)}</em></div>` : ''}` : `<div class="hint">先自己想想它是什么意思，再翻面</div>`}
          <div class="hint vw-src">出自：${esc(w.from || '')}</div>
        </div>
        <div class="row" style="justify-content:space-between;margin-top:12px">
          <span class="hint">${idx + 1} / ${now.length}${w.box >= 0 ? ` · 第 ${w.box + 1} 档 · 下次 ${new Date(w.due).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}` : ' · 新词'}</span>
          <div class="row"><button class="btn small" id="vw-skip">跳过</button>${show ? `<button class="btn small danger" id="vw-no">不认识</button><button class="btn small primary" id="vw-yes">认识</button>` : `<button class="btn primary" id="vw-flip">翻面</button>`}</div>
        </div>`;
      $$('[data-say]', el).forEach(b => b.onclick = () => Prep.speak(b.dataset.say));
      const flip = $('#vw-flip', el); if (flip) flip.onclick = () => { show = true; paint(); };
      $('#vw', el).onclick = () => { if (!show) { show = true; paint(); } };
      $('#vw-skip', el).onclick = () => { idx++; show = false; paint(); };
      const yes = $('#vw-yes', el); if (yes) yes.onclick = async () => { await gradeWord(cid, w, true); idx++; show = false; paint(); };
      const no = $('#vw-no', el); if (no) no.onclick = async () => { await gradeWord(cid, w, false); idx++; show = false; paint(); };
      const g = $('#vs-go', el); if (g) g.onclick = startScreen;
    };
    const startScreen = async () => { const v = await vocab(cid); sOrder = pending(v).map(i => i.key); sIdx = 0; sShow = false; screening = true; paint(); };
    const paintScreen = v => {
      const list = sOrder.map(k => v.items.find(i => i.key === k)).filter(i => i && !i.status);
      if (!list.length) {
        screening = false; order = [];
        const st = vstats(v);
        el.innerHTML = `<div class="empty"><strong>筛完了</strong>生词本里现在有 ${st.total} 个词，会的 ${st.known} 个已经跳过。<div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="vs-done">开始背</button></div></div>`;
        $('#vs-done', el).onclick = () => paint();
        return;
      }
      const w = list[0], total = sOrder.length, doneN = total - list.length;
      el.innerHTML = `<div class="card pad vocab-top"><div class="row"><div class="grow"><b>筛词 ${doneN + 1} / ${total}</b><div class="hint">这个词你会吗？会的跳过，不会的放进生词本</div><div class="sb-bar" style="margin-top:8px"><i style="width:${Math.round(doneN / total * 100)}%"></i></div></div><button class="btn small ghost" id="vs-stop">先停一下</button></div></div>
        <div class="vword" id="vs-w">
          <div class="vw-en"><button class="say" data-say="${esc(w.en)}" aria-label="朗读">🔊</button>${esc(w.en)}</div>
          ${sShow ? `<div class="vw-zh">${esc(w.zh)}</div>${w.explain ? `<div class="vw-ex">${esc(w.explain)}</div>` : ''}${w.example ? `<div class="vw-sent">${esc(w.example)}${w.example_zh ? `<em>${esc(w.example_zh)}</em>` : ''}</div>` : ''}` : `<div class="hint" style="margin-top:10px">先自己想一下是什么意思，不确定就点「看意思」</div>`}
          <div class="hint vw-src">出自：${esc(w.from || '')}</div>
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:12px;gap:8px">
          ${sShow ? '' : '<button class="btn" id="vs-show">看意思</button>'}
          <button class="btn danger" id="vs-no">不会，放进生词本</button><button class="btn primary" id="vs-yes">会，跳过</button>
        </div>`;
      $$('[data-say]', el).forEach(b => b.onclick = e => { e.stopPropagation(); Prep.speak(b.dataset.say); });
      const sh = $('#vs-show', el); if (sh) sh.onclick = () => { sShow = true; paint(); };
      $('#vs-yes', el).onclick = async () => { await screenWord(cid, w, true); sShow = false; paint(); };
      $('#vs-no', el).onclick = async () => { await screenWord(cid, w, false); sShow = false; paint(); };
      $('#vs-stop', el).onclick = () => { screening = false; order = []; paint(); };
    };
    paint();
  }

  /* ==================== 2. 课件难度预判 ==================== */
  async function diffFile(file, courseName) {
    if (!Settings.load().deepseekKey) throw new Error('难度预判要用 DeepSeek，先去设置填 key');
    if (!(file.text || '').trim()) throw new Error('这份课件还没读出文字，先识别/同步一次');
    const job = Jobs.start('diff:' + file.id, '预判难度：' + file.name);
    job.phase('正在读这份课件', .05, .9, { expectSec: 12 });
    try {
      const out = await AI.deepseekStream({
        thinking: false, json: true, maxTokens: 1400, purpose: 'prep',
        onText: t => job.len(t.length),
        system: '你是商科课程助教，帮英语不好的中国留学生找出「最该先啃」的几页。只输出 JSON。',
        user: `课程：${courseName || ''}\n课件：${file.name}\n\n判断这份课件里最难的 3 页（概念最密、公式最多、或者学生最容易听不懂的地方），以及整体难度。只输出 JSON：\n{"hardest":[{"page":12,"why":"这页为什么难（一句中文）"}],"overall":"整体难度和怎么读（一句中文）","tips":["针对这几页的读法建议（2 条）"]}\n\n<课件>\n${String(file.text).slice(0, 60000)}\n</课件>`,
      });
      const j = AI.parseJSON(out);
      file.hard = {
        pages: (j.hardest || []).slice(0, 3).map(x => ({ page: Number(x.page) || 0, why: String(x.why || '') })),
        overall: String(j.overall || ''), tips: (j.tips || []).map(String).slice(0, 3), at: Date.now(),
      };
      const fresh = await DB.get('files', file.id);
      if (fresh) { fresh.hard = file.hard; await DB.put('files', fresh); }
      return file.hard;
    } finally { job.done(); }
  }
  let diffChain = Promise.resolve();
  /* 导入完自动排一遍（一次最多 8 份，免得一次导入 30 份课件跑半小时、花掉几块钱） */
  function diffAuto(files, courseName) {
    const s = Settings.load();
    if (s.autoDiff === false || !s.deepseekKey) return 0;
    const list = files.filter(f => !f.hard && (f.text || '').length > 1200 && f.status === 'ready').slice(0, 8);
    for (const f of list) diffChain = diffChain.then(() => diffFile(f, courseName)).catch(() => {});
    return list.length;
  }

  /* ==================== 3. 没听懂 → 复习清单 ==================== */
  const TODO = note => (note.todo = note.todo || []);
  async function confusedList(note, session, course) {
    const cf = (session.confused || []);
    if (!cf.length) throw new Error('这节课还没有点过「没听懂」');
    if (!Settings.load().deepseekKey) throw new Error('要用 DeepSeek，先去设置填 key');
    const job = Jobs.start('cf:' + session.id, '整理没听懂的地方');
    try {
      job.phase('正在整理你没听懂的地方', .06, .95, { expectSec: 14 });
      const around = cf.slice(0, 8).map(c => {
        const near = (session.segments || []).filter(g => Math.abs(g.t - c.t) < 90).map(g => `[${fmtTime(g.t)}] ${g.en}`).join('\n');
        return `【没听懂 ${fmtTime(c.t)}】\n${near || c.near || ''}`;
      }).join('\n\n');
      const out = await AI.deepseekStream({
        thinking: false, json: true, maxTokens: 3000, purpose: 'chat',
        onText: t => job.len(t.length),
        system: '你是耐心的商科助教，学生英语不好。把学生课上没听懂的地方整理成能照着复盘的清单。只输出 JSON。',
        user: `课程：${course ? course.name : ''}\n课堂：${session.title}\n学生标记了 ${cf.length} 处没听懂。下面是每处前后老师说的话（语音识别可能有错）：\n\n${around}\n\n只输出 JSON：\n{"items":[{"title":"一句话：没听懂的是什么（中文，带英文术语）","explain":"用中文讲清楚（3-5 句，术语写 中文（English））","check":"复习时怎么自己验证懂了（一句）"}]}\n最多 5 条，按重要性排序。不要编老师没讲过的东西。`,
      });
      const j = AI.parseJSON(out);
      const items = (j.items || []).filter(x => x && x.title).slice(0, 5).map((x, i) => ({
        id: DB.uid('td_'), t: String(x.title), detail: String(x.explain || ''), check: String(x.check || ''),
        done: false, at: Date.now(), from: 'confused', sessionId: session.id, i,
      }));
      if (!items.length) throw new Error('没整理出内容，再点一次');
      // 同一节课重复整理时替换旧的，别堆成几十条
      note.todo = TODO(note).filter(x => x.sessionId !== session.id).concat(items);
      await DB.put('notes', note);
      return items;
    } finally { job.done(); }
  }
  async function todoToggle(note, id) {
    const it = TODO(note).find(x => x.id === id); if (!it) return;
    it.done = !it.done; it.doneAt = it.done ? Date.now() : 0;
    await DB.put('notes', note);
  }

  /* ==================== 4. 老师亲口划的重点 ==================== */
  function gatherMarks(sessions) {
    const out = [];
    for (const s of sessions) {
      for (const h of (s.highlights || [])) out.push({ t: h.t, text: h.near || '', sid: s.id, title: s.title, kind: 'mark' });
      for (const g of (s.segments || [])) if (g.important && !g.starred) out.push({ t: g.t, text: g.en || '', sid: s.id, title: s.title, kind: 'auto' });
    }
    return out.sort((a, b) => a.sid === b.sid ? a.t - b.t : a.title.localeCompare(b.title));
  }
  async function buildMarks(course) {
    const sessions = await DB.byIndex('sessions', 'courseId', course.id);
    const raw = gatherMarks(sessions);
    if (!raw.length) throw new Error('这门课还没有标记或自动高亮的内容');
    if (!Settings.load().deepseekKey) throw new Error('要用 DeepSeek，先去设置填 key');
    const job = Jobs.start('marks:' + course.id, '整理考前重点：' + course.name);
    try {
      job.phase('正在把老师划过的地方合成一张纸', .06, .95, { expectSec: 16 });
      const lines = raw.slice(0, 120).map((x, i) => `${i + 1}. [${x.title} ${fmtTime(x.t)}] ${String(x.text).slice(0, 260)}`).join('\n');
      const out = await AI.deepseekStream({
        thinking: false, json: true, maxTokens: 4000, purpose: 'recap',
        onText: t => job.len(t.length),
        system: '你是帮学生备考的助教。老师课上反复强调、明确说了考试/作业相关的内容，整理成考前只看这一页的清单。只输出 JSON。',
        user: `课程：${course.name}\n下面是这个学期课堂里「我按过标记」和「系统判定为考试/作业/老师强调」的原话（语音识别可能有错字）：\n\n${lines}\n\n只输出 JSON：\n{"items":[{"title":"考点（中文 + English 术语）","why":"老师原话的意思，一句话","level":"必考/可能考/了解"}],"summary":"这门课考前最该抓的 3 件事（一句中文）"}\n合并重复的说法，按重要性排序，最多 18 条。不要编没出现过的内容。`,
      });
      const j = AI.parseJSON(out);
      course.marks = {
        items: (j.items || []).filter(x => x && x.title).slice(0, 18).map(x => ({ title: String(x.title), why: String(x.why || ''), level: String(x.level || '') })),
        summary: String(j.summary || ''), at: Date.now(), n: raw.length,
      };
      await DB.put('courses', course);
      return course.marks;
    } finally { job.done(); }
  }

  /* ==================== 5. 录音按话题分段 ==================== */
  async function buildTopics(session, course) {
    if ((session.segments || []).length < 12) throw new Error('这段录音太短，不用分段');
    if (!Settings.load().deepseekKey) throw new Error('要用 DeepSeek，先去设置填 key');
    const job = Jobs.start('topic:' + session.id, '按话题分段');
    try {
      job.phase('正在听这节课讲了几个话题', .06, .95, { expectSec: 18 });
      const lines = session.segments.slice(0, 900).map(g => `[${fmtTime(g.t)}] ${g.en}`).join('\n');
      const out = await AI.deepseekStream({
        thinking: false, json: true, maxTokens: 2000, purpose: 'recap',
        onText: t => job.len(t.length),
        system: '你是课堂录音的编辑，负责按老师换话题的位置切段落。只输出 JSON。',
        user: `课程：${course ? course.name : ''}\n下面是一节课的转写（每行开头是时间）。老师讲到新话题的地方切开，给每段起一个 8-16 字的中文小标题。只输出 JSON：\n{"topics":[{"t":123,"title":"小标题"}]}\n第一段必须从 0 开始；每 2-6 分钟一段；最多 12 段；标题要具体（写讲的是什么内容，不要写「继续讲解」）。\n\n<转写>\n${lines}\n</转写>`,
      });
      const j = AI.parseJSON(out);
      const tps = (j.topics || []).map(x => ({ t: Math.max(0, Number(x.t) || 0), title: String(x.title || '').trim() }))
        .filter(x => x.title).sort((a, b) => a.t - b.t).slice(0, 12);
      if (tps.length < 2) throw new Error('没能切出话题，再点一次');
      session.topics = tps;
      await DB.put('sessions', session);
      return tps;
    } finally { job.done(); }
  }

  /* ==================== 6. 复习优先级（不花钱） ==================== */
  function priority(notes, courses) {
    const out = [];
    const now = Date.now();
    for (const d of Deadlines.upcoming(10)) {
      const days = (d.due - now) / DAY;
      if (days > 21) continue;
      const key = String(d.course || '');
      const course = d.courseId ? courses.find(c => c.id === d.courseId)
        : courses.find(c => key && (key.includes(c.code || '\u0000') || c.name.includes(key) || key.includes(shortName(c.name))));
      const pool = notes.filter(n => (!course || n.courseId === course.id) && n.status !== 'generating');
      const picks = pool.map(n => {
        const p = Study.progress(n);
        const rate = p.total ? p.done / p.total : (n.markdown ? .5 : 0);
        return { n, rate, p };
      }).sort((a, b) => a.rate - b.rate).slice(0, 3);
      if (!picks.length) continue;
      out.push({ d, course, days, picks });
      if (out.length >= 3) break;
    }
    return out;
  }
  function week(notes) {
    const ws = weekStart();
    const ns = notes.filter(n => (n.createdAt || 0) >= ws && n.status !== 'generating');
    const total = ns.reduce((a, n) => a + ((n.study && n.study.points) || []).length, 0);
    const done = ns.reduce((a, n) => a + Study.progress(n).done, 0);
    return { n: ns.length, total, done, rate: total ? done / total : 0 };
  }

  /* ==================== 7. 错题本 ==================== */
  function wrongAdd(note, qi) {
    const st = note.study || {};
    const q = (st.quiz || [])[qi]; if (!q) return;
    note.wrong = note.wrong || [];
    const hit = note.wrong.find(x => x.qi === qi && x.q === q.q);
    if (hit) { hit.at = Date.now(); hit.ok = 0; }
    else note.wrong.push({ qi, q: q.q, at: Date.now(), ok: 0 });
    // 一轮最多记 40 道，别把笔记撑大
    if (note.wrong.length > 40) note.wrong = note.wrong.slice(-40);
  }
  function wrongList(notes, courses) {
    const out = [];
    for (const n of notes) for (const w of (n.wrong || [])) {
      const q = (n.study && n.study.quiz || [])[w.qi];
      if (!q || q.q !== w.q) continue; // 题重新生成过，对不上了就跳过
      out.push({ q, noteId: n.id, noteTitle: n.title, courseId: n.courseId, courseName: (courses.find(c => c.id === n.courseId) || {}).name || '', n2: w.ok || 0, qi: w.qi });
    }
    return out.sort((a, b) => b.n2 - a.n2);
  }
  /* 答完一题就写库：答对累计两次自动出本，答错就进本 */
  async function wrongHit(noteId, qi, good) {
    const note = await DB.get('notes', noteId); if (!note) return;
    if (good) {
      const w = (note.wrong || []).find(x => x.qi === qi);
      if (w) { w.ok = (w.ok || 0) + 1; if (w.ok >= 2) note.wrong = note.wrong.filter(x => x !== w); }
    } else wrongAdd(note, qi);
    await DB.put('notes', note);
  }
  async function wrongResolve(noteId, qi, good) {
    const note = await DB.get('notes', noteId); if (!note) return;
    const w = (note.wrong || []).find(x => x.qi === qi); if (!w) return;
    if (good) w.ok = (w.ok || 0) + 1; else w.ok = 0;
    if (w.ok >= 2) note.wrong = note.wrong.filter(x => x.qi !== qi); // 连对两次就出本
    await DB.put('notes', note);
  }

  /* ==================== 8. 加权模考 ==================== */
  /* 每份笔记（≈ 一个 topic）一个权重，题目按权重分，而不是平均抽 */
  function pickWeighted(pools, total) {
    const sum = pools.reduce((a, p) => a + p.weight, 0) || 1;
    const bag = [], seen = new Set();
    const push = (q, w) => {
      const k = String(q.q || '').replace(/\s/g, '');
      if (seen.has(k)) return; // 两节课里出过同一题只算一次
      seen.add(k); bag.push(Object.assign({}, q, { _w: w }));
    };
    pools.forEach(p => {
      const want = Math.max(1, Math.round(total * p.weight / sum));
      p.qs.slice().sort(() => Math.random() - .5).slice(0, Math.min(want, p.qs.length)).forEach(q => push(q, p.weight));
    });
    // 还不够题数就从所有题里补（还是去重）
    if (bag.length < total) pools.forEach(p => p.qs.slice().sort(() => Math.random() - .5).forEach(q => { if (bag.length < total) push(q, p.weight); }));
    return bag.sort(() => Math.random() - .5).slice(0, total);
  }
  async function paperFor(course, cfg) {
    const notes = (await DB.byIndex('notes', 'courseId', course.id)).filter(n => n.study && (n.study.quiz || []).length);
    const pools = notes.map(n => ({
      note: n,
      weight: Math.max(0, Number((cfg.weights || {})[n.id] ?? 1)),
      qs: n.study.quiz.map((q, qi) => Object.assign({}, q, { noteId: n.id, noteTitle: n.title, courseId: course.id, qi })),
    })).filter(p => p.weight > 0 && p.qs.length);
    if (!pools.length) throw new Error('这门课还没有笔记生成过测验题（先去笔记里出一次测验）');
    const qs = pickWeighted(pools, Math.max(5, Math.min(60, cfg.count || 20)));
    return { qs, pools };
  }

  /* ==================== 9. 打包给别的 AI ==================== */
  function packPrompt(note, course, opts = {}) {
    const st = note.study || {};
    const parts = [];
    parts.push(`你是我的学习助教。下面是「${course ? course.name : '这门课'}」的课堂笔记资料，请基于它帮我${opts.task || '查漏补缺、出几道题考我'}。用中文回答，专业术语写成 中文（English）。`);
    if (opts.note !== false && note.markdown) parts.push(`\n## 笔记\n${note.markdown.slice(0, 14000)}`);
    if (opts.points !== false && (st.points || []).length) parts.push(`\n## 知识点（已掌握用 ✓）\n${st.points.map(p => `${(note.mastered || {})[p.id] ? '✓' : '·'} ${p.title}`).join('\n')}`);
    if (opts.wrong !== false && (note.wrong || []).length) {
      const w = (note.wrong || []).map(x => `- ${x.q}`).slice(0, 20);
      parts.push(`\n## 我做错过的题\n${w.join('\n')}`);
    }
    const td = (note.todo || []).filter(x => !x.done);
    if (opts.todo !== false && td.length) parts.push(`\n## 我还没搞懂的\n${td.map(x => `- ${x.t}`).join('\n')}`);
    parts.push('\n请先指出我最该补的 3 个地方，再给我讲解和练习。');
    return parts.join('\n');
  }

  /* ==================== 通用：一题一题的做题器（错题本 / 模考共用） ==================== */
  function runPaper(course, qs, minutes, opts = {}) {
    const ans = new Array(qs.length).fill(null), L = 'ABCDEF';
    const end = minutes ? Date.now() + minutes * 60e3 : 0;
    const title = opts.title || '模拟考试';
    const onWrong = opts.onWrong || (() => {});
    const onRight = opts.onRight || (() => {});
    view.innerHTML = `<div class="head"><div><h1>${esc(title)}${course ? ' · ' + esc(course.name) : ''}</h1><div class="meta">${qs.length} 题${minutes ? ` · 限时 ${minutes} 分钟` : ' · 不限时'}${opts.meta ? ' · ' + esc(opts.meta) : ''}</div></div>
      <div class="row">${minutes ? '<span class="clock" id="ex-clock"></span>' : ''}<button class="btn primary" id="ex-submit">交卷</button></div></div>
      <div class="exam">${qs.map((q, i) => `<div class="card pad quiz" data-i="${i}"><div class="qq">${i + 1}. ${esc(q.q)} ${q.noteTitle ? `<span class="hint">· ${esc(q.noteTitle)}</span>` : ''}</div><div class="opts">${q.options.map((o, k) => `<button class="opt" data-k="${k}"><b>${L[k]}</b><span>${esc(o)}</span></button>`).join('')}</div></div>`).join('')}</div>`;
    $$('.exam .quiz').forEach(c => $$('.opt', c).forEach(b => b.onclick = () => { ans[Number(c.dataset.i)] = Number(b.dataset.k); $$('.opt', c).forEach(x => x.classList.toggle('sel', x === b)); }));
    let tick = null;
    const submit = () => {
      if (tick) clearInterval(tick);
      const score = qs.filter((q, i) => ans[i] === q.answer).length;
      const byNote = new Map();
      qs.forEach((q, i) => {
        const k = q.noteTitle || '其他';
        const b = byNote.get(k) || { n: 0, ok: 0 };
        b.n++; if (ans[i] === q.answer) b.ok++;
        byNote.set(k, b);
        if (q.noteId && q.qi != null) (ans[i] === q.answer ? onRight : onWrong)(q);
      });
      view.innerHTML = `<div class="head"><div><h1>成绩：${score} / ${qs.length}</h1><div class="meta">${Math.round(score / qs.length * 100)} 分 · 错题下面有解析${opts.back ? '' : ''}</div></div><div class="row">${Nav.crumb('review', '复习', 'btn')}</div></div>
        ${byNote.size > 1 ? `<div class="card pad"><b>按 topic 看</b><div class="mk-rows">${[...byNote.entries()].map(([k, b]) => `<div class="mk-row"><span class="grow">${esc(k)}</span><span class="sb-bar green mk-bar"><i style="width:${Math.round(b.ok / b.n * 100)}%"></i></span><span class="hint">${b.ok}/${b.n}</span></div>`).join('')}</div></div>` : ''}
        <div class="exam">${qs.map((q, i) => `<div class="card pad quiz"><div class="qq">${i + 1}. ${esc(q.q)}</div><div class="opts">${q.options.map((o, k) => `<div class="opt ${k === q.answer ? 'right' : k === ans[i] ? 'wrong' : ''}"><b>${L[k]}</b><span>${esc(o)}</span></div>`).join('')}</div>
          <div class="explain ${ans[i] === q.answer ? 'ok' : 'bad'}"><b>${ans[i] === q.answer ? '对' : ans[i] === null ? '没答' : '错'}</b> · ${esc(q.explain || '')} ${q.noteId ? `<a href="#note-${q.noteId}~points">（${esc(q.noteTitle)}）</a>` : ''}</div></div>`).join('')}</div>`;
      window.scrollTo(0, 0);
    };
    if (minutes) tick = setInterval(() => { const c = $('#ex-clock'); if (!c) { clearInterval(tick); return; } const left = Math.max(0, end - Date.now()); c.textContent = fmtTime(left / 1000); if (!left) submit(); }, 500);
    $('#ex-submit').onclick = () => { const blank = ans.filter(a => a === null).length; if (blank && !$('#ex-submit').dataset.armed) { $('#ex-submit').dataset.armed = 1; $('#ex-submit').textContent = `还有 ${blank} 题没答，再点交卷`; return; } submit(); };
  }

  return {
    vocab, vocabPage, gradeWord, dueItems, vstats, addWord, screenWord,
    diffFile, diffAuto,
    confusedList, todoToggle, TODO,
    gatherMarks, buildMarks,
    buildTopics,
    priority, week,
    wrongAdd, wrongList, wrongResolve, wrongHit,
    paperFor, pickWeighted, runPaper,
    packPrompt, DAY, weekStart,
  };
})();
