/* 听课本 — 本地数据库（IndexedDB）。所有数据只存在这台设备的浏览器里。
   v2（2026-10-31）：课件原文件从 files 表搬到单独的 blobs 表。
   原因：files 表原来把整份 PDF 和学习记录塞在同一条里，任何一次「列出所有课件」
   都会把上百个 PDF 一起读进内存（这台机器上有 180 多个课件），同步和首页都会被拖死。 */
const DB = (() => {
  const NAME = 'tingkeben';
  const VERSION = 2;
  const STORES = ['courses', 'files', 'notes', 'sessions', 'audio', 'blobs'];
  const SYNCED = ['courses', 'files', 'notes', 'sessions'];
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = ev => {
        const db = req.result;
        if (!db.objectStoreNames.contains('courses')) db.createObjectStore('courses', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('files')) {
          const s = db.createObjectStore('files', { keyPath: 'id' });
          s.createIndex('courseId', 'courseId');
        }
        if (!db.objectStoreNames.contains('notes')) {
          const s = db.createObjectStore('notes', { keyPath: 'id' });
          s.createIndex('courseId', 'courseId');
        }
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('courseId', 'courseId');
        }
        if (!db.objectStoreNames.contains('audio')) {
          const s = db.createObjectStore('audio', { keyPath: 'id' });
          s.createIndex('sessionId', 'sessionId');
        }
        if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });

        // v1 → v2：把每条 files.blob 搬进 blobs，再从 files 里删掉（同一个事务，要么全成要么全不成）。
        // 一次最多搬 200MB：搬的过程原文件会短暂存在两份，iPad 存储紧张时可能不够，
        // 所以搬不完的就留在 files 里（DB.getBlob 仍然能读到），下次打开再接着搬。
        if (ev.oldVersion >= 1) {
          try {
            const files = req.transaction.objectStore('files');
            const blobs = req.transaction.objectStore('blobs');
            let moved = 0;
            const CAP = 200 * 1024 * 1024;
            files.openCursor().onsuccess = e => {
              const c = e.target.result;
              if (!c) return;
              const v = c.value;
              if (v && v.blob) {
                if (moved + (v.blob.size || 0) > CAP) { c.continue(); return; }
                moved += v.blob.size || 0;
                try { blobs.put({ id: v.id, blob: v.blob }); } catch (_) {}
                delete v.blob;
                v.hasBlob = true;
                c.update(v);
              }
              c.continue();
            };
          } catch (_) { /* 老库结构不对就跳过，原文件还能从云端重新下回来 */ }
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // 浏览器随时可能关掉这条连接（另一个标签页升级数据库、iPad 回收内存、清除存储）。
        // 关掉之后必须把缓存清掉重新开，否则之后每一次读写都在用一个死连接，
        // 报 "The database connection is closing"，整个 app 到刷新前都好不了。
        db.onversionchange = () => { try { db.close(); } catch (e) {} dbp = null; };
        try { db.onclose = () => { dbp = null; }; } catch (e) {}
        resolve(db);
      };
      req.onerror = () => { dbp = null; reject(req.error); };
      req.onblocked = () => {
        dbp = null;
        try { if (typeof toast === 'function') toast('听课本在另一个标签页里开着，先关掉那个页面再来', 8000); } catch (e) {}
        reject(new Error('数据库被另一个标签页占用，关掉其他听课本页面再刷新'));
      };
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    try {
      return await txOnce(store, mode, fn);
    } catch (e) {
      // 连接失效：重开一次再试，用户完全不用管
      const dead = e && (/closing|InvalidState|not open|被另一个标签页占用/i.test((e.name || '') + ' ' + (e.message || '')));
      if (dead) {
        dbp = null;
        await new Promise(r => setTimeout(r, 60));
        return await txOnce(store, mode, fn);
      }
      throw e;
    }
  }

  async function txOnce(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let t;
      try { t = db.transaction(store, mode); }
      catch (e) { dbp = null; reject(e); return; }
      const s = t.objectStore(store);
      let result;
      // 请求失败时必须显式 reject：原来只写了 .then，失败时会留下没人处理的 rejection
      Promise.resolve(fn(s)).then(r => { result = r; }, err => reject(err));
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  return {
    STORES,
    // 课程/课件/笔记/录音改动时记下时间，云同步按这个判断哪边新
    put(store, obj, opts) {
      if (SYNCED.includes(store) && !(opts && opts.fromSync)) { obj.updatedAt = Date.now(); typeof Sync !== 'undefined' && Sync.schedule(); }
      return tx(store, 'readwrite', s => req2p(s.put(obj)));
    },
    get: (store, id) => tx(store, 'readonly', s => req2p(s.get(id))),
    del(store, id, opts) {
      if (SYNCED.includes(store) && !(opts && opts.fromSync) && typeof Sync !== 'undefined') Sync.tomb(store, id);
      const p = tx(store, 'readwrite', s => req2p(s.delete(id)));
      return store === 'files' ? p.then(() => this.delBlob(id).catch(() => {})) : p;
    },
    all: (store) => tx(store, 'readonly', s => req2p(s.getAll())),
    byIndex: (store, index, value) => tx(store, 'readonly', s => req2p(s.index(index).getAll(value))),
    async delByIndex(store, index, value) {
      const items = await this.byIndex(store, index, value);
      if (SYNCED.includes(store) && typeof Sync !== 'undefined') items.forEach(i => Sync.tomb(store, i.id));
      await tx(store, 'readwrite', s => { items.forEach(i => s.delete(i.id)); });
      if (store === 'files') for (const i of items) await this.delBlob(i.id).catch(() => {});
      return items.length;
    },
    /* ---- 课件原文件（单独一张表，列课件时不会把它们读进内存） ---- */
    getBlob: id => tx('blobs', 'readonly', s => req2p(s.get(id)))
      .then(r => (r && r.blob) || null)
      .then(b => b || tx('files', 'readonly', s => req2p(s.get(id))).then(f => (f && f.blob) || null)), // 还没搬过来的老数据
    putBlob(id, blob) { return tx('blobs', 'readwrite', s => req2p(s.put({ id, blob }))); },
    delBlob: id => tx('blobs', 'readwrite', s => req2p(s.delete(id))),
    blobIds: () => tx('blobs', 'readonly', s => req2p(s.getAllKeys())).then(ks => new Set(ks || [])),
    uid: (p = '') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
  };
})();

