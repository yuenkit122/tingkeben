/* 听课本 — 界面与流程 */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');

const ICON = {
  book: '<svg viewBox="0 0 24 24"><path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/><path d="M8 7h8M8 11h6"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
};
const COLORS = ['#2C47A5', '#2B7A4B', '#B5532A', '#7A4BB0', '#A23B62', '#1F7A8C', '#8A6D1F'];

const State = { courses: [], live: null, gens: new Map(), studyGens: new Set() };

/* ---------- 小工具 ---------- */
let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}
const fmtTime = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const fmtDate = t => new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const courseCode = name => (name.match(/\b[A-Z]{3,4}\s?\d{4}\b/) || [''])[0].replace(/\s/, '');

function md(text) {
  const html = DOMPurify.sanitize(marked.parse(text || '', { gfm: true, breaks: false }));
  return html.replace(/<table>/g, '<div class="tbl"><table>').replace(/<\/table>/g, '</table></div>');
}

function modal(html, onMount) {
  const m = $('#modal'), box = $('#modal-box');
  box.className = 'box'; box.innerHTML = html; m.hidden = false; delete box.dataset.sync; delete box.dataset.syncui;
  const close = () => { m.hidden = true; box.innerHTML = ''; delete box.dataset.sync; delete box.dataset.syncui; };
  m.onclick = e => { if (e.target === m) close(); };
  $$('[data-close]', box).forEach(b => b.onclick = close);
  onMount && onMount(box, close);
  return close;
}

/* 删除这类操作：第一次点变成“确认删除”，3 秒内再点才执行 */
function confirmClick(btn, label, fn) {
  btn.onclick = async () => {
    if (btn.dataset.armed) { await fn(); return; }
    const old = btn.innerHTML; btn.dataset.armed = '1'; btn.textContent = label; btn.classList.add('danger');
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.innerHTML = old; btn.classList.remove('danger'); } }, 3000);
  };
}

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function keysReady() { const s = Settings.load(); return { gemini: !!s.geminiKey, notes: !!s.deepseekKey }; }

/* ---------- 导航 ---------- */
async function loadCourses() {
  State.courses = (await DB.all('courses')).sort((a, b) => a.createdAt - b.createdAt);
  renderSide();
}

function renderSide() {
  const r = location.hash.slice(1) || 'home';
  const items = [['home', '课程主页', ICON.home], ['review', '复习', ICON.book], ['ask', '问 AI', ICON.chat], ['settings', '设置', ICON.gear]];
  const isOn = id => r === id || (id === 'ask' && r.startsWith('ask')) || (id === 'review' && r.startsWith('review')) || (id === 'settings' && r.startsWith('settings')) ||
    (id === 'home' && (r.startsWith('course') || r.startsWith('note') || r.startsWith('desk') || r.startsWith('session') || r.startsWith('live')));
  $('#nav').innerHTML = items.map(([id, label, ic]) => `<a href="#${id}" class="${isOn(id) ? 'on' : ''}" title="${label}">${ic}<span class="lbl">${label}</span>${id === 'home' && State.live ? ' <span class="pill bad">REC</span>' : ''}</a>`).join('');
  $('#tabbar').innerHTML = items.map(([id, label, ic]) => `<a href="#${id}" class="${isOn(id) ? 'on' : ''}">${ic}${label}</a>`).join('');
  const short = c => (c.code || courseCode(c.name)).replace(/^[A-Z]+/, '') || c.name.slice(0, 2);
  // 当前在哪门课里（课程页、它的笔记、工作台、复习、录音、生词本、问 AI）：左边那门课一直高亮
  const direct = (r.match(/^course-([^~]+)/) || r.match(/^(?:vocab|marks|review)~([^~]+)/) || r.match(/^(?:ask|live)-([^~]+)/) || [])[1] || '';
  $('#side-courses').innerHTML = State.courses.map(c => `<a class="course-link ${direct === c.id ? 'on' : ''}" data-cid="${c.id}" href="#course-${c.id}" title="${esc(c.name)}"><span class="cshort">${esc(short(c))}</span><span class="lbl">${esc(c.name)}</span></a>`).join('') ||
    '<div class="course-link" style="color:var(--faint)">还没有课程</div>';
  if (!direct) {
    const m = r.match(/^(note|desk|review|session)-([^~]+)/);
    if (m) DB.get(m[1] === 'session' ? 'sessions' : 'notes', m[2]).then(x => {
      if (!x || (location.hash.slice(1) || 'home') !== r) return;
      const el = document.querySelector(`#side-courses [data-cid="${x.courseId}"]`); if (el) el.classList.add('on');
    }).catch(() => {});
  }
  const tog = $('#side-tog'); if (tog) tog.onclick = () => Device.toggleSide();
}


/* ---------- 返回：回到你真正来的那一页 ----------
   每条历史记录都编号（history.state.i），并在 sessionStorage 里记下每个编号对应的页面。
   页面里的「←」按钮：有上一页就等于浏览器后退（iPad 侧滑、Mac 的 ⌘[ 也一样）；
   直接打开链接、没有上一页时，才去这一页的「上级」，而且用 replace，不会多出一条历史。
   跳转（旧链接、找不到的笔记、删除后）一律 replace，后退时不会被弹回来。 */
const Nav = (() => {
  const KEY = 'tingkeben.navstack';
  let stack = [];
  try { stack = JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) {}
  const save = () => { try { sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-80))); } catch (e) {} };
  const idx = () => (history.state && typeof history.state.i === 'number') ? history.state.i : -1;
  function track(r) {
    let i = idx();
    if (i < 0) {
      // 新的一条记录：接在上一条后面（上一条的编号存在 lastIdx 里）
      i = Nav.lastIdx + 1;
      try { history.replaceState({ i }, '', location.href); } catch (e) {}
      stack.length = Math.min(stack.length, i);
    }
    stack[i] = r; Nav.lastIdx = i; save();
  }
  const prev = () => { const i = idx(); return i > 0 ? stack[i - 1] || null : null; };
  function go(hash) { location.hash = hash; }
  // 换掉当前这条记录（不新增历史）：replaceState 不会触发 hashchange，所以手动 route 一次
  function replace(hash) { const i = idx(); try { history.replaceState(i >= 0 ? { i } : null, '', '#' + hash); } catch (e) { location.replace('#' + hash); return; } route(); }
  function back(fallback) { if (prev()) history.back(); else replace(fallback || 'home'); }
  // 页面里切标签（课件 / 笔记 / 重点 / 测验…）也算一步：返回键先回到上一个标签，再回上一页
  function setTab(hash) {
    if (location.hash.slice(1) === hash) return;
    const i = idx() + 1;
    try { history.pushState({ i }, '', '#' + hash); } catch (e) { return; }
    stack.length = i; stack[i] = hash; Nav.lastIdx = i; save();
  }
  // 「←」上显示的名字：按上一页是什么页来叫
  function label(h) {
    if (!h || h === 'home') return '课程主页';
    const id = h.replace(/^[a-z]+-/, '').split('~')[0];
    if (h.startsWith('course-')) { const c = State.courses.find(x => x.id === id); return c ? c.name : '课程'; }
    if (h.startsWith('note-')) return '笔记';
    if (h.startsWith('desk-')) return '上课工作台';
    if (h.startsWith('review-')) return '复习笔记';
    if (h.startsWith('review')) return '复习';
    if (h.startsWith('session-')) return '录音';
    if (h.startsWith('live')) return '录音';
    if (h.startsWith('settings')) return '设置';
    if (h.startsWith('ask')) return '问 AI';
    if (h.startsWith('vocab')) return '生词本';
    if (h.startsWith('wrong')) return '错题本';
    if (h.startsWith('marks')) return '考前重点';
    return '上一页';
  }
  // 所有返回按钮都一样：「← 返回」= 回到上一步（和浏览器后退、iPad 侧滑、Mac ⌘[ 完全相同）。
  // 只有一打开就是这一页、前面什么都没有的时候，才去 fallback（这一页的上级）。
  function crumb(fallback, fallbackLabel, cls = 'crumb', inner) {
    const p = prev();
    const text = inner != null ? inner : '← 返回';
    return `<a class="${cls}" data-back="${esc(fallback)}" href="#${esc(p || fallback)}" title="${esc('返回' + (p ? '：' + label(p) : ''))}">${text}</a>`;
  }
  function reset() { stack = []; Nav.lastIdx = -1; }
  return { track, prev, back, replace, go, setTab, crumb, label, reset, lastIdx: -1 };
})();
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[data-back]');
  if (!a || e.metaKey || e.ctrlKey || e.button) return;
  e.preventDefault(); Nav.back(a.dataset.back);
});

async function route() {
  const r = location.hash.slice(1) || 'home';
  Nav.track(r);
  document.body.classList.toggle('desk-mode', r.startsWith('desk-'));
  document.body.classList.toggle('review-mode', r.startsWith('review-'));
  renderSide();
  window.scrollTo(0, 0);
  try {
    if (r === 'home') await renderHome();
    else if (r === 'settings' || r.startsWith('settings~')) renderSettings(r.split('~')[1] || '');
    else if (r === 'live' || r.startsWith('live-')) await renderLive(r.startsWith('live-') ? r.slice(5) : null);
    else if (r.startsWith('course-')) { const [id, tab] = r.slice(7).split('~'); await renderCourse(id, tab || 'files'); }
    else if (r.startsWith('note-')) { const [id, tab] = r.slice(5).split('~'); await renderNote(id, tab || 'note'); }
    else if (r.startsWith('desk-')) await renderDesk(r.slice(5));
    else if (r === 'review' || r.startsWith('review~')) await renderReview(r.split('~')[1] || '');
    else if (r === 'vocab' || r.startsWith('vocab~')) { const p = r.split('~'); await renderVocab(p[1] || '', p[2] || 'card'); }
    else if (r === 'wrong') await renderWrong();
    else if (r === 'marks' || r.startsWith('marks~')) await renderMarks(r.split('~')[1] || '');
    else if (r.startsWith('review-')) { const [id, tab] = r.slice(7).split('~'); await renderReviewNote(id, tab || 'note'); }
    else if (r === 'ask' || r.startsWith('ask-')) await renderAsk(r.slice(4) || null);
    else if (r.startsWith('session-')) await renderSession(r.slice(8));
    else await renderHome();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty"><strong>页面出错了</strong>${esc(e.message)}</div>`;
  }
  // 每次换页让内容重新淡入（上课工作台是全屏网格，CSS 里已经排除）
  view.classList.remove('tk-in');
  void view.offsetWidth;
  view.classList.add('tk-in');
}
window.addEventListener('hashchange', route);

/* ---------- 主页 ---------- */
async function renderHome() {
  const [files, notes, sessions] = await Promise.all([DB.all('files'), DB.all('notes'), DB.all('sessions')]);
  const k = keysReady();
  const count = (arr, id) => arr.filter(x => x.courseId === id).length;
  const recent = notes.sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  view.innerHTML = `
    <div class="head">
      <div class="grow"><h1>我的课程</h1><div class="meta">把 Moodle 课件放进对应课程，AI 帮你整理成中英对照笔记；没有课件也能先手写、先录音</div></div>
      <div class="row"><button class="btn" id="new-course">＋ 新建课程</button><button class="btn primary" id="sync-moodle">${ICON.up}从 Moodle 同步</button></div>
    </div>
    ${homeHint(k)}
    ${State.courses.length ? scheduleCard() : ''}
    ${State.courses.length ? homeSummary(notes) + learnStrip(notes) : ''}
    <div class="grid">
      ${State.courses.map((c, i) => `
        <a class="card course-card" href="#course-${c.id}" style="--c:${c.color || COLORS[i % COLORS.length]}">
          <div class="code">${esc(c.code || '课程')}</div>
          <h3>${esc(c.name)}</h3>
          ${c.examDate ? `<div class="meta" style="font-size:13px;color:var(--muted)">考试 ${esc(c.examDate)} · ${examCountdown(c.examDate)}</div>` : ''}
          <div class="stats"><span>课件 ${count(files, c.id)}</span><span>笔记 ${count(notes, c.id)}</span><span>录音 ${count(sessions, c.id)}</span></div>
          <button class="del-x" data-del-course="${c.id}" title="删除这门课" aria-label="删除这门课"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg></button>
        </a>`).join('')}
      <button class="card course-card new" id="new-course-2">＋ 新建课程</button>
    </div>
    ${recent.length ? `<h2 class="sec-h">最近的笔记</h2><div class="card list">${recent.map(noteItem).join('')}</div>` : ''}
    ${State.courses.length ? weekPrep(files) : ''}`;
  $('#new-course').onclick = $('#new-course-2').onclick = () => courseModal();
  const hs = $('[data-hint]');
  if (hs) {
    const id = hs.dataset.hint;
    $('[data-hint-x]', hs).onclick = () => {
      let done = {}; try { done = JSON.parse(localStorage.getItem('tingkeben.hints') || '{}'); } catch (e) {}
      done[id] = 1; localStorage.setItem('tingkeben.hints', JSON.stringify(done)); renderHome();
    };
    const act = $('[data-hint-act]', hs);
    if (act) act.onclick = () => { if (act.dataset.hintAct === 'login') cloudLoginModal(); else extGuide(); };
  }
  $$('[data-study]').forEach(b => b.onclick = () => {
    const c = State.courses.find(x => x.id === b.dataset.study) || State.courses[0];
    if (c) openClassroom(c);
  });
  $$('[data-prep]').forEach(b => b.onclick = () => openDocModal(b.dataset.prep, 'prep'));
  const dr = $('#dl-refresh'); if (dr) dr.onclick = async () => { dr.disabled = true; await Deadlines.refresh(); if (dr.isConnected) renderHome(); };
  const da = $('#dl-add'); if (da) da.onclick = () => Deadlines.addModal(renderHome);
  $$('[data-dl-del]').forEach(b => confirmClick(b, '删', () => { Deadlines.remove(b.dataset.dlDel); renderHome(); }));
  $$('[data-dl-done]').forEach(b => b.onclick = () => { const d = Deadlines.load(); const it = d.items.find(x => x.id === b.dataset.dlDone); if (it) { it.done = true; try { localStorage.setItem('tingkeben.deadlines', JSON.stringify(d)); } catch (e) {} } toast('已完成，拿掉了', 1500); renderHome(); });
  $('#sync-moodle').onclick = () => syncModal();
  const sAdd = $('#sched-add'); if (sAdd) sAdd.onclick = () => Schedule.addModal(renderHome);
  const sList = $('#sched-list'); if (sList) sList.onclick = () => scheduleModal();
}
/* 主页只留一条提示：按「最挡路」的顺序挑一条，点 × 关掉就不再烦 */
function homeHint(k) {
  let done = {};
  try { done = JSON.parse(localStorage.getItem('tingkeben.hints') || '{}'); } catch (e) {}
  const items = [];
  if (!State.courses.length) items.push({ id: 'start', t: '第一次用？', s: '在 Chrome 打开 Moodle 并登录，点右上角「听课本助手」，勾选课程同步进来；也可以先在电脑上新建一门课。', cta: '怎么装扩展', act: 'ext' });
  if (!k.notes || !k.gemini) items.push({ id: 'key', t: '先把 API key 填上', s: `${!k.notes ? '生成笔记要 DeepSeek' : ''}${!k.notes && !k.gemini ? '，' : ''}${!k.gemini ? '实时转写要 Gemini' : ''}。key 只存在这台设备上。`, cta: '去设置', href: '#settings~ai' });
  if (!Sync.ready()) items.push({ id: 'sync', t: '云同步没开', s: '登录之后 Mac 和 iPad 的课程、笔记、录音会自动对上（没登录也能正常用）。', cta: '登录', act: 'login' });
  const pick = items.find(x => !done[x.id]);
  if (!pick) return '';
  return `<div class="hint-strip" data-hint="${pick.id}">
    <span class="pill mute">提示</span>
    <div class="grow"><b>${esc(pick.t)}</b> <span class="hint">${esc(pick.s)}</span></div>
    ${pick.href ? `<a class="btn small primary" href="${pick.href}">${esc(pick.cta)}</a>` : `<button class="btn small primary" data-hint-act="${pick.act}">${esc(pick.cta)}</button>`}
    <button class="btn small ghost" data-hint-x aria-label="不再提示">✕</button>
  </div>`;
}

/* 主页：今天的三个动作（背生词 / 清待办 / 刷错题），有东西才显示 */
function learnStrip(notes) {
  const todo = notes.reduce((a, n) => a + (n.todo || []).filter(x => !x.done).length, 0);
  const wrong = notes.reduce((a, n) => a + (n.wrong || []).length, 0);
  const host = document.createElement('div');
  host.id = 'learn-strip';
  if (!todo && !wrong) { host.hidden = true; }
  host.innerHTML = `<div class="card pad learn-strip noprint">
    <span class="grow"><b>今天</b> · <a href="#vocab" id="ls-w">生词 —</a>${todo ? ` · <a href="#wrong">${todo} 条待办没搞懂</a>` : ''}${wrong ? ` · <a href="#wrong">${wrong} 道错题</a>` : ''}</span>
    <a class="btn small" href="#vocab">背生词</a><a class="btn small" href="#wrong">刷错题</a><a class="btn small" href="#marks">考前重点</a>
  </div>`;
  (async () => {
    let due = 0;
    for (const c of State.courses) { try { due += Learn.vstats(await Learn.vocab(c.id)).due; } catch (e) {} }
    const w = document.querySelector('#ls-w');
    if (w) w.textContent = due ? `${due} 个生词要背` : '生词今天清完了';
    const live = document.querySelector('#learn-strip');
    if (live && !due && !todo && !wrong) live.hidden = true;
  })();
  return host.outerHTML;
}

/* 主页：下一节课（借鉴 Otter 的日历联动） */
function scheduleCard() {
  const list = Schedule.load();
  const head = `<div class="row" style="justify-content:space-between;align-items:flex-start"><div class="grow"><b>课表</b><div class="hint">填好每周上课时间，开课前 10 分钟提醒开录，录音自动归到那门课</div></div><button class="btn small" id="sched-add">＋ 添加</button></div>`;
  if (!list.length) return '';   // 没填课表就不占首页位置（课表在「设置 → 课表与提醒」里还能填）
  const n = Schedule.next();
  if (!n) return `<div class="card pad sched">${head.replace('填好每周上课时间，开课前 10 分钟提醒开录，录音自动归到那门课', '接下来两周没有课，去检查一下课表')}</div>`;
  const c = State.courses.find(x => x.id === n.entry.courseId);
  return `<div class="card pad sched${n.live ? ' on' : ''}">
    <div class="sched-row">
      <div class="sched-when"><span class="pill ${n.live ? 'ok' : 'mute'}">${n.live ? '正在上课' : Schedule.when(n)}</span><span class="hint">${Schedule.countdown(n)}</span></div>
      <div class="grow sched-name-box"><div class="sched-name">${esc(Schedule.courseName(n.entry))}</div><div class="hint">${esc(n.entry.start)}–${esc(n.entry.end)}${n.entry.room ? ' · ' + esc(n.entry.room) : ''}</div></div>
      <div class="row" style="gap:8px"><button class="btn small ghost" id="sched-list">课表</button><button class="btn small ${n.live ? 'primary' : ''}" data-study="${esc(n.entry.courseId || '')}" title="直接进三栏课堂：左课件、中画板、右录音">${ICON.mic}${n.live ? '进入课堂' : '一键进课堂'}${!n.live && n.inMs < 90 * 60e3 ? ' · ' + Schedule.countdown(n).replace('还有 ', '') : ''}</button></div>
    </div>
  </div>`;
}
function scheduleModal() {
  const rows = Schedule.load().slice().sort((a, b) => a.day - b.day || String(a.start).localeCompare(String(b.start)));
  modal(`<div class="row"><h2 class="grow">课表</h2><button class="btn small" data-close>关闭</button></div>
    ${rows.length ? `<div class="sched-list">${rows.map(e => `<div class="sched-item"><span class="sched-day">${Schedule.DAY[e.day] || ''}</span><span class="sched-time">${esc(e.start)}–${esc(e.end)}</span><span class="grow">${esc(Schedule.courseName(e))}${e.room ? ` <span class="hint">${esc(e.room)}</span>` : ''}</span><button class="btn small ghost" data-sc-del="${esc(e.id)}" aria-label="删除这节">✕</button></div>`).join('')}</div>` : '<div class="hint" style="margin:10px 0">还没有课。添加后，首页会显示下一节课，到点提醒你开录。</div>'}
    <div class="row" style="justify-content:space-between;margin-top:16px;gap:10px;flex-wrap:wrap">
      <label class="switch" style="margin:0"><input type="checkbox" id="sc-remind" ${Schedule.remindOn() ? 'checked' : ''}>开课前 10 分钟提醒</label>
      <button class="btn primary small" id="sc-add2">＋ 添加</button>
    </div>
    <div class="hint" style="margin-top:8px">提醒用的是页面里的定时器：听课本要开着（挂在后台也行），关掉浏览器就不会响。</div>`, box => {
    $$('[data-sc-del]', box).forEach(b => confirmClick(b, '删除', () => { Schedule.remove(b.dataset.scDel); scheduleModal(); }));
    $('#sc-add2', box).onclick = () => Schedule.addModal(() => scheduleModal());
    $('#sc-remind', box).onchange = async e => {
      if (!e.target.checked) { Schedule.setRemind(false); return; }
      const p = await Schedule.askNotify();
      Schedule.setRemind(true);
      if (p === 'denied') toast('浏览器通知被拒绝了，只能在页面里提醒', 6000);
      else if (p === 'granted') toast('已开启，开课前 10 分钟提醒');
    };
  });
}
function weekPrep(files) {
  const rows = State.courses.map(c => {
    const fs = files.filter(f => f.courseId === c.id && f.status === 'ready' && weekOf(f).n < 800 && phaseOf(f) !== '作业考试');
    if (!fs.length) return null;
    const wk = Math.max(...fs.map(f => weekOf(f).n));
    return { c, wk, fs: sortFiles(fs.filter(f => weekOf(f).n === wk)).slice(0, 4) };
  }).filter(Boolean);
  if (!rows.length) return '';
  return `<div class="card pad"><div class="row" style="justify-content:space-between"><b>课前 5 分钟预习</b><span class="hint">每门课最新一周的课件，点开看预习卡和术语表</span></div>
    <div class="prep-grid">${rows.map(r => `<div class="prep-course"><div class="hint"><b style="color:var(--ink)">${esc(r.c.code || r.c.name)}</b> · Week ${r.wk}</div>${r.fs.map(f => `<button class="prep-file" data-prep="${f.id}">${phaseOf(f) ? `<span class="tag ${phaseOf(f) === '预习' ? 'pre' : 'cls'}">${phaseOf(f)}</span>` : ''}<span class="grow">${esc(f.name.replace(/\.[^.]+$/, ''))}</span>${f.prep ? '<span class="pill ok">已备好</span>' : '<span class="pill mute">生成</span>'}</button>`).join('')}</div>`).join('')}</div></div>`;
}
/* 难度预判：哪 3 页最难、为什么、怎么读 */
function diffModal(f, course) {
  const h = f.hard;
  if (!h) return;
  modal(`<h2>这份课件最难的地方</h2>
    <p class="hint" style="margin:0">${esc(h.overall || '')}</p>
    <div class="hard-list">${h.pages.map(p => `<div class="hard-item"><span class="hard-p">P${p.page}</span><div class="grow"><b>为什么难</b><div class="hint">${esc(p.why)}</div></div><button class="btn small" data-page="${p.page}">打开这一页</button></div>`).join('')}</div>
    ${h.tips && h.tips.length ? `<div class="hard-tips"><b>怎么读这几页</b><ul>${h.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>知道了</button></div>`, (box, close) => {
    $$('[data-page]', box).forEach(b => b.onclick = () => {
      const page = Number(b.dataset.page);
      close();
      openDocModal(f.id);
      // 阅读器是异步渲染的，等它把页画出来再滚过去
      let tries = 0;
      const jump = () => {
        const el = document.querySelector(`#dv-host .pdfpage[data-p="${page}"]`);
        if (el) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); return; }
        if (tries++ < 20) setTimeout(jump, 200);
      };
      setTimeout(jump, 300);
    });
  });
}

