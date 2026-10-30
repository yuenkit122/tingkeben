/* 听课本 — 界面与流程 */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');

const ICON = {
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
  box.className = 'box'; box.innerHTML = html; m.hidden = false; delete box.dataset.sync;
  const close = () => { m.hidden = true; box.innerHTML = ''; delete box.dataset.sync; };
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
  const items = [['home', '课程主页', ICON.home], ['live', State.live ? '录音中…' : '课堂录音', ICON.mic], ['ask', '问 AI', ICON.chat], ['settings', '设置', ICON.gear]];
  const isOn = id => r === id || (id === 'live' && r.startsWith('live')) || (id === 'ask' && r.startsWith('ask'));
  $('#nav').innerHTML = items.map(([id, label, ic]) => `<a href="#${id}" class="${isOn(id) ? 'on' : ''}">${ic}${label}${id === 'live' && State.live ? ' <span class="pill bad">REC</span>' : ''}</a>`).join('');
  $('#tabbar').innerHTML = items.map(([id, label, ic]) => `<a href="#${id}" class="${isOn(id) ? 'on' : ''}">${ic}${label}</a>`).join('');
  $('#side-courses').innerHTML = State.courses.map(c => `<a class="course-link ${r === 'course-' + c.id ? 'on' : ''}" href="#course-${c.id}" title="${esc(c.name)}">${esc(c.name)}</a>`).join('') ||
    '<div class="course-link" style="color:var(--faint)">还没有课程</div>';
}

async function route() {
  const r = location.hash.slice(1) || 'home';
  document.body.classList.toggle('desk-mode', r.startsWith('desk-'));
  renderSide();
  window.scrollTo(0, 0);
  try {
    if (r === 'home') await renderHome();
    else if (r === 'settings') renderSettings();
    else if (r === 'live' || r.startsWith('live-')) await renderLive(r.startsWith('live-') ? r.slice(5) : null);
    else if (r.startsWith('course-')) { const [id, tab] = r.slice(7).split('~'); await renderCourse(id, tab || 'files'); }
    else if (r.startsWith('note-')) { const [id, tab] = r.slice(5).split('~'); await renderNote(id, tab || 'note'); }
    else if (r.startsWith('desk-')) await renderDesk(r.slice(5));
    else if (r === 'ask' || r.startsWith('ask-')) await renderAsk(r.slice(4) || null);
    else if (r.startsWith('session-')) await renderSession(r.slice(8));
    else await renderHome();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="empty"><strong>页面出错了</strong>${esc(e.message)}</div>`;
  }
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
      <div><h1>我的课程</h1><div class="meta">把 Moodle 课件放进对应课程，AI 帮你整理成中英对照笔记</div></div>
      <div class="row"><a class="btn" href="#live">${ICON.mic}开始录音</a><button class="btn" id="new-course">＋ 新建课程</button><button class="btn primary" id="sync-moodle">${ICON.up}从 Moodle 同步</button></div>
    </div>
    ${!State.courses.length ? `<div class="banner"><div class="grow"><strong>第一次用？</strong><br><span style="font-size:14px;color:var(--muted)">在 Chrome 打开 Moodle 并登录，点右上角「听课本助手」扩展图标，勾选课程后点「同步到听课本」，4 门课和每周的课件会自动导进来。</span></div><button class="btn primary small" id="sync-moodle-2">怎么装扩展</button></div>` : ''}
    ${!k.gemini || !k.notes ? `<div class="banner"><div class="grow"><strong>先填 API key</strong><br><span style="font-size:14px;color:var(--muted)">${!k.notes ? '生成笔记需要 DeepSeek 的 key' : ''}${!k.notes && !k.gemini ? '；' : ''}${!k.gemini ? '实时转写翻译需要 Gemini 的 key' : ''}。key 只存在这台设备上。</span></div><a class="btn primary small" href="#settings">去设置</a></div>` : ''}
    ${State.courses.length ? homeSummary(notes) + weekPrep(files) : ''}
    <div class="grid">
      ${State.courses.map((c, i) => `
        <a class="card course-card" href="#course-${c.id}" style="--c:${c.color || COLORS[i % COLORS.length]}">
          <div class="code">${esc(c.code || '课程')}</div>
          <h3>${esc(c.name)}</h3>
          ${c.examDate ? `<div class="meta" style="font-size:13px;color:var(--muted)">考试 ${esc(c.examDate)} · ${examCountdown(c.examDate)}</div>` : ''}
          <div class="stats"><span>课件 ${count(files, c.id)}</span><span>笔记 ${count(notes, c.id)}</span><span>录音 ${count(sessions, c.id)}</span></div>
        </a>`).join('')}
      <button class="card course-card new" id="new-course-2">＋ 新建课程</button>
    </div>
    ${recent.length ? `<h2 style="font-size:18px">最近的笔记</h2><div class="card list">${recent.map(noteItem).join('')}</div>` : ''}`;
  $('#new-course').onclick = $('#new-course-2').onclick = () => courseModal();
  $$('[data-prep]').forEach(b => b.onclick = () => openDocModal(b.dataset.prep, 'prep'));
  const dr = $('#dl-refresh'); if (dr) dr.onclick = async () => { dr.disabled = true; await Deadlines.refresh(); if (dr.isConnected) renderHome(); };
  const da = $('#dl-add'); if (da) da.onclick = () => Deadlines.addModal(renderHome);
  $$('[data-dl-del]').forEach(b => confirmClick(b, '删', () => { Deadlines.remove(b.dataset.dlDel); renderHome(); }));
  $('#sync-moodle').onclick = () => syncModal();
  const s2 = $('#sync-moodle-2'); if (s2) s2.onclick = () => Ext.version() ? modal(`<h2>扩展已经装好了</h2><ol style="margin:0;padding-left:20px;line-height:1.9"><li>Chrome 新开一个标签页，打开 <b>learning.monash.edu</b> 并登录</li><li>点浏览器右上角的「听课本助手」图标（在拼图图标里，可以点图钉固定）</li><li>勾选课程 →「同步到听课本」</li></ol><div class="row" style="justify-content:flex-end"><a class="btn primary" href="${MOODLE}/my/courses.php" target="_blank" rel="noopener">打开 Moodle</a></div>`) : extGuide();
}
/* 主页：每门课最新一周的课前包 */
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
      ${up.length ? `<div class="dl-list">${up.map(d => `<div class="dl"><div class="dl-when ${d.due - Date.now() < 3 * 86400e3 ? 'soon' : ''}">${Deadlines.left(d.due)}</div><div class="grow"><div class="t">${d.url ? `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)}</a>` : esc(d.name)}</div><div class="hint">${esc(shortName(d.course || ''))} · ${new Date(d.due).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>${d.manual ? `<button class="btn small ghost" data-dl-del="${esc(d.id)}" aria-label="删除">✕</button>` : ''}</div>`).join('')}</div>`
        : `<div class="hint" style="margin-top:6px">${dl.at ? '最近没有要交的东西 🎉' : Ext.version() ? '点「从 Moodle 更新」读取作业和测验的截止日期' : '装好「听课本助手」扩展后可以自动读取 Moodle 的截止日期，也可以手动添加'}</div>`}
    </div>
    <div class="card pad">
      <b>学习进度</b>
      <div style="margin-top:6px"><span style="font-size:28px;font-weight:800">${tot.d}</span> <span class="hint">/ ${tot.t} 个知识点已掌握</span></div>
      <div class="level" style="width:100%;height:6px"><i style="width:${tot.t ? Math.round(tot.d / tot.t * 100) : 0}%"></i></div>
      ${byCourse.map(x => `<div class="row" style="justify-content:space-between;font-size:13px;margin-top:6px"><a href="#course-${x.c.id}~notes" style="color:var(--ink);text-decoration:none">${esc(x.c.code || x.c.name)}</a><span class="hint">${x.d}/${x.t}</span></div>`).join('') || '<div class="hint" style="margin-top:6px">生成笔记后会自动出重点知识点，在「重点」里标「已掌握」就会算进来</div>'}
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
  return `<a class="item" href="#note-${n.id}"><div class="grow"><div class="t">${esc(n.title)}</div><div class="s">${esc(c ? c.name : '')} · ${fmtDate(n.createdAt)}${pg.total ? ` · 知识点 ${pg.done}/${pg.total}` : ''}${n.sessionId ? ' · 含录音' : ''}</div></div>${st}</a>`;
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
    if (del) confirmClick(del, '再点一次：删除课程和里面所有课件、笔记、录音', async () => {
      for (const st of ['files', 'notes', 'sessions']) {
        const items = await DB.byIndex(st, 'courseId', course.id);
        for (const it of items) { if (st === 'sessions') await DB.delByIndex('audio', 'sessionId', it.id); await DB.del(st, it.id); }
      }
      await DB.del('courses', course.id);
      await loadCourses(); close(); location.hash = 'home';
    });
  });
}

