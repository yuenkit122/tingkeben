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
   规则（跟 GoodNotes 一样）：只有笔真的接触屏幕时才压手指，抬笔 0.12 秒后手指立刻能滑；笔悬停不算写字。笔接触期间所有手指 / 手掌的触摸都不算：
   不会点到按钮、不会拖动或缩放画布、不会滚动页面，也不会被当成「两指轻点撤销」。
   手掌先放上去、笔后落下的情况也算：笔一落下，之前按着的手指全部作废（画布会收到 tk:pendown，把它们清掉）。
   保险：笔的抬起事件丢了也不会一直锁着（4 秒没有笔的动静就自动解锁）。
   换笔画的间隙：抬笔 0.4 秒内手指不会点中按钮（手掌抬起落下碰不到工具栏），滑动不受影响。
   笔本身（跟 GoodNotes / Notability 一样）：在笔记区里只写字；在笔记区外就是普通的点按，工具栏、侧栏、列表都能点，也能拖动滚动。
   只有两种情况不算点击：笔在按钮上划过去（不是点），或者写字时抬笔 0.2 秒内落到笔记区外（写快了划出界，不是想点）。
   手掌压在屏幕上时 iOS 可能不合成 click，所以笔点按钮后 0.12 秒没等到 click 就自己补一个（只补一次）。
   笔停顿时 iOS 会当成长按选字，取消这一笔再选中最近的文字（比如工具栏的「更多」），所以笔的触摸和选字都要拦。 */