async function openDocModal(fileId, mode) {
  const full = await DB.get('files', fileId); if (!full) return;
  const course = await DB.get('courses', full.courseId);
  modal(`<div class="row"><h2 class="grow">${esc(full.name)}</h2><button class="btn small" data-close>关闭</button></div><div class="doc-modal" id="dv-host"></div>`, box => { box.classList.add('wide'); const h = $('#dv-host', box); h._mode = mode || 'orig'; mountDocViewer(h, full, { course }); });
}
function homeSummary(notes) {
  const up = Deadlines.upcoming(6);
  const tot = notes.reduce((a, n) => { const p = Study.progress(n); a.d += p.done; a.t += p.total; return a; }, { d: 0, t: 0 });
  const byCourse = State.courses.map(c => { const ns = notes.filter(n => n.courseId === c.id); const p = ns.reduce((a, n) => { const q = Study.progress(n); a.d += q.done; a.t += q.total; return a; }, { d: 0, t: 0 }); return { c, ...p }; }).filter(x => x.t);
  const dl = Deadlines.load();
  return `<div class="home-sum">
    <div class="card pad">
      <div class="row" style="justify-content:space-between"><b>即将到来</b><div class="row" style="gap:4px"><button class="btn small ghost" id="dl-add">＋ 添加</button>${Ext.version() ? '<button class="btn small ghost" id="dl-refresh">从 Moodle 更新</button>' : ''}</div></div>
      ${up.length ? `<div class="dl-list">${up.map(d => `<div class="dl"><div class="dl-when ${d.due - Date.now() < 3 * 86400e3 ? 'soon' : ''}">${Deadlines.left(d.due)}</div><div class="grow"><div class="t">${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)}</a>` : esc(d.name)}</div><div class="hint">${esc(shortName(d.course || ''))} · ${new Date(d.due).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}${d.todo ? ` · <span class="pill ${/submi|add/i.test(d.todo) ? 'warn' : 'mute'}">${esc(/add submission|submit/i.test(d.todo) ? '还没交' : /attempt/i.test(d.todo) ? '还没做' : d.todo)}</span>` : ''}</div></div><button class="btn small ghost" data-dl-done="${esc(d.id)}" title="做完了，从列表里拿掉" aria-label="完成">✓</button>${d.manual ? `<button class="btn small ghost" data-dl-del="${esc(d.id)}" aria-label="删除">✕</button>` : ''}</div>`).join('')}</div>`
        : `<div class="hint" style="margin-top:6px">${dl.at ? '最近没有要交的东西 🎉' : Ext.version() ? '点「从 Moodle 更新」读取作业和测验的截止日期' : '装好「听课本助手」扩展后可以自动读取 Moodle 的截止日期，也可以手动添加'}</div>`}
    </div>
    <div class="card pad">
      <b>学习进度</b>
      <div style="margin-top:6px"><span style="font-size:28px;font-weight:800">${tot.t ? Math.round(tot.d / tot.t * 100) : 0}%</span> <span class="hint">的知识点已经掌握 · 本周 ${Math.round(Learn.week(notes).rate * 100)}%（${Learn.week(notes).n} 份笔记）</span></div>
      <div class="level" style="width:100%;height:6px"><i style="width:${tot.t ? Math.round(tot.d / tot.t * 100) : 0}%"></i></div>
      <div class="hint" style="margin-top:6px">${tot.t ? `一共 ${tot.t} 个知识点，已经拿下 ${tot.d} 个 —— 本周新学的先看「复习」页的「今天先看什么」` : '在「生成」里勾选「重点」就会出知识点，标「已掌握」后算进这里'}</div>
      ${byCourse.map(x => `<div class="row" style="justify-content:space-between;font-size:13px;margin-top:6px"><a href="#course-${x.c.id}~notes" style="color:var(--ink);text-decoration:none">${esc(x.c.code || x.c.name)}</a><span class="hint">${Math.round(x.d / x.t * 100)}%（${x.d}/${x.t}）</span></div>`).join('')}
    </div>
  </div>`;
}
function examCountdown(d) {
  const days = Math.ceil((new Date(d + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
  return days > 0 ? `还有 ${days} 天` : days === 0 ? '就是今天' : '已结束';
}
function noteItem(n) {
  const c = State.courses.find(x => x.id === n.courseId);
  const st = n.status === 'generating' || State.gens.has(n.id) ? '<span class="pill">生成中</span>' : n.status === 'error' ? '<span class="pill bad">失败</span>' : '';
  const pg = Study.progress(n);
  return `<a class="item" href="#note-${n.id}"><div class="grow"><div class="t">${esc(n.title)}</div><div class="s">${esc(c ? c.name : '')} · ${fmtDate(n.createdAt)}${pg.total ? ` · 掌握 ${Math.round(pg.done / pg.total * 100)}%` : ''}${n.sessionId ? ' · 含录音' : ''}</div></div>${st}<button class="del-x" data-del-note="${n.id}" title="删除这份笔记" aria-label="删除这份笔记"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/></svg></button></a>`;
}

function courseModal(course) {
  const isNew = !course;
  course = course || { name: '', examDate: '', glossary: [] };
  modal(`
    <h2>${isNew ? '新建课程' : '课程设置'}</h2>
    <div class="field"><label for="c-name">课程名称</label><input id="c-name" type="text" value="${esc(course.name)}" placeholder="例如 MMD1010 Accounting 101"><span class="hint">建议用 Moodle 上的名字，带上课程代码</span></div>
    <div class="field"><label for="c-exam">考试日期（可不填）</label><input id="c-exam" type="date" value="${esc(course.examDate || '')}"></div>
    <div class="field"><label for="c-terms">专业词（可不填）</label><textarea id="c-terms" placeholder="用逗号分开，例如 accrual basis, double entry, GST">${esc((course.glossary || []).join(', '))}</textarea><span class="hint">实时转写时会优先识别这些词。导入课件后会自动从课件里挑词，这里只需补充漏掉的。</span></div>
    <div class="row" style="justify-content:space-between">
      ${isNew ? '<span></span>' : '<button class="btn danger small" id="c-del">删除这门课</button>'}
      <div class="row"><button class="btn" data-close>取消</button><button class="btn primary" id="c-save">${isNew ? '创建' : '保存'}</button></div>
    </div>`, (box, close) => {
    $('#c-name', box).focus();
    $('#c-save', box).onclick = async () => {
      const name = $('#c-name', box).value.trim();
      if (!name) { toast('先填课程名称'); return; }
      const c = Object.assign(course, {
        id: course.id || DB.uid('c_'), name, code: courseCode(name), examDate: $('#c-exam', box).value,
        glossary: $('#c-terms', box).value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean),
        createdAt: course.createdAt || Date.now(), color: course.color || COLORS[State.courses.length % COLORS.length],
      });
      await DB.put('courses', c);
      await loadCourses(); close();
      if (isNew) location.hash = 'course-' + c.id; else route();
    };
    const del = $('#c-del', box);
    if (del) confirmClick(del, '再点一次：删除课程和里面所有课件、笔记、录音', async () => { await deleteCourse(course.id); close(); });
  });
}

/* ---------- 课程页 ---------- */
async function renderCourse(id, tab) {
  const course = await DB.get('courses', id);
  if (!course) { Nav.replace('home'); return; }
  const [files, notes, sessions] = await Promise.all([DB.byIndex('files', 'courseId', id), DB.byIndex('notes', 'courseId', id), DB.byIndex('sessions', 'courseId', id)]);
  view.innerHTML = `
    <div>
      ${Nav.crumb('home', '课程主页')}
      <div class="head" style="margin-top:6px">
        <div class="grow"><h1>${esc(course.name)}</h1><div class="meta">${course.examDate ? `考试 ${esc(course.examDate)} · ${examCountdown(course.examDate)}` : '还没设考试日期'}</div></div>
        <div class="row"><button class="btn small" id="c-edit">课程设置</button><button class="btn small ghost danger-text" data-del-course="${id}" title="删除这门课">删除课程</button><button class="btn small" id="c-sync">${ICON.up}同步 Moodle</button><button class="btn small" id="c-points">知识点总结</button><button class="btn small" id="c-mock">模拟考试</button><a class="btn small" href="#ask-${id}">${ICON.chat}问 AI</a><button class="btn" id="c-desk">${ICON.mic}上课</button><button class="btn primary" id="c-gen">${ICON.spark}生成笔记</button></div>
      </div>
    </div>
    <div class="tabs">
      <button data-tab="files" class="${tab === 'files' ? 'on' : ''}">课件 ${files.length}</button>
      <button data-tab="notes" class="${tab === 'notes' ? 'on' : ''}">笔记 ${notes.length}</button>
      <button data-tab="sessions" class="${tab === 'sessions' ? 'on' : ''}">课堂录音 ${sessions.length}</button>
    </div>
    <div id="tab-body"></div>`;
  $$('.tabs button').forEach(b => b.onclick = () => { Nav.setTab('course-' + id + '~' + b.dataset.tab); renderCourse(id, b.dataset.tab); });
  $('#c-edit').onclick = () => courseModal(course);
  $('#c-sync').onclick = () => syncModal(course.id);
  $('#c-gen').onclick = () => generateModal({ course, preselect: State.selected || [] });
  $('#c-points').onclick = () => coursePointsModal(course);
  $('#c-mock').onclick = () => mockExamModal(course);
  $('#c-desk').onclick = () => openClassroom(course);
  const body = $('#tab-body');
  if (tab === 'files') renderFilesTab(course, body);
  else if (tab === 'notes') {
    notes.sort((a, b) => b.createdAt - a.createdAt);
    body.innerHTML = notes.length ? `<div class="row" style="justify-content:flex-end;margin-bottom:10px"><button class="btn small primary" id="c-newnote">＋ 空白笔记</button></div><div class="card list">${notes.map(noteItem).join('')}</div>`
      : `<div class="empty"><strong>还没有笔记</strong>
          <div style="margin:6px 0 14px">不用等课件：可以先建一份空白笔记，进去手写或录音，课件以后再补。</div>
          <div class="row" style="justify-content:center"><button class="btn" id="c-newnote">＋ 空白笔记</button><button class="btn primary" id="c-newnote2">${ICON.mic}手写 + 录音</button></div></div>`;
    const nb = $('#c-newnote', body); if (nb) nb.onclick = async () => { const n = await newBlankNote(course); location.hash = 'note-' + n.id; };
    const nb2 = $('#c-newnote2', body); if (nb2) nb2.onclick = () => studyFlow({ courseId: course.id });
  } else {
    sessions.sort((a, b) => b.startedAt - a.startedAt);
    body.innerHTML = sessions.length ? `<div class="card list">${sessions.map(s => `<a class="item" href="#session-${s.id}"><div class="grow"><div class="t">${esc(s.title)}</div><div class="s">${fmtDate(s.startedAt)} · ${fmtTime(s.duration)} · ${s.segments.length} 句</div></div></a>`).join('')}</div>`
      : `<div class="empty"><strong>还没有课堂录音</strong>上课时点「录这门课」，会实时转写英文并翻译成中文。</div>`;
  }
}

/* 按周分组：从 Moodle 的栏目路径里找 Week N；Own time = 预习，Real time = 正课 */
function weekOf(f) {
  const src = (f.folder || '') + ' ' + (f.moodleTitle || '');
  const m = src.match(/\b(?:week|wk)\s*0*(\d{1,2})\b/i) || (f.name || '').match(/\b(?:week|wk|w)\s*0*(\d{1,2})\b/i);
  if (m) return { n: Number(m[1]), label: 'Week ' + Number(m[1]) };
  const top = (f.folder || '').split(' / ')[0].trim();
  if (/assess|assignment|exam/i.test(top)) return { n: 900, label: top };
  return top ? { n: 800, label: top } : { n: 999, label: '其他文件' };
}
function phaseOf(f) {
  if (f.phase) return f.phase === 'none' ? '' : f.phase;
  const src = (f.folder || '') + ' ' + (f.moodleTitle || '') + ' ' + f.name;
  if (/own[\s-]*time|pre[\s-]*(class|reading|work|lecture|session)|prepar|before (the )?class|self[\s-]*(study|paced)|independent/i.test(src)) return '预习';
  if (/real[\s-]*time|in[\s-]*class|lecture|tutorial|workshop|seminar|class activit|live session/i.test(src)) return '正课';
  if (/wrap[\s-]*up|after (the )?class|post[\s-]*class|review|revision/i.test(src)) return '课后';
  if (/assess|assignment|exam|test\b|quiz|rubric/i.test(src)) return '作业考试';
  return '';
}
function sortFiles(list) {
  const po = { '预习': 0, '正课': 1, '课后': 2, '作业考试': 3, '': 4 };
  return list.sort((a, b) => weekOf(a).n - weekOf(b).n || weekOf(a).label.localeCompare(weekOf(b).label) || po[phaseOf(a)] - po[phaseOf(b)] || (a.addedAt - b.addedAt) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function fileIcon(name) {
  const e = Extract.ext(name);
  const cls = ['png', 'jpg', 'jpeg', 'webp'].includes(e) ? 'img' : e;
  return `<div class="ficon ${cls}">${e === 'jpeg' ? 'JPG' : e.toUpperCase()}</div>`;
}
function linkIcon(f) {
  const p = (f.kind && f.kind.provider) || 'web';
  const t = p === 'youtube' ? 'YT' : p === 'vimeo' ? 'VM' : p === 'video' ? 'VID' : p === 'moodle' ? 'M' : 'URL';
  return `<div class="ficon ${p}">${t}</div>`;
}
function fileStatus(f) {
  if (f.status === 'link') return `<span class="pill mute">${esc((f.kind && f.kind.label) || '链接')}</span>`;
  if (f.url && f.status === 'ready') return '<span class="pill ok">网页 · 已读取</span>';
  if (f.status === 'extracting') return '<span class="pill"><span class="spin" style="width:10px;height:10px;border-width:1.5px"></span>提取中</span>';
  if (f.status === 'ocr') return '<span class="pill"><span class="spin" style="width:10px;height:10px;border-width:1.5px"></span>Gemini 识别中</span>';
  if (f.status === 'scanned') return '<span class="pill warn">扫描件，没读到文字</span>';
  if (f.status === 'error') return `<span class="pill bad" title="${esc(f.error)}">读取失败</span>`;
  return `<span class="pill ok">已读取${f.pages ? ' ' + f.pages + ' 页' : ''}</span>`;
}

async function renderFilesTab(course, body) {
  State.selected = State.selected || [];
  const files = sortFiles(await DB.byIndex('files', 'courseId', course.id));
  State.selected = State.selected.filter(id => files.some(f => f.id === id));
  body.innerHTML = `
    <label class="drop" id="drop">
      <div style="font-size:30px">📥</div>
      <div class="grow"><strong>导入 Moodle 课件</strong>
        <p>支持 PDF、PPTX、DOCX、图片，也可以直接放 Moodle「Download folder」下载的 ZIP。可以一次选多个。</p></div>
      <span class="btn primary">${ICON.up}选择文件</span>
      <input type="file" id="file-in" multiple hidden accept=".pdf,.pptx,.docx,.txt,.md,.zip,.png,.jpg,.jpeg,.webp">
    </label>
    <div class="row" style="justify-content:flex-end;margin:10px 0 6px"><button class="btn small ghost" id="add-link" title="Moodle 里的视频、YouTube、网页都可以挂在这里">🔗 添加视频 / 链接</button></div>
    ${files.length ? `<div class="card files">${files.map((f, i) => `
      ${weekOf(f).label !== (files[i - 1] ? weekOf(files[i - 1]).label : null) ? `<div class="fgroup">${esc(weekOf(f).label)}</div>` : ''}
      <div class="file" data-id="${f.id}">
        <input type="checkbox" aria-label="选择 ${esc(f.name)}" ${State.selected.includes(f.id) ? 'checked' : ''} ${f.status !== 'ready' ? 'disabled' : ''}>
        ${f.status === 'link' ? linkIcon(f) : fileIcon(f.name)}
        <div style="min-width:0"><div class="name">${esc(f.name)}</div>
          <div class="sub">${phaseOf(f) ? `<button class="tag ${phaseOf(f) === '预习' ? 'pre' : phaseOf(f) === '正课' ? 'cls' : phaseOf(f) === '课后' ? 'post' : 'asm'}" data-act="phase" title="点一下改标签">${phaseOf(f)}</button>` : '<button class="tag none" data-act="phase" title="打标签">＋标签</button>'}${f.kind && f.kind.label ? `<span class="tag kind-${esc(f.kind.id)}" title="导入时按文件名和内容判断的">${esc(f.kind.label)}</span>` : ''}${fileStatus(f)}<span>${fmtSize(f.size)}</span>${f.moodleTitle && f.moodleTitle !== f.name.replace(/\.[^.]+$/, '') ? `<span>Moodle：${esc(f.moodleTitle)}</span>` : ''}${f.hard && f.hard.pages.length ? `<button class="tag hard" data-act="diff" title="${esc(f.hard.pages.map(p => 'P' + p.page + '：' + p.why).join('\n'))}">最难 ${f.hard.pages.map(p => 'P' + p.page).join(' ')}</button>` : ''}</div></div>
        <div class="acts">
          ${f.status === 'scanned' || f.status === 'error' ? '<button class="btn small" data-act="ocr">用 Gemini 识别</button>' : ''}
          ${f.status === 'link' || (f.url && f.status === 'ready') ? '<button class="btn small primary" data-act="openlink">打开网页</button>' : ''}
          ${f.status === 'ready' || /\.pdf$/i.test(f.name) ? '<button class="btn small ghost" data-act="view">打开</button>' : ''}${f.status === 'ready' ? `<button class="btn small ghost" data-act="prep" title="5 分钟预习卡 + 术语表">${f.prep ? '课前包 ✓' : '课前包'}</button>` : ''}${f.status === 'ready' && !f.hard ? '<button class="btn small ghost" data-act="diffgo" title="AI 标出这份课件最难的 3 页">难度</button>' : ''}${f.status === 'ready' ? '<button class="btn small ghost" data-act="class" title="用这份课件上课：左边课件、中间笔记、右边翻译">上课</button>' : ''}
          <button class="btn small ghost" data-act="del">删除</button>
        </div>
      </div>`).join('')}</div>` : `<div class="empty"><strong>这门课还没有课件</strong>
        <div style="margin:6px 0 12px">课件可以以后再补 —— 手写板和课堂录音都不需要课件。</div>
        <button class="btn primary" id="nb-study">${ICON.mic}不用课件，先开始学</button>
        <div class="hint" style="margin-top:12px">要导课件：在 Moodle 打开课程 → 进入 Week 文件夹 → 点「Download folder」下载 ZIP，或者一个个下载 PDF/PPT，然后放到上面。</div></div>`}
    <div class="bar noprint" id="selbar" ${State.selected.length ? '' : 'hidden'}>
      <span class="grow">已选 <b id="selcount">${State.selected.length}</b> 个课件</span>
      <button class="btn small" id="sel-clear">取消</button>
      <button class="btn small primary" id="sel-gen">${ICON.spark}用选中的生成笔记</button>
    </div>`;

  // 老数据：没判断过内容的，打开列表时补一次（纯本地规则，不花钱）
  (async () => {
    let changed = false;
    for (const f of files) {
      if (f.status === 'ready' && !f.kind) { f.kind = Extract.classify(f.name, f.folder, f.text); changed = true; }
      else if (f.status === 'link' && (!f.kind || !f.kind.provider)) { f.kind = Object.assign(Extract.linkInfo(f.url || ''), { id: 'video' }); changed = true; }
    }
    if (changed) { for (const f of files) await DB.put('files', f); if (body.isConnected) renderFilesTab(course, body); }
  })();

  const al = $('#add-link', body); if (al) al.onclick = () => addLinkModal(course);
  $$('[data-act=openlink]', body).forEach(b => b.onclick = e => { e.preventDefault(); const f = files.find(x => x.id === b.closest('.file').dataset.id); if (f) openLink(f); });

  const input = $('#file-in', body), drop = $('#drop', body);
  const nbStudy = $('#nb-study', body); if (nbStudy) nbStudy.onclick = () => studyFlow({ courseId: course.id });
  input.onchange = () => { importFiles(course, [...input.files]); input.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => importFiles(course, [...e.dataTransfer.files]));

  const syncBar = () => { $('#selbar', body).hidden = !State.selected.length; $('#selcount', body).textContent = State.selected.length; };
  $$('.file', body).forEach(row => {
    const id = row.dataset.id, f = files.find(x => x.id === id);
    $('input[type=checkbox]', row).onchange = e => {
      State.selected = e.target.checked ? [...new Set([...State.selected, id])] : State.selected.filter(x => x !== id);
      syncBar();
    };
    const v = $('[data-act=view]', row); if (v) v.onclick = () => openDocModal(f.id);
    const pp = $('[data-act=prep]', row); if (pp) pp.onclick = () => openDocModal(f.id, 'prep');
    const dg = $('[data-act=diffgo]', row); if (dg) dg.onclick = async () => { dg.disabled = true; dg.textContent = '…'; try { await Learn.diffFile(f, course.name); toast('标出最难的 ' + f.hard.pages.length + ' 页了'); renderFilesTab(course, body); } catch (e) { toast(e.message, 6000); dg.disabled = false; dg.textContent = '难度'; } };
    const df = $('[data-act=diff]', row); if (df) df.onclick = e => { e.preventDefault(); diffModal(f, course); };
    const cl = $('[data-act=class]', row); if (cl) cl.onclick = () => startClass(course, [f.id], f.name.replace(/\.[^.]+$/, ''));
    const o = $('[data-act=ocr]', row); if (o) o.onclick = () => ocrFile(course, f);
    const ph = $('[data-act=phase]', row); if (ph) ph.onclick = async e => {
      e.preventDefault();
      const order = ['预习', '正课', '课后', '作业考试', ''];
      f.phase = order[(order.indexOf(phaseOf(f)) + 1) % order.length] || 'none';
      await DB.put('files', f); renderFilesTab(course, body);
    };
    confirmClick($('[data-act=del]', row), '确认删除', async () => { await DB.del('files', id); State.selected = State.selected.filter(x => x !== id); renderCourse(course.id, 'files'); });
  });
  $('#sel-clear', body).onclick = () => { State.selected = []; renderFilesTab(course, body); };
  $('#sel-gen', body).onclick = () => generateModal({ course, preselect: State.selected });
}

/* Moodle 里除了文件还有视频和网页：挂成一条链接，点开就能看 */
function addLinkModal(course, after) {
  modal(`<h2>添加视频 / 链接</h2>
    <p class="hint" style="margin:0">Moodle 里的 YouTube、课堂录像（Echo360 / Panopto）、网页说明都可以放这儿，一条一行。课件列表、工作台左栏都会出现。</p>
    <div class="field"><label for="lk-u">网址（可以一次贴多行）</label><textarea id="lk-u" rows="4" placeholder="https://www.youtube.com/watch?v=…&#10;https://learning.monash.edu/mod/page/view.php?id=…"></textarea></div>
    <div class="row"><div class="field grow"><label for="lk-t">标题（可不填，多行时忽略）</label><input id="lk-t" type="text" placeholder="例如 Week 3 课堂录像"></div>
      <div class="field grow"><label for="lk-w">哪一周</label><input id="lk-w" type="text" placeholder="Week 3"></div></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="lk-go">加进去</button></div>`, (box, close) => {
    $('#lk-go', box).onclick = async () => {
      const urls = $('#lk-u', box).value.split(/\n+/).map(x => x.trim()).filter(x => /^https?:\/\//i.test(x));
      if (!urls.length) { toast('先贴一个网址'); return; }
      const title = $('#lk-t', box).value.trim(), week = $('#lk-w', box).value.trim();
      const recs = [];
      for (const url of urls) {
        const info = Extract.linkInfo(url);
        let name = title;
        if (!name || urls.length > 1) {
          // 没填标题时给个好认的名字：YouTube 视频 / Moodle 页面 / 域名
          if (info.provider === 'youtube') name = 'YouTube 视频' + (info.id ? ' · ' + info.id.slice(0, 6) : '');
          else if (info.provider === 'vimeo') name = 'Vimeo 视频' + (info.id ? ' · ' + info.id : '');
          else if (info.provider === 'moodle') name = 'Moodle 页面 · ' + ((url.match(/id=(\d+)/) || [])[1] || '');
          else { try { name = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { name = url.slice(0, 40); } }
        }
        recs.push({ id: DB.uid('f_'), courseId: course.id, name, url, folder: week, size: 0, status: 'link', pages: null,
          kind: { id: info.provider === 'web' || info.provider === 'moodle' ? 'link' : 'video', label: info.label, provider: info.provider, vid: info.id },
          addedAt: Date.now() });
      }
      for (const r of recs) await DB.put('files', r);
      close(); toast(`加了 ${recs.length} 条链接`);
      after ? after() : renderCourse(course.id, 'files');
    };
  });
}
function openLink(f) {
  const p = (f.kind && f.kind.provider) || 'web', vid = f.kind && f.kind.vid;
  if ((p === 'youtube' || p === 'vimeo') && vid) {
    const src = p === 'youtube' ? `https://www.youtube.com/embed/${vid}` : `https://player.vimeo.com/video/${vid}`;
    modal(`<div class="row"><h2 class="grow">${esc(f.name)}</h2><a class="btn small" href="${esc(f.url)}" target="_blank" rel="noopener">在浏览器打开</a><button class="btn small" data-close>关闭</button></div>
      <div class="video-wrap"><iframe src="${esc(src)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`, box => box.classList.add('wide'));
    return;
  }
  window.open(f.url, '_blank', 'noopener');
  toast(p === 'video' ? '课堂录像要在 Moodle 里看，已经在新标签页打开了' : '已经在新标签页打开');
}

async function importFiles(course, list) {
  if (!list.length) return;
  try { navigator.storage?.persist?.(); } catch (e) {}
  const items = [];
  for (const f of list) {
    if (Extract.ext(f.name) === 'zip') {
      toast('正在拆开 ' + f.name + ' …');
      try { items.push(...await Extract.unzipFiles(f)); } catch (e) { toast('ZIP 打不开：' + e.message, 4000); }
    } else if (Extract.isSupported(f.name)) items.push({ file: f, folder: '' });
    else toast('跳过不支持的文件：' + f.name);
  }
  if (!items.length) { toast('没有找到能读取的课件'); return; }
  toast(`导入 ${items.length} 个文件，正在读取文字…`);
  const recs = await ingest(course, items);
  const scanned = recs.filter(r => r.status === 'scanned').length;
  toast(scanned ? `读取完成。${scanned} 个是扫描件，点「用 Gemini 识别」读出文字。` : '课件读取完成，勾选后就能生成笔记', 4000);
  // 顺手扫一遍难度：先标出这份课件最难的 3 页（一次最多 8 份）
  const n = Learn.diffAuto(recs, course.name);
  if (n) toast(`正在标出这 ${n} 份课件最难的 3 页（后台跑，不影响你用）`, 5000);
  return recs;
}

/* 存文件并提取文字；items: [{file, folder, meta}] */
async function ingest(course, items) {
  const recs = [], srcs = new Map();
  for (const { file, folder, meta } of items) {
    const rec = Object.assign({ id: DB.uid('f_'), courseId: course.id, name: file.name, folder, size: file.size, type: file.type || Extract.MIME[Extract.ext(file.name)] || '', hasBlob: true, text: '', pages: null, status: 'extracting', addedAt: Date.now() }, meta || {});
    await DB.putBlob(rec.id, file); // 原文件单独存，列课件时不会被读进内存
    srcs.set(rec.id, file);
    await DB.put('files', rec); recs.push(rec);
  }
  refreshIfOn(course.id);
  for (const rec of recs) {
    try {
      const r = await Extract.fromFile(srcs.get(rec.id));
      Object.assign(rec, { text: r.text, pages: r.pages, status: r.scanned ? 'scanned' : 'ready' });
      // 导进来顺手判断这是什么：课件 / 练习题 / 参考答案 / 阅读 / 作业 / 考试…
      rec.kind = Extract.classify(rec.name, rec.folder, r.text);
    } catch (e) { Object.assign(rec, { status: 'error', error: e.message }); }
    await DB.put('files', rec);
    refreshIfOn(course.id);
  }
  return recs;
}

/* ---------- 扩展直接推过来的同步数据 ----------
   同步整个在插件里跑（列表、下载、截止日期），这里只负责写进本地库。
   以前是页面反过来一条条向扩展要，扩展/页面任一没就位就同步不了。 */
const ExtPush = (() => {
  const byMoodle = new Map();
  async function ensureCourse(c) {
    let local = (await DB.all('courses')).find(x => x.moodleId === c.id || (x.code && x.code === courseCode(c.name) && !x.moodleId));
    if (!local) local = { id: DB.uid('c_'), name: shortName(c.name), code: courseCode(c.name), examDate: '', glossary: [], createdAt: Date.now(), color: COLORS[State.courses.length % COLORS.length] };
    local.moodleId = c.id;
    await DB.put('courses', local);
    byMoodle.set(c.id, local.id);
    await loadCourses();
    return local;
  }
  /* 文字类条目的「类型」：作业 / 测验 / 每周说明 / 课程简介 / 成绩，导入时就标好 */
  const KIND_BY_MODULE = { assign: { id: 'assignment', label: '作业' }, quiz: { id: 'exam', label: '测验' }, section: { id: 'guide', label: '每周说明' }, overview: { id: 'guide', label: '课程说明' }, grades: { id: 'guide', label: '成绩' }, lti: { id: 'video', label: '课堂录像 / 外部工具' }, turnitintooltwo: { id: 'assignment', label: '作业（Turnitin）' }, assignfile: { id: 'assignment', label: '作业附件' } };
  /* 写进本地库：同一门课里 cmid + 文件名一样的就是同一个东西 —— 有就更新，没有才新建（以前每同步一次就多一份） */
  async function findSame(courseId, it) {
    const list = await DB.byIndex('files', 'courseId', courseId);
    return list.find(f => f.moodleCmid && f.moodleCmid === it.cmid && (it.link || f.name === it.name));
  }
  // 文件解析排队做，一次一个（几十个 PDF 同时解析 iPad / 小内存 Mac 会卡死）
  let extractQ = Promise.resolve();
  const queueExtract = (rec, file, courseId) => {
    extractQ = extractQ.then(async () => {
      try {
        const r = await Extract.fromFile(file);
        Object.assign(rec, { text: r.text, pages: r.pages, status: r.scanned ? 'scanned' : 'ready' });
        rec.kind = (rec.module && KIND_BY_MODULE[rec.module]) || Extract.classify(rec.name, rec.folder, r.text);
      } catch (e) { Object.assign(rec, { status: 'error', error: e.message }); }
      await DB.put('files', rec);
      refreshIfOn(courseId);
    });
    return extractQ;
  };
  async function writeItem(courseId, it) {
    const old = await findSame(courseId, it);
    if (it.link) {
      const info = Extract.linkInfo(it.url || '');
      const hasText = (it.text || '').trim().length > 40;
      const k0 = KIND_BY_MODULE[it.module];
      const kind = hasText ? Object.assign(k0 || Extract.classify(it.name, it.folder, it.text), { provider: info.provider, vid: info.id, url: true })
        : (k0 ? Object.assign({}, k0, { provider: info.provider, vid: info.id }) : { id: info.provider === 'web' || info.provider === 'moodle' ? 'link' : 'video', label: info.label, provider: info.provider, vid: info.id });
      if (old) {
        if (old.text === (hasText ? it.text : '') && old.name === it.name && old.url === it.url) return 'same';
        Object.assign(old, { name: it.name || old.name, url: it.url, folder: it.folder || old.folder, text: hasText ? it.text : old.text, status: hasText ? 'ready' : old.status, kind: Object.assign({}, old.kind || {}, kind), due: it.due || old.due || 0 });
        await DB.put('files', old);
        return 'updated';
      }
      await DB.put('files', { id: DB.uid('f_'), courseId, name: it.name || it.url, url: it.url, folder: it.folder || '', size: 0,
        status: hasText ? 'ready' : 'link', text: hasText ? it.text : '', pages: null, addedAt: Date.now(), moodleCmid: it.cmid || null, module: it.module || '', due: it.due || 0, kind });
      return 'added';
    }
    const bin = atob(it.b64 || ''); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const file = new File([u], it.name, { type: it.mime || Extract.MIME[Extract.ext(it.name)] || '' });
    if (!Extract.isSupported(it.name)) return 'same';
    // Moodle 上换了新版本：原地替换文件，笔记、标注、难度标记都还挂在这条上
    const id = old ? old.id : DB.uid('f_');
    await DB.putBlob(id, file);
    const rec = Object.assign(old || { id, courseId, addedAt: Date.now() }, { name: it.name, folder: it.folder || (old && old.folder) || '', size: file.size, type: it.mime || '', hasBlob: true,
      status: 'extracting', moodleCmid: it.cmid || null, moodleRevision: it.revision || '', moodleTitle: it.moodleTitle || '', module: it.module || '' });
    if (old) rec.updatedFromMoodle = Date.now();
    await DB.put('files', rec);
    queueExtract(rec, file, courseId);
    return old ? 'updated' : 'added';
  }
  /* 本机已有：{ moodle 课程 id: ['cmid|文件名|版本', …] }，扩展据此跳过不用再下的文件 */
  async function haveMap(ids) {
    const out = {};
    const courses = await DB.all('courses');
    for (const mid of ids || []) {
      const c = courses.find(x => x.moodleId === mid); if (!c) continue;
      const files = await DB.byIndex('files', 'courseId', c.id);
      out[mid] = files.filter(f => f.moodleCmid && !f.url).map(f => `${f.moodleCmid}|${f.name}|${f.moodleRevision || '*'}`);
    }
    return out;
  }
  /* 以前的版本每同步一次就重复一份：同一个 cmid + 文件名只留一份（被笔记用到、有标注的那份优先） */
  async function dedupe(courseId) {
    const files = await DB.byIndex('files', 'courseId', courseId);
    const notes = await DB.byIndex('notes', 'courseId', courseId);
    const used = new Set(notes.flatMap(n => [...(n.sourceFileIds || []), n.deskFile]).filter(Boolean));
    const score = f => (used.has(f.id) ? 100 : 0) + (f.ink && Object.keys(f.ink).length ? 50 : 0) + (f.prep ? 10 : 0) + (f.hard ? 10 : 0) + (f.keypoints ? 10 : 0) + (f.translation ? 10 : 0) + (f.status === 'ready' ? 1 : 0);
    const groups = new Map();
    for (const f of files) {
      if (!f.moodleCmid) continue;
      const k = f.moodleCmid + '|' + (f.url ? '' : f.name);
      (groups.get(k) || groups.set(k, []).get(k)).push(f);
    }
    let removed = 0;
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      g.sort((a, b) => score(b) - score(a) || (a.addedAt || 0) - (b.addedAt || 0));
      for (const f of g.slice(1)) { if (used.has(f.id)) continue; await DB.del('files', f.id); removed++; }
    }
    return removed;
  }
  async function handle(p) {
    try {
      if (p.type === 'start') {
        State.sync = { total: 0, done: 0, added: 0, updated: 0, same: 0, skipped: [], failed: [], current: '正在准备…', finished: false };
        showSyncProgress(true);
        for (const c of p.courses) await ensureCourse(c);
      } else if (p.type === 'course') {
        await ensureCourse(p.course);
        if (State.sync) State.sync.total += p.total || 0;
        showSyncProgress();
      } else if (p.type === 'item') {
        const cid = byMoodle.get(p.courseId) || p.courseId;
        const r = await writeItem(cid, p.item);
        if (State.sync) { State.sync.current = p.item.name; }
        showSyncProgress();
        return r;
      } else if (p.type === 'progress') {
        if (State.sync) Object.assign(State.sync, { done: p.done, added: p.added, updated: p.updated || 0, same: p.same || 0, current: p.current || '' }, p.failed ? { failed: p.failed } : {});
        showSyncProgress();
      } else if (p.type === 'deadlines') {
        const d = Deadlines.load();
        const doneIds = new Set(d.items.filter(x => x.done).map(x => x.id));   // 自己勾掉的不要被同步冲回来
        d.items = [...d.items.filter(x => x.manual), ...p.items.map(e => ({ ...e, id: 'm' + e.id, done: doneIds.has('m' + e.id) }))];
        d.at = Date.now();
        try { localStorage.setItem('tingkeben.deadlines', JSON.stringify(d)); } catch (e) {}
      } else if (p.type === 'error') {
        if (State.sync) { State.sync.finished = true; State.sync.current = ''; State.sync.failed = [p.message]; }
        showSyncProgress(true);
        toast('同步停下了：' + p.message, 8000);
        State.sync = null; SyncUI.render();
      } else if (p.type === 'done') {
        await extractQ;
        let removed = 0;
        for (const lid of new Set(byMoodle.values())) removed += await dedupe(lid).catch(() => 0);
        if (State.sync) Object.assign(State.sync, { finished: true, current: '', failed: p.failed || [], added: p.added, updated: p.updated || 0, same: p.same || 0, removed });
        showSyncProgress(true);
        toast(`同步完成：新增 ${p.added} 项${p.updated ? `，更新 ${p.updated} 项` : ''}${removed ? `，清掉 ${removed} 个重复课件` : ''}${p.failed && p.failed.length ? `，${p.failed.length} 个失败` : ''}`, 6000);
        await loadCourses(); State.sync = null; SyncUI.render();
        try { localStorage.setItem('tingkeben.moodleAt', String(Date.now())); localStorage.setItem('tingkeben.moodleAdded', String(p.added)); } catch (e) {}
        if (location.hash.slice(1) === 'home' || !location.hash) route();
      }
    } catch (e) { console.warn('扩展推送处理失败', e); }
  }
  async function ask(q) {
    if (q.type === 'have') return haveMap(q.moodleIds);
    return null;
  }
  return { handle, ask, dedupe };
})();
document.documentElement.dataset.tkbReply = '1';   // 告诉扩展：这一版会回话（扩展据此等待「新增/更新/已有」）
window.addEventListener('message', async e => {
  if (e.source !== window || !e.data || e.data.tkbFrom !== 'ext' || !(e.data.push || e.data.ask)) return;
  const data = e.data.push ? await ExtPush.handle(e.data.push) : await ExtPush.ask(e.data.ask).catch(() => null);
  // 回话给扩展（新版扩展会等这个，用来跳过已有文件、统计新增/更新）
  if (e.data.replyId) window.postMessage({ tkbAppReply: e.data.replyId, data: data === undefined ? null : data }, location.origin);
});

