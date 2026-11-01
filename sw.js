/* 听课本 — 离线缓存（Service Worker）
   作用：断网、或者教室 WiFi 很差的时候，页面也能打开，本地数据照常看。
   发布新版本时：把下面的 V 和 index.html 里所有 ?v= 改成同一个新数字。
   （就算忘了改这里，只要你改了 index.html 的 ?v=，也不会读到旧文件。） */

const V = '11011019';
const CACHE = 'tkb-' + V;

const BASE = self.location.href.replace(/sw\.js.*$/, '');
const abs = p => new URL(p, BASE).href;
const withV = p => abs(p) + '?v=' + V;

// 版本号带在 URL 上：换了 ?v= 就自然绕过旧缓存，不用依赖这里同步。
const SHELL = [
  abs(''), abs('index.html'),
  withV('styles.css'), withV('device.js'), withV('db.js'), withV('sync.js'),
  withV('extract.js'), withV('ai.js'), withV('live.js'), withV('study.js'), withV('schedule.js'), withV('app.js'),
  abs('manifest.webmanifest'),
  abs('icon-180.png'), abs('icon-192.png'), abs('icon-512.png'),
];

// 外部库也缓存一份，否则断网时 pdf.js / marked 拿不到，页面直接白屏。
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js',
];

function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>听课本 · 离线</title>' +
    '<div style="font-family:-apple-system,system-ui,sans-serif;max-width:380px;margin:22vh auto;padding:0 24px;text-align:center;color:#2C47A5">' +
    '<h2 style="margin:0 0 10px">现在没有网络</h2>' +
    '<p style="color:#666;line-height:1.7;font-size:15px">听课本还没把页面缓存下来（或者缓存被系统清掉了）。<br>连上网打开一次就好，之后断网也能用。</p>' +
    '<a href="./index.html" style="display:inline-block;margin-top:14px;padding:10px 22px;border-radius:999px;background:#2C47A5;color:#fff;text-decoration:none">重试</a>' +
    '</div>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 一个失败不影响其他（比如某个 CDN 暂时抽风）
    await Promise.all([...SHELL, ...CDN].map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('tkb-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
  if (u.pathname.endsWith('/sw.js')) return;

  // 页面本身：先联网（保证一打开就是最新版），断网才回落到缓存
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        const c = await caches.open(CACHE);
        c.put(abs('index.html'), r.clone()).catch(() => {});
        return r;
      } catch (err) {
        const c = await caches.open(CACHE);
        return (await c.match(req, { ignoreSearch: true })) || (await c.match(abs('index.html'))) || (await c.match(abs(''))) || offlinePage();
      }
    })());
    return;
  }

  // 其它资源：同源的先联网（保证代码永远是新的），断网才用缓存；
  // 外部 CDN 的版本号是写死的，直接用缓存，省流量也快。
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const same = u.origin === self.location.origin;
    if (same) {
      try {
        const r = await fetch(req);
        if (r && r.ok) c.put(req, r.clone()).catch(() => {});
        return r;
      } catch (err) {
        return (await c.match(req)) || (await c.match(req, { ignoreSearch: true })) || offlinePage();
      }
    }
    const hit = await c.match(req);
    if (hit) {
      fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); }).catch(() => {});
      return hit;
    }
    try {
      const r = await fetch(req);
      if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()).catch(() => {});
      return r;
    } catch (err) {
      return (await c.match(req, { ignoreSearch: true })) || offlinePage();
    }
  })());
});
