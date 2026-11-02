/* 听课本 — 分辨这台设备是 iPad、Mac 还是手机，给 <html> 加上 class，样式和功能按设备做针对优化。
   - iPad 的 Safari 默认伪装成 Mac（「请求桌面网站」），所以要看「有没有多点触控」
   - 设置里可以手动指定（自动 / Mac / iPad），存在本机
   - 网址后面加 ?device=ipad 也能临时指定，方便测试 */
const Device = (() => {
  const KEY = 'tingkeben.device';
  const ua = navigator.userAgent;
  const touchPoints = navigator.maxTouchPoints || 0;
  const looksIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 0);
  const looksPhone = /iPhone|iPod|Android.+Mobile/.test(ua);
  const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} };

  const q = (location.search.match(/[?&]device=(ipad|desktop|phone)/) || [])[1];
  const choice = () => read(KEY) || 'auto';
  const kind = q || (choice() !== 'auto' ? choice() : looksIpad ? 'ipad' : looksPhone ? 'phone' : 'desktop');
  const touch = kind !== 'desktop' || touchPoints > 0 && !/Macintosh/.test(ua) || matchMedia('(pointer: coarse)').matches;

  const root = document.documentElement;
  root.classList.add('dev-' + kind);
  if (touch) root.classList.add('is-touch');

  const portrait = () => window.innerHeight > window.innerWidth;
  // iPad 侧边栏：竖屏默认收成图标栏，横屏默认展开；手动切换后横竖屏各记各的
  const sideKey = () => 'tingkeben.side.' + (portrait() ? 'portrait' : 'landscape');
  const sideMini = () => { if (kind !== 'ipad') return false; const v = read(sideKey()); return v == null ? portrait() : v === '1'; };
  function apply() {
    const p = portrait();
    root.classList.toggle('portrait', p); root.classList.toggle('landscape', !p);
    root.classList.toggle('side-mini', sideMini());
  }
  apply();
  let last = portrait();
  window.addEventListener('resize', () => { apply(); if (portrait() !== last) { last = portrait(); window.dispatchEvent(new Event('orientchange')); } });

  function toggleSide() { write(sideKey(), sideMini() ? '0' : '1'); apply(); }
  function setChoice(v) { write(KEY, v === 'auto' ? null : v); }

  return { kind, ipad: kind === 'ipad', phone: kind === 'phone', desktop: kind === 'desktop', touch, portrait, toggleSide, sideMini, choice, setChoice, detected: looksIpad ? 'ipad' : looksPhone ? 'phone' : 'desktop' };
})();

/* 防手掌误触（iPad + Apple Pencil）
   规则：笔正在写、笔悬停在屏幕上方、或者笔刚离开不到半秒，这段时间里所有手指 / 手掌的触摸都不算：
   不会点到按钮、不会拖动或缩放画布、不会滚动页面，也不会被当成「两指轻点撤销」。
   手掌先放上去、笔后落下的情况也算：笔一落下，之前按着的手指全部作废（画布会收到 tk:pendown，把它们清掉）。
   保险：笔的抬起事件丢了也不会一直锁着（4 秒没有笔的动静就自动解锁）。 */
const PenGuard = (() => {
  const HOLD = 500;
  let penDown = false, lastPen = 0, seen = false, lastBlockedUp = 0;
  const live = new Set(), blocked = new Set();
  const now = () => Date.now();
  const active = () => (penDown && now() - lastPen < 4000) || now() - lastPen < HOLD;
  const recent = ms => seen && now() - lastPen < ms;
  // 手掌接触面大：浏览器给了接触尺寸、而且这台设备用过笔时，大块接触直接当手掌（不确定 iPad 是否总会给尺寸）
  const palmShape = e => seen && e.width > 0 && e.width * e.height > 45 * 45;
  const kill = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const pen = e => {
    seen = true; lastPen = now();
    if (!document.documentElement.classList.contains('pen-seen')) document.documentElement.classList.add('pen-seen');
  };
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'pen') {
      pen(e); penDown = true;
      if (live.size) { live.forEach(id => blocked.add(id)); live.clear(); }
      window.dispatchEvent(new Event('tk:pendown'));
      return;
    }
    if (e.pointerType !== 'touch') return;
    if (e.isPrimary) { live.clear(); }
    if (active() || palmShape(e)) { blocked.add(e.pointerId); kill(e); return; }
    live.add(e.pointerId);
  }, true);
  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'pen') { pen(e); return; }   // 笔悬停（M2 以后的 iPad Pro）也算「准备写字」
    if (e.pointerType === 'touch' && blocked.has(e.pointerId)) kill(e);
  }, true);
  const up = e => {
    if (e.pointerType === 'pen') { penDown = false; lastPen = now(); return; }
    if (e.pointerType !== 'touch') return;
    live.delete(e.pointerId);
    if (blocked.has(e.pointerId)) { blocked.delete(e.pointerId); lastBlockedUp = now(); kill(e); }
  };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  // 被作废的触摸，浏览器随后还会补一个 click：一起拦掉
  document.addEventListener('click', e => {
    if (now() - lastBlockedUp < 450 && e.pointerType !== 'pen' && e.pointerType !== 'mouse') kill(e);
  }, true);
  // 触摸事件这一层也要拦：取消滚动、取消 iOS 自己合成的点击
  const direct = t => t.touchType !== 'stylus';
  const tstart = new Set();
  document.addEventListener('touchstart', e => {
    const stylus = [...e.touches].some(t => !direct(t));
    if (stylus) { pen(); }
    if (stylus || active()) { for (const t of e.changedTouches) if (direct(t)) tstart.add(t.identifier); if ([...e.changedTouches].every(direct)) e.preventDefault(); }
  }, { capture: true, passive: false });
  document.addEventListener('touchmove', e => {
    if (!seen) return;
    const stylus = [...e.touches].some(t => !direct(t));
    if (stylus || active() || [...e.changedTouches].some(t => tstart.has(t.identifier))) {
      if ([...e.changedTouches].every(direct)) e.preventDefault();
    }
  }, { capture: true, passive: false });
  const tend = e => {
    let hit = false;
    for (const t of e.changedTouches) { if (tstart.has(t.identifier)) { hit = true; tstart.delete(t.identifier); } }
    if ((hit || active()) && [...e.changedTouches].every(direct) && e.cancelable) e.preventDefault();
  };
  document.addEventListener('touchend', tend, { capture: true, passive: false });
  document.addEventListener('touchcancel', e => { for (const t of e.changedTouches) tstart.delete(t.identifier); }, true);
  return { active, recent, seen: () => seen };
})();
window.PenGuard = PenGuard;
