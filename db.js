/* 听课本 — 本地数据库（IndexedDB）。所有数据只存在这台设备的浏览器里。 */
const DB = (() => {
  const NAME = 'tingkeben';
  const VERSION = 1;
  const STORES = ['courses', 'files', 'notes', 'sessions', 'audio'];
  const SYNCED = ['courses', 'files', 'notes', 'sessions'];
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
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
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then(r => { result = r; });
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
      return tx(store, 'readwrite', s => req2p(s.delete(id)));
    },
    all: (store) => tx(store, 'readonly', s => req2p(s.getAll())),
    byIndex: (store, index, value) => tx(store, 'readonly', s => req2p(s.index(index).getAll(value))),
    async delByIndex(store, index, value) {
      const items = await this.byIndex(store, index, value);
      if (SYNCED.includes(store) && typeof Sync !== 'undefined') items.forEach(i => Sync.tomb(store, i.id));
      await tx(store, 'readwrite', s => { items.forEach(i => s.delete(i.id)); });
      return items.length;
    },
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
