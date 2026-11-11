/* 听课本云服务 v2（Cloudflare Worker）
   一个 Worker + 一个 R2 存储桶，可以给多个人用，每个人的数据互相看不到。

   两种账号：
     - 主人：只用密码登录（APP_PASSWORD）。数据在桶里的 tingkeben/ 下，和 v1 完全一样，
       旧设备、旧版 App 不用重新登录。主人可以发邀请码、看用量、停用账号。
     - 朋友：主人发一个邀请码 → 朋友自己定用户名和密码注册。数据在 users/<用户名>/ 下，
       有空间上限（发邀请码时定）。

   需要在 Worker 设置里配：
     - R2 绑定：变量名 BUCKET → 选 tingkeben 存储桶
     - 机密（Secret）：APP_PASSWORD = 主人的登录密码（别用 4 位数字，至少 10 位）
   改 APP_PASSWORD = 所有设备（包括朋友的）都要重新登录一次，数据不受影响。 */

const VERSION = 2;
const ALLOWED = ['https://yuenkit122.github.io'];
const DAYS = 180;            // 登录一次管 180 天
const DEFAULT_QUOTA_MB = 1024; // 邀请码没写上限时，朋友默认 1 GB
const MAX_OBJECT_MB = 300;   // 单个文件上限
const USAGE_TTL = 10 * 60e3; // 用量缓存 10 分钟
const MAX_FAILS = 8, LOCK_MS = 15 * 60e3; // 同一 IP 对同一账号连错 8 次，锁 15 分钟

const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = s => new Uint8Array((s.match(/../g) || []).map(h => parseInt(h, 16)));
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
function same(a, b) { // 防时序攻击的比较
  a = String(a || ''); b = String(b || '');
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function hashPw(pw, saltHex) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: 100000 }, k, 256));
}
const rand = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAME_RE = /^[a-z0-9][a-z0-9_-]{2,19}$/;
const RESERVED = ['owner', 'admin', 'root', 'tingkeben', 'users', 'accounts', 'invites'];

/* 桶里的小 JSON（账号、邀请码、失败计数）。都不在 tingkeben/ 和 users/ 下，/r2/ 接口碰不到 */
const getJ = async (env, key) => { const o = await env.BUCKET.get(key); return o ? o.json().catch(() => null) : null; };
const putJ = (env, key, v) => env.BUCKET.put(key, JSON.stringify(v), { httpMetadata: { contentType: 'application/json' } });

/* 令牌
   主人：  exp.sig          （和 v1 一样）
   朋友：  exp.name.sig      签名里混入这个人的密码哈希 → 改密码、被停用后旧令牌立刻失效 */
const ownerSig = (env, exp) => hmac('tkb:' + env.APP_PASSWORD, exp);
const userSig = (env, acc, exp) => hmac('tkb:' + env.APP_PASSWORD + ':' + acc.hash, exp + '.' + acc.name);
const newExp = () => String(Date.now() + DAYS * 864e5);
async function whoIs(env, t) {
  const p = String(t || '').split('.');
  if (p.length < 2 || p.length > 3 || !(Number(p[0]) > Date.now())) return null;
  if (p.length === 2) return same(p[1], await ownerSig(env, p[0])) ? { role: 'owner', name: '', prefix: 'tingkeben/' } : null;
  if (!NAME_RE.test(p[1])) return null;
  const acc = await getJ(env, `accounts/${p[1]}.json`);
  if (!acc || acc.disabled || !same(p[2], await userSig(env, acc, p[0]))) return null;
  return { role: 'user', name: acc.name, prefix: `users/${acc.name}/`, acc };
}