/* ---------- 课程页 ---------- */
async function renderCourse(id, tab) {
  const course = await DB.get('courses', id);
  if (!course) { location.hash = 'home'; return; }
  const [files, notes, sessions] = await Promise.all([DB.byIndex('files', 'courseId', id), DB.byIndex('notes', 'courseId', id), DB.byIndex('sessions', 'courseId', id)]);
  view.innerHTML = `
    <div>
      <a class="crumb" href="#home">← 课程主页</a>
      <div class="head" style="margin-top:6px">
        <div class="grow"><h1>${esc(course.name)}</h1><div class="meta">${course.examDate ? `考试 ${esc(course.examDate)} · ${examCountdown(course.examDate)}` : '还没设考试日期'}</div></div>
        <div class="row"><button class="btn small" id="c-edit">课程设置</button><button class="btn small" id="c-sync">${ICON.up}同步 Moodle</button><button class="btn small" id="c-points">知识点总结</button><button class="btn small" id="c-mock">模拟考试</button><a class="btn small" href="#ask-${id}">${ICON.chat}问 AI</a><button class="btn" id="c-desk">${ICON.mic}上课</button><button class="btn primary" id="c-gen">${ICON.spark}生成笔记</button></div>
      </div>
    </div>
    <div class="tabs">
      <button data-tab="files" class="${tab === 'files' ? 'on' : ''}">课件 ${files.length}</button>
      <button data-tab="notes" class="${tab === 'notes' ? 'on' : ''}">笔记 ${notes.length}</button>
      <button data-tab="sessions" class="${tab === 'sessions' ? 'on' : ''}">课堂录音 ${sessions.length}</button>
    </div>
    <div id="tab-body"></div>`;
  $$('.tabs button').forEach(b => b.onclick = () => { history.replaceState(null, '', '#course-' + id + '~' + b.dataset.tab); renderCourse(id, b.dataset.tab); });
  $('#c-edit').onclick = () => courseModal(course);
  $('#c-sync').onclick = () => syncModal(course.id);
  $('#c-gen').onclick = () => generateModal({ course, preselect: State.selected || [] });
  $('#c-points').onclick = () => coursePointsModal(course);
  $('#c-mock').onclick = () => mockExamModal(course);
  $('#c-desk').onclick = () => startClassModal(course);
  const body = $('#tab-body');
  if (tab === 'files') renderFilesTab(course, body);
  else if (tab === 'notes') {
    notes.sort((a, b) => b.createdAt - a.createdAt);
    body.innerHTML = notes.length ? `<div class="card list">${notes.map(noteItem).join('')}</div>`
      : `<div class="empty"><strong>还没有笔记</strong>先在「课件」里导入 Moodle 课件，勾选后点「生成笔记」。</div>`;
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
function fileStatus(f) {
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
    ${files.length ? `<div class="card files">${files.map((f, i) => `
      ${weekOf(f).label !== (files[i - 1] ? weekOf(files[i - 1]).label : null) ? `<div class="fgroup">${esc(weekOf(f).label)}</div>` : ''}
      <div class="file" data-id="${f.id}">
        <input type="checkbox" aria-label="选择 ${esc(f.name)}" ${State.selected.includes(f.id) ? 'checked' : ''} ${f.status !== 'ready' ? 'disabled' : ''}>
        ${fileIcon(f.name)}
        <div style="min-width:0"><div class="name">${esc(f.name)}</div>
          <div class="sub">${phaseOf(f) ? `<button class="tag ${phaseOf(f) === '预习' ? 'pre' : phaseOf(f) === '正课' ? 'cls' : phaseOf(f) === '课后' ? 'post' : 'asm'}" data-act="phase" title="点一下改标签">${phaseOf(f)}</button>` : '<button class="tag none" data-act="phase" title="打标签">＋标签</button>'}${fileStatus(f)}<span>${fmtSize(f.size)}</span>${f.moodleTitle && f.moodleTitle !== f.name.replace(/\.[^.]+$/, '') ? `<span>Moodle：${esc(f.moodleTitle)}</span>` : ''}</div></div>
        <div class="acts">
          ${f.status === 'scanned' || f.status === 'error' ? '<button class="btn small" data-act="ocr">用 Gemini 识别</button>' : ''}
          ${f.status === 'ready' || /\.pdf$/i.test(f.name) ? '<button class="btn small ghost" data-act="view">打开</button>' : ''}${f.status === 'ready' ? `<button class="btn small ghost" data-act="prep" title="5 分钟预习卡 + 术语表">${f.prep ? '课前包 ✓' : '课前包'}</button>` : ''}${f.status === 'ready' ? '<button class="btn small ghost" data-act="class" title="用这份课件上课：左边课件、中间笔记、右边翻译">上课</button>' : ''}
          <button class="btn small ghost" data-act="del">删除</button>
        </div>
      </div>`).join('')}</div>` : `<div class="empty"><strong>这门课还没有课件</strong>在 Moodle 打开课程 → 进入 Week 文件夹 → 点「Download folder」下载 ZIP，或者一个个下载 PDF/PPT，然后放到上面。</div>`}
    <div class="bar noprint" id="selbar" ${State.selected.length ? '' : 'hidden'}>
      <span class="grow">已选 <b id="selcount">${State.selected.length}</b> 个课件</span>
      <button class="btn small" id="sel-clear">取消</button>
      <button class="btn small primary" id="sel-gen">${ICON.spark}用选中的生成笔记</button>
    </div>`;

  const input = $('#file-in', body), drop = $('#drop', body);
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
}

/* 存文件并提取文字；items: [{file, folder, meta}] */
async function ingest(course, items) {
  const recs = [];
  for (const { file, folder, meta } of items) {
    const rec = Object.assign({ id: DB.uid('f_'), courseId: course.id, name: file.name, folder, size: file.size, type: file.type || Extract.MIME[Extract.ext(file.name)] || '', blob: file, text: '', pages: null, status: 'extracting', addedAt: Date.now() }, meta || {});
    await DB.put('files', rec); recs.push(rec);
  }
  refreshIfOn(course.id);
  for (const rec of recs) {
    try {
      const r = await Extract.fromFile(rec.blob);
      Object.assign(rec, { text: r.text, pages: r.pages, status: r.scanned ? 'scanned' : 'ready' });
    } catch (e) { Object.assign(rec, { status: 'error', error: e.message }); }
    await DB.put('files', rec);
    refreshIfOn(course.id);
  }
  return recs;
}

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

async function runSync(courses, includeEbook) {
  const S = State.sync = { total: 0, done: 0, added: 0, skipped: [], failed: [], current: '正在列出文件…', finished: false };
  showSyncProgress(true);
  try {
    // 1. 对应本地课程（没有就建）
    const plan = [];
    for (const mc of courses) {
      let local = (await DB.all('courses')).find(c => c.moodleId === mc.id) || State.courses.find(c => c.code && c.code === courseCode(mc.name) && !c.moodleId);
      if (!local) {
        local = { id: DB.uid('c_'), name: shortName(mc.name), code: courseCode(mc.name), examDate: '', glossary: [], createdAt: Date.now(), color: COLORS[State.courses.length % COLORS.length] };
      }
      local.moodleId = mc.id;
      await DB.put('courses', local);
      await loadCourses();
      S.current = '正在列出 ' + local.name + ' 的文件…'; showSyncProgress();
      const files = await Ext.call('listFiles', { courseId: mc.id }, 60000);
      const have = new Set((await DB.byIndex('files', 'courseId', local.id)).map(f => f.moodleCmid).filter(Boolean));
      const skip = new Set(local.moodleSkip || []);
      const todo = files.filter(f => !have.has(f.cmid) && !skip.has(f.cmid) && (includeEbook || !/e-?book/i.test(f.name)));
      plan.push({ local, todo });
      S.total += todo.length;
    }
    showSyncProgress();
    // 2. 一个一个下载
    for (const { local, todo } of plan) {
      for (const f of todo) {
        S.current = `${local.name} · ${f.name}`; showSyncProgress();
        try {
          const got = await Ext.call('fetchFile', { cmid: f.cmid, module: f.module });
          const items = [];
          for (const g of got) {
            if (g.error) { S.failed.push(`${f.name}：${g.error}`); continue; }
            if (!Extract.isSupported(g.name)) { S.skipped.push(g.name); continue; }
            const file = new File([b64ToBlob(g.b64, g.mime || Extract.MIME[Extract.ext(g.name)] || '')], g.name, { type: g.mime || '' });
            items.push({ file, folder: f.folder, meta: { moodleCmid: f.cmid, moodleCourseId: local.moodleId, moodleTitle: f.name, moodleRevision: g.revision } });
          }
          if (items.length) { await ingest(local, items); S.added += items.length; }
          else if (!got.length) S.failed.push(`${f.name}：没有文件`);
          else if (got.every(g => !g.error)) { local.moodleSkip = [...(local.moodleSkip || []), f.cmid]; await DB.put('courses', local); } // 全是不支持的类型，下次不再检查
        } catch (e) {
          if (e.code === 'login' || e.code === 'busy') { S.failed.push(e.message); throw e; }
          S.failed.push(`${f.name}：${e.message}`);
        }
        S.done++; showSyncProgress();
      }
    }
  } catch (e) {
    if (!S.failed.includes(e.message)) S.failed.push(e.message || String(e));
  }
  S.finished = true; S.current = '';
  await loadCourses();
  showSyncProgress(true);
  toast(`同步完成：新增 ${S.added} 个课件${S.skipped.length ? `，${S.skipped.length} 个类型不支持` : ''}${S.failed.length ? `，${S.failed.length} 个失败` : ''}`, 6000);
  State.sync = null;
  await Deadlines.refresh(true);
  if (location.hash.slice(1) === 'home' || !location.hash) route();
}

function showSyncProgress(force) {
  const S = State.sync; if (!S) return;
  const m = $('#modal'), box = $('#modal-box');
  const open = !m.hidden && box.dataset.sync;
  if (!open && !force) return;
  const html = `
    <h2>${S.finished ? '同步完成' : '正在同步 Moodle'}</h2>
    <div class="level" style="width:100%;height:8px"><i style="width:${S.total ? Math.round(S.done / S.total * 100) : 3}%"></i></div>
    <div style="font-size:14px">${S.finished ? `新增 <b>${S.added}</b> 个课件` : `${S.done} / ${S.total || '…'} · ${esc(S.current)}`}</div>
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
    if (!f.blob) Object.assign(f, await Sync.ensureBlob(f));
    f.text = await AI.ocr(f.blob, mime);
    f.status = 'ready'; f.error = '';
    toast('识别完成：' + f.name);
  } catch (e) { f.status = 'error'; f.error = e.message; toast(e.message, 5000); }
  await DB.put('files', f); refreshIfOn(course.id);
}

/* ---------- 生成笔记 ---------- */
async function generateModal({ course, preselect = [], sessionId = null, noteId = null, title: presetTitle = '' }) {
  const files = sortFiles((await DB.byIndex('files', 'courseId', course.id)).filter(f => f.status === 'ready'));
  const sessions = (await DB.byIndex('sessions', 'courseId', course.id)).sort((a, b) => b.startedAt - a.startedAt);
  if (!files.length && !sessions.length) { toast('这门课还没有能用的课件或录音，先导入课件'); return; }
  const firstSel = files.find(f => preselect.includes(f.id));
  const defTitle = presetTitle || (sessionId ? (sessions.find(s => s.id === sessionId)?.title || '课堂笔记') : firstSel ? firstSel.name.replace(/\.[^.]+$/, '') : '');
  const p = AI.notesProvider();
  modal(`
    <h2>生成笔记</h2>
    <div class="field"><label>用哪些课件</label>
      ${files.length ? `<div class="checklist">${files.map(f => `<label><input type="checkbox" value="${f.id}" ${preselect.includes(f.id) ? 'checked' : ''}><span class="hint" style="min-width:58px">${esc(weekOf(f).label)}</span>${phaseOf(f) ? `<span class="tag ${phaseOf(f) === '预习' ? 'pre' : phaseOf(f) === '正课' ? 'cls' : phaseOf(f) === '课后' ? 'post' : 'asm'}">${phaseOf(f)}</span>` : ''}${esc(f.name)}</label>`).join('')}</div>` : '<span class="hint">这门课还没有已读取的课件</span>'}
    </div>
    ${sessions.length ? `<div class="field"><label for="g-sess">加上课堂录音（可选）</label><select id="g-sess"><option value="">不用录音</option>${sessions.map(s => `<option value="${s.id}" ${s.id === sessionId ? 'selected' : ''}>${esc(s.title)} · ${fmtTime(s.duration)}</option>`).join('')}</select><span class="hint">会把老师强调的考试、作业重点单独列出来</span></div>` : ''}
    <div class="field"><label for="g-title">笔记标题</label><input id="g-title" type="text" value="${esc(defTitle)}" placeholder="例如 Week 1 会计等式"></div>
    <div class="field"><label>详细程度</label><div class="radios">
      <label><input type="radio" name="g-style" value="detailed" checked>详细（第一次学）</label>
      <label><input type="radio" name="g-style" value="brief">精简（考前复习）</label></div></div>
    <div class="field"><label for="g-extra">额外要求（可不填）</label><input id="g-extra" type="text" placeholder="例如：多给几道计算题"></div>
    <div class="hint" id="g-est"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="g-go">${ICON.spark}开始生成</button></div>`, (box, close) => {
    const est = () => {
      const ids = $$('.checklist input:checked', box).map(i => i.value);
      const chars = files.filter(f => ids.includes(f.id)).reduce((n, f) => n + (f.text || '').length, 0);
      const sid = $('#g-sess', box)?.value;
      const sChars = sid ? sessions.find(s => s.id === sid).segments.reduce((n, g) => n + g.en.length + g.zh.length, 0) : 0;
      const tokens = Math.round((chars + sChars) / 3.2) + 1500;
      const yuan = p.id === 'deepseek' ? (tokens * 2 + 12000 * 8) / 1e6 : null;
      $('#g-est', box).textContent = `用 ${p.label}（${p.model}）· 材料约 ${Math.round(tokens / 1000)}k tokens` + (yuan !== null ? ` · 预计不到 ¥${Math.max(0.01, yuan).toFixed(2)}（按高峰价估）` : '');
    };
    $$('input,select', box).forEach(i => i.addEventListener('change', est)); est();
    $('#g-go', box).onclick = async () => {
      const ids = $$('.checklist input:checked', box).map(i => i.value);
      const sid = $('#g-sess', box)?.value || null;
      if (!ids.length && !sid) { toast('至少选一个课件或一段录音'); return; }
      const title = $('#g-title', box).value.trim() || (sid ? '课堂笔记' : files.find(f => f.id === ids[0]).name.replace(/\.[^.]+$/, ''));
      const style = $('input[name=g-style]:checked', box).value;
      const extra = $('#g-extra', box).value.trim(); // 关窗之前先读，关了就读不到了
      close();
      try {
        const id = await startGeneration({ course, fileIds: ids, sessionId: sid, title, style, extra, noteId });
        State.selected = [];
        location.hash = 'note-' + id;
      } catch (e) { toast('没能开始生成：' + e.message, 6000); }
    };
  });
}

function sessionTranscript(s) {
  return s.segments.map(g => `[${fmtTime(g.t)}]${g.important ? '【重点】' : ''}${g.starred ? '【学生标记】' : ''} ${g.en}\n　　${g.zh || ''}`).join('\n');
}

async function startGeneration({ course, fileIds, sessionId, title, style, extra, noteId }) {
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
      toast('笔记生成好了：' + title + '，正在出重点和测验题…');
      autoStudy = true;
    } catch (e) {
      note.markdown = gen.text; note.status = gen.text ? 'done' : 'error';
      note.error = e.name === 'AbortError' ? '已停止' : e.message;
      if (e.name !== 'AbortError') toast(e.message, 6000);
    }
    await DB.put('notes', note);
    State.gens.delete(note.id);
    job.done();
    ping();
    if (autoStudy && Settings.load().autoStudy !== false) Study.background(note.id);
  })();
  return note.id;
}

