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
  const ready = () => { const c = cfg(); return !!(c.acct && c.id && c.secret && c.bucket); };

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
  async function req(method, key, opts = {}) {
    const s = await signed(method, key, opts);
    let r;
    try { r = await fetch(s.url, { method, headers: s.headers, body: opts.body == null ? undefined : opts.body }); }
    catch (e) { throw new Error('连不上 R2。最常见的原因是存储桶的 CORS 没设好（看设置里的第 4 步），或者 Account ID 填错了。'); }
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

  let running = null, timer = null, lastErr = '';
  const listeners = new Set();
  const status = () => ({ ready: ready(), running: !!running, at: Number(localStorage.getItem(LAST) || 0), err: lastErr });
  const emit = () => listeners.forEach(fn => { try { fn(status()); } catch (e) {} });

  function schedule(ms = 15000) {
    if (!ready()) return;
    clearTimeout(timer); timer = setTimeout(() => syncNow({ silent: true }), ms);
  }

  async function syncNow({ silent = false, onProgress } = {}) {
    if (!ready()) { if (!silent) toast('先在设置里填好 Cloudflare R2'); return; }
    if (running) return running;
    running = (async () => {
      emit();
      const prog = t => { onProgress && onProgress(t); };
      try {
        const remote = (await getJSON('tingkeben/index.json')) || { v: 1, items: {} };
        const items = remote.items || {};
        const tb = tombs();
        let up = 0, down = 0, del = 0;
        for (const store of STORES) {
          const locals = await DB.all(store);
          const byId = new Map(locals.map(r => [r.id, r]));
          // 1. 本机比云端新 → 上传
          for (const r of locals) {
            const key = store + '/' + r.id, rm = items[key];
            if (rm && !rm.d && rm.u >= stamp(r)) continue;
            if (rm && rm.d && rm.u >= stamp(r)) continue; // 另一台设备删了，下面处理
            prog(`上传 ${store} ${++up}`);
            await putJSON(`tingkeben/db/${key}.json`, pack(store, r));
            items[key] = { u: stamp(r), b: store === 'files' ? !!(r.blob || (rm && rm.b)) : undefined };
            if (store === 'files' && r.blob && !(rm && rm.b)) {
              prog(`上传课件 ${r.name}`);
              await req('PUT', `tingkeben/blob/${r.id}`, { body: r.blob, headers: { 'content-type': r.type || 'application/octet-stream' } });
              items[key].b = true;
            }
          }
          // 2. 云端比本机新 → 下载；云端已删 → 本机也删
          for (const [key, rm] of Object.entries(items)) {
            if (!key.startsWith(store + '/')) continue;
            const id = key.slice(store.length + 1), loc = byId.get(id);
            if (rm.d) {
              if (loc && rm.u >= stamp(loc)) { await DB.del(store, id, { fromSync: true }); if (store === 'sessions') await DB.delByIndex('audio', 'sessionId', id); del++; }
              continue;
            }
            if (tb[key] && tb[key] >= rm.u) continue; // 本机删了，下面处理
            if (loc && stamp(loc) >= rm.u) continue;
            prog(`下载 ${store} ${++down}`);
            const r = await getJSON(`tingkeben/db/${key}.json`);
            if (!r) continue;
            if (store === 'files' && loc && loc.blob) r.blob = loc.blob; // 本机已有原文件就保留
            await DB.put(store, r, { fromSync: true });
          }
        }
        // 3. 本机删掉的 → 云端标记删除
        for (const [key, t] of Object.entries(tb)) {
          const rm = items[key];
          if (!rm || (!rm.d && t >= rm.u)) {
            if (rm) { await req('DELETE', `tingkeben/db/${key}.json`).catch(() => {}); if (rm.b) await req('DELETE', `tingkeben/blob/${key.split('/')[1]}`).catch(() => {}); }
            items[key] = { u: t, d: 1 };
          }
        }
        try { localStorage.setItem(TOMB, '{}'); } catch (e) {}
        remote.items = items; remote.at = Date.now();
        await putJSON('tingkeben/index.json', remote);
        try { localStorage.setItem(LAST, String(Date.now())); } catch (e) {}
        lastErr = '';
        if (down || del) { await loadCourses(); const h = location.hash.slice(1); if (!h.startsWith('desk-') && !State.live && !/~board/.test(h)) route(); }
        if (!silent) toast(`同步完成：上传 ${up}、下载 ${down}${del ? '、删除 ' + del : ''}`);
        return { up, down, del };
      } catch (e) {
        lastErr = e.message;
        if (!silent) toast(e.message, 7000);
        throw e;
      } finally { running = null; emit(); }
    })();
    return running.catch(() => null);
  }

  /* 课件原文件：本机没有就从 R2 拿（iPad 打开课件时才下载） */
  const fetching = new Map();
  async function ensureBlob(f) {
    if (f.blob) return f;
    if (!f.hasBlob || !ready()) return f;
    if (!fetching.has(f.id)) fetching.set(f.id, (async () => {
      toast('正在从云端下载 ' + f.name + ' …');
      const r = await req('GET', `tingkeben/blob/${f.id}`);
      const blob = await r.blob();
      const full = await DB.get('files', f.id) || f;
      full.blob = new Blob([blob], { type: f.type || blob.type });
      await DB.put('files', full, { fromSync: true });
      return full;
    })().finally(() => fetching.delete(f.id)));
    return fetching.get(f.id);
  }
  async function downloadAll(onProgress) {
    const files = (await DB.all('files')).filter(f => !f.blob && f.hasBlob);
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

  // 打开时同步一次；看得见时每 3 分钟一次；切到后台时把改动推上去
  let started = false;
  function start() {
    if (!ready() || started) return;
    started = true;
    setTimeout(() => syncNow({ silent: true }), 1500);
    setInterval(() => { if (document.visibilityState === 'visible') syncNow({ silent: true }); }, 180000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') syncNow({ silent: true }); else schedule(2000); });
  }

  const CORS = (origin) => JSON.stringify([{ AllowedOrigins: [origin, 'https://yuenkit122.github.io', 'http://localhost:8765'].filter((v, i, a) => a.indexOf(v) === i), AllowedMethods: ['GET', 'PUT', 'DELETE', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }], null, 2);

  return { syncNow, schedule, tomb, ready, status, listeners, ensureBlob, downloadAll, test, exportSettings, importSettings, start, CORS, signed, STORES };
})();
