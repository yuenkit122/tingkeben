/* 听课本 — 云同步（Cloudflare R2，浏览器直接连，不经过任何服务器）
   - 课程、课件文字、笔记（含画板手写、重点、聊天）、录音转写：自动同步，最后改的那台设备为准
   - 课件原文件（PDF/PPT）：上传一次；另一台设备打开时才下载，省 iPad 空间
   - 录音音频不同步（太大）
   - R2 的 key 只存在本机浏览器里 */
const Sync = (() => {
  const STORES = ['courses', 'files', 'notes', 'sessions'];
  const TOMB = 'tingkeben.tomb', LAST = 'tingkeben.syncAt';
  const enc = new TextEncoder();
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const sha = async d => hex(await crypto.subtle.digest('SHA-256', typeof d === 'string' ? enc.encode(d) : d));
  const hmac = async (k, m) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', typeof k === 'string' ? enc.encode(k) : k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(m));
  const uri = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

  function cfg() {
    const s = Settings.load();
    return { acct: (s.r2Account || '').trim(), id: (s.r2KeyId || '').trim(), secret: (s.r2Secret || '').trim(), bucket: (s.r2Bucket || '').trim() };
  }
  // 两种连法：① 听课本云服务（Worker，只要密码）② 直接连 R2（要 key，高级）
  const cloud = () => { const s = Settings.load(); return s.cloudUrl && s.cloudToken ? { url: s.cloudUrl.replace(/\/+$/, ''), token: s.cloudToken } : null; };
  const direct = () => { const c = cfg(); return !!(c.acct && c.id && c.secret && c.bucket); };
  const ready = () => !!cloud() || direct();
  const mode = () => cloud() ? 'cloud' : direct() ? 'r2' : '';

  /* AWS Signature V4（R2 兼容 S3），用浏览器自带的 WebCrypto 算 */
  async function signed(method, key, { body = null, query = {}, headers = {}, now = new Date() } = {}) {
    const c = cfg();
    const host = `${c.acct}.r2.cloudflarestorage.com`;
    const path = '/' + c.bucket + (key ? '/' + key.split('/').map(uri).join('/') : '');
    const amz = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const day = amz.slice(0, 8);
    const payload = body == null ? await sha('') : await sha(body instanceof Blob ? await body.arrayBuffer() : body);
    const qs = Object.keys(query).sort().map(k => `${uri(k)}=${uri(query[k])}`).join('&');
    const h = Object.assign({ host, 'x-amz-content-sha256': payload, 'x-amz-date': amz }, Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])));
    const names = Object.keys(h).sort();
    const canon = [method, path, qs, names.map(n => `${n}:${h[n]}\n`).join(''), names.join(';'), payload].join('\n');
    const scope = `${day}/auto/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amz, scope, await sha(canon)].join('\n');
    let k = await hmac('AWS4' + c.secret, day); k = await hmac(k, 'auto'); k = await hmac(k, 's3'); k = await hmac(k, 'aws4_request');
    const sig = hex(await hmac(k, toSign));
    delete h.host;
    h.authorization = `AWS4-HMAC-SHA256 Credential=${c.id}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}`;
    return { url: `https://${host}${path}${qs ? '?' + qs : ''}`, headers: h, canon, sig };
  }
  /* 每个请求都带超时：教室 WiFi 很差，没有超时的话一次卡住的请求会让整场同步
     永久挂住（running 一直不清空，之后所有自动同步都静默失效）。 */
  function timed(signal, ms) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), ms);
    const ab = () => ac.abort();
    if (signal) signal.addEventListener('abort', ab, { once: true });
    return { signal: ac.signal, done() { clearTimeout(to); if (signal) signal.removeEventListener('abort', ab); } };
  }
  const TIMEOUT_JSON = 30000, TIMEOUT_BIG = 180000;
  async function req(method, key, opts = {}) {
    const big = opts.body && typeof opts.body !== 'string' && (opts.body.size || 0) > 2e6;
    const t = timed(opts.signal, opts.timeout || (big ? TIMEOUT_BIG : TIMEOUT_JSON));
    try { return await req2(method, key, opts, t.signal); }
    catch (e) {
      if (e && e.name === 'AbortError') throw new Error('网络太慢，这次请求超时了（' + key + '）');
      throw e;
    } finally { t.done(); }
  }
  async function req2(method, key, opts = {}, signal) {
    const c = cloud();
    if (c) {
      let r;
      const headers = { Authorization: 'Bearer ' + c.token };
      const ct = opts.headers && (opts.headers['content-type'] || opts.headers['Content-Type']); if (ct) headers['Content-Type'] = ct;
      try { r = await fetch(c.url + '/r2/' + key.split('/').map(encodeURIComponent).join('/'), { method, headers, body: opts.body == null ? undefined : opts.body, signal }); }
      catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('连不上听课本云服务，检查网络。'); }
      if (r.status === 404 && opts.allow404) return null;
      if (r.status === 401) { Settings.save({ cloudToken: '' }); emit(); throw new Error('云端登录过期了，到「设置 → 云服务」重新输入密码'); }
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error('云服务出错：' + (j.error || r.status)); }
      return r;
    }
    const s = await signed(method, key, opts);
    let r;
    try { r = await fetch(s.url, { method, headers: s.headers, body: opts.body == null ? undefined : opts.body, signal }); }
    catch (e) { if (e && e.name === 'AbortError') throw e; throw new Error('连不上 R2。最常见的原因是存储桶的 CORS 没设好（看设置里的第 4 步），或者 Account ID 填错了。'); }
    if (r.status === 404 && opts.allow404) return null;
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      const code = (t.match(/<Code>([^<]+)/) || [])[1] || r.status;
      const hint = { SignatureDoesNotMatch: 'Secret Access Key 不对', InvalidAccessKeyId: 'Access Key ID 不对', NoSuchBucket: '存储桶名字不对', AccessDenied: '这个 API 令牌没有这个存储桶的「读写」权限' }[code] || '';
      throw new Error(`R2 返回 ${code}${hint ? '：' + hint : ''}`);
    }
    return r;
  }
  const getJSON = async key => { const r = await req('GET', key, { allow404: true }); return r ? r.json() : null; };
  const putJSON = (key, obj) => req('PUT', key, { body: JSON.stringify(obj), headers: { 'content-type': 'application/json' } });

  const TOMB_TTL = 60 * 864e5; // 云端墓碑留 60 天，之后清掉，索引才不会被越撑越大

  /* 冲突副本（借鉴 BBNotes 的 ConflictCopyJournal）
     两边都在上次同步之后改过同一条记录时，原来的规则是「谁的 updatedAt 大谁活」——另一边的
     改动就无声无息地没了。用户会觉得「我的笔记在两台设备之间消失」。现在改成：照旧采用较新
     的那份，但把被顶掉的那份存成一条「（冲突副本）」，由用户自己决定要不要合并。
     只对 课程/笔记/录音转写 做；课件是从 Moodle 重新导入的，复制一份反而添乱。 */
  const CONFLICT_OK = ['courses', 'notes', 'sessions'];
  const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
    : v && typeof v === 'object' ? '{' + Object.keys(v).sort().filter(k => k !== 'updatedAt' && k !== 'playAt').map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
    : JSON.stringify(v);
  function conflictCopy(store, loc, rem) {
    if (!CONFLICT_OK.includes(store)) return false;
    if (!loc || !loc.id) return false;
    if (stable(loc) === stable(rem)) return false;
    const label = loc.title || loc.name || '未命名';
    const dup = Object.assign({}, loc, {
      id: loc.id + '-c' + Date.now().toString(36).slice(-5),
      title: loc.title ? label + '（冲突副本）' : loc.title,
      name: loc.name ? label + '（冲突副本）' : loc.name,
      createdAt: Date.now(),
    });
    delete dup.updatedAt;
    if (store === 'sessions') dup.hasAudio = false; // 音频还挂在原来那条上，副本只留文字
    return dup;
  }

  /* 写云端索引前，重新读一次再合并。原来是把开始时读到的那份索引整份写回去，
     另一台设备在这期间上传的记录就会被覆盖掉（表现：某条笔记在两台设备上「消失」）。 */
  async function mergeIndex(mine) {
    let fresh = null;
    try { fresh = await getJSON('tingkeben/index.json'); } catch (e) { fresh = null; }
    if (!fresh || !fresh.items) return mine;
    const out = Object.assign({}, fresh.items);
    for (const [k, v] of Object.entries(mine)) {
      const o = out[k];
      if (!o) { out[k] = v; continue; }
      if ((v.u || 0) > (o.u || 0)) out[k] = v;
      else if ((v.u || 0) === (o.u || 0)) {
        const m = Object.assign({}, o, v);
        if (o.b || v.b) m.b = true; else delete m.b;
        out[k] = m;
      }
    }
    return out;
  }

  /* 本机删除记录（墓碑），同步时告诉另一台设备也删 */
  const tombs = () => { try { return JSON.parse(localStorage.getItem(TOMB) || '{}'); } catch (e) { return {}; } };
  function tomb(store, id) { if (!STORES.includes(store)) return; const t = tombs(); t[store + '/' + id] = Date.now(); try { localStorage.setItem(TOMB, JSON.stringify(t)); } catch (e) {} schedule(); }
  const stamp = r => r.updatedAt || r.createdAt || r.addedAt || r.startedAt || 1;

  /* 上传前去掉不同步的大字段 */
  function pack(store, r) {
    if (store !== 'files') return r;
    const { blob, ...rest } = r;
    return Object.assign(rest, { hasBlob: !!blob || !!r.hasBlob });
  }

  let running = null, timer = null, lastErr = '', nextAt = 0, retryN = 0, pending = 0, lastResult = null, counts = null, remoteItems = null;
  let prog = null; // 正在同步时：{ done, total, label, bytesDone, bytesTotal }
  const listeners = new Set();
  const AUTO = 'tingkeben.autoSync';
  const auto = () => localStorage.getItem(AUTO) !== '0';
  function setAuto(on) { try { localStorage.setItem(AUTO, on ? '1' : '0'); } catch (e) {} if (on) schedule(1000); else { clearTimeout(timer); nextAt = 0; } emit(); }
  const status = () => ({ ready: ready(), mode: mode(), running: !!running, at: Number(localStorage.getItem(LAST) || 0), err: lastErr, auto: auto(), nextAt, pending, counts, prog, lastResult, online: navigator.onLine !== false });
  const emit = () => listeners.forEach(fn => { try { fn(status()); } catch (e) {} });

  /* 每类数据：一共几条、已同步几条、没同步几条（要上传 / 要下载）
     有云端索引时按索引精确比较；还没拿到索引时按「上次同步之后改过的」估算 */
  let countTimer = null;
  function recount() {
    clearTimeout(countTimer);
    countTimer = setTimeout(async () => {
      const last = Number(localStorage.getItem(LAST) || 0), tb = tombs(), items = remoteItems;
      const by = {}, sum = { total: 0, synced: 0, up: 0, down: 0, del: 0, blobs: 0, blobsLocal: 0, blobsCloud: 0 };
      const haveBlobs = await DB.blobIds();
      for (const st of STORES) {
        if (st === 'blobs') continue;
        const locals = await DB.all(st), ids = new Set(locals.map(r => r.id));
        const c = { total: 0, synced: 0, up: 0, down: 0 };
        for (const r of locals) {
          const rm = items && items[st + '/' + r.id];
          const needUp = items ? (!rm || rm.u < stamp(r)) : stamp(r) > last;
          const needDown = !!(items && rm && !rm.d && rm.u > stamp(r));
          c.total++; if (needUp) c.up++; else if (needDown) c.down++; else c.synced++;
          if (st === 'files') { sum.blobs++; if (haveBlobs.has(r.id)) sum.blobsLocal++; if (rm && rm.b) sum.blobsCloud++; }
        }
        if (items) for (const [key, rm] of Object.entries(items)) {
          if (!key.startsWith(st + '/') || rm.d) continue;
          const id = key.slice(st.length + 1);
          if (!ids.has(id) && !tb[key]) { c.total++; c.down++; }
        }
        by[st] = c; sum.total += c.total; sum.synced += c.synced; sum.up += c.up; sum.down += c.down;
      }
      sum.del = Object.keys(tb).length;
      counts = { by, ...sum, exact: !!items };
      pending = sum.up + sum.del;
      emit();
    }, 250);
  }
  // 打开同步面板时看一眼云端索引（只读一个小文件），「要下载几条」才准
  async function peek() {
    if (!ready() || running) return;
    try { const r = await getJSON('tingkeben/index.json'); remoteItems = (r && r.items) || {}; recount(); } catch (e) {}
  }

  function schedule(ms = 2000) {
    recount();
    if (!ready() || !auto()) return;
    clearTimeout(timer); nextAt = Date.now() + ms; emit();
    timer = setTimeout(() => { nextAt = 0; syncNow({ silent: true, auto: true }); }, ms);
  }

  const size = v => v == null ? 0 : v instanceof Blob ? v.size : typeof v === 'string' ? v.length : 0;

  async function syncNow({ silent = false, onProgress, auto: isAuto = false } = {}) {
    if (!ready()) { if (!silent) toast('先在「设置 → 云服务」登录'); return; }
    if (running) return running;
    if (navigator.onLine === false) { lastErr = '没有网络，联网后会自动同步'; emit(); return; }
    clearTimeout(timer); nextAt = 0;
    running = (async () => {
      const t0 = Date.now();
      const lastSync = Number(localStorage.getItem(LAST) || 0);
      prog = { done: 0, total: 0, label: '检查云端…', bytesDone: 0, bytesTotal: 0 }; emit();
      const tick = (label, bytes = 0) => { prog.done++; prog.label = label; prog.bytesDone += bytes; onProgress && onProgress(`${prog.done} / ${prog.total} · ${label}`); emit(); };
      try {
        if (cloud()) await pullVault().catch(() => {});
        const remote = (await getJSON('tingkeben/index.json')) || { v: 1, items: {} };
        const items = remote.items || {};
        const tb = tombs();

        // ① 先列出要做的事，才知道总共多少、进度条才准
        const ops = [];
        for (const store of STORES) {
          const locals = await DB.all(store);
          const byId = new Map(locals.map(r => [r.id, r]));
          for (const r of locals) {
            const key = store + '/' + r.id, rm = items[key];
            if (rm && rm.u >= stamp(r)) continue;
            ops.push({ kind: 'up', store, key, r, rm });
            if (store === 'files' && r.hasBlob && !(rm && rm.b)) ops.push({ kind: 'blob', store, key, r, bytes: r.size || 0 });
          }
          for (const [key, rm] of Object.entries(items)) {
            if (!key.startsWith(store + '/')) continue;
            const id = key.slice(store.length + 1), loc = byId.get(id);
            if (rm.d) { if (loc && rm.u >= stamp(loc)) ops.push({ kind: 'delLocal', store, key, id }); continue; }
            if (tb[key] && tb[key] >= rm.u) continue;
            if (loc && stamp(loc) >= rm.u) continue;
            ops.push({ kind: 'down', store, key, loc });
          }
        }
        for (const [key, t] of Object.entries(tb)) { const rm = items[key]; if (!rm || (!rm.d && t >= rm.u)) ops.push({ kind: 'delRemote', key, t, rm }); }
        prog.total = ops.length; prog.bytesTotal = ops.reduce((a, o) => a + (o.bytes || 0), 0);
        prog.label = ops.length ? '开始同步' : '已经是最新'; emit();

        // ② 同时做 6 条；任何一条失败都只影响它自己，不会拖垮整场同步
        const NAMES = { courses: '课程', files: '课件', notes: '笔记', sessions: '录音转写' };
        const nameOf = (store, r) => (r && (r.name || r.title)) || NAMES[store];
        let up = 0, down = 0, del = 0;
        const failed = [];

        async function doOp(o) {
          if (o.kind === 'up') {
            await putJSON(`tingkeben/db/${o.key}.json`, pack(o.store, o.r));
            items[o.key] = { u: stamp(o.r), b: o.store === 'files' ? !!(o.rm && o.rm.b) : undefined };
            up++; tick(`上传${NAMES[o.store]} · ${nameOf(o.store, o.r)}`);
          } else if (o.kind === 'blob') {
            const blob = await DB.getBlob(o.r.id);
            if (!blob) return; // 这台设备只同步过文字，原文件在另一台设备上，等它传
            await req('PUT', `tingkeben/blob/${o.r.id}`, { body: blob, headers: { 'content-type': o.r.type || 'application/octet-stream' } });
            // 并行时「上传课件」这条可能还没跑完，索引条目要自己兜底
            items[o.key] = Object.assign({ u: stamp(o.r) }, items[o.key] || {}, { b: true });
            tick(`上传课件原文件 · ${o.r.name}`, o.bytes);
          } else if (o.kind === 'down') {
            const r = await getJSON(`tingkeben/db/${o.key}.json`);
            if (r) {
              // 两边都动过同一条：先把本机这份另存为冲突副本，再采用云端的
              if (o.loc && lastSync && stamp(o.loc) > lastSync && stamp(r) > lastSync) {
                try {
                  const dup = conflictCopy(o.store, o.loc, r);
                  if (dup) { await DB.put(o.store, dup); up++; }
                } catch (e) { /* 副本没存下来不影响主流程 */ }
              }
              await DB.put(o.store, r, { fromSync: true }); down++;
            }
            tick(`下载${NAMES[o.store]} · ${nameOf(o.store, r)}`);
          } else if (o.kind === 'delLocal') {
            await DB.del(o.store, o.id, { fromSync: true }); if (o.store === 'sessions') await DB.delByIndex('audio', 'sessionId', o.id); del++;
            tick(`删除${NAMES[o.store]}（另一台设备删的）`);
          } else if (o.kind === 'delRemote') {
            // 不再吞错误：删不掉的墓碑要留着，否则下次会「删掉的笔记又回来了」
            if (o.rm) {
              await req('DELETE', `tingkeben/db/${o.key}.json`);
              if (o.rm.b) await req('DELETE', `tingkeben/blob/${o.key.split('/')[1]}`).catch(() => {});
            }
            items[o.key] = { u: o.t, d: 1 };
            del++;
            tick('删除云端的旧数据');
          }
        }

        const LIMIT = 6;
        const queue = ops.slice();
        let qi = 0;
        await Promise.all(Array.from({ length: Math.min(LIMIT, queue.length) }, async () => {
          while (qi < queue.length) {
            const o = queue[qi++];
            try { await doOp(o); }
            catch (e) {
              failed.push({ kind: o.kind, key: o.key, msg: (e && e.message) || String(e) });
              tick('跳过 ' + (nameOf(o.store, o.r || o.loc) || o.key), 0);
            }
          }
        }));

        // 只清掉成功的墓碑；失败的下次接着删
        const tbLeft = {};
        for (const f of failed) if (f.kind === 'delRemote') tbLeft[f.key] = tombs()[f.key] || Date.now();
        try { localStorage.setItem(TOMB, JSON.stringify(tbLeft)); } catch (e) {}

        // 写索引前重新读一次云端再合并：两台设备同时同步时不互相覆盖
        let nextItems = items;
        if (ops.length) {
          nextItems = await mergeIndex(items);
          for (const [k, v] of Object.entries(nextItems)) if (v.d && Date.now() - (v.u || 0) > TOMB_TTL) delete nextItems[k];
          remote.items = nextItems; remote.at = Date.now();
          try { await putJSON('tingkeben/index.json', remote); }
          catch (e) { await new Promise(r => setTimeout(r, 800)); await putJSON('tingkeben/index.json', remote); }
        }
        remoteItems = nextItems;
        try { localStorage.setItem(LAST, String(t0)); } catch (e) {}
        retryN = 0; lastResult = { up, down, del, failed: failed.length, at: Date.now() };
        if (failed.length) {
          // 大部分都成功了，只是几条没过去：不当作整体失败，只排队重试那几条
          lastErr = `${failed.length} 条没同步成功（${failed[0].msg}），会自动重试`;
          if (!silent) toast(`同步完成：成功 ${up + down + del} 条，${failed.length} 条失败，稍后自动重试`, 6000);
          schedule(20000);
        } else {
          lastErr = '';
          if (!silent) toast(ops.length ? `同步完成：上传 ${up}、下载 ${down}${del ? '、删除 ' + del : ''}` : '已经是最新，不用同步');
        }
        // 刷新界面只是「顺手做的事」，它出错了不能算同步失败
        if (down || del) {
          try {
            await loadCourses();
            const h = location.hash.slice(1);
            if (!h.startsWith('desk-') && !State.live && !/~board/.test(h)) route();
          } catch (e) { console.warn('[sync] 界面刷新失败，不影响数据', e); }
        }
        return { up, down, del, failed: failed.length };
      } catch (e) {
        lastErr = e.message;
        if (!silent) toast(e.message, 7000);
        // 出错自动重试：30 秒、1 分钟、2 分钟、5 分钟…
        if (auto() && !/登录过期/.test(e.message)) { const wait = [30, 60, 120, 300, 600][Math.min(retryN++, 4)] * 1000; clearTimeout(timer); nextAt = Date.now() + wait; timer = setTimeout(() => { nextAt = 0; syncNow({ silent: true, auto: true }); }, wait); }
        throw e;
      } finally {
        running = null; prog = null; recount(); emit();
        if (!lastErr) for (const st of STORES) { if ((await DB.all(st)).some(r => stamp(r) > t0)) { schedule(3000); break; } }
      }
    })();
    return running.catch(() => null);
  }

  /* 课件原文件：本机没有就从 R2 拿（iPad 打开课件时才下载） */
  const fetching = new Map();
  async function ensureBlob(f) {
    if (await DB.getBlob(f.id)) return f;
    if (!f.hasBlob || !ready()) return f;
    if (!fetching.has(f.id)) fetching.set(f.id, (async () => {
      toast('正在从云端下载 ' + f.name + ' …');
      const r = await req('GET', `tingkeben/blob/${f.id}`);
      const blob = await r.blob();
      await DB.putBlob(f.id, new Blob([blob], { type: f.type || blob.type }));
      return f;
    })().finally(() => fetching.delete(f.id)));
    return fetching.get(f.id);
  }
  async function downloadAll(onProgress) {
    const have = await DB.blobIds();
    const files = (await DB.all('files')).filter(f => f.hasBlob && !have.has(f.id));
    let i = 0;
    for (const f of files) { onProgress && onProgress(`${++i} / ${files.length} · ${f.name}`); await ensureBlob(f); }
    return files.length;
  }
  async function test() {
    await req('PUT', 'tingkeben/.ping', { body: String(Date.now()), headers: { 'content-type': 'text/plain' } });
    await req('GET', 'tingkeben/.ping');
    return true;
  }

  /* 两台设备之间搬设置（API key 等），通过剪贴板 / 隔空投送 */
  const MOVE_KEYS = ['geminiKey', 'deepseekKey', 'groqKey', 'cerebrasKey', 'mistralKey', 'r2Account', 'r2KeyId', 'r2Secret', 'r2Bucket', 'deepseekModel', 'groqModel', 'groqModel2', 'liveLanguage', 'translatePace', 'draftMode'];
  function exportSettings() { const s = Settings.load(); const o = {}; MOVE_KEYS.forEach(k => { if (s[k]) o[k] = s[k]; }); return 'TKB1:' + btoa(unescape(encodeURIComponent(JSON.stringify(o)))); }
  function importSettings(code) {
    const t = String(code).trim().replace(/^TKB1:/, '');
    const o = JSON.parse(decodeURIComponent(escape(atob(t))));
    const patch = {}; MOVE_KEYS.forEach(k => { if (o[k]) patch[k] = o[k]; });
    Settings.save(patch); return Object.keys(patch).length;
  }

  /* ---------- 听课本云服务：密码登录 + 云端保管 API key ---------- */
  const VAULT_KEYS = ['geminiKey', 'deepseekKey', 'groqKey', 'cerebrasKey', 'mistralKey', 'deepseekModel', 'groqModel', 'groqModel2', 'liveLanguage', 'liveMode', 'translatePace', 'draftMode', 'translateProvider', 'poolFallback', 'maxWaitSec', 'dsPriceIn', 'dsPriceHit', 'dsPriceOut'];
  async function login(url, password) {
    url = String(url || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\//.test(url) && !/^http:\/\/localhost/.test(url)) throw new Error('云服务网址要以 https:// 开头');
    let r;
    try { r = await fetch(url + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); }
    catch (e) { throw new Error('连不上这个网址。检查网址有没有抄错，Worker 有没有部署。'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('登录失败 ' + r.status));
    Settings.save({ cloudUrl: url, cloudToken: j.token });
    // 云端有保管的 key 就拿下来；没有就把本机的存上去
    const v = await getJSON('tingkeben/vault.json');
    if (v && v.settings) { const patch = {}; VAULT_KEYS.forEach(k => { if (v.settings[k] !== undefined && v.settings[k] !== '') patch[k] = v.settings[k]; }); vaultMute = true; Settings.save(patch); vaultMute = false; }
    else await pushVault();
    emit(); started = false; start(); syncNow({ silent: true });
    return { pulled: !!(v && v.settings) };
  }
  function logout(clearKeys) {
    const patch = { cloudToken: '' };
    if (clearKeys) VAULT_KEYS.forEach(k => { if (/Key$/.test(k)) patch[k] = ''; });
    Settings.save(patch); started = false; emit();
  }
  let vaultMute = false, vaultTimer = null;
  async function pushVault() {
    if (!cloud()) return;
    const s = Settings.load(), o = {}; VAULT_KEYS.forEach(k => { if (s[k] !== undefined) o[k] = s[k]; });
    await putJSON('tingkeben/vault.json', { at: Date.now(), settings: o });
  }
  // 设置里改了 key → 过几秒自动存到云端，别的设备下次登录 / 同步时拿到
  function onSettings(patch) {
    if (vaultMute || !cloud() || !Object.keys(patch || {}).some(k => VAULT_KEYS.includes(k))) return;
    clearTimeout(vaultTimer); vaultTimer = setTimeout(() => pushVault().catch(() => {}), 3000);
  }
  async function pullVault() {
    if (!cloud()) return;
    const v = await getJSON('tingkeben/vault.json');
    if (!v || !v.settings) return;
    const s = Settings.load(), patch = {};
    VAULT_KEYS.forEach(k => { if (v.settings[k] !== undefined && v.settings[k] !== '' && v.settings[k] !== s[k]) patch[k] = v.settings[k]; });
    if (Object.keys(patch).length) { vaultMute = true; Settings.save(patch); vaultMute = false; }
  }

  // 自动同步：打开时一次；看得见时每 30 秒一次；改了东西 2 秒后；切到后台时推一次；断网恢复后马上补
  let started = false;
  function start() {
    recount();
    if (!ready() || started) return;
    started = true;
    const go = () => auto() && syncNow({ silent: true, auto: true });
    setTimeout(go, 1500);
    setInterval(() => { if (document.visibilityState === 'visible' && !running) go(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') go(); else schedule(2000); });
    window.addEventListener('online', () => { lastErr = ''; schedule(1000); });
    window.addEventListener('offline', () => { lastErr = '没有网络，联网后会自动同步'; emit(); });
  }

  const CORS = (origin) => JSON.stringify([{ AllowedOrigins: [origin, 'https://yuenkit122.github.io', 'http://localhost:8765'].filter((v, i, a) => a.indexOf(v) === i), AllowedMethods: ['GET', 'PUT', 'DELETE', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }], null, 2);

  return { auto, setAuto, recount, peek, login, logout, onSettings, pushVault, mode, syncNow, schedule, tomb, ready, status, listeners, ensureBlob, downloadAll, test, exportSettings, importSettings, start, CORS, signed, STORES };
})();