/* ---------- 从 Moodle 同步（需要 Chrome 扩展「听课本助手」） ---------- */
const Ext = {
  version: () => document.documentElement.dataset.tkbExt || null,
  call(cmd, args, timeout = 180000) {
    return new Promise((resolve, reject) => {
      const id = DB.uid('x_');
      const t = setTimeout(() => { window.removeEventListener('message', h); reject({ code: 'timeout', message: '扩展太久没回应，重新加载页面再试' }); }, timeout);
      const h = e => {
        if (e.source !== window || !e.data || e.data.tkbFrom !== 'ext' || e.data.id !== id) return;
        window.removeEventListener('message', h); clearTimeout(t);
        e.data.ok ? resolve(e.data.data) : reject(e.data.error || { message: '扩展出错' });
      };
      window.addEventListener('message', h);
      window.postMessage({ tkbTo: 'ext', id, cmd, args }, location.origin);
    });
  },
};
const MOODLE = 'https://learning.monash.edu';
const shortName = n => n.replace(/\s*-\s*(January|February|March|April|May|June|July|August|September|October|November|December)\b.*$/i, '').trim();
const b64ToBlob = (b64, type) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };
State.sync = null;

function extGuide() {
  const chrome = /Chrome\//.test(navigator.userAgent) && !/Edg\//.test(navigator.userAgent);
  modal(`
    <h2>先装「听课本助手」</h2>
    <p style="margin:0;color:var(--muted)">自动同步 Moodle 要靠这个 Chrome 扩展，它用你自己的 Moodle 登录读取课件，只读不改。${chrome ? '' : '<br><strong style="color:var(--warn)">你现在用的不是 Chrome。同步只能在 Mac 的 Chrome 里做，iPad 用不了。</strong>'}</p>
    <ol style="margin:0;padding-left:20px;line-height:1.9">
      <li>把聊天里发给你的 <b>tingkeben-helper.zip</b> 解压</li>
      <li>Chrome 地址栏输入 <code>chrome://extensions</code> 回车</li>
      <li>打开右上角「开发者模式」</li>
      <li>点「加载已解压的扩展程序」，选解压出来的 <b>tingkeben-helper</b> 文件夹</li>
      <li>以后：在已登录的 Moodle 页面点右上角「听课本助手」图标 → 勾选课程 →「同步到听课本」</li>
    </ol>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>知道了</button><button class="btn primary" id="g-reload">已装好，刷新</button></div>`, box => { $('#g-reload', box).onclick = () => location.reload(); });
}

async function syncModal(onlyCourseId) {
  if (State.sync) { showSyncProgress(true); return; }
  // Mac 版里看不到 Chrome 的扩展：同步要在 Chrome 的 Moodle 页面上点扩展图标，数据会直接送进这里
  if (!Ext.version() && document.documentElement.dataset.tkbDesktop) {
    modal(`<h2>从 Moodle 同步到 Mac 版</h2>
      <ol style="margin:0;padding-left:20px;line-height:1.9">
        <li>保持这个 Mac 版听课本开着</li>
        <li>在 <b>Chrome</b> 里打开 Moodle 并登录</li>
        <li>点 Chrome 右上角「听课本助手」图标 → 勾选课程 →「同步到听课本」</li>
      </ol>
      <p class="hint" style="margin:0">扩展会直接把课件、作业要求、成绩等送进这个窗口，进度在这里显示。需要「听课本助手」1.6 以上。</p>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-close>知道了</button><a class="btn primary" href="${MOODLE}/my/courses.php" target="_blank" rel="noopener">打开 Moodle</a></div>`);
    return;
  }
  if (!Ext.version()) { extGuide(); return; }
  const close = modal(`<h2>从 Moodle 同步</h2><div class="thinking"><span class="spin"></span>正在读取你的 Moodle 课程…</div>`);
  let courses;
  try { courses = await Ext.call('listCourses', {}, 60000); }
  catch (e) {
    close();
    if (e.code === 'login') modal(`<h2>先登录 Moodle</h2><p style="margin:0">Moodle 的登录过期了。打开 Moodle 登录后，直接在 Moodle 页面点右上角「听课本助手」图标同步就行。</p><div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><a class="btn primary" href="${MOODLE}/my/courses.php" target="_blank" rel="noopener">打开 Moodle 登录</a></div>`);
    else toast(e.message || '读取 Moodle 失败', 6000);
    return;
  }
  const local = await DB.all('courses');
  modal(`
    <h2>从 Moodle 同步</h2>
    <p style="margin:0;color:var(--muted);font-size:14px">会自动建好课程、按周归类，已经导入过的文件不会重复下载。</p>
    <div class="checklist">${courses.map(c => `<label><input type="checkbox" value="${c.id}" ${!onlyCourseId || local.find(l => l.moodleId === c.id && l.id === onlyCourseId) ? 'checked' : ''}>${esc(c.name)}</label>`).join('')}</div>
    <label class="switch"><input type="checkbox" id="y-ebook">也同步 E-Book 课本章节（文件大、下载慢）</label>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="y-go">开始同步</button></div>`, (box, close2) => {
    $('#y-go', box).onclick = () => {
      const ids = $$('.checklist input:checked', box).map(i => Number(i.value));
      if (!ids.length) { toast('至少选一门课'); return; }
      const ebook = $('#y-ebook', box).checked;
      close2();
      runSync(courses.filter(c => ids.includes(c.id)), ebook);
    };
  });
}

/* 同步统一交给扩展后台去跑（和在 Moodle 页面点扩展图标是同一条路）：
   扩展抓 → 推给这个页面写库；已有的文件不重下，改过的原地更新，作业要求 / 每周说明 / 成绩一起带回来。 */
async function runSync(courses, includeEbook) {
  try {
    await Ext.call('startSync', { courses, ebook: !!includeEbook }, 60000);
    toast('开始同步，进度会显示在这里', 3000);
  } catch (e) {
    toast((e && e.message) || '同步没启动起来', 6000);
  }
}

function showSyncProgress(force) {
  SyncUI.render();
  const S = State.sync; if (!S) return;
  const m = $('#modal'), box = $('#modal-box');
  const open = !m.hidden && box.dataset.sync;
  if (!open && !force) return;
  const html = `
    <h2>${S.finished ? '同步完成' : '正在同步 Moodle'}</h2>
    <div class="level" style="width:100%;height:8px"><i style="width:${S.total ? Math.round(S.done / S.total * 100) : 3}%"></i></div>
    <div style="font-size:14px">${S.finished ? `新增 <b>${S.added}</b> 项${S.updated ? ` · 更新 <b>${S.updated}</b> 项` : ''}${S.same ? ` · ${S.same} 项没变化` : ''}${S.removed ? ` · 清掉 ${S.removed} 个重复` : ''}` : `${S.done} / ${S.total || '…'} · ${esc(S.current)}${S.added || S.updated ? `<div class="hint">新增 ${S.added || 0} · 更新 ${S.updated || 0}${S.same ? ' · 没变化 ' + S.same : ''}</div>` : ''}`}</div>
    ${S.skipped.length ? `<details><summary style="font-size:13px;color:var(--muted)">${S.skipped.length} 个文件类型不支持，已跳过</summary><div class="hint">${S.skipped.map(esc).join('<br>')}</div></details>` : ''}
    ${S.failed.length ? `<details ${S.finished ? 'open' : ''}><summary style="font-size:13px;color:var(--danger)">${S.failed.length} 个没同步成功</summary><div class="hint">${S.failed.map(esc).join('<br>')}</div></details>` : ''}
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>${S.finished ? '关闭' : '放到后台继续'}</button></div>`;
  if (!open) modal(html); else box.innerHTML = html;
  box.dataset.sync = '1';
  $$('[data-close]', box).forEach(b => b.onclick = () => { m.hidden = true; box.innerHTML = ''; delete box.dataset.sync; });
}
function refreshIfOn(courseId) {
  const h = location.hash.slice(1);
  if (h === 'course-' + courseId || h === 'course-' + courseId + '~files') {
    const y = window.scrollY;
    renderCourse(courseId, 'files').then(() => window.scrollTo(0, y));
  }
}

async function ocrFile(course, f) {
  f.status = 'ocr'; await DB.put('files', f); refreshIfOn(course.id);
  try {
    const mime = f.type || Extract.MIME[Extract.ext(f.name)];
    let blob = await DB.getBlob(f.id);
    if (!blob) { await Sync.ensureBlob(f); blob = await DB.getBlob(f.id); }
    if (!blob) throw new Error('课件原文件还不在本机，连上网再试');
    f.text = await AI.ocr(blob, mime);
    f.status = 'ready'; f.error = '';
    toast('识别完成：' + f.name);
  } catch (e) { f.status = 'error'; f.error = e.message; toast(e.message, 5000); }
  await DB.put('files', f); refreshIfOn(course.id);
}

/* ---------- 生成笔记 ---------- */
const GEN_OUTS = [['note', '笔记', '按课件顺序的中英对照讲义'], ['points', '重点', '要背的知识点'], ['quiz', '测验', '单选题 + 解析']];
const GenPref = {
  get() { try { const v = JSON.parse(localStorage.getItem('tingkeben.genouts') || 'null'); return Array.isArray(v) && v.length ? v : ['note']; } catch (e) { return ['note']; } },
  set(v) { try { localStorage.setItem('tingkeben.genouts', JSON.stringify(v)); } catch (e) {} },
};
async function generateModal({ course, preselect = [], sessionId = null, noteId = null, title: presetTitle = '' }) {
  const files = sortFiles((await DB.byIndex('files', 'courseId', course.id)).filter(f => f.status === 'ready'));
  const sessions = (await DB.byIndex('sessions', 'courseId', course.id)).sort((a, b) => b.startedAt - a.startedAt);
  if (!files.length && !sessions.length) {
    modal(`<h2>还没有能用的材料</h2>
      <p class="hint" style="margin:0">生成笔记要先有课件的文字，或者一段课堂录音。不过可以先建一份空白笔记，进去手写、录音，材料齐了再回来生成。</p>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="gm-study">${ICON.mic}手写笔记 + 课堂录音</button></div>`, (box, close) => {
      $('#gm-study', box).onclick = () => { close(); studyFlow({ courseId: course.id }); };
    });
    return;
  }
  const firstSel = files.find(f => preselect.includes(f.id));
  const defTitle = presetTitle || (sessionId ? (sessions.find(s => s.id === sessionId)?.title || '课堂笔记') : firstSel ? firstSel.name.replace(/\.[^.]+$/, '') : '');
  const p = AI.notesProvider();
  const outs = GenPref.get();
  modal(`
    <h2>生成</h2>
    <div class="field"><label>要生成什么（可以多选）</label>
      <div class="outs" id="g-outs">${GEN_OUTS.map(([k, l, d]) => `<label class="out"><input type="checkbox" value="${k}" ${outs.includes(k) ? 'checked' : ''}><b>${l}</b><small>${d}</small></label>`).join('')}</div></div>
    <div class="field"><label>用哪些课件</label>
      ${files.length ? `<div class="checklist">${files.map(f => `<label><input type="checkbox" value="${f.id}" ${preselect.includes(f.id) ? 'checked' : ''}><span class="hint" style="min-width:58px">${esc(weekOf(f).label)}</span>${phaseOf(f) ? `<span class="tag ${phaseOf(f) === '预习' ? 'pre' : phaseOf(f) === '正课' ? 'cls' : phaseOf(f) === '课后' ? 'post' : 'asm'}">${phaseOf(f)}</span>` : ''}${esc(f.name)}</label>`).join('')}</div>` : '<span class="hint">这门课还没有已读取的课件</span>'}
    </div>
    ${sessions.length ? `<div class="field"><label for="g-sess">加上课堂录音（可选）</label><select id="g-sess"><option value="">不用录音</option>${sessions.map(s => `<option value="${s.id}" ${s.id === sessionId ? 'selected' : ''}>${esc(s.title)} · ${fmtTime(s.duration)}</option>`).join('')}</select><span class="hint">会把老师强调的考试、作业重点单独列出来</span></div>` : ''}
    <div class="field"><label for="g-title">标题</label><input id="g-title" type="text" value="${esc(defTitle)}" placeholder="例如 Week 1 会计等式"></div>
    <div class="field g-notes-only"><label>笔记详细程度</label><div class="radios">
      <label><input type="radio" name="g-style" value="detailed" checked>详细（第一次学）</label>
      <label><input type="radio" name="g-style" value="brief">精简（考前复习）</label></div></div>
    <div class="field g-notes-only"><label for="g-extra">笔记的额外要求（可不填）</label><input id="g-extra" type="text" placeholder="例如：多给几道计算题"></div>
    <div class="hint" id="g-est"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="g-go">${ICON.spark}开始生成</button></div>`, (box, close) => {
    const picked = () => $$('#g-outs input:checked', box).map(i => i.value);
    const est = () => {
      const o = picked();
      $$('.g-notes-only', box).forEach(el => { el.hidden = !o.includes('note'); });
      $('#g-go', box).innerHTML = `${ICON.spark}${o.length ? '生成' + o.map(k => GEN_OUTS.find(x => x[0] === k)[1]).join(' + ') : '先选要生成什么'}`;
      const ids = $$('.checklist input:checked', box).map(i => i.value);
      const chars = files.filter(f => ids.includes(f.id)).reduce((n, f) => n + (f.text || '').length, 0);
      const sid = $('#g-sess', box)?.value;
      const sChars = sid ? sessions.find(s => s.id === sid).segments.reduce((n, g) => n + g.en.length + g.zh.length, 0) : 0;
      const tokens = Math.round((chars + sChars) / 3.2) + 1500;
      $('#g-est', box).textContent = `用 ${p.label}（${p.model}）· 材料约 ${Math.round(tokens / 1000)}k tokens` + (o.length > 1 || (o.length && !o.includes('note')) ? ' · 只生成勾选的，不会多出别的' : '');
    };
    $$('input,select', box).forEach(i => i.addEventListener('change', est)); est();
    $('#g-go', box).onclick = async () => {
      const o = picked();
      if (!o.length) { toast('先勾选要生成什么'); return; }
      GenPref.set(o);
      const ids = $$('.checklist input:checked', box).map(i => i.value);
      const sid = $('#g-sess', box)?.value || null;
      if (!ids.length && !sid) { toast('至少选一个课件或一段录音'); return; }
      if (!o.includes('note') && !ids.length) { toast('只出重点 / 卡片 / 测验时要选课件（录音要先生成笔记）'); return; }
      const title = $('#g-title', box).value.trim() || (sid ? '课堂笔记' : files.find(f => f.id === ids[0]).name.replace(/\.[^.]+$/, ''));
      const style = $('input[name=g-style]:checked', box).value;
      const extra = $('#g-extra', box).value.trim(); // 关窗之前先读，关了就读不到了
      close();
      const parts = o.filter(k => k !== 'note');
      try {
        if (o.includes('note')) {
          const id = await startGeneration({ course, fileIds: ids, sessionId: sid, title, style, extra, noteId, thenParts: parts });
          State.selected = [];
          location.hash = 'note-' + id;
        } else {
          // 不要笔记：建一份只放复习材料的记录，直接从课件出重点 / 卡片 / 测验
          const n = noteId ? await DB.get('notes', noteId) : { id: DB.uid('n_'), courseId: course.id, createdAt: Date.now(), markdown: '', status: 'done', model: '' };
          Object.assign(n, { title, sourceFileIds: [...new Set([...(n.sourceFileIds || []), ...ids])] });
          await DB.put('notes', n);
          State.selected = [];
          location.hash = 'note-' + n.id + '~' + parts[0];
          Study.background(n.id, parts);
        }
      } catch (e) { toast('没能开始生成：' + e.message, 6000); }
    };
  });
}

function sessionTranscript(s) {
  return s.segments.map(g => `[${fmtTime(g.t)}]${g.important ? '【重点】' : ''}${g.starred ? '【学生标记】' : ''} ${g.en}\n　　${g.zh || ''}`).join('\n');
}

/* ---------- 笔记的课件：建好以后也能随时加新课件 / 去掉课件 ----------
   · 勾选这门课已有的课件，或者直接从电脑上传新的（上传完自动勾上）
   · 新加的课件可以只「加进来」（左边能看、能在课件上写），也可以让 AI 把它的内容整理好接在笔记后面
     —— 原来的笔记文字、手写、文本框都不动，只在最后多出新的几块 */
async function noteFilesModal(note, course, after) {
  if (!course) course = await DB.get('courses', note.courseId);
  const before = new Set(note.sourceFileIds || []);
  let chosen = new Set(before);
  let q = '';
  const usable = f => f.status !== 'link' && f.status !== 'error';
  const load = async () => sortFiles((await DB.byIndex('files', 'courseId', course.id)).filter(usable));
  let files = await load();
  modal(`<h2>这份笔记的课件</h2>
    <p class="hint" style="margin:0">勾上的课件会出现在笔记左边，也能拿来生成笔记。随时可以再来加新的。</p>
    <div class="row" style="gap:8px;margin-top:10px">
      <input type="search" id="nf-q" placeholder="搜课件名字 / 第几周" style="flex:1;min-width:0">
      <label class="btn small" style="cursor:pointer">＋ 从电脑上传<input type="file" id="nf-up" multiple accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.md,.zip,.png,.jpg,.jpeg" hidden></label>
    </div>
    <div class="nf-list" id="nf-list"></div>
    <div id="nf-mode"></div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close>取消</button><button class="btn primary" id="nf-ok">保存</button></div>`, (box, close) => {
    const list = $('#nf-list', box), modeEl = $('#nf-mode', box);
    const paint = () => {
      const shown = files.filter(f => !q || (f.name + ' ' + weekOf(f).label + ' ' + (f.folder || '')).toLowerCase().includes(q));
      list.innerHTML = shown.length ? shown.map(f => `<label class="nf-item${chosen.has(f.id) ? ' on' : ''}"><input type="checkbox" data-f="${f.id}" ${chosen.has(f.id) ? 'checked' : ''}>
        <span class="grow"><b>${esc(f.name)}</b><span class="hint">${esc(weekOf(f).label)}${f.status === 'extracting' ? ' · 正在读取文字…' : f.status === 'scanned' ? ' · 扫描件' : ''}</span></span></label>`).join('')
        : `<div class="empty" style="padding:18px">${files.length ? '没有找到' : '这门课还没有课件，点「从电脑上传」，或者先从 Moodle 同步'}</div>`;
      $$('[data-f]', list).forEach(cb => cb.onchange = () => { cb.checked ? chosen.add(cb.dataset.f) : chosen.delete(cb.dataset.f); cb.closest('.nf-item').classList.toggle('on', cb.checked); paintMode(); });
      paintMode();
    };
    const paintMode = () => {
      const added = [...chosen].filter(x => !before.has(x));
      if (!added.length || !String(note.markdown || '').trim()) { modeEl.innerHTML = ''; return; }
      const keep = modeEl.querySelector('input[name=nf-m]:checked');
      const v = keep ? keep.value : 'link';
      modeEl.innerHTML = `<div class="field" style="margin-top:12px"><label>新加的 ${added.length} 份课件</label>
        <label class="radio"><input type="radio" name="nf-m" value="link" ${v === 'link' ? 'checked' : ''}> 只加进来：左边能看、能在课件上写，笔记文字不变</label>
        <label class="radio"><input type="radio" name="nf-m" value="append" ${v === 'append' ? 'checked' : ''}> 把新课件的内容整理好，接在笔记后面（DeepSeek，原来的笔记和手写都不动）</label></div>`;
    };
    $('#nf-q', box).oninput = e => { q = e.target.value.trim().toLowerCase(); paint(); };
    $('#nf-up', box).onchange = async e => {
      const picked = [...e.target.files]; e.target.value = '';
      if (!picked.length) return;
      const recs = (await importFiles(course, picked)) || [];
      recs.forEach(r => chosen.add(r.id));
      files = await load(); paint();
    };
    $('#nf-ok', box).onclick = async () => {
      const ids = files.map(f => f.id).filter(id => chosen.has(id));
      // 不在这门课列表里的老 id（比如被删的课件）顺手清掉
      const added = ids.filter(x => !before.has(x));
      const mode = (modeEl.querySelector('input[name=nf-m]:checked') || {}).value || 'link';
      const fresh = await DB.get('notes', note.id) || note;
      fresh.sourceFileIds = ids;
      if (!ids.includes(fresh.deskFile)) fresh.deskFile = added[0] || ids[0] || '';
      else if (added.length) fresh.deskFile = added[0];   // 刚加的课件直接显示在左边
      await DB.put('notes', fresh);
      Object.assign(note, { sourceFileIds: fresh.sourceFileIds, deskFile: fresh.deskFile });
      close();
      const removed = [...before].filter(x => !ids.includes(x)).length;
      toast(added.length || removed ? `课件已更新：加了 ${added.length} 份${removed ? `，去掉 ${removed} 份` : ''}` : '课件没有变化', 2000);
      if (added.length && mode === 'append') appendFromFiles(fresh, course, added, after);
      after && after();
    };
    paint();
  });
}