const PenGuard = (() => {
  const HOLD = 120, OFF_HOLD = 400, PALM_HOLD = 1500, STRAY_GAP = 200, TAP_SLOP = 12, TAP_WAIT = 120, CLICK_WINDOW = 450;
  const WRITE = '.ic-stage, .pdfpage, .docpage', FREE = 'input, textarea, select, .modal', CONTROL = 'button, a, summary, label, [role="button"]';
  let penDown = false, lastPen = 0, seen = false, lastBlockedUp = 0;
  let penInk = false;                                  // 最近这一笔落在笔记区里（写字），不是点按
  let offTap = null, lastStray = 0;                    // 笔在笔记区外的这一下；最近一次不算点击的时间
  let lastPenTap = 0, tapClicked = false, tapFilled = false, filling = false, tapTimer = 0;
  const live = new Set(), blocked = new Set();
  const now = () => Date.now();
  const active = () => (penDown && now() - lastPen < 4000) || now() - lastPen < HOLD;
  const recent = ms => seen && now() - lastPen < ms;
  // 手掌接触面大：刚写过字时，大块接触当手掌（不确定 iPad 是否总会给尺寸）；平时再大的手指也照常滑
  const palmShape = e => recent(PALM_HOLD) && e.width > 0 && e.width * e.height > 60 * 60;
  const kill = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const pen = e => {
    seen = true; lastPen = now();
    if (!document.documentElement.classList.contains('pen-seen')) document.documentElement.classList.add('pen-seen');
  };
  const elOf = t => (t && t.nodeType === 1 ? t : t && t.parentElement) || null;
  const editable = t => { const el = elOf(t); return !!el && (el.isContentEditable || !!el.closest(FREE)); };
  const inWrite = t => { const el = elOf(t); return !!el && !!el.closest(WRITE); };
  // 课件页上选了手 / 选择 / 文字：笔不写字，要让它能滚动、选字
  const docPass = t => { const el = elOf(t); return !!el && !!el.closest('.pdfpage, .docpage') && typeof window.TkInkPass === 'function' && window.TkInkPass(); };
  const onInk = t => inWrite(t) && !editable(t) && !docPass(t);
  const inkActive = () => penInk && active();
  const touchOff = t => { const el = elOf(t); return penInk && recent(OFF_HOLD) && !!el && !!el.closest(CONTROL) && !inWrite(t) && !editable(t); };
  // 笔点完按钮：等浏览器的 click，等不到就补一个
  const penTapped = el => {
    lastPenTap = now(); tapClicked = false; tapFilled = false;
    const c = elOf(el) && elOf(el).closest(CONTROL);
    clearTimeout(tapTimer);
    if (!c) return;
    tapTimer = setTimeout(() => {
      if (tapClicked || !c.isConnected) return;
      tapFilled = true; filling = true;
      try { c.click(); } finally { filling = false; }
    }, TAP_WAIT);
  };
  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'pen') {
      const off = !inWrite(e.target) && !editable(e.target);
      const stray = off && penInk && now() - lastPen < STRAY_GAP;
      pen(e); penDown = true;
      if (!stray) penInk = onInk(e.target);
      if (live.size) { live.forEach(id => blocked.add(id)); live.clear(); }
      window.dispatchEvent(new Event('tk:pendown'));
      offTap = off ? { id: e.pointerId, x: e.clientX, y: e.clientY, el: e.target, stray } : null;
      if (stray) kill(e);
      return;
    }
    if (e.pointerType !== 'touch') return;
    if (e.isPrimary) { live.clear(); }
    if (active() || palmShape(e) || touchOff(e.target)) { blocked.add(e.pointerId); kill(e); return; }
    live.add(e.pointerId);
  }, true);
  document.addEventListener('pointermove', e => {
    if (e.pointerType === 'pen') { if (penDown) pen(e); return; }   // 悬停（M2 以后的 iPad Pro）不算写字，不然拿着笔手指就滑不动
    if (e.pointerType === 'touch' && blocked.has(e.pointerId)) kill(e);
  }, true);
  const up = e => {
    if (e.pointerType === 'pen') {
      penDown = false; lastPen = now();
      if (offTap && e.pointerId === offTap.id) {
        const t = offTap; offTap = null;
        if (t.stray || Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_SLOP) { lastStray = now(); if (t.stray) kill(e); }
        else if (e.type === 'pointerup') penTapped(t.el);
      }
      return;
    }
    if (e.pointerType !== 'touch') return;
    live.delete(e.pointerId);
    if (blocked.has(e.pointerId)) { blocked.delete(e.pointerId); lastBlockedUp = now(); kill(e); }
  };
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', up, true);
  // 被作废的触摸，浏览器随后还会补一个 click：一起拦掉
  document.addEventListener('click', e => {
    if (filling) return;
    if (now() - lastStray < CLICK_WINDOW) { kill(e); return; }
    // 笔点的这一下：手掌同时抬起也不影响；已经补过就不再算第二次
    if (now() - lastPenTap < CLICK_WINDOW && e.pointerType !== 'touch') { if (tapFilled) kill(e); else tapClicked = true; return; }
    if (now() - lastBlockedUp < CLICK_WINDOW && e.pointerType !== 'pen' && e.pointerType !== 'mouse') kill(e);
  }, true);
  // 触摸事件这一层也要拦：取消滚动、取消 iOS 自己合成的点击
  const direct = t => t.touchType !== 'stylus';
  const tstart = new Set();
  // 笔记区里笔的触摸取消默认动作：iOS 就不会把它当长按选字 / 随手写，这一笔不会被中途掐断（pointer 事件照常来）。
  // 笔记区外不取消，不然浏览器不合成 click，笔就点不了按钮了
  const holdPen = e => {
    if (e.cancelable && [...e.changedTouches].some(t => !direct(t)) && onInk(e.target)) e.preventDefault();
  };
  document.addEventListener('touchstart', e => {
    const stylus = [...e.touches].some(t => !direct(t));
    if (stylus) { pen(); }
    holdPen(e);
    if (stylus || active() || touchOff(e.target)) { for (const t of e.changedTouches) if (direct(t)) tstart.add(t.identifier); if ([...e.changedTouches].every(direct)) e.preventDefault(); }
  }, { capture: true, passive: false });
  document.addEventListener('touchmove', e => {
    if (!seen) return;
    holdPen(e);
    const stylus = [...e.touches].some(t => !direct(t));
    if (stylus || active() || [...e.changedTouches].some(t => tstart.has(t.identifier))) {
      if ([...e.changedTouches].every(direct)) e.preventDefault();
    }
  }, { capture: true, passive: false });
  const penLift = e => { if ([...e.changedTouches].some(t => !direct(t))) { penDown = false; lastPen = now(); } };   // pointerup 丢了也能解锁
  const tend = e => {
    penLift(e);
    let hit = false;
    for (const t of e.changedTouches) { if (tstart.has(t.identifier)) { hit = true; tstart.delete(t.identifier); } }
    if ((hit || active()) && [...e.changedTouches].every(direct) && e.cancelable) e.preventDefault();
  };
  document.addEventListener('touchend', tend, { capture: true, passive: false });
  document.addEventListener('touchcancel', e => { penLift(e); for (const t of e.changedTouches) tstart.delete(t.identifier); }, true);
  // 兜底：写字时不许起选区、不弹长按菜单；已经选上的（不在输入框里）立刻清掉
  const noSelect = e => { if (inkActive() && !editable(e.target)) e.preventDefault(); };
  document.addEventListener('selectstart', noSelect, true);
  document.addEventListener('contextmenu', noSelect, true);
  document.addEventListener('selectionchange', () => {
    if (!inkActive()) return;
    const sel = document.getSelection();
    if (sel && !sel.isCollapsed && !editable(sel.anchorNode) && !editable(document.activeElement)) sel.removeAllRanges();
  });
  return { active, recent, seen: () => seen };
})();
window.PenGuard = PenGuard;