/* 设置（API key 等）只存在本机 localStorage */
const Settings = (() => {
  const KEY = 'tingkeben.settings';
  const defaults = {
    geminiKey: '',
    deepseekKey: '',
    deepseekModel: 'deepseek-flash',
    deepseekThinking: true,
    geminiFastModel: 'gemini-3.1-flash-lite',
    geminiSmartModel: 'gemini-3.8-flash',
    liveModel: 'gemini-3.5-transcribe-live',
    liveLanguage: 'en-GB',
    liveMode: 'SMART',
    saveAudio: true,
    translateGap: 6000,
    translateProvider: 'pool',
    groqKey: '', groqModel: 'qwen/qwen3.8-27b', groqModel2: 'openai/gpt-oss-120b',
    cerebrasKey: '', cerebrasModel: 'llama-3.3-70b',
    mistralKey: '', mistralModel: 'mistral-small-latest',
    poolOff: {},
    poolFallback: 'deepseek',
    draftMode: 'free',
    maxWaitSec: 6,
    translatePace: 'balanced',
    autoStudy: false,
    micId: '',
    r2Account: '', r2KeyId: '', r2Secret: '', r2Bucket: 'tingkeben',
    cloudUrl: '', cloudToken: '',
    captionView: 'both',
    captionSize: 20,
  };
  let cache = null;
  function load() {
    if (cache) return cache;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
    cache = Object.assign({}, defaults, saved);
    // 旧版存下的默认值换成新的（3.5 Flash-Lite 免费版实测有时要 20 多秒）
    if (!cache.migrated2) {
      if (cache.geminiFastModel === 'gemini-3.5-flash-lite') cache.geminiFastModel = 'gemini-3.1-flash-lite';
      if (cache.translateProvider === 'gemini') cache.translateProvider = 'pool';
      cache.migrated2 = true;
    }
    // 生成笔记不再默认连带出重点和测验（用户要求，省算力）
    if (!cache.migrated4) { cache.autoStudy = false; cache.migrated4 = true; try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) {} }
    if (!cache.migrated3) {
      if (cache.groqModel === 'llama-3.3-70b-versatile') cache.groqModel = 'qwen/qwen3.8-27b';
      cache.migrated3 = true;
      try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) {}
    }
    return cache;
  }
  function save(patch) {
    cache = Object.assign(load(), patch);
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* 存不了就只留在内存 */ }
    if (typeof Sync !== 'undefined') Sync.onSettings(patch);
    return cache;
  }
  return { load, save, defaults };
})();
