/* 听课本 — 本地数据库（IndexedDB）。所有数据只存在这台设备的浏览器里。 */
const DB = (() => {
  const NAME = 'tingkeben';
  const VERSION = 1;
  const STORES = ['courses', 'files', 'notes', 'sessions', 'audio'];
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
    put: (store, obj) => tx(store, 'readwrite', s => req2p(s.put(obj))),
    get: (store, id) => tx(store, 'readonly', s => req2p(s.get(id))),
    del: (store, id) => tx(store, 'readwrite', s => req2p(s.delete(id))),
    all: (store) => tx(store, 'readonly', s => req2p(s.getAll())),
    byIndex: (store, index, value) => tx(store, 'readonly', s => req2p(s.index(index).getAll(value))),
    async delByIndex(store, index, value) {
      const items = await this.byIndex(store, index, value);
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
    geminiFastModel: 'gemini-3.5-flash-lite',
    geminiSmartModel: 'gemini-3.8-flash',
    liveModel: 'gemini-3.5-transcribe-live',
    liveLanguage: 'en-GB',
    liveMode: 'SMART',
    saveAudio: true,
    translateGap: 6000,
    captionView: 'both',
    captionSize: 20,
  };
  let cache = null;
  function load() {
    if (cache) return cache;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { saved = {}; }
    cache = Object.assign({}, defaults, saved);
    return cache;
  }
  function save(patch) {
    cache = Object.assign(load(), patch);
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* 存不了就只留在内存 */ }
    return cache;
  }
  return { load, save, defaults };
})();