/* 把新课件整理成笔记，接在原来的笔记后面。只新增板块，原来板块的编号不变，手写就不会跑位。 */
async function appendFromFiles(note, course, fileIds, after) {
  if (!keysReady().notes) { toast('先在设置里填 DeepSeek 的 key 才能整理笔记', 4000); return; }
  const job = Jobs.start('note-add:' + note.id, '补进笔记：' + note.title);
  try {
    // 刚上传的课件可能还在读文字，等一下（最多 90 秒）
    let files = [];
    for (let t = 0; t < 90; t++) {
      files = (await Promise.all(fileIds.map(id => DB.get('files', id)))).filter(Boolean);
      if (!files.some(f => f.status === 'extracting')) break;
      job.phase('等课件读完文字', 0, .05, { expectSec: 20 });
      await new Promise(r => setTimeout(r, 1000));
    }
    const src = files.filter(f => (f.text || '').trim());
    if (!src.length) { job.done(); toast('新课件还读不出文字（扫描件要先在课件页用 Gemini 识别），这次只加进来了', 5000); return; }
    job.phase('正在读课件、理清思路', .05, .35, { expectLen: 4000 });
    const extra = [note.extra || '', '这是同一份笔记的续写：学生已经有前面的笔记，现在只需要把下面这几份新课件整理成笔记，接在后面。不要重复写课程介绍，第一行用二级标题写这份课件讲的主题（标题里带上课件名），其余格式和前面保持一致。'].filter(Boolean).join('\n');
    const user = AI.notesPrompt({ courseName: course.name, title: note.title, sources: src.map(f => ({ name: f.name, text: (f.text || '').slice(0, 600000) })), transcript: '', highlights: [], style: note.style || 'detailed', extra });
    let writing = false;
    const text = await AI.deepseekStream({
      system: AI.NOTES_SYSTEM, user, purpose: 'notes',
      onThinking: t => { job.len(t.length).sub(`已思考 ${t.length} 字`); },
      onText: t => { if (!writing) { writing = true; job.phase('正在写笔记', .35, .98, { expectLen: 8000 }); } job.len(t.length).sub(`已写 ${t.length} 字`); },
    });
    const add = String(text || '').trim().replace(/^#\s[^\n]*\n+/, '');   // 去掉续写里多出来的一级大标题
    if (!add) throw new Error('DeepSeek 没有返回内容');
    const n = await DB.get('notes', note.id) || note;
    Board.appendMd(n, add);
    await DB.put('notes', n);
    job.done();
    toast(`新课件的笔记已经接在后面了（${src.length} 份）`, 3000);
    if (location.hash.slice(1).startsWith('note-' + note.id) || location.hash.slice(1) === 'desk-' + note.id) { after ? after() : route(); }
  } catch (e) { job.done(); toast('补进笔记失败：' + e.message, 6000); }
}

async function startGeneration({ course, fileIds, sessionId, title, style, extra, noteId, thenParts = [] }) {
  const files = await Promise.all(fileIds.map(id => DB.get('files', id)));
  const session = sessionId ? await DB.get('sessions', sessionId) : null;
  const p = AI.notesProvider();
  const note = noteId ? await DB.get('notes', noteId) : { id: DB.uid('n_'), courseId: course.id, createdAt: Date.now() };
  Object.assign(note, { title, sourceFileIds: fileIds, sessionId, style, extra, markdown: '', status: 'generating', model: p.label + ' ' + p.model, error: '' });
  await DB.put('notes', note);
  const gen = { text: '', think: '', ctl: new AbortController(), listeners: new Set() };
  State.gens.set(note.id, gen);
  // 进度条：连接 → 读课件思考 → 写笔记（按已写字数估算）
  const job = Jobs.start('note:' + note.id, '生成笔记：' + title);
  const srcChars = files.filter(Boolean).reduce((n, f) => n + (f.text || '').length, 0);
  const expectWrite = Math.max(3000, Math.min(style === 'brief' ? 6000 : 14000, srcChars * (style === 'brief' ? .35 : .8)));
  let phase = 0;
  const ping = () => {
    if (gen.text && phase < 2) { phase = 2; job.phase('正在写笔记', .35, .98, { expectLen: expectWrite }); }
    else if (gen.think && phase < 1) { phase = 1; job.phase('正在读课件、理清思路', .05, .35, { expectLen: 4000 }); }
    if (phase === 2) job.len(gen.text.length).sub(`已写 ${gen.text.length} 字`);
    else if (phase === 1) job.len(gen.think.length).sub(`已思考 ${gen.think.length} 字`);
    gen.listeners.forEach(fn => fn());
  };
  job.phase('正在连接 DeepSeek', 0, .05, { expectSec: 3 });
  const user = AI.notesPrompt({
    courseName: course.name, title,
    sources: files.filter(Boolean).map(f => ({ name: f.name, text: (f.text || '').slice(0, 600000) })),
    transcript: session ? sessionTranscript(session) : '',
    highlights: session ? session.highlights.map(h => `[${fmtTime(h.t)}] ${h.near}`) : [],
    style, extra,
  });
  let autoStudy = false;
  (async () => {
    try {
      const text = await AI.deepseekStream({
        system: AI.NOTES_SYSTEM, user, signal: gen.ctl.signal, purpose: 'notes',
        onThinking: t => { gen.think = t; ping(); },
        onText: t => { gen.text = t; ping(); },
      });
      note.markdown = text; note.status = 'done';
      autoStudy = thenParts.length > 0 || Settings.load().autoStudy === true;
      toast('笔记生成好了：' + title + (autoStudy ? '，接着出你勾选的复习材料…' : ''));
    } catch (e) {
      note.markdown = gen.text; note.status = gen.text ? 'done' : 'error';
      note.error = e.name === 'AbortError' ? '已停止' : e.message;
      if (e.name !== 'AbortError') toast(e.message, 6000);
    }
    await DB.put('notes', note);
    State.gens.delete(note.id);
    job.done();
    ping();
    if (autoStudy) Study.background(note.id, thenParts.length ? thenParts : ['points', 'quiz']);
  })();
  return note.id;
}

/* ---------- 学习流程：手写笔记 + 课堂录音 ---------- */

/* 新建一份空白笔记。不要求先有课件 —— 画板和录音本来就不依赖课件，
   课件只是左边拿来对照的东西，随时后补。 */
async function newBlankNote(course, { files = [], title = '' } = {}) {
  const f = files[0] || null;
  const n = {
    id: DB.uid('n_'), courseId: course.id, createdAt: Date.now(),
    title: title || `${new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 课堂笔记`,
    markdown: '', status: 'done', sourceFileIds: files.slice(), deskFile: f, model: '',
  };
  await DB.put('notes', n);
  return n;
}

/* 一个入口：进去就是「中间画板 + 右栏实时录音」，课件可有可无。
   以前想学习必须先导课件，没课件就只能在空页面干瞪眼；现在课件只影响左栏。 */
async function studyFlow({ courseId = null, noteId = null, title = '' } = {}) {
  const courses = State.courses;
  if (!courses.length) { toast('先在首页点「新建课程」，建一门课再开始'); return; }
  const course = courses.find(c => c.id === courseId) || courses[0];
  const [allFiles, allNotes] = await Promise.all([
    DB.byIndex('files', 'courseId', course.id),
    DB.byIndex('notes', 'courseId', course.id),
  ]);
  const ready = sortFiles(allFiles.filter(f => f.status === 'ready' || isPdf(f)));
  const notes = allNotes.sort((a, b) => b.createdAt - a.createdAt);
  modal(`<h2>${ICON.mic}手写笔记 + 课堂录音</h2>
    <p class="hint" style="margin:0">不用课件也能开始。iPad 上用 Apple Pencil 直接在笔记上写，右栏同时录音并出中文字幕；下课后点「优化笔记」，AI 把老师讲的和你手写的合到一起。</p>
    <div class="field"><label for="sf-c">哪门课</label><select id="sf-c">${courses.map(c => `<option value="${c.id}" ${c.id === course.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="sf-f">左边放哪份课件（可以不选）</label>
      <select id="sf-f"><option value="">不用课件 / 还没有</option>${ready.map(f => `<option value="${f.id}">${esc(weekOf(f).label)} · ${esc(f.name)}</option>`).join('')}</select>
      <span class="hint">${ready.length ? '只影响左栏显示，不影响手写和录音；上课时也能换' : '这门课还没有课件，左栏先空着。课件以后导进来，再进工作台一样能看'}</span></div>
    <div class="field"><label for="sf-n">记在哪份笔记</label>
      <select id="sf-n"><option value="">新建一份空白笔记</option>${notes.map(n => `<option value="${n.id}" ${n.id === noteId ? 'selected' : ''}>${esc(n.title)}</option>`).join('')}</select></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="sf-go">${ICON.mic}进入：笔记 + 录音</button></div>`, (box, close) => {
    $('#sf-c', box).onchange = e => { close(); studyFlow({ courseId: e.target.value }); };
    $('#sf-go', box).onclick = async () => {
      const fid = $('#sf-f', box).value;
      const chosen = $('#sf-n', box).value;
      let n = chosen ? await DB.get('notes', chosen) : null;
      if (!n) n = await newBlankNote(course, { files: fid ? [fid] : [], title });
      if (fid) {
        n.deskFile = fid;
        if (!(n.sourceFileIds || []).includes(fid)) n.sourceFileIds = [...(n.sourceFileIds || []), fid];
        await DB.put('notes', n);
      }
      // 进工作台先把分栏对到手写和录音：中间笔记 + 右边录音
      DeskPref.set({ mtab: 'note', rtab: 'live' });
      close();
      location.hash = 'desk-' + n.id;
    };
  });
}

/* 课堂结束后：手写 + 录音一起交给 AI 整理进笔记（有录音走完整流程，只有手写就只认手写） */
async function enhanceNote(note, course, after) {
  const ink = typeof Board !== 'undefined' && Board.hasInk(note);
  const hasRec = (note.sessionIds || []).length || note.sessionId;
  if (!hasRec && !ink) { toast('这节课还没有录音，笔记上也还没写东西。先录一段，或者直接在笔记上写'); return; }
  if (hasRec) return runRecap(note, course, after);
  const close = modal(`<h2>手写笔记 → 笔记</h2><div data-job-slot="hw:${note.id}"><div class="thinking"><span class="spin"></span>准备中…</div></div><div id="en-st" class="hint" hidden></div><p class="hint" style="margin:0">会把笔记上的手写识别出来，整理成「我的手写笔记」加到笔记最后，不会动你已经写好的部分。</p>`);
  try {
    await Recap.handwritingMerge(note, course, t => { const el = $('#en-st'); if (el) { el.hidden = false; el.textContent = t; } });
    close(); toast('手写已经整理进笔记');
    after && after();
  } catch (e) { close(); toast(e.message, 6000); }
}

/* 上课：找这份课件已有的笔记，没有就建一份空白的，然后进工作台 */
/* 一键进课堂：直接是三栏（左课件 / 中笔记或画板 / 右翻译·AI），不再先弹模式选择框。
   模式（画板 / 笔记 / 重点…）在课堂里用中栏的标签切换，不用重新进来一次。 */
async function openClassroom(course, fileId) {
  if (!course) { toast('先选一门课'); return; }
  const [files, notes] = await Promise.all([
    DB.byIndex('files', 'courseId', course.id),
    DB.byIndex('notes', 'courseId', course.id),
  ]);
  const ready = sortFiles(files.filter(f => f.status === 'ready' || isPdf(f)));
  const ns = notes.sort((a, b) => b.createdAt - a.createdAt);
  // 优先上次在这门课用的笔记（有 deskFile 的），否则最近一份
  const note = ns.find(n => n.deskFile) || ns[0];
  const fid = fileId || (note && note.deskFile) || (ready[0] && ready[0].id) || '';
  if (note) {
    if (fid && note.deskFile !== fid) { note.deskFile = fid; await DB.put('notes', note); }
    // 进课堂默认是「画板 + 录音」，笔记/重点/卡片在教室里点中栏标签随时切
    DeskPref.set({ left: true, mid: true, mtab: 'note', rtab: 'live' });
    location.hash = 'desk-' + note.id;
    return;
  }
  const title = `${new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${course.code || course.name}`;
  await startClass(course, fid ? [fid] : [], title);
}

async function startClass(course, fileIds, title) {
  const notes = await DB.byIndex('notes', 'courseId', course.id);
  let n = fileIds.length ? notes.filter(x => (x.sourceFileIds || []).includes(fileIds[0])).sort((a, b) => b.createdAt - a.createdAt)[0] : null;
  if (!n) { n = { id: DB.uid('n_'), courseId: course.id, createdAt: Date.now(), title: title || `${new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 课堂笔记`, markdown: '', status: 'done', sourceFileIds: fileIds, model: '' }; await DB.put('notes', n); }
  n.deskFile = fileIds[0] || n.deskFile; await DB.put('notes', n);
  location.hash = 'desk-' + n.id;
}
async function startClassModal(course) {
  const files = sortFiles((await DB.byIndex('files', 'courseId', course.id)).filter(f => f.status === 'ready'));
  const notes = (await DB.byIndex('notes', 'courseId', course.id)).sort((a, b) => b.createdAt - a.createdAt);
  modal(`<h2>开始上课</h2><p class="hint" style="margin:0">Mac 上三栏：左边课件、中间笔记和手写、右边实时翻译和问 AI。iPad 竖着用可以一次看一栏。</p>
    <div class="field"><label for="sc-f">这节课用哪份课件</label><select id="sc-f"><option value="">不用课件</option>${files.map(f => `<option value="${f.id}">${esc(weekOf(f).label)}${phaseOf(f) ? ' · ' + phaseOf(f) : ''} · ${esc(f.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="sc-n">记在哪份笔记</label><select id="sc-n"><option value="">新建空白笔记</option>${notes.map(n => `<option value="${n.id}">${esc(n.title)}</option>`).join('')}</select><span class="hint">选了已经生成好的笔记，上课时可以边听边对照</span></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="sc-go">进入工作台</button></div>`, (box, close) => {
    const fsel = $('#sc-f', box), nsel = $('#sc-n', box);
    fsel.onchange = () => { const m = notes.find(n => (n.sourceFileIds || []).includes(fsel.value)); if (m) nsel.value = m.id; };
    $('#sc-go', box).onclick = async () => {
      close();
      if (nsel.value) { const n = await DB.get('notes', nsel.value); if (fsel.value) { n.deskFile = fsel.value; if (!(n.sourceFileIds || []).includes(fsel.value)) n.sourceFileIds = [...(n.sourceFileIds || []), fsel.value]; await DB.put('notes', n); } location.hash = 'desk-' + n.id; }
      else { const f = files.find(x => x.id === fsel.value); const n = { id: DB.uid('n_'), courseId: course.id, createdAt: Date.now(), title: f ? f.name.replace(/\.[^.]+$/, '') : `${new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 课堂笔记`, markdown: '', status: 'done', sourceFileIds: f ? [f.id] : [], deskFile: f ? f.id : null, model: '' }; await DB.put('notes', n); location.hash = 'desk-' + n.id; }
    };
  });
}

/* ---------- 笔记页 ---------- */
// 笔记页的功能标签：笔记（画布）/ 重点 / 测验 / 思维导图 / 生词本 / 复盘
/* 笔记页的标签：重点 / 测验 / 思维导图 / 生词本 是单独的复习页面，点进去算「进了一页」，
   返回键才能回到这份笔记（以前是原地替换，返回就跳过笔记直接回到更早的页面 / 复习主页）。
   笔记 / 复盘 在笔记页里切换。 */
function noteTabGo(id, tab) {
  if (['points', 'quiz'].includes(tab)) { DB.get('notes', id).then(() => Nav.go('review-' + id + '~' + tab)); return; }
  if (tab === 'vocab') { DB.get('notes', id).then(n => { if (n) Nav.go('vocab~' + n.courseId); }); return; }
  Nav.setTab('note-' + id + (tab === 'note' ? '' : '~' + tab)); renderNote(id, tab);
}
const NOTE_TABS = [['note', '笔记'], ['points', '重点'], ['quiz', '测验'], ['text', '复盘'], ['vocab', '生词本']];
function noteTabsHTML(tab, note) {
  const pg = Study.progress(note);
  return NOTE_TABS.map(([k, l]) => `<button data-ntab="${k}" class="${tab === k ? 'on' : ''}">${l}${k === 'points' && pg.total ? ` <span class="pill mute">${pg.done}/${pg.total}</span>` : ''}${k !== 'note' && k !== 'board' && k !== 'map' && State.studyGens.has(note.id) ? ' <span class="spin" style="width:10px;height:10px;border-width:1.5px"></span>' : ''}</button>`).join('');
}
/* 在 pane 里画一个笔记工具（笔记以外的标签） */
function mountNoteTool(tab, note, course, pane, go) {

  if (tab === 'points') return Study.points(note, pane, { focus: go && go.focus });
  if (tab === 'quiz') return Study.quiz(note, pane, { gotoPoint: id => go && go.toPoint(id) });
  if (tab === 'map') tab = 'text';
  if (tab === 'doc') return docTab(note, course, pane);
  if (tab === 'text') return renderRecap(note, course, pane, note.id, () => mountNoteTool('text', note, course, pane, go));
  if (tab === 'vocab') { pane.innerHTML = `<div class="empty"><strong>生词本</strong>这门课的生词按艾宾浩斯节奏复习。<div class="row" style="justify-content:center;margin-top:12px"><a class="btn primary" href="#vocab~${esc(note.courseId)}">打开生词本</a></div></div>`; return; }

}
async function renderNote(id, tab = 'note', opt = {}) {
  if (!location.hash.slice(1).startsWith('note-' + id)) return; // 已经离开这页了（异步回调晚到），不要把别的页面盖掉
  if (tab === 'board') tab = 'note'; // 画板已经并进笔记，老链接直接落到笔记
  if (tab === 'map') tab = 'text';   // 思维导图并进了「复盘」
  if (['points', 'quiz'].includes(tab)) { Nav.replace('review-' + id + '~' + tab); return; }
  const note = await DB.get('notes', id);
  if (!note) { Nav.replace('home'); return; }
  if (tab === 'vocab') { Nav.replace('vocab~' + note.courseId); return; }
  const course = await DB.get('courses', note.courseId);
  const files = (await Promise.all((note.sourceFileIds || []).map(f => DB.get('files', f)))).filter(Boolean);
  const gen = State.gens.get(id);
  view.innerHTML = `
    <div class="noprint">
      ${Nav.crumb('course-' + note.courseId + '~notes', course ? course.name : '课程')}
      <div class="head" style="margin-top:6px">
        <div class="grow"><h1>${esc(note.title)}</h1>
          <div class="meta">${[fmtDate(note.createdAt), esc(note.model || ''), files.length ? '来源：' + files.map(f => esc(f.name)).join('、') : '', note.sessionId ? '含课堂录音' : ''].filter(Boolean).join(' · ')}</div></div>
        <div class="row"><a class="btn" href="#desk-${id}">上课工作台</a><button class="btn" id="n-ask">问 AI</button></div>
      </div>
      <div class="tabs" id="n-tabs">${noteTabsHTML(tab, note)}</div>
    </div>
    <div id="n-pane"></div>`;
  $$('[data-ntab]').forEach(b => b.onclick = () => noteTabGo(id, b.dataset.ntab));
  $('#n-ask').onclick = () => chatDrawer({ note, course });
  const pane = $('#n-pane');
  // 「笔记」= 课件顺序的笔记文字 + 手写画板（合在一页）；「纯文本」还是老式的文章视图
  if (tab === 'note') {
    // 左边课件、右边笔记（白板），左边滑到哪一页，右边就跟着滚到那一页
    pane.innerHTML = `<div id="note-todo"></div><div class="row noprint note-acts" id="note-acts"></div>
      <div class="nb-split" id="nb-split"><button class="btn small nb-doc-tog noprint" id="nb-doc-tog" aria-expanded="false">📄 显示课件</button><aside class="nb-left" id="nb-left"></aside><section class="nb-right" id="nb-right"></section></div>`;
    // 窄屏（iPad 竖屏 / 手机）：课件默认收起，点一下在画布上方展开，不用滚到最底下找
    const tog = $('#nb-doc-tog');
    const setDoc = on => { $('#nb-split').classList.toggle('doc-on', on); tog.textContent = on ? '收起课件' : '📄 显示课件'; tog.setAttribute('aria-expanded', on ? 'true' : 'false');  };
    tog.onclick = () => setDoc(!$('#nb-split').classList.contains('doc-on'));
    try { localStorage.removeItem('tingkeben.nbDoc'); } catch (e) {}   // 每次打开都是默认（课件收起），不记上次
    renderTodo($('#note-todo'), note, course, () => renderTodo($('#note-todo'), note, course));
    $('#note-acts').innerHTML = noteActsHTML(note, 'board');
    bindNoteActs(note, course, id, 'board');
    // 左右不再自动联动（用户要求：标着页数自己滑）。只有点笔记里的页码小标签时，左边才跳到那一页。
    let docPaneRef = null;
    Board.mount($('#nb-right'), note, { course, onPageJump: p => { if (docPaneRef) docPaneRef.scrollTo(p); } });
    Promise.resolve(noteDocPane($('#nb-left'), note, course, null)).then(x => { docPaneRef = x || null; });
    return;
  }
  if (tab !== 'text') {
    pane.className = 'card pad tool-pane';
    mountNoteTool(tab, note, course, pane, { focus: opt.focus, toPoint: pid => { Nav.setTab('note-' + id + '~points'); renderNote(id, 'points', { focus: pid }); } });
    return;
  }
  pane.innerHTML = `<div id="note-todo"></div><div class="row noprint note-acts" id="note-acts"></div><article class="sheet"><div id="note-body" class="md"></div></article>`;
  const body = $('#note-body'), acts = $('#note-acts');
  renderTodo($('#note-todo'), note, course, () => renderTodo($('#note-todo'), note, course));

  if (gen) {
    acts.innerHTML = '<button class="btn small" id="n-stop">停止生成</button>';
    $('#n-stop').onclick = () => gen.ctl.abort();
    let last = 0, timer = null;
    const paint = () => {
      if (!body.isConnected) { gen.listeners.delete(paint); return; }
      if (!State.gens.has(id)) { gen.listeners.delete(paint); renderNote(id); return; }
      const now = Date.now();
      if (now - last < 250) { clearTimeout(timer); timer = setTimeout(paint, 260); return; }
      last = now;
      body.innerHTML = `<div class="noprint prog-sticky">${Jobs.slot('note:' + id)}${gen.think && !gen.text ? `<details class="hint"><summary>看看它在想什么</summary><pre>${esc(gen.think.slice(-2000))}</pre></details>` : ''}</div>` + (gen.text ? md(gen.text) : '');
    };
    gen.listeners.add(paint); paint();
    return;
  }

  // 复盘：课后把这份笔记（含课堂上老师提到的、你的手写整理、没听懂的、错题）重新理一遍逻辑、重新排版，专门给复习用。
  // 原来的笔记和画布不动，复盘单独存在 note.recap；想看 / 改原文，点「原始笔记」。
  if (!opt.raw) { renderRecap(note, course, pane, id); return; }
  if (note.status === 'error') body.innerHTML = `<div class="empty"><strong>生成失败</strong>${esc(note.error)}</div>`;
  else if (!note.markdown) body.innerHTML = `<div class="empty"><strong>这是一份空白笔记</strong>可以直接点「编辑」写，或者直接在笔记上写；有课件的话点「生成」让 AI 先写一稿。</div>`;
  else body.innerHTML = md(note.markdown) + (note.error ? `<p class="noprint" style="color:var(--warn)">（${esc(note.error)}，内容可能不完整）</p>` : '');
  linkPageRefs(body, note);
  acts.innerHTML = `<button class="btn small" id="n-back-recap">← 回到复盘</button>` + noteActsHTML(note, 'text');
  $('#n-back-recap').onclick = () => renderNote(id, 'text');
  bindNoteActs(note, course, id, 'text');
  $('#n-edit').onclick = () => {
    body.innerHTML = `<textarea id="n-text" style="min-height:60vh;font-family:var(--mono);font-size:14px">${esc(note.markdown)}</textarea>
      <div class="row noprint" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="n-cancel">取消</button><button class="btn primary" id="n-save">保存</button></div>`;
    $('#n-cancel').onclick = () => renderNote(id, 'text', { raw: true });
    $('#n-save').onclick = async () => { note.markdown = $('#n-text').value; await DB.put('notes', note); toast('已保存'); renderNote(id, 'text', { raw: true }); };
  };
}

/* ---------- 复盘 ---------- */
const RECAP_SYSTEM = `你是耐心的商科助教，帮一个英语不好的中国留学生（Monash Diploma of Business 一年级）做课后复盘。
你会拿到他这节课的笔记（可能包含「课堂上老师提到的」、他的手写整理），以及他没听懂的地方和做错的题。
任务：把这些内容重新理一遍逻辑、重新排版，写成一份适合复习的复盘讲义。要求：
- 用中文写，专业术语写成「中文（English）」。
- 不照搬原笔记的顺序：先讲清楚这节课要解决什么问题，再按「概念之间的逻辑关系」重新排（先基础后进阶、因果、对比）。
- 结构：
  ## 一句话总结
  ## 知识框架（用缩进列表画出概念之间的关系）
  ## 逐个讲清楚（每个概念：是什么 → 为什么重要 → 一个简单例子；容易混的放在一起对比，可以用表格）
  ## 老师强调的 / 可能考的
  ## 我还没搞懂的（针对他没听懂的地方和错题，用更简单的话重讲；没有就省略这一节）
  ## 自测 5 题（问答题，每题答案直接写在题目下面）
- 只用材料里有的内容，不要编造课上没讲的东西；材料没说清的地方写「（课件没说清，建议问老师）」。
- 直接从第一个标题开始，不要开场白。`;
function recapInput(note, course, session) {
  const todo = (note.todo || []).filter(x => !x.done).map(x => `- ${x.t}${x.detail ? '：' + x.detail : ''}`).join('\n');
  const quiz = (note.study && note.study.quiz) || [];
  const wrong = (note.wrong || []).map(w => quiz[w.qi]).filter(Boolean).map(q => `- ${q.q}${q.explain ? '（解析：' + String(q.explain).slice(0, 200) + '）' : ''}`).join('\n');
  const tr = session ? sessionTranscript(session).slice(0, 40000) : '';
  return `课程：${course ? course.name : ''}\n这节课：${note.title}\n\n【笔记】\n${String(note.markdown || '').slice(0, 120000)}\n\n` +
    (todo ? `【没听懂 / 待搞懂】\n${todo}\n\n` : '') + (wrong ? `【做错的题】\n${wrong}\n\n` : '') +
    (tr && !/课堂上老师提到/.test(note.markdown || '') ? `【课堂录音转写（语音识别可能有错，只用来补充）】\n${tr}\n\n` : '') +
    '请写复盘讲义。';
}
const recapRunning = new Map();
async function renderRecap(note, course, pane, id, rerender) {
  const busy = recapRunning.get(id);
  const again = () => { if (!pane.isConnected) return; if (rerender) rerender(); else if (location.hash.slice(1) === 'note-' + id + '~text') renderNote(id, 'text'); };
  pane.className = 'card pad tool-pane';
  pane.innerHTML = `<div class="row noprint recap-bar">
      <div class="grow"><b>复盘</b> <span class="hint">${note.recap ? '整理于 ' + fmtDate(note.recapAt || Date.now()) + (note.recapSig && note.recapSig !== recapSig(note) ? ' · 笔记后来改过，可以重新整理' : '') : '课后把这节课重新理一遍逻辑、重新排版，专门用来复习'}</span></div>
      ${note.recap && !busy ? `<button class="btn small" id="rc-copy">复制</button><button class="btn small" id="rc-pdf">导出 PDF</button><button class="btn small" id="rc-redo">重新整理</button>` : ''}
      ${rerender ? '' : '<button class="btn small ghost" id="rc-raw" title="看 / 改原来的笔记文字">原始笔记</button>'}
    </div>
    <div class="recap-host"><div class="recap-wrap">
      <article class="sheet recap-text"><div class="md" id="rc-body"></div></article>
      <aside class="recap-map noprint"><div class="recap-map-h"><b>思维导图</b><span class="hint" id="rc-map-src"></span></div><div id="rc-map"></div></aside>
    </div></div>`;
  const body = $('#rc-body', pane);
  // 右边思维导图：有复盘就按复盘的结构画，没有就先按原笔记的标题画（本地画，不花钱）
  const mapSrc = note.recap && !busy ? note.recap : note.markdown;
  $('#rc-map-src', pane).textContent = note.recap && !busy ? '按复盘画的' : '按笔记标题画的，复盘后会按复盘重画';
  MindMap.mount($('#rc-map', pane), { id: note.id, title: note.title, markdown: mapSrc || '' });
  const rawBtn = $('#rc-raw', pane); if (rawBtn) rawBtn.onclick = () => renderNote(id, 'text', { raw: true });
  const start = () => {
    if (!String(note.markdown || '').trim()) { toast('这份笔记还没有文字：先生成笔记，或者用「手写笔记 + 课堂录音优化笔记」把手写整理进来'); return; }
    if (!keysReady().notes) { toast('先在设置里填 DeepSeek 的 key'); return; }
    const job = Jobs.start('recap:' + id, '复盘：' + note.title);
    const run = (async () => {
      const session = note.sessionId ? await DB.get('sessions', note.sessionId) : null;
      let txt = '';
      job.phase('正在理清这节课的逻辑', .02, .3, { expectLen: 3000 });
      const out = await AI.deepseekStream({
        system: RECAP_SYSTEM, user: recapInput(note, course, session), purpose: 'notes',
        onThinking: t => job.len(t.length).sub(`已思考 ${t.length} 字`),
        onText: t => { if (!txt) job.phase('正在写复盘', .3, .98, { expectLen: 7000 }); txt = t; job.len(t.length).sub(`已写 ${t.length} 字`); const el = pane.isConnected && $('#rc-body', pane); if (el) el.innerHTML = md(t); },
      });
      const n = await DB.get('notes', id) || note;
      n.recap = String(out || '').trim(); n.recapAt = Date.now(); n.recapSig = recapSig(n);
      await DB.put('notes', n); Object.assign(note, { recap: n.recap, recapAt: n.recapAt, recapSig: n.recapSig });
      toast('复盘整理好了：' + note.title);
    })().catch(e => toast('复盘失败：' + e.message, 6000)).finally(() => { job.done(); recapRunning.delete(id); again(); });
    recapRunning.set(id, run);
    renderRecap(note, course, pane, id, rerender);
  };
  if (busy) { body.innerHTML = `<div class="noprint">${Jobs.slot('recap:' + id)}</div>`; return; }
  if (!note.recap) {
    body.innerHTML = `<div class="empty"><strong>还没有复盘</strong>把这节课的笔记、课堂上老师提到的、你的手写整理、没听懂的地方和错题放在一起，重新理顺逻辑、重新排版，最后附 5 道自测题。原来的笔记不会被改。<div class="row" style="justify-content:center;margin-top:12px"><button class="btn primary" id="rc-go">开始复盘</button></div></div>`;
    $('#rc-go', pane).onclick = start; return;
  }
  body.innerHTML = md(note.recap);
  $('#rc-redo', pane).onclick = start;
  $('#rc-copy', pane).onclick = async () => { try { await navigator.clipboard.writeText(note.recap); toast('已复制'); } catch (e) { toast('复制失败'); } };
  $('#rc-pdf', pane).onclick = () => { toast('在打印窗口选「存储为 PDF」'); setTimeout(() => window.print(), 300); };
}
const recapSig = n => { const s = String(n.markdown || '') + '|' + (n.todo || []).length + '|' + (n.wrong || []).length; let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ':' + h; };

function noteActsHTML(note, view) {
  return `
    ${(note.sessionIds || []).length || note.sessionId || Board.hasInk(note) ? `<button class="btn small primary" id="n-recap" title="把老师讲的和你手写的整理进笔记下半部分">${ICON.spark}手写笔记 + 课堂录音优化笔记</button>` : `<button class="btn small" id="n-link">关联课堂录音</button>`}
    <button class="btn small" id="n-files" title="给这份笔记加课件 / 去掉课件，可以随时加新的">＋ 课件${(note.sourceFileIds || []).length ? ' · ' + note.sourceFileIds.length : ''}</button>
    <button class="btn small" id="n-ai" title="把笔记 + 错题 + 没搞懂的打包成一段 prompt">复制给 AI</button>
    <button class="btn small ghost danger-text" data-del-note="${note.id}" title="删除这份笔记">删除笔记</button>
    <details class="more">
      <summary class="btn small">更多</summary>
      <div class="more-menu">
        <button id="n-edit">编辑正文</button>
        <button id="n-copy">复制 Markdown</button>
        ${view === 'board' ? `<a href="#note-${note.id}~text">复盘</a>` : `<a href="#note-${note.id}">笔记 + 手写</a>`}
        <button id="n-pdf">导出 PDF</button>
        <button id="n-regen">${note.markdown ? '重新生成' : '生成'}</button>
      </div>
    </details>`;
}
function bindNoteActs(note, course, id, view) {
  const copy = $('#n-copy'); if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(note.markdown); toast('已复制 Markdown，可以粘贴到 Goodnotes / Notion'); } catch (e) { toast('复制失败，长按文字手动复制'); } };
  const ai = $('#n-ai'); if (ai) ai.onclick = () => aiPackModal(note, course);
  const pdf = $('#n-pdf'); if (pdf) pdf.onclick = () => { toast('在打印窗口选「存储为 PDF」'); setTimeout(() => window.print(), 300); };
  const re = $('#n-regen'); if (re) re.onclick = async () => {
    if (!course) return;
    if (!(note.sourceFileIds || []).length && !note.sessionId) { generateModal({ course, noteId: note.id, title: note.title }); return; }
    await startGeneration({ course, fileIds: note.sourceFileIds || [], sessionId: note.sessionId, title: note.title, style: note.style || 'detailed', extra: note.extra, noteId: note.id });
    renderNote(id);
  };
  const rc = $('#n-recap'); if (rc) rc.onclick = () => enhanceNote(note, course, () => renderNote(id));
  const nf = $('#n-files'); if (nf) nf.onclick = () => noteFilesModal(note, course, () => renderNote(id, view === 'board' ? 'note' : 'text'));
  const lk = $('#n-link'); if (lk) lk.onclick = () => linkSessionModal(note, () => renderNote(id));
  const del = $('#n-del'); if (del) confirmClick(del, '确认删除', async () => { await DB.del('notes', id); toast('笔记已删除'); Nav.back('course-' + note.courseId + '~notes'); });
  const ed = $('#n-edit'); if (ed) ed.onclick = () => editMarkdown(note, () => renderNote(id, view === 'board' ? 'note' : 'text'));
}

/* 改正文：两种视图都能用，弹窗里改，保存后回到原视图 */
function editMarkdown(note, after) {
  modal(`<h2>编辑正文</h2><p class="hint" style="margin:0">手写和课件页不受影响；笔记是按 [p.3] 这样的页码对上课件的。</p>
    <textarea id="em-t" style="min-height:50vh;font-family:var(--mono);font-size:14px;width:100%">${esc(note.markdown || '')}</textarea>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-close>取消</button><button class="btn primary" id="em-save">保存</button></div>`, (box, close) => {
    $('#em-save', box).onclick = async () => { note.markdown = $('#em-t', box).value; await DB.put('notes', note); close(); toast('已保存'); after && after(); };
  });
}

/* 这节还没搞懂的（「没听懂」一键转过来的待办清单） */
function renderTodo(host, note, course, after) {
  const list = (note.todo || []);
  const open = list.filter(x => !x.done);
  if (!list.length) { host.innerHTML = ''; return; }
  host.innerHTML = `<details class="card pad todo-card noprint">
    <summary><b>还没搞懂的 · ${open.length}</b><span class="hint">勾掉就是真懂了</span></summary>
    <div class="todo-list">${list.map(x => `<div class="todo-item ${x.done ? 'done' : ''}" data-td="${esc(x.id)}">
      <button class="todo-box" aria-label="${x.done ? '标记为没懂' : '标记为懂了'}">${x.done ? '✓' : ''}</button>
      <div class="grow"><b>${esc(x.t)}</b>${x.detail ? `<div class="hint todo-d">${esc(x.detail)}</div>` : ''}${x.check ? `<div class="hint todo-c">自测：${esc(x.check)}</div>` : ''}</div>
      ${x.sessionId ? `<a class="btn small ghost" href="#session-${x.sessionId}" title="回到那节课">回看</a>` : ''}
    </div>`).join('')}</div></details>`;
  $$('[data-td]', host).forEach(row => $('.todo-box', row).onclick = async () => {
    await Learn.todoToggle(note, row.dataset.td);
    after && after();
  });
}

/* 一键打包给别的 AI（Claude / ChatGPT / LearnlyAI 都行） */
function aiPackModal(note, course) {
  const st = note.study || {};
  const has = { note: !!note.markdown, points: (st.points || []).length, wrong: (note.wrong || []).length, todo: (note.todo || []).filter(x => !x.done).length };
  modal(`<h2>复制给 AI</h2>
    <p class="hint" style="margin:0">打包成一段 prompt，直接粘到 Claude / ChatGPT / LearnlyAI 继续问，不用手动贴来贴去。</p>
    <div class="checklist">
      ${has.note ? `<label><input type="checkbox" id="ap-note" checked>笔记正文</label>` : ''}
      ${has.points ? `<label><input type="checkbox" id="ap-points" checked>${has.points} 个知识点（已掌握的标 ✓）</label>` : ''}
      ${has.wrong ? `<label><input type="checkbox" id="ap-wrong" checked>${has.wrong} 道做错过的题</label>` : ''}
      ${has.todo ? `<label><input type="checkbox" id="ap-todo" checked>${has.todo} 条还没搞懂的</label>` : ''}
    </div>
    <div class="field"><label for="ap-task">想让它做什么</label><input id="ap-task" type="text" value="查漏补缺，并出 5 道题考我" placeholder="例如：用更简单的中文重讲一遍 / 出 10 道题 / 帮我写复习计划"></div>
    <div class="field"><label for="ap-pre">预览</label><textarea id="ap-pre" rows="7" style="font-family:var(--mono);font-size:12.5px"></textarea></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>关闭</button><button class="btn primary" id="ap-go">复制</button></div>`, (box, close) => {
    const build = () => Learn.packPrompt(note, course, {
      task: $('#ap-task', box).value.trim(),
      note: !!$('#ap-note', box)?.checked, points: !!$('#ap-points', box)?.checked,
      wrong: !!$('#ap-wrong', box)?.checked, todo: !!$('#ap-todo', box)?.checked,
    });
    const upd = () => { $('#ap-pre', box).value = build(); };
    $$('input[type=checkbox], #ap-task', box).forEach(el => el.onchange = upd);
    $('#ap-task', box).oninput = upd;
    upd();
    $('#ap-go', box).onclick = async () => {
      try { await navigator.clipboard.writeText(build()); toast('已复制，粘到 Claude / ChatGPT 就行'); close(); }
      catch (e) { toast('复制失败，手动选中下面的预览复制'); }
    };
  });
}
/* 笔记里的 [p.5] 变成可点的小标签（在工作台里点了会跳到课件那一页） */
function linkPageRefs(body, note) {
  body.innerHTML = body.innerHTML.replace(/\[p\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?\]/g, (m, a) => `<button class="pref" data-page="${a}">p.${a}</button>`);
  $$('.pref', body).forEach(b => b.onclick = () => document.dispatchEvent(new CustomEvent('tkb-goto-page', { detail: { page: Number(b.dataset.page) } })));
}

async function linkSessionModal(note, after) {
  const sessions = (await DB.byIndex('sessions', 'courseId', note.courseId)).sort((a, b) => b.startedAt - a.startedAt);
  if (!sessions.length) { toast('这门课还没有课堂录音'); return; }
  const linked = new Set([].concat(note.sessionIds || [], note.sessionId || []).filter(Boolean));
  modal(`<h2>关联课堂录音</h2><p class="hint" style="margin:0">同一份笔记可以关联好几段录音（一门课上好几节课），整理时一起用。</p>
    <div class="checklist" id="ls-list">${sessions.map(s => `<label><input type="checkbox" value="${s.id}" ${linked.has(s.id) ? 'checked' : ''}>${esc(s.title)} <span class="hint">${fmtDate(s.startedAt)} · ${fmtTime(s.duration)}</span></label>`).join('')}</div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="ls-go">关联</button></div>`, (box, close) => {
    $('#ls-go', box).onclick = async () => {
      const ids = $$('#ls-list input:checked', box).map(i => i.value);
      note.sessionIds = ids;
      note.sessionId = ids[ids.length - 1] || '';
      await DB.put('notes', note); close(); after && after();
    };
  });
}

/* 笔记页左边的课件栏：一页一页画出来，滚到哪一页就告诉右边 */
async function noteDocPane(host, note, course, onPage) {
  const files = sortFiles((await Promise.all((note.sourceFileIds || []).map(id => DB.get('files', id)))).filter(Boolean));
  const pdfs = files.filter(f => f.pages || isPdf(f));
  if (!pdfs.length) {
    host.innerHTML = '<div class="empty"><strong>还没关联课件</strong>把 Moodle 的 PDF 导进来，这里就会一页一页显示，右边笔记跟着走。</div>';
    const sp = host.closest('.nb-split'); if (sp) { sp.classList.add('no-doc'); window.dispatchEvent(new Event('resize')); }
    return;
  }
  let cur = note.deskFile && pdfs.some(f => f.id === note.deskFile) ? note.deskFile : pdfs[0].id;
  const draw = async () => {
    const f = pdfs.find(x => x.id === cur) || pdfs[0];
    const full = await DB.get('files', f.id);
    const pdf = isPdf(f);
    const n = pdf ? await Pdf.count(f.id).catch(() => 0) : (splitPages(full.text).length || 1);
    if (!n) { host.innerHTML = '<div class="empty">这份课件读不出页数</div>'; return; }
    host.innerHTML = `<div class="nb-head">${pdfs.length > 1
      ? `<select id="nb-file" class="dk-sel">${pdfs.map(x => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`
      : `<b class="grow">${esc(f.name)}</b>`}<span class="hint">${n} 页</span></div>
      <div class="nb-pages" id="nb-pages">${Array.from({ length: n }, (_, i) => i + 1).map(p => {
        if (pdf) return `<div class="pdfpage nb-page" data-p="${p}"><div class="ph">第 ${p} 页</div><span class="pnum">P${p}</span></div>`;
        const txt = (splitPages(full.text).find(x => x.n === p) || {}).text || '';
        return `<div class="docpage nb-page" data-p="${p}"><div class="doc-text">${esc(txt)}</div><span class="pnum">P${p}</span></div>`;
      }).join('')}</div>`;
    const sel = $('#nb-file', host); if (sel) sel.onchange = () => { cur = sel.value; draw(); };
    const pages = $('.nb-pages', host);
    if (pdf) {
      const io = new IntersectionObserver(ents => ents.forEach(async en => {
        if (!en.isIntersecting) return;
        const node = en.target; if (node.dataset.done) return; node.dataset.done = '1';
        try { await renderPdfPageInto(node, f.id, Number(node.dataset.p)); } catch (e) { node.innerHTML = `<div class="ph">第 ${node.dataset.p} 页加载失败</div>`; }
      }), { root: pages, rootMargin: '600px' });
      $$('.nb-page', host).forEach(x => io.observe(x));
    }
    let ticking = false;
    const pick = () => {
      ticking = false;
      if (!pages.isConnected || !pages.offsetParent || !pages.clientHeight) return;   // 课件栏收起时不要乱报页码（会把画布拽到最后一块）
      const nodes = $$('.nb-page', host);
      if (!nodes.length) return;
      // 滚到底/滚到顶直接取最后一页/第一页，否则取离顶边最近的那页
      if (pages.scrollTop + pages.clientHeight >= pages.scrollHeight - 6) return onPage && onPage(Number(nodes[nodes.length - 1].dataset.p));
      if (pages.scrollTop <= 2) return onPage && onPage(Number(nodes[0].dataset.p));
      const top = pages.getBoundingClientRect().top + 12;
      let best = 1, bestD = Infinity;
      for (const node of nodes) {
        const r = node.getBoundingClientRect();
        if (r.bottom <= top + 4) continue;
        const d = Math.abs(r.top - top);
        if (d < bestD) { bestD = d; best = Number(node.dataset.p); }
      }
      onPage && onPage(best);
    };
    let lock = 0;
    pages.addEventListener('scroll', () => {
      if (Date.now() < lock) return;
      if (!ticking) { ticking = true; requestAnimationFrame(pick); }
    }, { passive: true });
    setTimeout(pick, 300);
    return {
      scrollTo(p) {
        const el = $(`.nb-page[data-p="${p}"]`, host); if (!el) return;
        lock = Date.now() + 700;          // 防止两边互相推
        el.scrollIntoView({ block: 'start' });
      },
    };
  };
  return draw();
}

async function runRecap(note, course, after) {
  const ink = Board.hasInk(note);
  const close = modal(`<h2>手写笔记 + 课堂录音优化笔记</h2><div data-job-slot="recap:${note.id}"><div class="thinking"><span class="spin"></span>准备中…</div></div><div id="rc-st" class="hint rc-st"></div><p class="hint" style="margin:0">会读这节课的录音转写、你标记的重点${ink ? '和画板上的手写（手写用 Gemini 免费识别，一页一页认）' : ''}，整理成笔记下半部分「课堂上老师提到的」。上半部分的课件笔记不会动。</p><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn small ghost" data-close>先关掉，后台继续</button></div>`);
  try {
    const r = await Recap.run(note, course, { onStatus: t => { const el = $('#rc-st'); if (el) el.textContent = t; } });
    close();
    if (r.full) {
      // 笔记还空着：课件 + 录音 + 手写一起生成整份笔记
      const id = await startGeneration({ course, fileIds: note.sourceFileIds || [], sessionId: note.sessionId, title: note.title, style: note.style || 'detailed', extra: r.handwriting ? '学生的课堂手写笔记如下，请整合进去（放在「课堂上老师提到的」里的「我的手写笔记整理」）：\n' + r.handwriting : '', noteId: note.id });
      location.hash = 'note-' + id; return;
    }
    toast('课堂总结已经写进笔记下半部分');
    after && after();
  } catch (e) { close(); toast(e.message, 6000); }
}

/* ---------- 实时转写翻译 ---------- */
async function renderLive(courseId) {
  const s = Settings.load();
  if (State.live) return renderLiveRunning();
  const courses = State.courses;
  view.innerHTML = `
    <div class="head"><div>${Nav.prev() ? Nav.crumb('home', '课程主页') : ''}<h1>课堂录音</h1><div class="meta">${Settings.load().liveEnglishOnly !== false ? '只转写英文，不翻中文 —— 录音用来课后整理笔记；换回中文可在设置里关掉「只录英文」' : '实时转写老师的英文，并翻成中文字幕；结束后可以一键整理成笔记'}</div></div></div>
    ${!s.geminiKey ? '<div class="banner"><div class="grow"><strong>还没填 Gemini API key</strong></div><a class="btn primary small" href="#settings~ai">去设置</a></div>' : ''}
    <div class="card pad" style="display:flex;flex-direction:column;gap:16px">
      <div class="field"><label for="l-course">这是哪门课</label>
        <select id="l-course"><option value="">不属于任何课程</option>${courses.map(c => `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <span class="hint">选了课程，会用这门课课件里的专业词提高识别准确度，录音也会存进这门课</span></div>
      <div class="row">
        <button class="recbtn" id="l-start" aria-label="开始录音"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg></button>
        <div><strong>开始录音</strong><div class="hint" style="color:var(--muted);font-size:13px">识别语言：${esc(langLabel(s.liveLanguage))} · ${s.liveEnglishOnly !== false ? '只存英文转写' : '英文 + 中文字幕'} · 可在设置里改</div></div>
      </div>
      <label class="switch"><input type="checkbox" id="l-enonly" ${s.liveEnglishOnly !== false ? 'checked' : ''}>只录英文，不翻中文（录音主要用来课后整理笔记，省额度）</label>
    </div>
    <div class="card pad" style="font-size:14px;color:var(--muted);line-height:1.7">
      <strong style="color:var(--ink)">上课时这样用</strong><br>
      · 手机或 iPad 放在离老师近一点的桌上，第一次会问你要麦克风权限，点「允许」。<br>
      · 想一边录一边在 iPad 上手写：用分屏把听课本和 Goodnotes 并排放。听课本完全切到后台时，iPadOS 可能会停掉麦克风（不确定，建议先试一节课）。<br>
      · 听到老师说重点，点「标记重点」，整理笔记时会单独列出来。<br>
      ${s.liveEnglishOnly !== false
        ? '· 现在只存英文转写（不翻中文），所以录音几乎不花额外的翻译额度；课后整理笔记时，AI 直接读英文转写。<br>· 想让这里也出中文字幕，把上面「只录英文」关掉就行。'
        : `· 老师说几个词就会先出灰色的草稿中文${(Settings.load().draftMode || 'free') === 'free' ? '（用 Chrome 内置免费翻译；iPad 上没有这个功能）' : ''}；说完一句或最多 ${Settings.load().maxWaitSec || 6} 秒，就换成黑色的正式翻译。<br>
      · ${AI.translateProvider() === 'deepseek' ? '正式翻译用 DeepSeek，会纠正识别错的专业词、术语前后一致。' : '正式翻译用免费模型池（Groq 两个模型 + Gemini 四个模型轮流用）。在「设置」里多填几家免费 key，就更快、更不容易用完。'}`}
    </div>`;
  const eo = $('#l-enonly');
  if (eo) eo.onchange = () => { Settings.save({ liveEnglishOnly: eo.checked }); renderLive(courseId); };
  $('#l-start').onclick = async () => {
    if (await micState() === 'denied') { micHelp(() => $('#l-start').click()); return; }
    // 必须在点击当下（还没 await 之前）准备 Chrome 内置翻译，否则 Chrome 不让下载模型
    if ((Settings.load().draftMode || 'free') === 'free') AI.prepareLocalTranslator();
    const cid = $('#l-course').value;
    const course = cid ? await DB.get('courses', cid) : null;
    const btn = $('#l-start'); btn.disabled = true;
    const sess = new LiveSession({
      course,
      onUpdate: segs => liveUI.update(segs),
      onInterim: t => liveUI.interim(t),
      onStatus: st => liveUI.status(st),
      onError: m => { liveUI.error(m); },
      onLevel: r => liveUI.level(r),
      onQuiet: mins => liveUI.quiet(mins),
    });
    try {
      await sess.start();
      State.live = sess;
      renderSide();
      renderLiveRunning();
    } catch (e) {
      btn.disabled = false;
      if (e.name === 'NotAllowedError' || /permission|denied/i.test(String(e.message || ''))) micHelp(() => $('#l-start').click());
      else toast(e.name === 'NotFoundError' ? '没找到麦克风。检查麦克风有没有接好，或在「设置」里换一个麦克风。' : e.message, 6000);
      try { sess.capture && sess.capture.stop(); } catch (x) {}
    }
  };
}
/* 麦克风权限引导：Chrome 一旦记住「拒绝」，再点开始录音也不会有任何弹窗，
   所以先查权限状态，被拒就一步步告诉用户去哪儿改。 */
async function micState() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return 'prompt';
    const st = await navigator.permissions.query({ name: 'microphone' });
    return st.state;
  } catch (e) { return 'prompt'; }
}
function micHelp(onRetry) {
  const isIOS = Device.ipad || /iPad|iPhone|iPod/.test(navigator.userAgent);
  modal(`<h2>先允许麦克风</h2>
    <p class="hint" style="margin:0">录音要用麦克风。浏览器只在你点「允许」时才给，之前如果点过「阻止」，它就不会再问了 —— 按下面三步改回来。</p>
    <ol class="mic-steps">
      <li>点地址栏<b>左边那个图标</b>（🔒 锁，或者 ⓘ / 两个滑块的图标）</li>
      <li>找到<b>麦克风（Microphone）</b>，改成 <b>允许（Allow）</b></li>
      <li>回到这个页面<b>刷新一次</b>，再点开始录音</li>
    </ol>
    ${isIOS ? '<p class="hint">iPad / iPhone 的 Safari：点地址栏左边的「大小／aA」→ 网站设置 → 麦克风 → 允许；如果还不行，去「设置 → Safari → 麦克风」看看。</p>' : '<p class="hint">Chrome：也可以点右上角 ⋮ → 设置 → 隐私和安全 → 网站设置 → 麦克风，把 tingkeben 从「不允许」里删掉。</p>'}
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>知道了</button><button class="btn primary" id="mic-retry">我改好了，再试一次</button></div>`, (box, close) => {
    $('#mic-retry', box).onclick = () => { close(); onRetry && onRetry(); };
  });
}
const langLabel = c => ({ 'en-GB': '英语（英式/马来西亚口音）', 'en-US': '英语（美式）', 'en-IN': '英语（印度口音）', 'ms-MY': '马来语', 'cmn-Hans-CN': '普通话', 'yue-Hant-HK': '粤语', auto: '自动识别' }[c] || c);

const liveUI = {
  els: new Map(),
  follow: true,
  update(segs) {
    const box = $('#captions'); if (!box) return;
    for (const g of segs) {
      let el = this.els.get(g.id);
      if (!el || !el.isConnected) {
        el = document.createElement('div'); el.className = 'cap'; el.dataset.id = g.id;
        box.appendChild(el); this.els.set(g.id, el);
      }
      const html = capHTML(g);
      if (el._html !== html || el._cf !== !!g.confused) { el.innerHTML = html; el._html = html; el._cf = !!g.confused; el.className = 'cap' + (g.important ? ' important' : '') + (g.starred ? ' starred' : '') + (g.confused ? ' confused' : ''); const r = $('[data-retry]', el); if (r) r.onclick = () => State.live && State.live.retry(g.id); }
    }
    if (this.follow) box.scrollTop = box.scrollHeight;
  },
  interim(d) {
    const el = $('#interim'); if (!el) return;
    const en = typeof d === 'string' ? d : (d && d.en) || '', zh = (d && d.zh) || '';
    el.innerHTML = en ? `${zh ? `<div class="d-zh">${esc(zh)}<span class="caret"></span></div>` : ''}<div class="d-en">${esc(en)}</div>` : '';
    if (this.follow) { const box = $('#captions'); if (box) box.scrollTop = box.scrollHeight; }
  },
  status(st) {
    const el = $('#l-status'); if (!el) return;
    const map = { live: ['ok', '实时转写中'], reconnecting: ['warn', '重新连接中…'], rotating: ['ok', '实时转写中'], error: ['bad', '转写已停止'], slow: ['warn', '免费额度紧张，翻译放慢'] };
    const [cls, txt] = map[st] || ['mute', st];
    el.className = 'pill ' + cls; el.textContent = txt;
  },
  error(m) { toast(m, 7000); const el = $('#l-err'); if (el) { el.hidden = false; el.textContent = m; } },
  level(r) { const el = $('#l-level'); if (el) el.style.width = Math.min(100, r * 400) + '%'; },
  /* 10 分钟没听到声音：不自动停，问一句（学 Otter 的 NO_SPEECH，但决定权留给人） */
  quiet(mins) {
    const el = $('#l-quiet'); if (!el) return;
    const t = $('#l-quiet-t'); if (t) t.textContent = `已经 ${mins} 分钟没识别到声音`;
    el.hidden = false;
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('听课本还在录音', { body: `${mins} 分钟没听到声音，是不是下课了？`, tag: 'tkb-quiet' }); } catch (e) {}
  },
};
function capHTML(g) {
  // 只录英文时没有中文，别留一行空的「翻译中…」
  if (g.status === 'done' && !g.zh) return `<div class="ts">${fmtTime(g.t)}</div><div><div class="en">${esc(g.en)}</div></div>`;
  const zh = g.status === 'done' ? esc(g.zh) : g.status === 'streaming' ? esc(g.zh) + '<span class="caret"></span>' : g.zhDraft && g.status !== 'failed' ? `<span class="draft">${esc(g.zhDraft)}</span>` : g.status === 'failed' ? `<span class="failed">翻译失败 <button class="btn small ghost" data-retry>重试</button></span>` : '<span class="wait">翻译中…</span>';
  return `<div class="ts" title="${esc(g.by ? '翻译：' + g.by : '')}">${fmtTime(g.t)}</div><div><div class="zh">${zh}</div><div class="en">${esc(g.en)}</div></div>`;
}

function renderLiveRunning() {
  const sess = State.live, s = Settings.load();
  liveUI.els = new Map(); liveUI.follow = true;
  view.innerHTML = `
    <div class="card live-top">
      <button class="recbtn on" id="l-stop" aria-label="停止录音"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg></button>
      <div><div class="clock" id="l-clock">0:00</div><div class="row" style="gap:8px"><span class="pill" id="l-status">连接中…</span><div class="level"><i id="l-level"></i></div></div></div>
      <div class="grow" style="min-width:120px"><strong>${esc(sess.course ? sess.course.name : '课堂录音')}</strong>${sess.vocab.length ? `<div class="hint" style="font-size:12px;color:var(--faint)">已加载 ${sess.vocab.length} 个课程专业词</div>` : ''}</div>
      <button class="btn" id="l-mark">${ICON.star}标记重点</button>
      <button class="btn" id="l-confused" title="课后会用中文重新讲这一段">❓ 没听懂</button>
      <select id="l-view" style="width:auto;min-height:40px"><option value="both">中英</option><option value="zh">只看中文</option><option value="en">只看英文</option></select>
      <div class="row" style="gap:4px"><button class="btn small" id="l-minus" aria-label="字小一点">A−</button><button class="btn small" id="l-plus" aria-label="字大一点">A＋</button></div>
    </div>
    <div class="banner" id="l-err" hidden></div>
    <div class="banner quiet-banner" id="l-quiet" hidden>
      <div class="grow"><strong id="l-quiet-t">已经 10 分钟没识别到声音</strong><div class="hint">是不是下课了？也可能麦克风被静音了。录音还在继续。</div></div>
      <button class="btn small" id="l-quiet-cont">继续录</button>
      <button class="btn small primary" id="l-quiet-stop">结束录音</button>
    </div>
    <div class="card" style="display:flex;flex-direction:column">
      <div class="captions" id="captions"></div>
      <div class="interim" id="interim"></div>
      <button class="btn small jump" id="l-jump" hidden>↓ 回到最新</button>
    </div>`;
  const box = $('#captions');
  const applyView = () => { box.classList.toggle('only-zh', s.captionView === 'zh'); box.classList.toggle('only-en', s.captionView === 'en'); box.style.setProperty('--cap', s.captionSize + 'px'); $('#interim').style.setProperty('--cap', s.captionSize + 'px'); };
  $('#l-view').value = s.captionView; applyView();
  $('#l-view').onchange = e => { Settings.save({ captionView: e.target.value }); s.captionView = e.target.value; applyView(); };
  $('#l-minus').onclick = () => { s.captionSize = Math.max(14, s.captionSize - 2); Settings.save({ captionSize: s.captionSize }); applyView(); };
  $('#l-plus').onclick = () => { s.captionSize = Math.min(40, s.captionSize + 2); Settings.save({ captionSize: s.captionSize }); applyView(); };
  box.addEventListener('scroll', () => {
    liveUI.follow = box.scrollTop + box.clientHeight > box.scrollHeight - 40;
    $('#l-jump').hidden = liveUI.follow;
  });
  $('#l-jump').onclick = () => { liveUI.follow = true; box.scrollTop = box.scrollHeight; $('#l-jump').hidden = true; };
  $('#l-mark').onclick = () => { const t = sess.mark(); toast('已标记 ' + fmtTime(t)); };
  $('#l-confused').onclick = () => { const t = sess.confused(); toast('记下了 ' + fmtTime(t) + '，课后在录音页点「用中文重讲」'); };
  $('#l-quiet-cont').onclick = () => { $('#l-quiet').hidden = true; sess.quietWarned = false; sess.quietSnoozeUntil = Date.now() + 10 * 60000; };
  $('#l-quiet-stop').onclick = () => { $('#l-quiet').hidden = true; $('#l-stop').click(); };
  liveUI.update(sess.segments);
  liveUI.status('live');
  const tick = setInterval(() => { const c = $('#l-clock'); if (!c || !State.live) { clearInterval(tick); return; } c.textContent = fmtTime(sess.elapsed()); }, 500);
  $('#l-stop').onclick = async () => {
    const btn = $('#l-stop'); btn.disabled = true; btn.classList.remove('on');
    liveUI.status('error'); $('#l-status').textContent = '正在收尾…';
    const rec = await sess.stop();
    State.live = null; clearInterval(tick);
    renderSide();
    if (sess.noteId) { const n = await DB.get('notes', sess.noteId); if (n) { n.sessionId = rec.id; await DB.put('notes', n); } }
    location.hash = 'session-' + rec.id;
  };
}

/* ---------- 录音回看 ---------- */
async function renderSession(id) {
  if (location.hash.slice(1) !== 'session-' + id) return; // 已经离开这页了
  const s = await DB.get('sessions', id);
  if (!s) { Nav.replace('home'); return; }
  const course = s.courseId ? await DB.get('courses', s.courseId) : null;
  const failed = s.segments.filter(g => g.status !== 'done').length;
  const view_ = Settings.load().captionView;
  view.innerHTML = `
    <div>
      ${Nav.crumb(course ? 'course-' + course.id + '~sessions' : 'home', course ? course.name : '课程主页')}
      <div class="head" style="margin-top:6px">
        <div class="grow"><h1 id="s-title">${esc(s.title)}</h1><div class="meta">${fmtDate(s.startedAt)} · ${fmtTime(s.duration)} · ${s.segments.length} 句${s.highlights.length ? ' · ' + s.highlights.length + ' 个标记' : ''}</div></div>
        <div class="row">
          ${course ? `<button class="btn primary" id="s-enhance" title="把这段录音和你画板上的手写一起整理进笔记">${ICON.spark}手写笔记 + 课堂录音优化笔记</button><button class="btn" id="s-merge" title="选一份已有笔记，把这节课老师讲的整理进去">并入已有笔记</button><button class="btn small" id="s-gen">整理成新笔记</button>` : ''}
          <button class="btn small" id="s-rename">改名</button>
          <button class="btn small" id="s-copy">复制全文</button>
          ${s.hasAudio ? '<button class="btn small" id="s-audio">下载录音</button>' : ''}
          ${failed ? `<button class="btn small" id="s-fix">补翻 ${failed} 句</button>` : ''}
          <button class="btn small ghost" id="s-del">删除</button>
        </div>
      </div>
    </div>
    ${!course ? '<div class="banner"><div class="grow">这段录音没有归到课程里。要整理成笔记，先把它放进一门课。</div><select id="s-move" style="width:auto"><option value="">选择课程</option>' + State.courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '</select></div>' : ''}
    ${(s.segments || []).length >= 12 ? `<div class="topics noprint">${(s.topics || []).length
      ? s.topics.map((t, i) => `<button class="topic" data-topic="${i}"><b>${esc(t.title)}</b><span>${fmtTime(t.t)}</span></button>`).join('')
      : `<button class="btn small" id="s-topics" title="按老师换话题的位置切段，每段一个标题">${ICON.spark}按话题分段（1 小时也能跳着听）</button>`}</div>` : ''}
    ${(s.confused || []).length ? `<div class="card pad confused-box"><div style="font-size:13px;font-weight:700;color:var(--warn);margin-bottom:8px">❓ 没听懂的地方 · ${s.confused.length}</div>${s.confused.map((c, i) => `<div class="cf" data-cf="${i}"><div class="row"><span class="clock" style="font-size:13px">${fmtTime(c.t)}</span><span class="grow hint cf-near">${esc(c.near.slice(-160))}</span><button class="btn small ghost" data-cf-go>跳过去</button><button class="btn small ${c.explain ? '' : 'primary'}" data-cf-ex>${c.explain ? '重新讲' : '用中文重讲'}</button></div>${c.explain ? `<div class="md cf-ex">${md(c.explain)}</div>` : '<div class="cf-ex" hidden></div>'}</div>`).join('')}      <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn primary" id="s-todo">${ICON.spark}变成复习清单（Top 5）</button></div></div>` : ''}
    ${(s.highlights || []).length ? `<div class="card pad marks-card">
      <div class="row" style="justify-content:space-between"><b>${ICON.star}标记重点 · ${s.highlights.length}</b><span class="hint">只回看你按过标记的时间点，不用从头听</span></div>
      <div class="mark-list">${s.highlights.map((h, i) => `<div class="mark-item"><button class="mark-time" data-hl="${i}" title="跳到这一句">${fmtTime(h.t)}</button><span class="grow mark-near">${esc((h.near || '').slice(0, 90) || '（这里没识别到文字）')}</span><button class="btn small ghost" data-hl-play="${i}">听 30 秒</button></div>`).join('')}</div>
    </div>` : ''}
    ${Object.keys(s.glossary || {}).length ? `<div class="card pad"><div style="font-size:13px;font-weight:700;color:var(--muted);margin-bottom:8px">本节课术语</div><div class="chips">${Object.entries(s.glossary).map(([en, zh]) => `<button class="chip" data-q="${esc(en)}">${esc(en)} <span>${esc(zh)}</span></button>`).join('')}</div></div>` : ''}
    <div class="row noprint">
      <input type="text" id="s-search" class="grow" placeholder="搜索转写内容（英文或中文）" style="max-width:420px">
      <span class="hint" id="s-found"></span>
      <span class="grow"></span>
      <select id="s-view" style="width:auto;min-height:40px"><option value="both">中英</option><option value="zh">只看中文</option><option value="en">只看英文</option></select>
      <button class="btn small" id="s-editmode">修改转写</button>
    </div>
    <div class="card seg-list"><div class="captions" id="s-caps" style="max-height:none">${s.segments.map((g, i) => {
      const gap = i > 0 && g.t - s.segments[i - 1].t > 25;
      return `${gap ? '<div class="para-gap"></div>' : ''}<div class="cap seek${g.important ? ' important' : ''}${g.starred ? ' starred' : ''}${g.confused ? ' confused' : ''}" data-i="${i}">${capHTML(g)}</div>`;
    }).join('') || '<div class="empty" style="margin:16px">这段录音没有识别到内容</div>'}</div></div>
    ${s.hasAudio ? `<div class="player noprint" id="player" hidden>
      <button class="btn small ghost" id="p-back" aria-label="后退 5 秒">↺ 5</button>
      <button class="btn small primary" id="p-play" aria-label="播放">▶</button>
      <button class="btn small ghost" id="p-fwd" aria-label="前进 5 秒">5 ↻</button>
      <span class="clock" id="p-time" style="font-size:13px">0:00</span>
      <input type="range" id="p-seek" min="0" max="${s.duration}" step="1" value="0" class="grow">
      <span class="clock" style="font-size:13px">${fmtTime(s.duration)}</span>
      <button class="btn small" id="p-rate">1x</button>
    </div>` : ''}`;
  const gen = $('#s-gen'); if (gen) gen.onclick = () => generateModal({ course, sessionId: s.id });
  // 按话题分段：有就跳转，没有就生成
  $$('[data-topic]').forEach(b => b.onclick = () => {
    const t = s.topics[Number(b.dataset.topic)];
    if (!t) return;
    jumpTo(t.t);
  });
  const tp = $('#s-topics');
  if (tp) tp.onclick = async () => { try { await Learn.buildTopics(s, course); toast('分好段了'); renderSession(s.id); } catch (e) { toast(e.message, 6000); } };
  const todoBtn = $('#s-todo');
  if (todoBtn) todoBtn.onclick = async () => {
    todoBtn.disabled = true;
    try {
      const notes = await DB.byIndex('notes', 'courseId', s.courseId);
      let n = notes.filter(x => x.sessionId === s.id).sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!n) { n = await newBlankNote(course, {}); n.sessionId = s.id; await DB.put('notes', n); }
      const items = await Learn.confusedList(n, s, course);
      toast(`整理出 ${items.length} 条，已经放进「${n.title}」的待办`);
      location.hash = 'note-' + n.id;
    } catch (e) { toast(e.message, 6000); todoBtn.disabled = false; }
  };
  const enh = $('#s-enhance'); if (enh) enh.onclick = async () => {
    const notes = await DB.byIndex('notes', 'courseId', course.id);
    let n = notes.filter(x => x.sessionId === s.id).sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!n) { n = await newBlankNote(course, {}); }
    await linkSession(n, s.id);
    await enhanceNote(n, course, () => { location.hash = 'note-' + n.id; });
  };
  const mg = $('#s-merge'); if (mg) mg.onclick = async () => {
    const notes = (await DB.byIndex('notes', 'courseId', course.id)).filter(n => n.markdown).sort((a, b) => b.createdAt - a.createdAt);
    if (!notes.length) { toast('这门课还没有笔记，点「整理成新笔记」'); return; }
    modal(`<h2>并入已有笔记</h2><div class="field"><select id="mg-n">${notes.map(n => `<option value="${n.id}" ${n.sessionId === s.id ? 'selected' : ''}>${esc(n.title)}</option>`).join('')}</select><span class="hint">课件笔记不动，在下面加一部分「课堂上老师提到的」：老师强调的、课件之外的补充、课堂提问和答案、你的手写</span></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="mg-go">开始整理</button></div>`, (box, close) => {
      $('#mg-go', box).onclick = async () => { const n = await DB.get('notes', $('#mg-n', box).value); await linkSession(n, s.id); close(); enhanceNote(n, course, () => { location.hash = 'note-' + n.id; }); };
    });
  };

  $$('[data-retry]').forEach(b => b.onclick = () => { const fixBtn = $('#s-fix'); fixBtn && fixBtn.click(); });
  $$('[data-cf]').forEach(row => {
    const c = s.confused[Number(row.dataset.cf)];
    $('[data-cf-go]', row).onclick = () => { let k = 0; s.segments.forEach((g, i) => { if (g.t <= c.t - 8) k = i; }); const el = $(`.cap[data-i="${k}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.click(); el.classList.add('flash-hit'); setTimeout(() => el.classList.remove('flash-hit'), 1600); if (!s.hasAudio) toast('跳到了 ' + fmtTime(c.t) + '（这节没有保存录音，只能看文字）'); } };
    $('[data-cf-ex]', row).onclick = async () => {
      if (!Settings.load().deepseekKey) { toast('先去设置里填 DeepSeek key'); return; }
      const ex = $('.cf-ex', row); ex.hidden = false; ex.className = 'md cf-ex'; ex.innerHTML = '<span class="spin"></span>';
      const around = s.segments.filter(g => g.t >= c.t - 60 && g.t <= c.t + 20).map(g => `[${fmtTime(g.t)}] ${g.en}`).join('\n') || c.near;
      try {
        c.explain = await AI.deepseekStream({ system: '你是耐心的商科助教，学生是英语不好的中国留学生。', user: AI.confusedPrompt({ courseName: course && course.name, around }), thinking: false, maxTokens: 1500, purpose: 'chat', onText: t => { ex.innerHTML = md(t); } });
        await DB.put('sessions', s);
      } catch (e) { ex.textContent = e.message; }
    };
  });
  // 显示方式
  const caps = $('#s-caps');
  const applyView = v => { caps.classList.toggle('only-zh', v === 'zh'); caps.classList.toggle('only-en', v === 'en'); };
  $('#s-view').value = view_; applyView(view_);
  $('#s-view').onchange = e => { Settings.save({ captionView: e.target.value }); applyView(e.target.value); };

  // 搜索：高亮命中句子
  const doSearch = q => {
    q = q.trim().toLowerCase(); let n = 0, first = null;
    $$('.cap', caps).forEach(el => {
      const g = s.segments[el.dataset.i]; const hit = q && ((g.en || '').toLowerCase().includes(q) || (g.zh || '').includes(q));
      el.classList.toggle('hit', !!hit); if (hit) { n++; first = first || el; }
    });
    $('#s-found').textContent = q ? `找到 ${n} 句` : '';
    if (first) first.scrollIntoView({ block: 'center' });
  };
  $('#s-search').addEventListener('input', e => doSearch(e.target.value));
  $$('.chip').forEach(c => c.onclick = () => { $('#s-search').value = c.dataset.q; doSearch(c.dataset.q); });

  // 修改转写（像 Otter 的 Edit transcript）
  let editing = false;
  $('#s-editmode').onclick = async () => {
    editing = !editing;
    $$('.cap .zh, .cap .en', caps).forEach(el => { el.contentEditable = editing ? 'true' : 'false'; });
    caps.classList.toggle('editing', editing);
    $('#s-editmode').textContent = editing ? '保存修改' : '修改转写';
    if (!editing) {
      $$('.cap', caps).forEach(el => { const g = s.segments[el.dataset.i]; g.en = $('.en', el).textContent.trim(); if (g.status === 'done') g.zh = $('.zh', el).textContent.trim(); });
      await DB.put('sessions', s); toast('转写已保存');
    } else toast('直接点文字修改，改完点「保存修改」');
  };

  // 录音回放：点句子跳到那里，播放时高亮当前句（借鉴 Otter）
  const jumpTo = t => { let k = 0; s.segments.forEach((g, i) => { if (g.t <= t) k = i; }); const el = $(`.cap[data-i="${k}"]`, caps); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash-hit'); setTimeout(() => el.classList.remove('flash-hit'), 1600); } return el; };
  if (s.hasAudio) {
    let audio = null, url = null, cur = -1, spanTimer = 0, savedAt = 0;
    const POS_KEY = 'tingkeben.play.' + s.id;
    const ensure = async () => {
      if (audio) return audio;
      const w = await sessionWav(s.id); if (!w) { toast('这段没有保存录音'); return null; }
      url = URL.createObjectURL(w); audio = new Audio(url); audio.preload = 'auto';
      // 断点续听：上次听到哪，下次从哪接着听（借鉴 Otter；只存本机，不参与同步）
      const resumeAt = Number(localStorage.getItem(POS_KEY) || 0);
      if (resumeAt > 5 && (!s.duration || resumeAt < s.duration - 10)) {
        audio.currentTime = resumeAt;
        toast('从上次的 ' + fmtTime(resumeAt) + ' 接着听');
      }
      audio.ontimeupdate = () => {
        if (!$('#p-time')) { audio.pause(); URL.revokeObjectURL(url); return; }
        $('#p-time').textContent = fmtTime(audio.currentTime); $('#p-seek').value = Math.floor(audio.currentTime);
        if (Date.now() - savedAt > 5000) { savedAt = Date.now(); try { localStorage.setItem(POS_KEY, String(Math.floor(audio.currentTime))); } catch (e) {} }
        let i = -1; for (let k = 0; k < s.segments.length; k++) { if (s.segments[k].t - 1.5 <= audio.currentTime) i = k; else break; }
        if (i !== cur) {
          const old = $(`.cap[data-i="${cur}"]`, caps); old && old.classList.remove('playing');
          const el = $(`.cap[data-i="${i}"]`, caps); if (el) { el.classList.add('playing'); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
          cur = i;
        }
      };
      audio.onplay = () => { $('#p-play').textContent = '❚❚'; };
      audio.onpause = () => { const b = $('#p-play'); if (b) b.textContent = '▶'; };
      return audio;
    };
    // 标记回看：听那 30 秒就够，不拖着整段录音走
    const playSpan = async (t, dur) => {
      const a = await ensure(); if (!a) { jumpTo(t); return; }
      a.currentTime = Math.max(0, t - 2); a.play();
      clearTimeout(spanTimer);
      spanTimer = setTimeout(() => { try { a.pause(); } catch (e) {} }, dur * 1000);
    };
    $$('[data-hl]').forEach(b => b.onclick = () => playSpan(s.highlights[Number(b.dataset.hl)].t, 8));
    $$('[data-hl-play]').forEach(b => b.onclick = () => playSpan(s.highlights[Number(b.dataset.hlPlay)].t, 30));
    $('#player').hidden = false;
    $('#p-play').onclick = async () => { const a = await ensure(); if (a) a.paused ? a.play() : a.pause(); };
    $('#p-back').onclick = async () => { const a = await ensure(); if (a) a.currentTime = Math.max(0, a.currentTime - 5); };
    $('#p-fwd').onclick = async () => { const a = await ensure(); if (a) a.currentTime += 5; };
    $('#p-seek').oninput = async e => { const a = await ensure(); if (a) a.currentTime = Number(e.target.value); };
    const rates = [1, 1.25, 1.5, 2, 0.75];
    $('#p-rate').onclick = async () => { const a = await ensure(); if (!a) return; const r = rates[(rates.indexOf(a.playbackRate) + 1) % rates.length]; a.playbackRate = r; $('#p-rate').textContent = r + 'x'; };
    caps.addEventListener('click', async e => {
      if (editing || e.target.closest('button')) return;
      const el = e.target.closest('.cap'); if (!el) return;
      const a = await ensure(); if (!a) return;
      a.currentTime = Math.max(0, s.segments[el.dataset.i].t - 1.5); a.play();
    });
  }
  // 这节没存录音时，标记也能跳：只跳文字，不给假播放器
  $$('[data-hl]').forEach(b => { if (!b.onclick) b.onclick = () => { jumpTo(s.highlights[Number(b.dataset.hl)].t); toast('这节没保存录音，已经跳到对应文字'); }; });
  $$('[data-hl-play]').forEach(b => { if (!b.onclick) b.onclick = () => { const t = s.highlights[Number(b.dataset.hlPlay)].t; jumpTo(t); toast('这节没保存录音，已经跳到 ' + fmtTime(t)); }; });
  $('#s-rename').onclick = () => modal(`<h2>改名</h2><input id="r-in" type="text" value="${esc(s.title)}"><div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="r-ok">保存</button></div>`, (box, close) => {
    $('#r-ok', box).onclick = async () => { s.title = $('#r-in', box).value.trim() || s.title; await DB.put('sessions', s); close(); renderSession(id); };
  });
  $('#s-copy').onclick = async () => { try { await navigator.clipboard.writeText(sessionTranscript(s)); toast('已复制'); } catch (e) { toast('复制失败'); } };
  const au = $('#s-audio'); if (au) au.onclick = async () => { const w = await sessionWav(s.id); if (!w) { toast('没有保存录音'); return; } download(w, s.title.replace(/[\\/:*?"<>|]/g, '_') + '.wav'); };
  const fx = $('#s-fix'); if (fx) fx.onclick = async () => {
    fx.disabled = true; fx.textContent = '补翻中…';
    const todo = s.segments.filter(g => g.status !== 'done');
    for (let i = 0; i < todo.length; i += 6) {
      const batch = todo.slice(i, i + 6);
      try {
        const r = await AI.translateBatch({ items: batch.map((g, j) => ({ id: 's' + j, en: g.en })), context: [], glossary: s.glossary || {}, courseName: course?.name, vocab: [] });
        const by = {}; (r.items || []).forEach(it => { by[String(it.id).replace(/[<>]/g, '')] = it; });
        batch.forEach((g, j) => { const it = by['s' + j]; if (it) { g.zh = it.zh; g.important = !!it.important; g.status = 'done'; } });
      } catch (e) { toast(e.message, 5000); break; }
      await new Promise(r => setTimeout(r, Settings.load().translateGap || 6000));
    }
    await DB.put('sessions', s); renderSession(id);
  };
  confirmClick($('#s-del'), '确认删除', async () => { await DB.delByIndex('audio', 'sessionId', s.id); await DB.del('sessions', s.id); Nav.back(course ? 'course-' + course.id + '~sessions' : 'home'); });
  const mv = $('#s-move'); if (mv) mv.onchange = async () => { if (!mv.value) return; s.courseId = mv.value; await DB.put('sessions', s); toast('已放进课程'); renderSession(id); };
}

/* ---------- 设置 ---------- */
function renderSettings(cat = '') {
  const s = Settings.load();
  const keyField = (id, label, val, hint) => `
    <div class="field"><label for="${id}">${label}</label>
      <div class="keyrow"><input id="${id}" type="password" autocomplete="off" spellcheck="false" value="${esc(val)}" placeholder="粘贴 API key"><button class="btn small" data-show="${id}">显示</button><button class="btn small" data-test="${id}">测试</button></div>
      <span class="hint">${hint}</span><div class="result" id="${id}-r"></div></div>`;
  view.innerHTML = `
    <div class="head"><div><h1>设置</h1><div class="meta">API key 只保存在这台设备的浏览器里，不会上传到别处。Mac 和 iPad 要各填一次。</div></div></div>
    <div class="settings">
      <section class="card pad">
        <div class="row" style="justify-content:space-between"><h2>这台设备</h2><span class="pill">${{ ipad: 'iPad 版', desktop: 'Mac 版', phone: '手机版' }[Device.kind]}</span></div>
        <p>iPad 版：侧边栏能收起、工作台竖屏上下分屏、默认打开画板、按钮更大。一般自动识别，认错了可以在这里改。</p>
        <div class="seg" role="radiogroup" aria-label="设备">${[['auto', '自动识别'], ['desktop', 'Mac'], ['ipad', 'iPad']].map(([v, l]) => `<button data-dev="${v}" class="${Device.choice() === v ? 'on' : ''}">${l}${v === 'auto' ? `（${{ ipad: 'iPad', desktop: 'Mac', phone: '手机' }[Device.detected]}）` : ''}</button>`).join('')}</div>
        <h2 style="margin-top:18px">外观</h2>
        <p>深色模式下页面和笔记画布变暗，手写颜色显示时会自动提亮；课件 PDF 保持白纸，方便看原件。每台设备各自设置。</p>
        <div class="seg theme-seg" role="radiogroup" aria-label="外观">${[
          ['auto', '跟随系统', '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'],
          ['light', '浅色', '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'],
          ['dark', '深色', '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/></svg>'],
        ].map(([v, l, ic]) => `<button data-theme="${v}" role="radio" aria-checked="${(s.theme || 'auto') === v}" class="${(s.theme || 'auto') === v ? 'on' : ''}">${ic}${l}</button>`).join('')}</div>
      </section>
      <section class="card pad">
        <div class="row" style="justify-content:space-between"><h2>课表与上课提醒</h2><button class="btn small" id="set-sched">管理课表</button></div>
        <p>填好每周的上课时间，首页会显示下一节课；开课前 10 分钟提醒你开录，录音自动归到那门课。</p>
        <label class="switch"><input type="checkbox" id="set-remind" ${Schedule.remindOn() ? 'checked' : ''}>开课前 10 分钟提醒（浏览器要允许通知；听课本开着才有效）</label>
      </section>
      <section class="card pad">
        <h2>Gemini（实时转写 + 翻译 + 扫描件识别）</h2>
        <p>在 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> 免费申请，新 key 以 AQ. 开头。</p>
        ${keyField('k-gemini', 'Gemini API key', s.geminiKey, '')}
        <div class="two" style="margin-top:14px">
          <div class="field"><label for="m-live">实时转写模型</label><input id="m-live" type="text" list="dl-live" value="${esc(s.liveModel)}"></div>
          <div class="field"><label for="m-smart">扫描件识别模型</label><input id="m-smart" type="text" list="dl-gem" value="${esc(s.geminiSmartModel)}"></div>
          <div class="field"><label for="l-lang">老师说的语言</label><select id="l-lang">${['en-GB', 'en-US', 'en-IN', 'ms-MY', 'cmn-Hans-CN', 'yue-Hant-HK', 'auto'].map(c => `<option value="${c}" ${s.liveLanguage === c ? 'selected' : ''}>${langLabel(c)}</option>`).join('')}</select></div>
          <div class="field"><label for="l-mode">转写方式</label><select id="l-mode"><option value="SMART" ${s.liveMode === 'SMART' ? 'selected' : ''}>整理版（去掉 um、uh，数字格式化）</option><option value="VERBATIM" ${s.liveMode === 'VERBATIM' ? 'selected' : ''}>逐字版</option></select></div>
        </div>
        <div class="two" style="margin-top:14px">
          <div class="field"><label for="d-mode">草稿翻译（老师说几个词就先出灰色中文）</label>
            <select id="d-mode">
              <option value="free" ${(s.draftMode || 'free') === 'free' ? 'selected' : ''}>免费：Chrome 内置翻译（Mac 的 Chrome 可用）</option>
              <option value="deepseek" ${s.draftMode === 'deepseek' ? 'selected' : ''}>DeepSeek（更准，iPad 也能用）</option>
              <option value="off" ${s.draftMode === 'off' ? 'selected' : ''}>关闭</option>
            </select>
            <div class="row" style="gap:8px;margin-top:4px"><button class="btn small" id="d-dl">下载 Chrome 内置翻译</button><span class="hint" id="d-st"></span></div>
          </div>
          <div class="field"><label for="t-pace">正式翻译节奏</label>
            <select id="t-pace">
              <option value="balanced" ${(s.translatePace || 'balanced') === 'balanced' ? 'selected' : ''}>均衡（推荐）：凑 2 句一起翻，正式中文晚 2–3 秒，额度省约 70%</option>
              <option value="fast" ${s.translatePace === 'fast' ? 'selected' : ''}>极速：一句一翻，最快但最费额度</option>
              <option value="saver" ${s.translatePace === 'saver' ? 'selected' : ''}>省额度：凑 3 句一起翻，晚 4–6 秒，额度省约 80%</option>
            </select><span class="hint">灰色草稿（Chrome 内置翻译）不受影响，照样马上出来</span></div>
          <div class="field"><label for="w-max">老师一直不停时，最多几秒强制翻一次</label><input id="w-max" type="number" min="3" max="20" value="${s.maxWaitSec || 6}"><span class="hint">越小中文越及时，但句子会被切得更碎；建议 5–8</span></div>
        </div>
        <div class="field" style="margin-top:8px"><label for="s-mic">麦克风</label><div class="row"><select id="s-mic" class="grow"><option value="">系统默认麦克风</option>${s.micId ? `<option value="${esc(s.micId)}" selected>上次选的麦克风</option>` : ''}</select><button class="btn small" id="s-mic-scan">列出麦克风</button></div><span class="hint">Mac 外接了麦克风或者用 AirPods 时可以在这里选</span></div>
        <label class="switch" style="margin-top:8px"><input type="checkbox" id="s-auto-study" ${s.autoStudy === true ? 'checked' : ''}>每次生成笔记后，都自动出重点和测验题（默认关；一般在「生成」窗口里按需勾选就行）</label>
        <label class="switch" style="margin-top:8px"><input type="checkbox" id="s-audio" ${s.saveAudio ? 'checked' : ''}>同时保存录音（之后可以下载回听，1 小时约 115MB）</label>
        <label class="switch" style="margin-top:8px"><input type="checkbox" id="s-autodiff" ${s.autoDiff !== false ? 'checked' : ''}>导入课件后自动标出「最难的 3 页」（一次导入最多扫 8 份）</label>
        <label class="switch" style="margin-top:8px"><input type="checkbox" id="l-enonly2" ${s.liveEnglishOnly !== false ? 'checked' : ''}>录音只转写英文，不翻中文（中文实时翻译用别的软件的话，开着更省额度）</label>
        <div class="row" style="margin-top:12px"><button class="btn small" id="t-live">测试实时转写连接</button><div class="result" id="t-live-r"></div></div>
      </section>
      <section class="card pad">
        <h2>课堂正式翻译（免费模型池）</h2>
        <p>按下面的顺序轮流用各家的免费额度：哪家慢（4 秒没出字）、出错或今天额度快用完，就自动换下一家。每家都是免费注册、不用绑卡；填了 key 的才会用。</p>
        <div class="field" style="margin-bottom:12px"><label for="t-prov">翻译方式</label><select id="t-prov">
          <option value="pool" ${s.translateProvider !== 'deepseek' ? 'selected' : ''}>免费模型池（推荐）</option>
          <option value="deepseek" ${s.translateProvider === 'deepseek' ? 'selected' : ''}>只用 DeepSeek</option>
        </select></div>
        <div class="pool" id="pool"></div>
        <div class="field" style="margin-top:12px"><label for="p-fb">免费额度都用完时</label><select id="p-fb">
          <option value="deepseek" ${(s.poolFallback || 'deepseek') === 'deepseek' ? 'selected' : ''}>改用 DeepSeek（付费，只在用完时才花钱）</option>
          <option value="local" ${s.poolFallback === 'local' ? 'selected' : ''}>改用 Chrome 内置翻译（免费，质量差一些，iPad 不能用）</option>
          <option value="pause" ${s.poolFallback === 'pause' ? 'selected' : ''}>暂停翻译，只出英文</option>
        </select></div>
      </section>
      <section class="card pad">
        <h2>DeepSeek（生成笔记）</h2>
        <p>用 V4.1-Flash 读整份课件，生成中英对照笔记。</p>
        ${keyField('k-deepseek', 'DeepSeek API key', s.deepseekKey, '在 platform.deepseek.com 申请，按用量付费')}
        <div class="two" style="margin-top:10px">
          <div class="field"><label for="m-ds">模型</label><input id="m-ds" type="text" list="dl-ds" value="${esc(s.deepseekModel)}"><span class="hint">deepseek-flash = V4.1-Flash-1017</span></div>
          <label class="switch" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="ds-think" ${s.deepseekThinking ? 'checked' : ''}>先思考再写（更准，慢一点）</label>
        </div>
      </section>
      <section class="card pad" id="cloud">
        <div class="row" style="justify-content:space-between"><h2>云服务（跨设备同步）</h2><span class="pill ${Sync.mode() === 'cloud' ? 'ok' : 'mute'}" id="cl-st">${Sync.mode() === 'cloud' ? '已登录' : '未登录'}</span></div>
        <p>登录后，课程、课件、笔记、画板手写、录音转写会自动同步，所有 API key 也存在你自己的云端。换设备只要打开网址、输密码。</p>
        ${Sync.mode() === 'cloud' ? `<div class="row"><span class="hint">云服务：${esc(s.cloudUrl)}</span></div>
          <div class="row" style="margin-top:8px"><button class="btn small primary" id="cl-sync">立即同步</button><button class="btn small" id="cl-push">把本机的 key 存到云端</button><button class="btn small" id="r2-all">全部课件下载到本机</button><button class="btn small ghost" id="cl-out">退出登录</button><span class="hint" id="r2-info"></span></div>`
          : `<div class="row"><button class="btn primary" id="cl-login">登录云服务</button><span class="hint">第一次用？先按「部署说明」在 Cloudflare 建好云服务</span></div>`}
      </section>
      <section class="card pad" id="r2">
        <details><summary style="font-weight:600;cursor:pointer">高级：不用云服务，直接连 R2（要在每台设备填 key）</summary>
        <div class="row" style="justify-content:flex-end"><span class="pill ${Sync.mode() === 'r2' ? 'ok' : 'mute'}" id="r2-st">${Sync.mode() === 'r2' ? '已设置' : '未设置'}</span></div>
        <p>Mac 和 iPad 之间自动同步课程、课件、笔记、画板手写和录音转写（录音音频不同步）。直接连你自己的存储桶，不经过别的服务器；key 只存在这台设备里。</p>
        <details ${Sync.ready() ? '' : 'open'}><summary style="font-weight:600;cursor:pointer">第一次设置（Mac 上做一次，约 10 分钟）</summary>
          <ol class="steps">
            <li>打开 <a href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noopener">Cloudflare</a> 注册（可以用 Gmail），左边菜单进 <b>R2 对象存储</b>，按提示开通。开通要绑一张卡或 PayPal，免费额度内（10 GB）不扣钱（不确定会不会先预授权一小笔）。</li>
            <li>点「创建存储桶」，名字填 <code>tingkeben</code>，位置选「自动」或亚太。</li>
            <li>回到 R2 首页 →「管理 API 令牌」→「创建 API 令牌」：权限选 <b>对象读和写</b>，只给 <code>tingkeben</code> 这个桶。创建后会显示 <b>Access Key ID</b> 和 <b>Secret Access Key</b>（只显示一次，马上复制），页面上方还有 <b>Account ID</b>。</li>
            <li>进 tingkeben 桶 →「设置」→「CORS 策略」→「添加 / 编辑」，把下面这段整段粘贴进去保存：
              <pre class="cors" id="r2-cors">${esc(Sync.CORS(location.origin))}</pre><button class="btn small" id="r2-cors-copy">复制这段</button></li>
            <li>把 Account ID、Access Key ID、Secret Access Key 填到下面，点「测试连接」→「立即同步」。</li>
            <li>iPad：在 Mac 上点「复制设置给另一台设备」，用隔空投送或通用剪贴板发到 iPad，在 iPad 的听课本设置里点「粘贴设置」，所有 API key 一次填好。</li>
          </ol>
        </details>
        <div class="two" style="margin-top:10px">
          <div class="field"><label for="r2-acct">Account ID</label><input id="r2-acct" type="text" autocomplete="off" spellcheck="false" value="${esc(s.r2Account)}" placeholder="32 位字母数字"></div>
          <div class="field"><label for="r2-bucket">存储桶名字</label><input id="r2-bucket" type="text" autocomplete="off" spellcheck="false" value="${esc(s.r2Bucket)}"></div>
          <div class="field"><label for="r2-id">Access Key ID</label><input id="r2-id" type="password" autocomplete="off" spellcheck="false" value="${esc(s.r2KeyId)}"></div>
          <div class="field"><label for="r2-secret">Secret Access Key</label><input id="r2-secret" type="password" autocomplete="off" spellcheck="false" value="${esc(s.r2Secret)}"></div>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn small" id="r2-test">测试连接</button>
          <button class="btn small primary" id="r2-sync">立即同步</button>
          <button class="btn small" id="r2-all2" title="默认只在打开课件时才下载，这里可以一次全部下到本机（离线也能看）">全部课件下载到本机</button>
          <span class="hint" id="r2-info2"></span>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="btn small ghost" id="mv-copy">复制设置给另一台设备</button>
          <button class="btn small ghost" id="mv-paste">粘贴设置</button>
          <span class="hint">会带上所有 API key，只发给你自己的设备</span>
        </div>
      
        </details>
      </section>
      <section class="card pad" id="costs"></section>
      <section class="card pad">
        <h2>数据</h2>
        <p>数据存在这台设备里；设好上面的云同步后会自动同步到另一台设备。也可以手动导出备份。</p>
        <div class="row"><button class="btn small" id="b-export">导出备份</button><label class="btn small">导入备份<input type="file" id="b-import" accept=".json" hidden></label><span class="hint" id="b-usage"></span></div>
      </section>
    </div>
    <datalist id="dl-live"><option value="gemini-3.5-transcribe-live"></datalist>
    <datalist id="dl-gem"><option value="gemini-3.5-flash-lite"><option value="gemini-3.1-flash-lite"><option value="gemini-3.8-flash"><option value="gemini-3.6-flash"></datalist>
    <datalist id="dl-ds"><option value="deepseek-flash"><option value="deepseek-v4-pro"></datalist>`;

  const bind = (sel, key, fn = v => v) => { const el = $(sel); el.addEventListener('change', () => { Settings.save({ [key]: fn(el.type === 'checkbox' ? el.checked : el.value) }); toast('已保存'); }); };
  bind('#k-gemini', 'geminiKey', v => v.trim()); bind('#k-deepseek', 'deepseekKey', v => v.trim());
  bind('#m-live', 'liveModel', v => v.trim()); bind('#m-smart', 'geminiSmartModel', v => v.trim());
  const setSched = $('#set-sched'); if (setSched) setSched.onclick = () => scheduleModal();
  const setRemind = $('#set-remind'); if (setRemind) setRemind.onchange = async e => {
    if (!e.target.checked) { Schedule.setRemind(false); return; }
    const p = await Schedule.askNotify(); Schedule.setRemind(true);
    if (p === 'denied') toast('浏览器通知被拒绝了，只能在页面里提醒', 6000);
  };
  bind('#m-ds', 'deepseekModel', v => v.trim()); bind('#ds-think', 'deepseekThinking');
  bind('#l-lang', 'liveLanguage'); bind('#l-mode', 'liveMode'); bind('#s-audio', 'saveAudio'); bind('#t-prov', 'translateProvider'); bind('#d-mode', 'draftMode'); bind('#t-pace', 'translatePace'); bind('#s-auto-study', 'autoStudy'); bind('#s-mic', 'micId'); bind('#s-autodiff', 'autoDiff'); bind('#l-enonly2', 'liveEnglishOnly');
  $('#s-mic-scan').onclick = async () => {
    try {
      const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach(t => t.stop());
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput');
      const cur = Settings.load().micId;
      $('#s-mic').innerHTML = '<option value="">系统默认麦克风</option>' + devs.map(d => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || '麦克风')}</option>`).join('');
      toast(`找到 ${devs.length} 个麦克风`);
    } catch (e) { toast('没有麦克风权限：' + e.message, 5000); }
  };
  bind('#w-max', 'maxWaitSec', v => Math.max(3, Math.min(20, Number(v) || 6)));
  const dst = $('#d-st'), ddl = $('#d-dl');
  const showLocal = async () => {
    const a = AI.localReady() ? 'available' : await AI.localAvailability();
    dst.textContent = { available: '已就绪 ✓', downloadable: '还没下载（约几十 MB，下载一次就行）', downloading: '下载中…', unsupported: '这个浏览器不支持（iPad / Safari 用 DeepSeek 草稿或关闭）' }[a] || a;
    ddl.hidden = a === 'available' || a === 'unsupported';
  };
  showLocal();
  ddl.onclick = () => {
    dst.textContent = '下载中…';
    AI.prepareLocalTranslator(p => { dst.textContent = `下载中 ${Math.round(p * 100)}%`; }).then(t => { if (t) { toast('Chrome 内置翻译已就绪'); } else toast('下载失败，稍后再试'); showLocal(); });
  };
  bind('#p-fb', 'poolFallback');
  renderPool();
  renderCosts();
  bindR2();
  $$('.theme-seg [data-theme]').forEach(b => b.onclick = () => {
    const v = b.dataset.theme; Settings.save({ theme: v }); if (window.__tkTheme) window.__tkTheme(v);
    $$('.theme-seg [data-theme]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
  });
  $$('[data-dev]').forEach(b => b.onclick = () => { Device.setChoice(b.dataset.dev); toast('已切换，正在重新打开…'); setTimeout(() => location.reload(), 500); });
  settingsCategories(cat);
  $$('[data-show]').forEach(b => b.onclick = () => { const i = $('#' + b.dataset.show); i.type = i.type === 'password' ? 'text' : 'password'; b.textContent = i.type === 'password' ? '显示' : '隐藏'; });
  $$('[data-test]').forEach(b => b.onclick = async () => {
    const id = b.dataset.test, r = $('#' + id + '-r');
    // 先保存输入框里的值
    const v = $('#' + id).value.trim();
    Settings.save({ [{ 'k-gemini': 'geminiKey', 'k-deepseek': 'deepseekKey' }[id]]: v });
    r.className = 'result'; r.textContent = '测试中…'; b.disabled = true;
    try {
      if (id === 'k-gemini') {
        const names = await AI.testGemini(); const st = Settings.load();
        const want = [st.geminiFastModel, st.geminiSmartModel, st.liveModel];
        const missing = want.filter(m => !names.includes(m));
        r.className = 'result ' + (missing.length ? 'bad' : 'ok');
        r.textContent = missing.length ? `key 可用，但这些模型你的账号用不了：${missing.join('、')}。可用的有：${names.filter(n => /flash|live|transcribe/.test(n)).slice(0, 12).join('、')}` : `可用 ✓（找到 ${names.length} 个模型，包括设置里的 3 个）`;
      } else {
        const { names, balance } = await AI.testDeepseek();
        r.className = 'result ok'; r.textContent = `可用 ✓ 模型：${names.join('、')}${balance ? ` · 余额 ${balance.total_balance} ${balance.currency}` : ''}`;
      }
    } catch (e) { r.className = 'result bad'; r.textContent = e.message; }
    b.disabled = false;
  });
  $('#t-live').onclick = () => {
    const r = $('#t-live-r'); r.className = 'result'; r.textContent = '连接中…';
    if (!Settings.load().geminiKey) { r.className = 'result bad'; r.textContent = '先填 Gemini key'; return; }
    const t = new LiveTranscriber({ vocab: [], onStatus: st => { if (st === 'live') { r.className = 'result ok'; r.textContent = '实时转写可以用 ✓'; t.stopping = true; try { t.ws.close(); } catch (e) {} } }, onError: m => { r.className = 'result bad'; r.textContent = m; } });
    t.start();
    setTimeout(() => { if (r.textContent === '连接中…') { r.className = 'result bad'; r.textContent = '10 秒内没连上：检查 key，或者你的账号暂时用不了这个实时模型'; t.stopping = true; try { t.ws && t.ws.close(); } catch (e) {} } }, 10000);
  };
  $('#b-export').onclick = exportBackup;
  $('#b-import').onchange = e => { const f = e.target.files[0]; if (f) importBackup(f); };
  navigator.storage?.estimate?.().then(est => { $('#b-usage') && ($('#b-usage').textContent = `已用 ${fmtSize(est.usage || 0)}`); }).catch(() => {});
}

/* 免费模型池：每家一行，按优先顺序 */
function renderPool() {
  const box = $('#pool'); if (!box) return;
  const s = Settings.load();
  box.innerHTML = AI.poolStatus().map((p, i) => {
    const shared = p.shareKey ? `用 ${p.shareKey} 的 key（这个模型有自己单独的免费额度）` : p.id === 'deepseek' ? '用下面填的 DeepSeek key；只在「免费额度都用完时」选了 DeepSeek 才会用' : '';
    return `
    <div class="prow ${p.off ? 'off' : ''}" data-id="${p.id}">
      <div class="pnum">${i + 1}</div>
      <div class="pmain">
        <div class="row" style="gap:8px"><strong>${esc(p.label)}</strong><span class="hint">${esc(p.note)}</span>
          <span class="grow"></span>
          <span class="pill ${p.hasKey ? (p.cooling ? 'warn' : 'ok') : 'mute'}">${p.hasKey ? (p.cooling ? '暂停中' : '可用') : '没填 key'}</span>
          <span class="hint" style="font-variant-numeric:tabular-nums">今天 ${p.today}${p.rpd < 1e8 ? ' / ' + p.rpd : ''} 次</span></div>
        ${shared ? `<div class="hint">${shared}</div>` : `
        <div class="keyrow" style="margin-top:6px"><input type="password" data-key="${p.keyField}" value="${esc(s[p.keyField] || '')}" placeholder="粘贴 ${esc(p.label)} API key" autocomplete="off" spellcheck="false">
          <a class="btn small" href="${p.signup}" target="_blank" rel="noopener">去申请</a></div>`}
        <div class="row" style="gap:8px;margin-top:6px">
          <input type="text" data-model="${p.modelField}" value="${esc(p.model)}" style="max-width:260px;min-height:34px;font-family:var(--mono);font-size:13px" aria-label="${esc(p.label)} 模型">
          <button class="btn small" data-ptest="${p.id}">测试</button>
          ${p.paid ? '' : `<label class="switch" style="font-size:13px"><input type="checkbox" data-poff="${p.id}" ${p.off ? '' : 'checked'}>启用</label>`}
          <span class="result" data-pres="${p.id}"></span>
        </div>
      </div>
    </div>`;
  }).join('');
  $$('[data-key]', box).forEach(i => i.onchange = () => { Settings.save({ [i.dataset.key]: i.value.trim() }); toast('已保存'); renderPool(); });
  $$('[data-model]', box).forEach(i => i.onchange = () => { Settings.save({ [i.dataset.model]: i.value.trim() }); toast('已保存'); });
  $$('[data-poff]', box).forEach(c => c.onchange = () => { const off = Object.assign({}, Settings.load().poolOff || {}); off[c.dataset.poff] = !c.checked; Settings.save({ poolOff: off }); renderPool(); });
  $$('[data-ptest]', box).forEach(b => b.onclick = async () => {
    const p = AI.POOL.find(x => x.id === b.dataset.ptest), r = $(`[data-pres="${p.id}"]`, box);
    r.className = 'result'; r.textContent = '测试中…'; b.disabled = true;
    const t0 = performance.now();
    try {
      const out = await AI.translateWith(p, { items: [{ id: 's0', en: 'So when you record the bit side, the debit side, the accounting equation must still balance.' }], context: [], glossary: {}, courseName: 'MMD1010 Accounting 101', vocab: ['debit', 'accounting equation'] });
      r.className = 'result ok'; r.textContent = `✓ ${Math.round(performance.now() - t0)} 毫秒：${out.items[0].zh}`;
    } catch (e) { r.className = 'result bad'; r.textContent = e.message; }
    b.disabled = false;
  });
}

/* 云同步设置 */
/* 登录云服务的窗口（设置页和主页都用） */
function cloudLoginModal(after) {
  const s = Settings.load();
  modal(`<h2>登录听课本云服务</h2>
    <div class="field"><label for="cl-url">云服务网址</label><input id="cl-url" type="url" autocomplete="url" spellcheck="false" value="${esc(s.cloudUrl || DEFAULT_CLOUD)}" placeholder="https://tingkeben-cloud.你的名字.workers.dev"></div>
    <div class="field"><label for="cl-pw">密码</label><input id="cl-pw" type="password" autocomplete="current-password"></div>
    <div class="hint" id="cl-msg"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="cl-go">登录</button></div>`, (box, close) => {
    const pw = $('#cl-pw', box); (s.cloudUrl || DEFAULT_CLOUD ? pw : $('#cl-url', box)).focus();
    const go = async () => {
      const url = $('#cl-url', box).value, p = pw.value;
      if (!url || !p) { $('#cl-msg', box).textContent = '网址和密码都要填'; return; }
      const b = $('#cl-go', box); b.disabled = true; $('#cl-msg', box).textContent = '登录中…';
      try {
        const r = await Sync.login(url, p);
        close(); toast(r.pulled ? '登录成功，API key 已经从云端拿下来了，正在同步课程…' : '登录成功，本机的 API key 已经存到云端，正在同步…', 5000);
        await loadCourses(); after ? after() : route();
      } catch (e) { $('#cl-msg', box).textContent = '✗ ' + e.message; b.disabled = false; }
    };
    $('#cl-go', box).onclick = go;
    pw.onkeydown = e => { if (e.key === 'Enter') go(); };
  });
}
const DEFAULT_CLOUD = 'https://tingkeben-cloud.yuenkit122.workers.dev';

function bindR2() {
  const cl = $('#cl-login'); if (cl) cl.onclick = () => cloudLoginModal(renderSettings);
  const co = $('#cl-out'); if (co) co.onclick = () => modal(`<h2>退出登录</h2><p style="margin:0">这台设备不再自动同步。课件和笔记还留在这台设备上。</p><label class="switch"><input type="checkbox" id="lo-k" checked>同时清掉这台设备上的 API key（借别人电脑用的话一定要勾）</label><div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="lo-go">退出</button></div>`, (box, close) => { $('#lo-go', box).onclick = () => { Sync.logout($('#lo-k', box).checked); close(); toast('已退出云服务'); renderSettings(); }; });
  const cs = $('#cl-sync'); if (cs) cs.onclick = async () => { cs.disabled = true; await Sync.syncNow({ onProgress: t => { const i = $('#r2-info'); if (i) i.textContent = t; } }); cs.disabled = false; };
  const cp = $('#cl-push'); if (cp) cp.onclick = async () => { try { await Sync.pushVault(); toast('已经把这台设备的 API key 存到云端'); } catch (e) { toast(e.message, 6000); } };
  const info = $('#r2-info') || $('#r2-info2'); if (!info) return;
  const paint = st => { if (!info.isConnected) { Sync.listeners.delete(paint); return; } info.textContent = st.running ? '同步中…' : st.err ? '上次出错：' + st.err : st.at ? '上次同步 ' + fmtDate(st.at) : ''; };
  Sync.listeners.add(paint); paint(Sync.status());
  [['#r2-acct', 'r2Account'], ['#r2-bucket', 'r2Bucket'], ['#r2-id', 'r2KeyId'], ['#r2-secret', 'r2Secret']].forEach(([id, k]) => $(id).addEventListener('change', e => { Settings.save({ [k]: e.target.value.trim() }); paint(Sync.status()); }));
  $('#r2-cors-copy').onclick = async () => { try { await navigator.clipboard.writeText($('#r2-cors').textContent); toast('已复制，粘贴到 R2 的 CORS 策略里'); } catch (e) { toast('复制失败，手动选中复制'); } };
  const info2 = $('#r2-info2');
  $('#r2-test').onclick = async () => { const b = $('#r2-test'); b.disabled = true; const info = info2; info.textContent = '测试中…'; try { await Sync.test(); info.textContent = '✓ 连接正常，可以同步'; Sync.start(); } catch (e) { info.textContent = '✗ ' + e.message; } b.disabled = false; };
  $('#r2-sync').onclick = async () => { const b = $('#r2-sync'); b.disabled = true; await Sync.syncNow({ onProgress: t => { info2.textContent = t; } }); b.disabled = false; paint(Sync.status()); };
  const dlAll = $('#r2-all') || $('#r2-all2'); if (dlAll) dlAll.onclick = async () => { const b = dlAll; b.disabled = true; try { const n = await Sync.downloadAll(t => { info.textContent = '下载 ' + t; }); toast(n ? `下载了 ${n} 个课件` : '课件都已经在本机了'); } catch (e) { toast(e.message, 6000); } b.disabled = false; paint(Sync.status()); };
  $('#mv-copy').onclick = async () => { try { await navigator.clipboard.writeText(Sync.exportSettings()); toast('已复制。用隔空投送或通用剪贴板发到 iPad，再点「粘贴设置」', 5000); } catch (e) { modal(`<h2>复制下面这段</h2><textarea readonly style="min-height:120px">${esc(Sync.exportSettings())}</textarea><div class="row" style="justify-content:flex-end"><button class="btn" data-close>好</button></div>`); } };
  $('#mv-paste').onclick = () => modal(`<h2>粘贴设置</h2><textarea id="mv-t" style="min-height:120px" placeholder="TKB1:……"></textarea><div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="mv-go">导入</button></div>`, (box, close) => {
    navigator.clipboard?.readText?.().then(t => { if (/^TKB1:/.test(t)) $('#mv-t', box).value = t; }).catch(() => {});
    $('#mv-go', box).onclick = () => { try { const n = Sync.importSettings($('#mv-t', box).value); close(); toast(`导入了 ${n} 项设置`); renderSettings(); if (Sync.ready()) { Sync.start(); Sync.syncNow(); } } catch (e) { toast('格式不对，要粘贴以 TKB1: 开头的那一段'); } };
  });
}

/* 用量与费用看板 */
const PURPOSE = { notes: '生成笔记', study: '重点 / 卡片 / 测验', prep: '课前包', chat: '问 AI', recap: '录音总结 / 手写', doctr: '课件翻译', translate: '课堂正式翻译', draft: '草稿翻译', other: '其他' };
function renderCosts() {
  const box = $('#costs'); if (!box) return;
  const all = AI.Costs.all(); const months = Object.keys(all).sort().reverse();
  const m = box.dataset.m || months[0] || AI.Costs.month();
  const row = all[m] || {};
  const ds = row.deepseek || {}, live = row.live || {}, gem = row.gemini || {}, pool = row.pool || {};
  const yuan = AI.Costs.yuan(ds);
  const tk = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n || 0);
  const purposes = Object.keys(PURPOSE).map(k => ({ k, r: row['ds_' + k] })).filter(x => x.r);
  const maxY = Math.max(0.0001, ...purposes.map(x => AI.Costs.yuan(x.r)));
  const poolRows = AI.POOL.filter(p => pool[p.id]).map(p => ({ label: p.label, n: pool[p.id] }));
  const p = AI.Costs.price();
  box.innerHTML = `
    <div class="row" style="justify-content:space-between"><h2>用量与费用</h2><select id="cs-m" style="width:auto;min-height:34px">${(months.length ? months : [m]).map(x => `<option ${x === m ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div class="cost-tiles">
      <div class="tile"><div class="tk">DeepSeek 本月花费</div><div class="tv">¥${yuan.toFixed(2)}</div><div class="hint">${ds.calls || 0} 次 · 输入 ${tk((ds.miss || 0) + (ds.hit || 0))}（缓存命中 ${tk(ds.hit)}）· 输出 ${tk(ds.out)}</div></div>
      <div class="tile"><div class="tk">Gemini 实时转写</div><div class="tv">${Math.round((live.sec || 0) / 60)} 分钟</div><div class="hint">${live.sessions || 0} 节课 · 免费额度</div></div>
      <div class="tile"><div class="tk">免费翻译调用</div><div class="tv">${poolRows.reduce((n, r) => n + r.n, 0)} 次</div><div class="hint">约 ${tk(pool.tokens)} tokens · ¥0</div></div>
      <div class="tile"><div class="tk">Gemini 识别（扫描件 / 手写）</div><div class="tv">${gem.calls || 0} 次</div><div class="hint">免费额度</div></div>
    </div>
    ${purposes.length ? `<div class="hint" style="margin:10px 0 4px">DeepSeek 花在哪</div><div class="bars">${purposes.map(x => { const y = AI.Costs.yuan(x.r); return `<div class="bar-row"><span>${PURPOSE[x.k]}</span><div class="bar-track"><i style="width:${Math.max(2, y / maxY * 100)}%"></i></div><b>¥${y.toFixed(2)}</b><span class="hint">${x.r.calls} 次</span></div>`; }).join('')}</div>` : '<p class="hint">这个月还没有用过 DeepSeek</p>'}
    ${poolRows.length ? `<div class="hint" style="margin:10px 0 4px">免费翻译各家用了多少次</div><div class="chips">${poolRows.map(r => `<span class="chip">${esc(r.label)} <span>${r.n}</span></span>`).join('')}</div>` : ''}
    <details style="margin-top:10px"><summary class="hint">DeepSeek 价格（元 / 百万 tokens，官网调价了就改这里）</summary>
      <div class="row" style="margin-top:8px"><label class="field grow"><span class="hint">输入（没命中缓存）</span><input type="number" step="0.1" id="cs-in" value="${p.miss}"></label><label class="field grow"><span class="hint">输入（命中缓存）</span><input type="number" step="0.01" id="cs-hit" value="${p.hit}"></label><label class="field grow"><span class="hint">输出</span><input type="number" step="0.1" id="cs-out" value="${p.out}"></label></div>
      <p class="hint">花费是按这里的价格估算的，以 DeepSeek 官网账单为准；缓存命中价（不确定）请对照官网。</p>
    </details>`;
  $('#cs-m', box).onchange = e => { box.dataset.m = e.target.value; renderCosts(); };
  [['#cs-in', 'dsPriceIn'], ['#cs-hit', 'dsPriceHit'], ['#cs-out', 'dsPriceOut']].forEach(([id, k]) => $(id, box).onchange = e => { Settings.save({ [k]: Number(e.target.value) }); renderCosts(); });
}

/* 备份：课程、笔记、录音文字、课件文字（不含原文件和音频，体积小） */
async function exportBackup() {
  const [courses, notes, sessions, files] = await Promise.all(['courses', 'notes', 'sessions', 'files'].map(s => DB.all(s)));
  const data = { app: 'tingkeben', version: 1, exportedAt: new Date().toISOString(), courses, notes, sessions, files: files.map(({ blob, ...f }) => f) };
  download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `听课本备份-${new Date().toISOString().slice(0, 10)}.json`);
  toast('备份已导出（不含原始课件文件和录音音频）', 4000);
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'tingkeben') throw new Error('这不是听课本的备份文件');
    let n = 0;
    for (const st of ['courses', 'notes', 'sessions', 'files']) for (const it of data[st] || []) { await DB.put(st, it); n++; }
    await loadCourses(); toast(`导入了 ${n} 条记录`); route();
  } catch (e) { toast('导入失败：' + e.message, 5000); }
}



/* 设置分类：首页只放分类卡片，点进去才看到具体设置 */
const SET_CATS = [
  ['device', '外观和设备', '浅色 / 深色 · Mac 版 / iPad 版'],
  ['schedule', '课表与提醒', '每周上课时间、开课前提醒'],
  ['ai', 'AI 和 API key', 'Gemini、DeepSeek、生成笔记'],
  ['translate', '课堂翻译', '免费模型池、翻译节奏'],
  ['sync', '云同步', 'Mac 和 iPad 之间同步'],
  ['usage', '用量和费用', '这个月花了多少'],
  ['data', '数据和备份', '导出、导入备份'],
];
const SET_ORDER = ['device', 'schedule', 'ai', 'translate', 'ai', 'sync', 'sync', 'usage', 'data']; // 设置页里每个区块属于哪一类（按出现顺序）
function settingsCategories(cat) {
  const wrap = $('.settings'); if (!wrap) return;
  const secs = $$(':scope > section', wrap);
  secs.forEach((sec, i) => { sec.dataset.cat = SET_ORDER[i] || 'data'; });
  const head = $('.head', view);
  if (!cat || !SET_CATS.some(c => c[0] === cat)) {
    secs.forEach(sec => { sec.hidden = true; });
    const s = Settings.load(), st = Sync.status();
    const status = {
      device: ({ auto: '跟随系统', light: '浅色', dark: '深色' }[s.theme || 'auto']) + ' · ' + { ipad: 'iPad 版', desktop: 'Mac 版', phone: '手机版' }[Device.kind],
      schedule: Schedule.load().length ? `${Schedule.load().length} 节课${Schedule.remindOn() ? ' · 会提醒' : ''}` : '还没填',
      ai: s.geminiKey && s.deepseekKey ? '✓ 两个 key 都填了' : `还没填：${[!s.geminiKey && 'Gemini', !s.deepseekKey && 'DeepSeek'].filter(Boolean).join('、')}`,
      translate: { pool: '免费模型池', deepseek: 'DeepSeek', gemini: 'Gemini' }[s.translateProvider] || s.translateProvider || '',
      sync: !st.ready ? '还没登录' : st.counts && (st.counts.up + st.counts.down + st.counts.del) ? `${st.counts.up + st.counts.down + st.counts.del} 个没同步` : '✓ 已登录',
      usage: '', data: '',
    };
    const warn = { ai: !(s.geminiKey && s.deepseekKey), sync: !st.ready };
    wrap.insertAdjacentHTML('afterbegin', `<div class="set-cats">${SET_CATS.map(([k, t, d]) => `<a class="set-cat" href="#settings~${k}"><b>${t}</b><small>${d}</small>${status[k] ? `<span class="pill ${warn[k] ? 'warn' : 'mute'}">${esc(status[k])}</span>` : ''}<span class="set-go">›</span></a>`).join('')}</div>`);
    return;
  }
  secs.forEach(sec => { sec.hidden = sec.dataset.cat !== cat; });
  const title = SET_CATS.find(c => c[0] === cat)[1];
  if (head) head.innerHTML = `<div>${Nav.crumb('settings', '设置')}<h1 style="margin-top:6px">${title}</h1></div>`;
}

/* ---------- 复习模式：大字、少按钮，适合 iPad 拿在手上看 ---------- */
const REVIEW_TABS = [['note', '笔记'], ['text', '复盘'], ['points', '重点'], ['quiz', '测验']];
const ReviewPref = {
  get() { try { return Object.assign({ size: Device.ipad ? 19 : 17 }, JSON.parse(localStorage.getItem('tingkeben.review') || '{}')); } catch (e) { return { size: 18 }; } },
  set(p) { try { localStorage.setItem('tingkeben.review', JSON.stringify(Object.assign(this.get(), p))); } catch (e) {} },
};
async function renderReview(courseId) {
  const all = (await DB.all('notes')).filter(n => n.status !== 'generating').sort((a, b) => b.createdAt - a.createdAt);
  const courses = State.courses;
  const list = courseId ? all.filter(n => n.courseId === courseId) : all;
  const cname = id => (courses.find(c => c.id === id) || {}).name || '';

  // 正反馈：先说本周掌握了多少，而不是「0/32 还差 32 个」
  const wk = Learn.week(list);
  const goal = 0.6, diff = Math.round((wk.rate - goal) * 100);
  const mood = !wk.total ? 'flat' : diff >= 0 ? 'up' : 'down';
  const moodText = !wk.total ? '本周还没有新笔记，先看下面的「今天先看什么」'
    : diff >= 0 ? `比「本周掌握 60%」的目标领先 ${diff} 个百分点，保持住`
    : `离「本周掌握 60%」还差 ${-diff} 个百分点，先把标了 ○ 的知识点过一遍`;

  // 今天先看什么：按考核截止日算，不花 token
  const plan = Learn.priority(all, courses);
  const wb = Learn.wrongList(all, courses);

  view.innerHTML = `
    <div class="head"><div><h1>复习</h1><div class="meta">先看什么、缺什么、错在哪，这一页给答案</div></div></div>

    <div class="card pad wk-card ${mood}">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div class="grow">
          <div class="wk-k">本周掌握</div>
          <div class="wk-n">${Math.round(wk.rate * 100)}<small>%</small></div>
          <div class="hint">本周 ${wk.n} 份笔记 · ${wk.done} / ${wk.total || 0} 个知识点 · ${esc(moodText)}</div>
        </div>
        <div class="wk-bar" aria-hidden="true"><i style="height:${Math.round(wk.rate * 100)}%"></i><span style="bottom:${goal * 100}%"></span></div>
      </div>
    </div>

    ${plan.length ? `<div class="card pad plan-card">
      <div class="row" style="justify-content:space-between"><b>今天先看什么</b><span class="hint">按 Moodle 截止日期排的，不用再自己算</span></div>
      ${plan.map(p => `<div class="plan-item">
        <div class="plan-head"><span class="pill ${p.days < 3 ? 'bad' : p.days < 7 ? 'warn' : 'mute'}">还有 ${Math.round(p.days)} 天</span><b class="grow">${esc(p.d.name)}</b><span class="hint">${esc(p.course ? p.course.name : '')}</span></div>
        <div class="plan-notes">${p.picks.map(x => `<a class="plan-note" href="#review-${x.n.id}"><span class="grow">${esc(x.n.title)}</span><span class="hint">${x.p.total ? `掌握 ${x.p.done}/${x.p.total}` : '还没出重点'}</span></a>`).join('')}</div>
      </div>`).join('')}
    </div>` : ''}

    <div class="hub">
      <a class="hub-card" href="#vocab${courseId ? '~' + courseId : ''}">
        <b>生词本</b><span class="hub-n" id="hub-vocab">—</span>
        <span class="hint">按遗忘曲线推：今天、3 天后、7 天后</span>
      </a>
      <a class="hub-card" href="#wrong">
        <b>错题本</b><span class="hub-n">${wb.length} 道</span>
        <span class="hint">只刷做错的，连对两次自动出本</span>
      </a>
      <a class="hub-card" href="#marks${courseId ? '~' + courseId : ''}">
        <b>老师亲口划的重点</b><span class="hub-n">考前一张纸</span>
        <span class="hint">课上标记 + 自动识别的高亮，合成一页</span>
      </a>
      <a class="hub-card" href="#course-${(courses[0] && courses[0].id) || ''}~notes" data-mock>
        <b>模拟考试</b><span class="hub-n">按权重组卷</span>
        <span class="hint">不同 topic 按占分抽题，比平均抽更像真考试</span>
      </a>
    </div>

    <h2 class="rv-h2">按课程看笔记</h2>
    <div class="chips" role="group" aria-label="按课程筛选">
      <a class="chip ${!courseId ? 'on' : ''}" href="#review">全部 <span>${all.length}</span></a>
      ${courses.map(c => `<a class="chip ${courseId === c.id ? 'on' : ''}" href="#review~${c.id}">${esc(c.name)} <span>${all.filter(n => n.courseId === c.id).length}</span></a>`).join('')}
    </div>
    ${list.length ? `<div class="rv-grid">${list.map(n => {
      const pg = Study.progress(n);
      const c = courses.find(x => x.id === n.courseId);
      const quiz = ((n.study && n.study.quiz) || []).length;
      const pct = pg.total ? Math.round(pg.done / pg.total * 100) : 0;
      return `<a class="rv-card" href="#review-${n.id}" style="--c:${(c && c.color) || 'var(--accent)'}">
        <span class="rv-course">${esc(cname(n.courseId))}</span>
        <b>${esc(n.title)}</b>
        <span class="rv-meta">${fmtDate(n.createdAt)}${n.markdown ? '' : ' · 还没有正文'}</span>
        ${pg.total ? `<span class="rv-prog"><span class="sb-bar green"><i style="width:${pct}%"></i></span><small>掌握 ${pct}%（${pg.done}/${pg.total}）${quiz ? ` · 测验 ${quiz} 题` : ''}${(n.wrong || []).length ? ` · 错题 ${n.wrong.length}` : ''}</small></span>` : '<span class="rv-prog"><small>还没生成重点和卡片</small></span>'}
      </a>`; }).join('')}</div>`
    : `<div class="empty"><strong>还没有笔记</strong>先在课程里生成笔记，再来复习。</div>`}`;

  // 生词本角标（异步，不挡页面）
  if (courseId || courses[0]) {
    Learn.vocab(courseId || courses[0].id).then(v => { const el = $('#hub-vocab'); if (el) el.textContent = `今天 ${Learn.vstats(v).due} 个`; }).catch(() => {});
  }
  const mk = $('[data-mock]'); if (mk) mk.onclick = e => { e.preventDefault(); const c = courses.find(x => x.id === courseId) || courses[0]; if (c) mockExamModal(c); };
}

/* ---------- 生词本 ---------- */
async function renderVocab(courseId, mode = 'card') {
  const courses = State.courses;
  const cid = courseId || (courses[0] && courses[0].id);
  view.innerHTML = `<div class="head"><div><h1>重点词汇</h1><div class="meta">整理出来的术语先筛一遍，不会的进生词本按遗忘曲线背；课件或笔记里选中一个词也能直接加</div></div>${Nav.crumb('review', '复习', 'btn small ghost')}</div>
    <div class="chips">${courses.map(c => `<a class="chip ${cid === c.id ? 'on' : ''}" href="#vocab~${c.id}~${mode}">${esc(c.name)}</a>`).join('')}</div>
    <div class="seg" id="vb-mode" style="margin-bottom:12px"><button data-vm="card" class="${mode === 'card' ? 'on' : ''}">🃏 生词本</button><button data-vm="list" class="${mode === 'list' ? 'on' : ''}">📖 全部词汇</button></div>
    <div id="vocab-body"></div>`;
  $$('#vb-mode [data-vm]').forEach(b => b.onclick = () => { Nav.setTab('vocab~' + cid + '~' + b.dataset.vm); renderVocab(cid, b.dataset.vm); });
  if (mode === 'list') await vocabList(cid, $('#vocab-body'));
  else Learn.vocabPage($('#vocab-body'), courses, cid);
}

/* 全部词汇：术语 + 音标 + 例句，可搜 */
async function vocabList(courseId, el) {
  const files = (await DB.byIndex('files', 'courseId', courseId)).filter(f => f.prep && (f.prep.terms || []).length);
  const terms = [], seen = new Set();
  for (const f of files) for (const t of ((f.prep && f.prep.terms) || [])) {
    const k = String(t.en || '').toLowerCase().trim(); if (!k || seen.has(k)) continue;
    seen.add(k); terms.push({ en: t.en, ipa: t.ipa || '', zh: t.zh, explain: t.explain || '', example: t.example || '', example_zh: t.example_zh || '', from: f.name, fileId: f.id });
  }
  if (!terms.length) {
    el.innerHTML = `<div class="empty"><strong>这门课还没有术语</strong>到「课件 → 课前包」生成一份，术语会同时进这里和生词本。</div>`;
    return;
  }
  vocabListHTML(el, terms, files);
}

function vocabListHTML(el, terms, files) {
  const missing = terms.filter(t => !t.ipa).length;
  el.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:flex-start;margin-bottom:10px">
      <div class="grow"><b>${terms.length} 个术语</b><div class="hint">来自这门课的课件和课堂录音 · 先在「生词本」里筛一遍，不会的才会进生词本按遗忘曲线背</div></div>
      ${missing ? `<button class="btn small" id="vb-ipa">补音标（${missing}）</button>` : ''}
    </div>
    <div class="row" style="margin-bottom:10px"><input id="vb-q" type="search" class="grow" placeholder="搜英文或中文…" style="max-width:320px"></div>
    <div class="vlist" id="vb-list">${terms.map((t, i) => `<div class="vitem" data-i="${i}">
      <div class="vi-h"><button class="say" data-say="${esc(t.en)}" aria-label="朗读">🔊</button><b>${esc(t.en)}</b>${t.ipa ? `<span class="vi-ipa">${esc(t.ipa)}</span>` : ''}<span class="vi-zh">${esc(t.zh)}</span></div>
      ${t.explain ? `<div class="vi-x">${esc(t.explain)}</div>` : ''}
      ${t.example ? `<div class="vi-e"><button class="say small" data-say="${esc(t.example)}" aria-label="朗读例句">🔊</button><span>${esc(t.example)}</span><em>${esc(t.example_zh)}</em></div>` : ''}
      <div class="vi-from">${esc(t.from || '')}</div>
    </div>`).join('')}</div>`;
  const list = $('#vb-list', el);
  $$('[data-say]', el).forEach(b => b.onclick = () => Prep.speak(b.dataset.say));
  $('#vb-q', el).oninput = e => {
    const k = e.target.value.trim().toLowerCase();
    $$('.vitem', list).forEach(row => { const t = terms[Number(row.dataset.i)]; row.hidden = !!k && !(t.en + ' ' + t.zh + ' ' + (t.explain || '')).toLowerCase().includes(k); });
  };
  const ipa = $('#vb-ipa', el);
  if (ipa) ipa.onclick = async () => {
    if (!Settings.load().deepseekKey) { toast('先去设置里填 DeepSeek key'); return; }
    ipa.disabled = true; ipa.textContent = '正在标…';
    try {
      const need = terms.filter(t => !t.ipa).slice(0, 60);
      const map = await AI.ipaFor(need.map(t => t.en));
      for (const f of files) {
        const fresh = await DB.get('files', f.id); if (!fresh.prep || !fresh.prep.terms) continue;
        let hit = false;
        fresh.prep.terms.forEach(x => { const v = map[String(x.en || '').toLowerCase().trim()]; if (v && !x.ipa) { x.ipa = v; hit = true; } });
        if (hit) await DB.put('files', fresh);
      }
      terms.forEach(t => { const v = map[String(t.en).toLowerCase().trim()]; if (v && !t.ipa) t.ipa = v; });
      toast('音标补好了'); vocabListHTML(el, terms, files);
    } catch (e) { toast(e.message, 6000); ipa.disabled = false; ipa.textContent = '补音标'; }
  };
}

/* ---------- 错题本 ---------- */
async function renderWrong() {
  const notes = (await DB.all('notes')).filter(n => (n.wrong || []).length);
  const courses = State.courses;
  const items = Learn.wrongList(notes, courses);
  view.innerHTML = `<div class="head"><div><h1>错题本</h1><div class="meta">测验做错的题自动进来；同一道连对两次就出本</div></div>${Nav.crumb('review', '复习', 'btn small ghost')}</div>
    ${items.length ? `<div class="row" style="margin-bottom:12px"><button class="btn primary" id="wb-go">开始刷错题（${items.length}）</button><span class="hint">做对了会从本子里淡出，别重做整套测验</span></div>
    <div class="wb-list">${items.map(it => `<div class="card pad wb-item">
      <div class="row" style="justify-content:space-between"><span class="pill mute">${esc(it.courseName)}</span><span class="hint">${esc(it.noteTitle)}</span></div>
      <div class="wb-q">${esc(it.q.q)}</div>
      <div class="wb-a"><b>答案：</b>${esc(it.q.options[it.q.answer])}<div class="hint" style="margin-top:4px">${esc(it.q.explain)}</div></div>
      <div class="row"><a class="btn small ghost" href="#note-${it.noteId}~points">看知识点</a><span class="grow"></span><button class="btn small" data-drop="${it.noteId}|${it.qi}">移出错题本</button></div>
    </div>`).join('')}</div>`
    : `<div class="empty"><strong>错题本是空的 👍</strong>去做一次测验，答错的题会自动进来。</div>`}`;
  const go = $('#wb-go');
  if (go) go.onclick = () => {
    Learn.runPaper(null, items.map(it => Object.assign({}, it.q, { noteId: it.noteId, noteTitle: it.noteTitle, qi: it.qi })), 0,
      { title: '错题重刷', meta: '连对两次自动出本', onWrong: q => Learn.wrongResolve(q.noteId, q.qi, false), onRight: q => Learn.wrongResolve(q.noteId, q.qi, true) });
  };
  $$('[data-drop]').forEach(b => b.onclick = async () => {
    const [nid, qi] = b.dataset.drop.split('|');
    const n = await DB.get('notes', nid); if (!n) return;
    n.wrong = (n.wrong || []).filter(x => x.qi !== Number(qi));
    await DB.put('notes', n); renderWrong();
  });
}

/* ---------- 老师亲口划的重点 ---------- */
async function renderMarks(courseId) {
  const courses = State.courses;
  const cid = courseId || (courses[0] && courses[0].id);
  const course = courses.find(c => c.id === cid);
  const sessions = cid ? await DB.byIndex('sessions', 'courseId', cid) : [];
  const raw = Learn.gatherMarks(sessions);
  const m = course && course.marks;
  view.innerHTML = `<div class="head"><div><h1>老师亲口划的重点</h1><div class="meta">课上按的标记 + 系统识别的 exam / due / important，合成考前只看这一页</div></div>${Nav.crumb('review', '复习', 'btn small ghost')}</div>
    <div class="chips">${courses.map(c => `<a class="chip ${cid === c.id ? 'on' : ''}" href="#marks~${c.id}">${esc(c.name)}</a>`).join('')}</div>
    ${!course ? '<div class="empty"><strong>还没有课程</strong></div>' : !raw.length ? `<div class="empty"><strong>这门课还没有可整理的内容</strong>上课时按「标记重点」，或者让实时翻译跑起来 —— 说到考试、作业、重点的句子会自动高亮，这里就能收进来。</div>`
    : `<div class="card pad"><div class="row" style="justify-content:space-between"><div class="grow"><b>${raw.length} 条原始标记</b><div class="hint">来自 ${new Set(raw.map(x => x.sid)).size} 节课；按「必考 / 可能考 / 了解」整理成一张纸</div></div><button class="btn primary" id="mk-go">${m ? '重新整理' : '整理成一张纸'}</button></div>
      ${m ? `<div class="mk-sum">${esc(m.summary)}</div><div class="mk-list">${m.items.map(x => `<div class="mk-item"><span class="pill ${x.level === '必考' ? 'bad' : x.level === '可能考' ? 'warn' : 'mute'}">${esc(x.level || '看看')}</span><div class="grow"><b>${esc(x.title)}</b>${x.why ? `<div class="hint">${esc(x.why)}</div>` : ''}</div></div>`).join('')}</div>
      <div class="row" style="justify-content:flex-end"><button class="btn small ghost" id="mk-copy">复制给 AI 复习</button></div>` : `<div class="hint" style="margin-top:10px">还没整理过。整理后这里会是一张按「必考 / 可能考 / 了解」分好、可以直接背的清单。</div>`}</div>
      <details class="card pad" style="margin-top:12px"><summary><b>原始标记（${raw.length}）</b><span class="hint"> · 点开看老师原话</span></summary>
        <div class="mark-list" style="margin-top:10px">${raw.slice(0, 120).map(x => `<div class="mark-item"><a class="mark-time" href="#session-${x.sid}">${fmtTime(x.t)}</a><span class="grow mark-near">${esc((x.text || '').slice(0, 120))}</span>${x.kind === 'mark' ? '<span class="pill mute">我标的</span>' : ''}</div>`).join('')}</div>
      </details>`}`;
  const go = $('#mk-go');
  if (go) go.onclick = async () => {
    go.disabled = true;
    try { await Learn.buildMarks(course); toast('整理好了'); renderMarks(cid); }
    catch (e) { toast(e.message, 6000); go.disabled = false; }
  };
  const cp = $('#mk-copy');
  if (cp) cp.onclick = async () => {
    const text = `这是「${course.name}」老师课上明确划过的重点，考前帮我按重要性排一遍，并针对每条出一句自测问题：\n\n${m.summary}\n\n${m.items.map((x, i) => `${i + 1}. [${x.level}] ${x.title} —— ${x.why}`).join('\n')}`;
    try { await navigator.clipboard.writeText(text); toast('已复制，粘给 Claude / ChatGPT 都行'); } catch (e) { toast('复制失败'); }
  };
}
async function renderReviewNote(id, tab) {
  if (tab === 'map') tab = 'text';   // 思维导图并进了「复盘」
  if (!location.hash.slice(1).startsWith('review-' + id)) return;
  const note = await DB.get('notes', id);
  if (!note) { Nav.replace('review'); return; }
  const course = await DB.get('courses', note.courseId);
  const siblings = (await DB.byIndex('notes', 'courseId', note.courseId)).filter(n => n.status !== 'generating').sort((a, b) => a.createdAt - b.createdAt);
  const i = siblings.findIndex(n => n.id === id), prev = siblings[i - 1], next = siblings[i + 1];
  const P = ReviewPref.get();
  view.innerHTML = `
    <div class="rv">
      <div class="rv-top noprint">
        ${Nav.crumb('review~' + note.courseId, '复习', 'btn small ghost')}
        <div class="rv-title"><small>${esc(course ? course.name : '')}</small><b>${esc(note.title)}</b></div>
        <div class="seg rv-tabs" role="tablist">${REVIEW_TABS.map(([k, l]) => `<button data-rt="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="seg" role="group" aria-label="字号"><button data-fs="-1" title="字小一点">A−</button><button data-fs="1" title="字大一点">A+</button></div>
      </div>
      <div class="rv-body" id="rv-body" style="--rv-size:${P.size}px"></div>
      <div class="rv-nav noprint">
        ${prev ? `<a class="btn" href="#review-${prev.id}~${tab}">‹ ${esc(prev.title)}</a>` : '<span></span>'}
        <span class="hint">${i + 1} / ${siblings.length}</span>
        ${next ? `<a class="btn" href="#review-${next.id}~${tab}">${esc(next.title)} ›</a>` : '<span></span>'}
      </div>
    </div>`;
  $$('[data-rt]').forEach(b => b.onclick = () => { Nav.setTab('review-' + id + (b.dataset.rt === 'note' ? '' : '~' + b.dataset.rt)); renderReviewNote(id, b.dataset.rt); });
  $$('[data-fs]').forEach(b => b.onclick = () => { const size = Math.min(26, Math.max(14, ReviewPref.get().size + Number(b.dataset.fs))); ReviewPref.set({ size }); $('#rv-body').style.setProperty('--rv-size', size + 'px'); });
  const body = $('#rv-body');
  if (tab === 'note') {
    body.innerHTML = note.markdown ? `<article class="md">${md(note.markdown)}</article>` : `<div class="empty"><strong>这份笔记还没有正文</strong>去课程里点「生成」，或者在画板里手写。</div>`;
    linkPageRefs($('.md', body) || body, note);
    return;
  }
  body.classList.add('rv-tool');
  mountNoteTool(tab, note, course, body, { toPoint: pid => { Nav.setTab('review-' + id + '~points'); renderReviewNote(id, 'points'); } });
}

/* ---------- 同步状态条（侧边栏底部 + 手机右上角） ---------- */
const SyncUI = (() => {
  const pad = n => String(n).padStart(2, '0');
  const rel = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '刚刚' : m < 60 ? m + ' 分钟前' : m < 24 * 60 ? Math.round(m / 60) + ' 小时前' : Math.round(m / 1440) + ' 天前'; };
  function when(t) {
    if (!t) return '还没同步过';
    const d = new Date(t), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    const day = d.toDateString() === now.toDateString() ? '今天' : d.toDateString() === y.toDateString() ? '昨天' : `${d.getMonth() + 1}月${d.getDate()}日`;
    return `${day} ${hm}（${rel(t)}）`;
  }
  const secs = t => Math.max(1, Math.round((t - Date.now()) / 1000));
  const pct = p => p && p.total ? Math.round((p.bytesTotal ? (p.done / p.total) * 0.4 + (p.bytesDone / p.bytesTotal) * 0.6 : p.done / p.total) * 100) : 4;
  const mb = b => (b / 1048576).toFixed(b > 10485760 ? 0 : 1) + ' MB';
  const unsynced = c => c ? c.up + c.down + c.del : 0;

  // 当前状态 → 标题、副标题、进度
  function state(st) {
    const M = State.sync, c = st.counts;
    if (M && !M.finished) return { k: 'run', title: `正在导入 Moodle ${M.done} / ${M.total || '…'}`, sub: M.current || '', p: M.total ? Math.round(M.done / M.total * 100) : 4 };
    if (!st.ready) return { k: 'off', title: '云同步没开', sub: '点这里登录，Mac 和 iPad 才会同步' };
    if (st.running) { const p = st.prog; return { k: 'run', title: p && p.total ? `正在同步 ${p.done} / ${p.total}` : '正在检查云端…', sub: p ? p.label : '', p: pct(p) }; }
    const n = unsynced(c), ratio = c && c.total ? Math.round(c.synced / c.total * 100) : 100;
    const last = '最近同步 ' + when(st.at);
    if (!st.online) return { k: 'bad', title: n ? `${n} 个没同步 · 没网络` : '没有网络', sub: '联网后自动同步 · ' + last, p: ratio, green: true };
    if (st.err) return { k: 'bad', title: '同步出错' + (n ? ` · ${n} 个没同步` : ''), sub: st.err + (st.nextAt ? ` · ${secs(st.nextAt)} 秒后重试` : ''), p: ratio, green: true };
    if (n) return { k: 'wait', title: `还有 ${n} 个没同步`, sub: (st.auto ? (st.nextAt ? `${secs(st.nextAt)} 秒后自动同步` : '马上自动同步') : '自动同步已关') + ' · ' + last, p: ratio, green: true };
    return { k: 'ok', title: c ? `全部已同步 ${c.synced} / ${c.total}` : '已同步', sub: last, p: c ? 100 : null, green: true };
  }

  function render() {
    const st = Sync.status(), x = state(st);
    const box = $('#syncbox');
    if (box) box.innerHTML = `<button class="syncbox-btn s-${x.k}" id="sb-open" title="同步详情">
        <span class="sb-row"><span class="sb-dot"></span><b>${esc(x.title)}</b></span>
        ${x.p != null ? `<span class="sb-bar ${x.green ? 'green' : ''}"><i style="width:${x.p}%"></i></span>` : ''}
        <span class="sb-sub">${esc(x.sub)}</span></button>`;
    const dot = $('#syncdot'), n = unsynced(st.counts);
    // 没登录云服务时不挂这个浮标：首页已经有提示，手机上也别挡着标题
    if (dot) { dot.hidden = x.k === 'off'; dot.className = 'syncdot s-' + x.k; dot.innerHTML = `<span class="sb-dot"></span>${x.k === 'run' ? (x.p || 0) + '%' : x.k === 'ok' ? '✓ 已同步' : n ? n + ' 个没同步' : '!'}`; }
    const ob = $('#sb-open'); if (ob) ob.onclick = open;
    const mbox = $('#modal-box'); if (mbox && mbox.dataset.syncui && !$('#modal').hidden) paintDetail(mbox);
  }

  const NAMES = [['courses', '课程'], ['files', '课件'], ['notes', '笔记'], ['sessions', '录音转写']];
  function table(c) {
    if (!c) return '<div class="hint">正在统计…</div>';
    const cell = r => { const n = r.up + r.down; return n ? `<span class="sd-bad">${n}</span>${r.up ? ` <small>↑${r.up}</small>` : ''}${r.down ? ` <small>↓${r.down}</small>` : ''}` : '<span class="sd-ok">0</span>'; };
    return `<table class="sd-table"><thead><tr><th></th><th>一共</th><th>已同步</th><th>没同步</th></tr></thead><tbody>
      ${NAMES.map(([k, n]) => `<tr><th>${n}</th><td>${c.by[k].total}</td><td>${c.by[k].synced}</td><td>${cell(c.by[k])}</td></tr>`).join('')}
      ${c.del ? `<tr><th>删除</th><td>—</td><td>—</td><td><span class="sd-bad">${c.del}</span> <small>↑${c.del}</small></td></tr>` : ''}
      <tr class="sum"><th>合计</th><td>${c.total}</td><td>${c.synced}</td><td>${cell({ up: c.up + c.del, down: c.down })}</td></tr></tbody></table>
      <div class="hint">↑ 这台设备改了、还没传上云端　↓ 云端有新的、还没下载到这台设备${c.exact ? '' : '　（正在核对云端，数字可能还会变）'}</div>
      ${c.blobs ? `<div class="hint">课件原文件（PDF/PPT）：这台设备已下载 ${c.blobsLocal} / ${c.blobs} 个，其余打开时才下载。</div>` : ''}`;
  }

  function paintDetail(box) {
    const st = Sync.status(), x = state(st), p = st.prog, M = State.sync, c = st.counts;
    const mAt = Number(localStorage.getItem('tingkeben.moodleAt') || 0), mAdd = localStorage.getItem('tingkeben.moodleAdded');
    const lr = st.lastResult;
    box.innerHTML = `
      <h2>同步</h2>
      <section class="sd-card">
        <div class="row" style="justify-content:space-between"><b>Mac ⇄ iPad 云同步</b><span class="pill ${{ ok: 'ok', run: '', wait: 'warn', bad: 'bad', off: 'mute' }[x.k]}">${esc(x.title)}</span></div>
        ${st.ready ? `
        <div class="sd-last"><span>最近同步</span><b>${when(st.at)}</b>${lr ? `<small>上传 ${lr.up} · 下载 ${lr.down}${lr.del ? ' · 删除 ' + lr.del : ''}${lr.failed ? ` · <span class="sd-bad">失败 ${lr.failed}</span>` : ''}</small>` : ''}</div>
        ${st.running ? `<div class="sb-bar big"><i style="width:${pct(p)}%"></i></div>
          <div class="hint">${p && p.total ? `第 ${p.done} / ${p.total} 个` : '正在检查云端…'}${p && p.bytesTotal ? ` · 课件 ${mb(p.bytesDone)} / ${mb(p.bytesTotal)}` : ''}　${esc(p ? p.label : '')}</div>`
          : st.err ? `<div class="hint" style="color:var(--danger)">${esc(x.sub)}</div>` : ''}
        ${table(c)}
        <label class="switch"><input type="checkbox" id="sd-auto" ${st.auto ? 'checked' : ''}>自动同步${st.auto && st.nextAt && !st.running ? `<span class="hint">（${secs(st.nextAt)} 秒后）</span>` : ''}</label>
        <div class="hint">打开听课本时、每 30 秒、改完东西 2 秒后、切到后台时都会自动同步；断网恢复后马上补上，出错会自己重试；个别条目失败只跳过它，其余照常同步。</div>
        <div class="row" style="margin-top:4px"><button class="btn small primary" id="sd-now" ${st.running ? 'disabled' : ''}>${st.running ? '同步中…' : '立即同步'}</button><button class="btn small ghost" id="sd-set">云服务设置</button></div>`
        : `<div class="hint">${esc(x.sub)}</div><div class="row"><button class="btn small primary" id="sd-login">登录云服务</button></div>`}
      </section>
      <section class="sd-card">
        <div class="row" style="justify-content:space-between"><b>Moodle 课件导入</b>${M && !M.finished ? '<span class="pill">导入中</span>' : ''}</div>
        ${M && !M.finished ? `<div class="sb-bar big"><i style="width:${M.total ? Math.round(M.done / M.total * 100) : 4}%"></i></div><div class="hint">第 ${M.done} / ${M.total || '…'} 个 · ${esc(M.current || '')}</div>
          <div class="row"><button class="btn small" id="sd-mdetail">看详情</button></div>`
        : `<div class="sd-last"><span>最近导入</span><b>${mAt ? when(mAt) : '还没导入过'}</b>${mAt && mAdd != null ? `<small>新增 ${mAdd} 个课件</small>` : ''}</div>
          <div class="hint">已经导入过的文件不会重复下载，不确定有没有新课件就再同步一次。</div>
          <div class="row"><button class="btn small" id="sd-moodle">从 Moodle 同步</button></div>`}
      </section>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-close>关闭</button></div>`;
    box.dataset.syncui = '1';
    const close = () => { $('#modal').hidden = true; box.innerHTML = ''; delete box.dataset.syncui; };
    $$('[data-close]', box).forEach(b => b.onclick = close);
    const a = $('#sd-auto', box); if (a) a.onchange = () => Sync.setAuto(a.checked);
    const n = $('#sd-now', box); if (n) n.onclick = () => Sync.syncNow();
    const g = $('#sd-set', box); if (g) g.onclick = () => { close(); location.hash = 'settings~sync'; };
    const l = $('#sd-login', box); if (l) l.onclick = () => { close(); cloudLoginModal(); };
    const md = $('#sd-mdetail', box); if (md) md.onclick = () => showSyncProgress(true);
    const mo = $('#sd-moodle', box); if (mo) mo.onclick = () => syncModal();
  }

  function open() { modal('', box => paintDetail(box)); Sync.peek(); }

  Sync.listeners.add(render);
  setInterval(render, 1000 * 30);
  setInterval(() => { const st = Sync.status(); const mb2 = $('#modal-box'); if (st.nextAt || (mb2 && mb2.dataset.syncui)) render(); }, 1000);
  return { render, open };
})();

/* ---------- 启动 ---------- */
window.addEventListener('beforeunload', e => { if (State.live) { e.preventDefault(); e.returnValue = '正在录音，离开会停止录音'; } });
(async () => {
  if (!window.indexedDB) { view.innerHTML = '<div class="empty"><strong>这个浏览器不能保存数据</strong>请用 Safari 或 Chrome 打开，不要用无痕模式。</div>'; return; }
  await loadCourses();
  Sync.start(); SyncUI.render();
  Schedule.start();
  // 接收扩展弹窗（在 Moodle 页面点的）发来的同步任务
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || e.data.tkbFrom !== 'ext' || !e.data.start) return;
    const { courses, ebook } = e.data.start;
    if (State.sync) { showSyncProgress(true); return; }
    if (State.live) { toast('正在录音，先停止录音再同步', 5000); return; }
    runSync(courses, ebook);
  });
  window.postMessage({ tkbAppReady: true }, location.origin);
  // 把上次没生成完的笔记标记为中断
  for (const n of await DB.all('notes')) if (n.status === 'generating') { n.status = n.markdown ? 'done' : 'error'; n.error = '上次生成被中断，点「重新生成」'; await DB.put('notes', n); }
  // 每次打开听课本都从课程主页开始（不回到上次退出时停在的页面）
  try { sessionStorage.removeItem('tingkeben.navstack'); history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  Nav.reset();
  const t0 = Date.now();
  await route().catch(() => {});
  await splashChecks();                       // 开屏上跑一遍自检
  exitSplash(Math.max(0, 2300 - (Date.now() - t0)));
  askDeviceOnce();
})();

/* 开屏自检：趁这 2 秒把该检查的检查一遍，有问题的当场就能看到 */
async function splashChecks() {
  const box = document.getElementById('sp-checks');
  if (!box) return;
  const prog = document.getElementById('sp-prog');
  let stepN = 0; const STEPS = 5;
  const bump = () => { stepN++; if (prog) prog.style.width = Math.round(stepN / STEPS * 100) + '%'; };
  const wait = ms => new Promise(r => setTimeout(r, window.__tkSplashSkip ? 0 : ms));
  const add = (text, state) => {
    const li = document.createElement('li');
    li.className = 'sp-check ' + (state || 'run');
    li.innerHTML = `<span class="sp-ico"></span><span>${esc(text)}</span>`;
    box.appendChild(li);
    requestAnimationFrame(() => li.classList.add('in'));
    return li;
  };
  const done = (li, text, state) => {
    li.className = 'sp-check in ' + state;
    li.lastChild.textContent = text;
    bump();
  };
  const step = async (pending, fn) => {
    const li = add(pending, 'run');
    await wait(90);
    try { const r = await fn(); done(li, pending + ' · ' + r.text, r.ok ? 'ok' : 'warn'); }
    catch (e) { done(li, pending + ' · ' + (e.message || '失败'), 'warn'); }
    await wait(120);
  };

  const s = Settings.load();
  let courses = 0;
  await step('检查本地数据', async () => { const all = await DB.all('courses'); courses = all.length; return { ok: true, text: courses + ' 门课' }; });
  await step('检查 API key', async () => {
    const miss = [!s.deepseekKey && 'DeepSeek', !s.geminiKey && 'Gemini'].filter(Boolean);
    return miss.length ? { ok: false, text: '还没填 ' + miss.join(' / ') } : { ok: true, text: '都填好了' };
  });
  await step('检查云同步', async () => {
    if (!Sync.ready()) return { ok: false, text: '没登录（登录后 Mac 和 iPad 才同步）' };
    const st = Sync.status();
    return { ok: !st.err, text: st.err ? '上次出错：' + st.err : (st.at ? '已连接' : '已登录') };
  });
  await step('检查离线缓存', async () => {
    const ctl = 'serviceWorker' in navigator && navigator.serviceWorker.controller;
    return { ok: true, text: ctl ? '已就绪' : '首次加载，稍后自动缓存' };
  });
  const v = (document.querySelector('link[href*="styles.css?v="]') || {}).href;
  const ver = (v && (v.match(/v=(\d+)/) || [])[1]) || '';
  const li = add('准备就绪', 'run');
  await wait(160);
  done(li, '全部检查完成 · 版本 ' + ver, 'ready');
}

/* 开屏：首屏画好之后再淡出，至少停留 2 秒，别闪一下就没了 */
function exitSplash(delay = 0) {
  const sp = document.getElementById('splash');
  if (!sp) return;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (sp.dataset.leaving) { if (!delay) { sp.classList.add('out'); setTimeout(() => sp.remove(), 650); } return; }
  sp.dataset.leaving = '1';
  setTimeout(() => {
    sp.classList.add('out');
    setTimeout(() => sp.remove(), reduced ? 30 : 700);
  }, reduced || window.__tkSplashSkip ? 0 : delay);
}

/* 第一次打开：确认一下认出来的设备对不对（只问一次；以后在「设置 → 这台设备」改） */
function askDeviceOnce() {
  try { if (localStorage.getItem('tingkeben.deviceAsked') || Device.choice() !== 'auto' || /[?&]device=/.test(location.search)) return; } catch (e) { return; }
  const mark = () => { try { localStorage.setItem('tingkeben.deviceAsked', '1'); } catch (e) {} };
  const isPad = Device.kind === 'ipad';
  modal(`<h2>${isPad ? '识别到你在用 iPad' : Device.kind === 'phone' ? '识别到你在用手机' : '识别到你在用电脑'}</h2>
    <p style="margin:0;color:var(--muted)">${isPad ? 'iPad 版：侧边栏能收起、上课工作台竖屏上下分屏、默认打开手写画板、按钮更大。' : '电脑版：上课工作台三栏（课件 / 笔记 / AI 问答），栏宽可以拖动。'}以后可以在「设置 → 这台设备」改。</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="da-other">不对，我用的是${isPad ? '电脑' : ' iPad'}</button><button class="btn primary" id="da-ok">对，用${isPad ? ' iPad 版' : '电脑版'}</button></div>`, (box, close) => {
    $('#da-ok', box).onclick = () => { mark(); close(); };
    $('#da-other', box).onclick = () => { mark(); Device.setChoice(isPad ? 'desktop' : 'ipad'); close(); toast('已切换，正在重新打开…'); setTimeout(() => location.reload(), 500); };
    $('#modal').onclick = null; // 必须选一个
  });
}

/* 「更多」菜单：点外面或点了菜单里的某一项就自动收起（以前要再点一次「更多」才关） */
document.addEventListener('click', e => {
  document.querySelectorAll('details.more[open]').forEach(d => {
    if (!d.contains(e.target)) { d.removeAttribute('open'); return; }
    const item = e.target.closest('.more-menu button, .more-menu a');
    if (item && !item.closest('.mm-row') && !item.closest('[data-keep]')) setTimeout(() => d.removeAttribute('open'), 0);
  });
}, true);
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('details.more[open]').forEach(d => d.removeAttribute('open')); });


/* ---------- 删除：课程卡片、笔记列表、课程页、笔记页都能直接删（点两次确认，防手滑） ---------- */
async function deleteCourse(id) {
  for (const st of ['files', 'notes', 'sessions']) {
    const items = await DB.byIndex(st, 'courseId', id);
    for (const it of items) { if (st === 'sessions') await DB.delByIndex('audio', 'sessionId', it.id); await DB.del(st, it.id); }
  }
  await DB.del('courses', id);
  await loadCourses();
  toast('课程已删除');
  if (location.hash.slice(1).includes(id) || location.hash.slice(1) === 'home' || !location.hash) { Nav.replace('home'); } else route();
}
async function deleteNote(id) {
  const n = await DB.get('notes', id);
  await DB.del('notes', id);
  toast('笔记已删除');
  if (location.hash.slice(1).startsWith('note-' + id) || location.hash.slice(1).startsWith('desk-' + id)) Nav.back(n ? 'course-' + n.courseId + '~notes' : 'home');
  else route();
}
document.addEventListener('click', async e => {
  const b = e.target.closest && e.target.closest('[data-del-course],[data-del-note]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  if (!b.dataset.armed) {
    b.dataset.armed = '1'; b.dataset.old = b.innerHTML; b.classList.add('armed');
    b.textContent = b.dataset.delCourse ? '再点一次：删除这门课和里面所有课件、笔记、录音' : '再点一次删除';
    setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.innerHTML = b.dataset.old; b.classList.remove('armed'); } }, 3500);
    return;
  }
  if (b.dataset.delCourse) await deleteCourse(b.dataset.delCourse); else await deleteNote(b.dataset.delNote);
}, true);