/* 上课：找这份课件已有的笔记，没有就建一份空白的，然后进工作台 */
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
const NOTE_TABS = [['note', '笔记'], ['board', '画板'], ['points', '重点'], ['cards', '记忆卡片'], ['quiz', '测验'], ['map', '思维导图']];
function noteTabsHTML(tab, note) {
  const pg = Study.progress(note);
  return NOTE_TABS.map(([k, l]) => `<button data-ntab="${k}" class="${tab === k ? 'on' : ''}">${l}${k === 'points' && pg.total ? ` <span class="pill mute">${pg.done}/${pg.total}</span>` : ''}${k !== 'note' && k !== 'board' && k !== 'map' && State.studyGens.has(note.id) ? ' <span class="spin" style="width:10px;height:10px;border-width:1.5px"></span>' : ''}</button>`).join('');
}
/* 在 pane 里画一个笔记工具（笔记以外的标签） */
function mountNoteTool(tab, note, course, pane, go) {
  if (tab === 'board') return Board.mount(pane, note, { course });
  if (tab === 'points') return Study.points(note, pane, { focus: go && go.focus });
  if (tab === 'cards') return Study.cards(note, pane);
  if (tab === 'quiz') return Study.quiz(note, pane, { gotoPoint: id => go && go.toPoint(id) });
  if (tab === 'map') return MindMap.mount(pane, note);
}
async function renderNote(id, tab = 'note', opt = {}) {
  if (!location.hash.slice(1).startsWith('note-' + id)) return; // 已经离开这页了（异步回调晚到），不要把别的页面盖掉
  const note = await DB.get('notes', id);
  if (!note) { location.hash = 'home'; return; }
  const course = await DB.get('courses', note.courseId);
  const files = (await Promise.all((note.sourceFileIds || []).map(f => DB.get('files', f)))).filter(Boolean);
  const gen = State.gens.get(id);
  view.innerHTML = `
    <div class="noprint">
      <a class="crumb" href="#course-${note.courseId}~notes">← ${esc(course ? course.name : '课程')}</a>
      <div class="head" style="margin-top:6px">
        <div class="grow"><h1>${esc(note.title)}</h1>
          <div class="meta">${fmtDate(note.createdAt)} · ${esc(note.model || '')}${files.length ? ' · 来源：' + files.map(f => esc(f.name)).join('、') : ''}${note.sessionId ? ' · 含课堂录音' : ''}</div></div>
        <div class="row"><a class="btn" href="#desk-${id}">上课工作台</a><button class="btn" id="n-ask">问 AI</button></div>
      </div>
      <div class="tabs" id="n-tabs">${noteTabsHTML(tab, note)}</div>
    </div>
    <div id="n-pane"></div>`;
  $$('[data-ntab]').forEach(b => b.onclick = () => { history.replaceState(null, '', '#note-' + id + (b.dataset.ntab === 'note' ? '' : '~' + b.dataset.ntab)); renderNote(id, b.dataset.ntab); });
  $('#n-ask').onclick = () => chatDrawer({ note, course });
  const pane = $('#n-pane');
  if (tab !== 'note') {
    pane.className = tab === 'board' ? '' : 'card pad tool-pane';
    mountNoteTool(tab, note, course, pane, { focus: opt.focus, toPoint: pid => { history.replaceState(null, '', '#note-' + id + '~points'); renderNote(id, 'points', { focus: pid }); } });
    return;
  }
  pane.innerHTML = `<div class="row noprint" id="note-acts" style="justify-content:flex-end;margin-bottom:10px"></div><article class="sheet"><div id="note-body" class="md"></div></article>`;
  const body = $('#note-body'), acts = $('#note-acts');

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

  if (note.status === 'error') body.innerHTML = `<div class="empty"><strong>生成失败</strong>${esc(note.error)}</div>`;
  else if (!note.markdown) body.innerHTML = `<div class="empty"><strong>这是一份空白笔记</strong>可以直接点「编辑」写，或者在「画板」里手写；有课件的话点「生成」让 AI 先写一稿。</div>`;
  else body.innerHTML = md(note.markdown) + (note.error ? `<p class="noprint" style="color:var(--warn)">（${esc(note.error)}，内容可能不完整）</p>` : '');
  linkPageRefs(body, note);
  acts.innerHTML = `
    ${note.sessionId ? `<button class="btn small primary" id="n-recap" title="把老师讲的、你手写的，整理进笔记下半部分">${ICON.spark}录音总结 → 笔记</button>` : `<button class="btn small" id="n-link">关联课堂录音</button>`}
    <button class="btn small" id="n-edit">编辑</button>
    <button class="btn small" id="n-copy">复制</button>
    <button class="btn small" id="n-pdf">导出 PDF</button>
    <button class="btn small" id="n-regen">${note.markdown ? '重新生成' : '生成'}</button>
    <button class="btn small ghost" id="n-del">删除</button>`;
  $('#n-copy').onclick = async () => { try { await navigator.clipboard.writeText(note.markdown); toast('已复制 Markdown，可以粘贴到 Goodnotes / Notion'); } catch (e) { toast('复制失败，长按文字手动复制'); } };
  $('#n-pdf').onclick = () => { toast('在打印窗口选「存储为 PDF」，再导入 Goodnotes 手写批注'); setTimeout(() => window.print(), 300); };
  $('#n-regen').onclick = async () => {
    if (!course) return;
    if (!(note.sourceFileIds || []).length && !note.sessionId) { generateModal({ course, noteId: note.id, title: note.title }); return; }
    await startGeneration({ course, fileIds: note.sourceFileIds || [], sessionId: note.sessionId, title: note.title, style: note.style || 'detailed', extra: note.extra, noteId: note.id });
    renderNote(id);
  };
  const rc = $('#n-recap'); if (rc) rc.onclick = () => runRecap(note, course, () => renderNote(id));
  const lk = $('#n-link'); if (lk) lk.onclick = () => linkSessionModal(note, () => renderNote(id));
  confirmClick($('#n-del'), '确认删除', async () => { await DB.del('notes', id); location.hash = 'course-' + note.courseId + '~notes'; });
  $('#n-edit').onclick = () => {
    body.innerHTML = `<textarea id="n-text" style="min-height:60vh;font-family:var(--mono);font-size:14px">${esc(note.markdown)}</textarea>
      <div class="row noprint" style="justify-content:flex-end;margin-top:10px"><button class="btn" id="n-cancel">取消</button><button class="btn primary" id="n-save">保存</button></div>`;
    $('#n-cancel').onclick = () => renderNote(id);
    $('#n-save').onclick = async () => { note.markdown = $('#n-text').value; await DB.put('notes', note); toast('已保存'); renderNote(id); };
  };
}
/* 笔记里的 [p.5] 变成可点的小标签（在工作台里点了会跳到课件那一页） */
function linkPageRefs(body, note) {
  body.innerHTML = body.innerHTML.replace(/\[p\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?\]/g, (m, a) => `<button class="pref" data-page="${a}">p.${a}</button>`);
  $$('.pref', body).forEach(b => b.onclick = () => document.dispatchEvent(new CustomEvent('tkb-goto-page', { detail: { page: Number(b.dataset.page) } })));
}