/* 连错太多次就锁一会儿（按 IP + 账号） */
const failKey = async (req, who) => 'fails/' + (await hmac('f', (req.headers.get('CF-Connecting-IP') || '?') + '|' + who)).slice(0, 32) + '.json';
async function locked(env, key) { const f = await getJ(env, key); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60e3) : 0; }
async function failed(env, key) {
  const f = (await getJ(env, key)) || { n: 0, at: 0 };
  if (Date.now() - f.at > LOCK_MS) f.n = 0;
  f.n++; f.at = Date.now();
  if (f.n >= MAX_FAILS) { f.until = Date.now() + LOCK_MS; f.n = 0; }
  await putJ(env, key, f);
  await sleep(800);
}

/* 用量：把这个人前缀下的对象大小加起来，结果缓存 10 分钟 */
async function usage(env, who, fresh) {
  const key = who.role === 'owner' ? 'accounts/_owner.usage.json' : `accounts/${who.name}.usage.json`;
  const c = await getJ(env, key);
  if (c && !fresh && Date.now() - c.at < USAGE_TTL) return c;
  let bytes = 0, count = 0, cursor;
  do {
    const l = await env.BUCKET.list({ prefix: who.prefix, cursor, limit: 1000 });
    for (const o of l.objects) { bytes += o.size; count++; }
    cursor = l.truncated ? l.cursor : null;
  } while (cursor);
  const u = { bytes, count, at: Date.now() };
  await putJ(env, key, u);
  return u;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    // 靠令牌鉴权，不靠 Cookie，所以放开本机的任意端口（桌面版 8765 被占时会换端口）和 iPad 原生壳
    const okOrigin = ALLOWED.includes(origin) || /^(https?|capacitor|ionic|app):\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Expose-Headers': 'ETag',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const path = new URL(req.url).pathname;
    if (path === '/' || path === '/health') return json({ app: 'tingkeben-cloud', v: VERSION, accounts: true, ok: true, ready: !!(env.APP_PASSWORD && env.BUCKET) });
    if (!env.APP_PASSWORD) return json({ error: 'Worker 还没设密码：在「设置 → 变量和机密」加 APP_PASSWORD' }, 500);
    if (!env.BUCKET) return json({ error: 'Worker 还没绑定存储桶：在「设置 → 绑定」加 R2，变量名 BUCKET' }, 500);
    const body = async () => { try { return (await req.json()) || {}; } catch (e) { return {}; } };

    /* ---------- 登录 ---------- */
    if (path === '/login' && req.method === 'POST') {
      const b = await body();
      const name = String(b.name || '').trim().toLowerCase(), pw = String(b.password || '');
      const fk = await failKey(req, name || 'owner');
      const mins = await locked(env, fk);
      if (mins) return json({ error: `密码连错太多次，${mins} 分钟后再试` }, 429);
      if (!name) { // 主人
        if (!same(pw, env.APP_PASSWORD)) { await failed(env, fk); return json({ error: '密码不对（有用户名的话要填用户名）' }, 401); }
        const exp = newExp();
        return json({ token: exp + '.' + await ownerSig(env, exp), days: DAYS, role: 'owner', name: '' });
      }
      const acc = NAME_RE.test(name) ? await getJ(env, `accounts/${name}.json`) : null;
      if (!acc || !same(acc.hash, await hashPw(pw, acc.salt))) { await failed(env, fk); return json({ error: '用户名或密码不对' }, 401); }
      if (acc.disabled) return json({ error: '这个账号被停用了，联系给你邀请码的人' }, 403);
      const exp = newExp();
      return json({ token: `${exp}.${acc.name}.${await userSig(env, acc, exp)}`, days: DAYS, role: 'user', name: acc.name, quotaMB: acc.quotaMB });
    }

    /* ---------- 用邀请码注册 ---------- */
    if (path === '/register' && req.method === 'POST') {
      const b = await body();
      const name = String(b.name || '').trim().toLowerCase(), pw = String(b.password || '');
      const code = String(b.invite || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const fk = await failKey(req, 'register');
      const mins = await locked(env, fk);
      if (mins) return json({ error: `试的次数太多，${mins} 分钟后再试` }, 429);
      if (!NAME_RE.test(name) || RESERVED.includes(name)) return json({ error: '用户名要 3–20 位，只能用小写字母、数字、- 和 _，字母或数字开头' }, 400);
      if (pw.length < 8) return json({ error: '密码至少 8 位' }, 400);
      const inv = code ? await getJ(env, `invites/${code}.json`) : null;
      if (!inv) { await failed(env, fk); return json({ error: '邀请码不对' }, 403); }
      if (inv.usedBy) return json({ error: '这个邀请码已经用过了，找对方再要一个' }, 403);
      if (await env.BUCKET.head(`accounts/${name}.json`)) return json({ error: '这个用户名有人用了，换一个' }, 409);
      const salt = rand(16);
      const acc = { name, salt, hash: await hashPw(pw, salt), quotaMB: inv.quotaMB || DEFAULT_QUOTA_MB, note: inv.note || '', invite: code, created: Date.now() };
      await putJ(env, `accounts/${name}.json`, acc);
      await putJ(env, `invites/${code}.json`, { ...inv, usedBy: name, usedAt: Date.now() });
      const exp = newExp();
      return json({ token: `${exp}.${name}.${await userSig(env, acc, exp)}`, days: DAYS, role: 'user', name, quotaMB: acc.quotaMB });
    }

    const who = await whoIs(env, (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!who) return json({ error: '登录过期了，重新输入密码' }, 401);

    if (path === '/ping') return json({ ok: true });

    /* ---------- 我是谁、用了多少 ---------- */
    if (path === '/me') {
      const u = await usage(env, who, new URL(req.url).searchParams.has('fresh'));
      return json({ role: who.role, name: who.name, quotaMB: who.role === 'owner' ? 0 : who.acc.quotaMB, usedBytes: u.bytes, files: u.count, at: u.at });
    }

    /* ---------- 朋友改自己的密码（主人的密码在 Cloudflare 后台改 APP_PASSWORD） ---------- */
    if (path === '/password' && req.method === 'POST') {
      if (who.role !== 'user') return json({ error: '主人的密码要到 Cloudflare 后台改 APP_PASSWORD' }, 400);
      const b = await body();
      if (!same(who.acc.hash, await hashPw(String(b.old || ''), who.acc.salt))) { await sleep(800); return json({ error: '原密码不对' }, 401); }
      if (String(b.password || '').length < 8) return json({ error: '新密码至少 8 位' }, 400);
      const salt = rand(16);
      const acc = { ...who.acc, salt, hash: await hashPw(String(b.password), salt) };
      await putJ(env, `accounts/${acc.name}.json`, acc);
      const exp = newExp();
      return json({ token: `${exp}.${acc.name}.${await userSig(env, acc, exp)}`, days: DAYS });
    }

    /* ---------- 主人：邀请码和账号管理 ---------- */
    if (path.startsWith('/admin/')) {
      if (who.role !== 'owner') return json({ error: '只有云服务的主人能做这个' }, 403);
      if (path === '/admin/invite' && req.method === 'POST') {
        const b = await body();
        const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉 0O1IL，念给别人听不会错
        const code = [...crypto.getRandomValues(new Uint8Array(10))].map(x => A[x % A.length]).join('');
        const quotaMB = Math.max(50, Math.min(10240, Math.round(Number(b.quotaMB) || DEFAULT_QUOTA_MB)));
        await putJ(env, `invites/${code}.json`, { code, quotaMB, note: String(b.note || '').slice(0, 40), created: Date.now() });
        return json({ code, show: code.slice(0, 5) + '-' + code.slice(5), quotaMB });
      }
      if (path === '/admin/overview' && req.method === 'GET') {
        const list = async prefix => { const out = []; let cursor; do { const l = await env.BUCKET.list({ prefix, cursor }); out.push(...l.objects.map(o => o.key)); cursor = l.truncated ? l.cursor : null; } while (cursor); return out; };
        const accKeys = (await list('accounts/')).filter(k => k.endsWith('.json') && !k.endsWith('.usage.json'));
        const users = [];
        for (const k of accKeys) {
          const a = await getJ(env, k); if (!a) continue;
          const u = await usage(env, { role: 'user', name: a.name, prefix: `users/${a.name}/` });
          users.push({ name: a.name, note: a.note || '', quotaMB: a.quotaMB, disabled: !!a.disabled, created: a.created, usedBytes: u.bytes });
        }
        const invites = [];
        for (const k of await list('invites/')) { const i = await getJ(env, k); if (i && !i.usedBy) invites.push({ code: i.code, note: i.note || '', quotaMB: i.quotaMB, created: i.created }); }
        const mine = await usage(env, who);
        return json({ users, invites, ownerBytes: mine.bytes });
      }
      const m = path.match(/^\/admin\/users\/([a-z0-9_-]+)$/);
      if (m && req.method === 'POST') { // 停用 / 恢复 / 改上限 / 重置密码；数据不删
        const acc = await getJ(env, `accounts/${m[1]}.json`);
        if (!acc) return json({ error: '没有这个账号' }, 404);
        const b = await body(); let tempPassword;
        if (typeof b.disabled === 'boolean') acc.disabled = b.disabled;
        if (b.quotaMB) acc.quotaMB = Math.max(50, Math.min(10240, Math.round(Number(b.quotaMB))));
        if (b.resetPassword) { tempPassword = rand(5); acc.salt = rand(16); acc.hash = await hashPw(tempPassword, acc.salt); }
        await putJ(env, `accounts/${acc.name}.json`, acc);
        return json({ ok: true, disabled: !!acc.disabled, quotaMB: acc.quotaMB, tempPassword });
      }
      const mi = path.match(/^\/admin\/invites\/([A-Z0-9]+)$/);
      if (mi && req.method === 'DELETE') { await env.BUCKET.delete(`invites/${mi[1]}.json`); return json({ ok: true }); }
      return json({ error: 'not found' }, 404);
    }

    /* ---------- 读写数据。App 里的 key 永远是 tingkeben/…，这里换成每个人自己的前缀 ---------- */
    if (path.startsWith('/r2/')) {
      let key;
      try { key = path.slice(4).split('/').map(decodeURIComponent).join('/'); } catch (e) { return json({ error: 'bad key' }, 400); }
      if (!key.startsWith('tingkeben/') || key.includes('..') || key.length > 600) return json({ error: 'bad key' }, 400);
      const real = who.prefix + key.slice('tingkeben/'.length);
      if (req.method === 'GET') {
        const obj = await env.BUCKET.get(real);
        if (!obj) return json({ error: 'NoSuchKey' }, 404);
        return new Response(obj.body, { headers: { ...cors, 'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'application/octet-stream', ETag: obj.httpEtag } });
      }
      if (req.method === 'PUT') {
        const size = Number(req.headers.get('Content-Length') || 0);
        if (size > MAX_OBJECT_MB * 1048576) return json({ error: `单个文件不能超过 ${MAX_OBJECT_MB} MB` }, 413);
        if (who.role === 'user' && size > 262144) { // 小的笔记不查，省请求；大的（课件）才算空间
          const u = await usage(env, who);
          if (u.bytes + size > who.acc.quotaMB * 1048576) return json({ error: `云端空间满了（上限 ${who.acc.quotaMB} MB）。删掉一些课件，或者找给你邀请码的人加空间` }, 413);
          await putJ(env, `accounts/${who.name}.usage.json`, { ...u, bytes: u.bytes + size });
        }
        await env.BUCKET.put(real, req.body, { httpMetadata: { contentType: req.headers.get('Content-Type') || 'application/octet-stream' } });
        return json({ ok: true });
      }
      if (req.method === 'DELETE') { await env.BUCKET.delete(real); return json({ ok: true }); }
    }
    return json({ error: 'not found' }, 404);
  },
};
