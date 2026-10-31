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