async function linkSessionModal(note, after) {
  const sessions = (await DB.byIndex('sessions', 'courseId', note.courseId)).sort((a, b) => b.startedAt - a.startedAt);
  if (!sessions.length) { toast('这门课还没有课堂录音'); return; }
  modal(`<h2>关联课堂录音</h2><div class="field"><select id="ls-s">${sessions.map(s => `<option value="${s.id}">${esc(s.title)} · ${fmtDate(s.startedAt)} · ${fmtTime(s.duration)}</option>`).join('')}</select><span class="hint">关联后可以点「录音总结 → 笔记」，问 AI 也会参考这节课老师说的话</span></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="ls-go">关联</button></div>`, (box, close) => {
    $('#ls-go', box).onclick = async () => { note.sessionId = $('#ls-s', box).value; await DB.put('notes', note); close(); after && after(); };
  });
}

async function runRecap(note, course, after) {
  const close = modal(`<h2>录音总结 → 笔记</h2><div data-job-slot="recap:${note.id}"><div class="thinking"><span class="spin"></span>准备中…</div></div><div id="rc-st" hidden></div><p class="hint" style="margin:0">会读这节课的录音转写、你标记的重点和画板上的手写（手写用 Gemini 免费识别），整理成笔记下半部分「课堂上老师提到的」。上半部分的课件笔记不会动。</p>`);
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
    <div class="head"><div><h1>课堂录音</h1><div class="meta">实时转写老师的英文，并翻成中文字幕；结束后可以一键整理成笔记</div></div></div>
    ${!s.geminiKey ? '<div class="banner"><div class="grow"><strong>还没填 Gemini API key</strong></div><a class="btn primary small" href="#settings">去设置</a></div>' : ''}
    <div class="card pad" style="display:flex;flex-direction:column;gap:16px">
      <div class="field"><label for="l-course">这是哪门课</label>
        <select id="l-course"><option value="">不属于任何课程</option>${courses.map(c => `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <span class="hint">选了课程，会用这门课课件里的专业词提高识别准确度，录音也会存进这门课</span></div>
      <div class="row">
        <button class="recbtn" id="l-start" aria-label="开始录音"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></svg></button>
        <div><strong>开始录音</strong><div class="hint" style="color:var(--muted);font-size:13px">识别语言：${esc(langLabel(s.liveLanguage))} · 可在设置里改</div></div>
      </div>
    </div>
    <div class="card pad" style="font-size:14px;color:var(--muted);line-height:1.7">
      <strong style="color:var(--ink)">上课时这样用</strong><br>
      · 手机或 iPad 放在离老师近一点的桌上，第一次会问你要麦克风权限，点「允许」。<br>
      · 想一边录一边在 iPad 上手写：用分屏把听课本和 Goodnotes 并排放。听课本完全切到后台时，iPadOS 可能会停掉麦克风（不确定，建议先试一节课）。<br>
      · 听到老师说重点，点「标记重点」，整理笔记时会单独列出来。<br>
      · 老师说几个词就会先出灰色的草稿中文${(Settings.load().draftMode || 'free') === 'free' ? '（用 Chrome 内置免费翻译；iPad 上没有这个功能）' : ''}；说完一句或最多 ${Settings.load().maxWaitSec || 6} 秒，就换成黑色的正式翻译。<br>
      · ${AI.translateProvider() === 'deepseek' ? '正式翻译用 DeepSeek，会纠正识别错的专业词、术语前后一致。' : '正式翻译用免费模型池（Groq 两个模型 + Gemini 四个模型轮流用）。在「设置」里多填几家免费 key，就更快、更不容易用完。'}
    </div>`;
  $('#l-start').onclick = async () => {
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
    });
    try {
      await sess.start();
      State.live = sess;
      renderSide();
      renderLiveRunning();
    } catch (e) {
      btn.disabled = false;
      const msg = e.name === 'NotAllowedError' ? '没有麦克风权限。到浏览器设置里允许这个网站使用麦克风，再试一次。' : e.name === 'NotFoundError' ? '没找到麦克风。检查麦克风有没有接好，或在「设置」里换一个麦克风。' : e.message;
      toast(msg, 6000);
      try { sess.capture && sess.capture.stop(); } catch (x) {}
    }
  };
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
};
function capHTML(g) {
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
  if (!s) { location.hash = 'home'; return; }
  const course = s.courseId ? await DB.get('courses', s.courseId) : null;
  const failed = s.segments.filter(g => g.status !== 'done').length;
  const view_ = Settings.load().captionView;
  view.innerHTML = `
    <div>
      <a class="crumb" href="${course ? '#course-' + course.id + '~sessions' : '#live'}">← ${esc(course ? course.name : '课堂录音')}</a>
      <div class="head" style="margin-top:6px">
        <div class="grow"><h1 id="s-title">${esc(s.title)}</h1><div class="meta">${fmtDate(s.startedAt)} · ${fmtTime(s.duration)} · ${s.segments.length} 句${s.highlights.length ? ' · ' + s.highlights.length + ' 个标记' : ''}</div></div>
        <div class="row">
          ${course ? `<button class="btn" id="s-merge" title="选一份已有笔记，把这节课老师讲的整理进去">并入已有笔记</button><button class="btn primary" id="s-gen">${ICON.spark}整理成新笔记</button>` : ''}
          <button class="btn small" id="s-rename">改名</button>
          <button class="btn small" id="s-copy">复制全文</button>
          ${s.hasAudio ? '<button class="btn small" id="s-audio">下载录音</button>' : ''}
          ${failed ? `<button class="btn small" id="s-fix">补翻 ${failed} 句</button>` : ''}
          <button class="btn small ghost" id="s-del">删除</button>
        </div>
      </div>
    </div>
    ${!course ? '<div class="banner"><div class="grow">这段录音没有归到课程里。要整理成笔记，先把它放进一门课。</div><select id="s-move" style="width:auto"><option value="">选择课程</option>' + State.courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + '</select></div>' : ''}
    ${(s.confused || []).length ? `<div class="card pad confused-box"><div style="font-size:13px;font-weight:700;color:var(--warn);margin-bottom:8px">❓ 没听懂的地方 · ${s.confused.length}</div>${s.confused.map((c, i) => `<div class="cf" data-cf="${i}"><div class="row"><span class="clock" style="font-size:13px">${fmtTime(c.t)}</span><span class="grow hint cf-near">${esc(c.near.slice(-160))}</span><button class="btn small ghost" data-cf-go>跳过去</button><button class="btn small ${c.explain ? '' : 'primary'}" data-cf-ex>${c.explain ? '重新讲' : '用中文重讲'}</button></div>${c.explain ? `<div class="md cf-ex">${md(c.explain)}</div>` : '<div class="cf-ex" hidden></div>'}</div>`).join('')}</div>` : ''}
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
  const mg = $('#s-merge'); if (mg) mg.onclick = async () => {
    const notes = (await DB.byIndex('notes', 'courseId', course.id)).filter(n => n.markdown).sort((a, b) => b.createdAt - a.createdAt);
    if (!notes.length) { toast('这门课还没有笔记，点「整理成新笔记」'); return; }
    modal(`<h2>并入已有笔记</h2><div class="field"><select id="mg-n">${notes.map(n => `<option value="${n.id}" ${n.sessionId === s.id ? 'selected' : ''}>${esc(n.title)}</option>`).join('')}</select><span class="hint">课件笔记不动，在下面加一部分「课堂上老师提到的」：老师强调的、课件之外的补充、课堂提问和答案、你的手写</span></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="mg-go">开始整理</button></div>`, (box, close) => {
      $('#mg-go', box).onclick = async () => { const n = await DB.get('notes', $('#mg-n', box).value); n.sessionId = s.id; await DB.put('notes', n); close(); runRecap(n, course, () => { location.hash = 'note-' + n.id; }); };
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
  if (s.hasAudio) {
    let audio = null, url = null, cur = -1;
    const ensure = async () => {
      if (audio) return audio;
      const w = await sessionWav(s.id); if (!w) { toast('这段没有保存录音'); return null; }
      url = URL.createObjectURL(w); audio = new Audio(url); audio.preload = 'auto';
      audio.ontimeupdate = () => {
        if (!$('#p-time')) { audio.pause(); URL.revokeObjectURL(url); return; }
        $('#p-time').textContent = fmtTime(audio.currentTime); $('#p-seek').value = Math.floor(audio.currentTime);
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
  confirmClick($('#s-del'), '确认删除', async () => { await DB.delByIndex('audio', 'sessionId', s.id); await DB.del('sessions', s.id); location.hash = course ? 'course-' + course.id + '~sessions' : 'live'; });
  const mv = $('#s-move'); if (mv) mv.onchange = async () => { if (!mv.value) return; s.courseId = mv.value; await DB.put('sessions', s); toast('已放进课程'); renderSession(id); };
}

/* ---------- 设置 ---------- */
function renderSettings() {
  const s = Settings.load();
  const keyField = (id, label, val, hint) => `
    <div class="field"><label for="${id}">${label}</label>
      <div class="keyrow"><input id="${id}" type="password" autocomplete="off" spellcheck="false" value="${esc(val)}" placeholder="粘贴 API key"><button class="btn small" data-show="${id}">显示</button><button class="btn small" data-test="${id}">测试</button></div>
      <span class="hint">${hint}</span><div class="result" id="${id}-r"></div></div>`;
  view.innerHTML = `
    <div class="head"><div><h1>设置</h1><div class="meta">API key 只保存在这台设备的浏览器里，不会上传到别处。Mac 和 iPad 要各填一次。</div></div></div>
    <div class="settings">
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
              <option value="deepseek" ${s.draftMode === 'deepseek' ? 'selected' : ''}>DeepSeek（更准，iPad 也能用，每小时约多 ¥1–2）</option>
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
        <label class="switch" style="margin-top:8px"><input type="checkbox" id="s-auto-study" ${s.autoStudy !== false ? 'checked' : ''}>生成笔记后，自动出重点、记忆卡片和测验题（DeepSeek，每份约 ¥0.02–0.05）</label>
        <label class="switch" style="margin-top:8px"><input type="checkbox" id="s-audio" ${s.saveAudio ? 'checked' : ''}>同时保存录音（之后可以下载回听，1 小时约 115MB）</label>
        <div class="row" style="margin-top:12px"><button class="btn small" id="t-live">测试实时转写连接</button><div class="result" id="t-live-r"></div></div>
      </section>
      <section class="card pad">
        <h2>课堂正式翻译（免费模型池）</h2>
        <p>按下面的顺序轮流用各家的免费额度：哪家慢（4 秒没出字）、出错或今天额度快用完，就自动换下一家。每家都是免费注册、不用绑卡；填了 key 的才会用。</p>
        <div class="field" style="margin-bottom:12px"><label for="t-prov">翻译方式</label><select id="t-prov">
          <option value="pool" ${s.translateProvider !== 'deepseek' ? 'selected' : ''}>免费模型池（推荐）</option>
          <option value="deepseek" ${s.translateProvider === 'deepseek' ? 'selected' : ''}>只用 DeepSeek（付费，每小时约 ¥0.5–1）</option>
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
      <section class="card pad" id="r2">
        <div class="row" style="justify-content:space-between"><h2>云同步（Cloudflare R2）</h2><span class="pill ${Sync.ready() ? 'ok' : 'mute'}" id="r2-st">${Sync.ready() ? '已设置' : '未设置'}</span></div>
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
          <button class="btn small" id="r2-all" title="默认只在打开课件时才下载，这里可以一次全部下到本机（离线也能看）">全部课件下载到本机</button>
          <span class="hint" id="r2-info"></span>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="btn small ghost" id="mv-copy">复制设置给另一台设备</button>
          <button class="btn small ghost" id="mv-paste">粘贴设置</button>
          <span class="hint">会带上所有 API key，只发给你自己的设备</span>
        </div>
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
  bind('#m-ds', 'deepseekModel', v => v.trim()); bind('#ds-think', 'deepseekThinking');
  bind('#l-lang', 'liveLanguage'); bind('#l-mode', 'liveMode'); bind('#s-audio', 'saveAudio'); bind('#t-prov', 'translateProvider'); bind('#d-mode', 'draftMode'); bind('#t-pace', 'translatePace'); bind('#s-auto-study', 'autoStudy'); bind('#s-mic', 'micId');
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
function bindR2() {
  const info = $('#r2-info'); if (!info) return;
  const paint = st => { if (!info.isConnected) { Sync.listeners.delete(paint); return; } info.textContent = st.running ? '同步中…' : st.err ? '上次出错：' + st.err : st.at ? '上次同步 ' + fmtDate(st.at) : ''; $('#r2-st').className = 'pill ' + (st.ready ? (st.err ? 'bad' : 'ok') : 'mute'); $('#r2-st').textContent = st.ready ? (st.err ? '出错' : '已设置') : '未设置'; };
  Sync.listeners.add(paint); paint(Sync.status());
  [['#r2-acct', 'r2Account'], ['#r2-bucket', 'r2Bucket'], ['#r2-id', 'r2KeyId'], ['#r2-secret', 'r2Secret']].forEach(([id, k]) => $(id).addEventListener('change', e => { Settings.save({ [k]: e.target.value.trim() }); paint(Sync.status()); }));
  $('#r2-cors-copy').onclick = async () => { try { await navigator.clipboard.writeText($('#r2-cors').textContent); toast('已复制，粘贴到 R2 的 CORS 策略里'); } catch (e) { toast('复制失败，手动选中复制'); } };
  $('#r2-test').onclick = async () => { const b = $('#r2-test'); b.disabled = true; info.textContent = '测试中…'; try { await Sync.test(); info.textContent = '✓ 连接正常，可以同步'; Sync.start(); } catch (e) { info.textContent = '✗ ' + e.message; } b.disabled = false; };
  $('#r2-sync').onclick = async () => { const b = $('#r2-sync'); b.disabled = true; await Sync.syncNow({ onProgress: t => { info.textContent = t; } }); b.disabled = false; paint(Sync.status()); };
  $('#r2-all').onclick = async () => { const b = $('#r2-all'); b.disabled = true; try { const n = await Sync.downloadAll(t => { info.textContent = '下载 ' + t; }); toast(n ? `下载了 ${n} 个课件` : '课件都已经在本机了'); } catch (e) { toast(e.message, 6000); } b.disabled = false; paint(Sync.status()); };
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
    for (const st of ['courses', 'notes', 'sessions', 'files']) for (const it of data[st] || []) { const old = await DB.get(st, it.id); if (st === 'files' && old?.blob) it.blob = old.blob; await DB.put(st, it); n++; }
    await loadCourses(); toast(`导入了 ${n} 条记录`); route();
  } catch (e) { toast('导入失败：' + e.message, 5000); }
}

/* ---------- 启动 ---------- */
window.addEventListener('beforeunload', e => { if (State.live) { e.preventDefault(); e.returnValue = '正在录音，离开会停止录音'; } });
(async () => {
  if (!window.indexedDB) { view.innerHTML = '<div class="empty"><strong>这个浏览器不能保存数据</strong>请用 Safari 或 Chrome 打开，不要用无痕模式。</div>'; return; }
  await loadCourses();
  Sync.start();
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
  route();
})();
