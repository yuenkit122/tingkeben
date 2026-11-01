/* 听课本 — 课表与上课提醒

   借鉴 Otter 的日历联动：与其让用户到点自己想起来开录，不如让 App 知道「现在该上哪门课」。
   Otter 是读系统日历 + 麦克风占用；网页端做不到那些，能做的等价物就是一张自己填的课表。

   为什么不放云端：课表是私人时间表，换学期就重来，体积又小，同步一次反而多一份出错的机会。
   全部存在本机 localStorage。 */
const Schedule = (() => {
  const KEY = 'tingkeben.schedule';
  const REMIND_KEY = 'tingkeben.remindOn';
  const DAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const pad = n => String(n).padStart(2, '0');
  const toMin = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const fromMin = m => pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60);

  const load = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const save = list => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {} };
  const courseName = e => {
    const c = (typeof State !== 'undefined' && State.courses || []).find(x => x.id === e.courseId);
    return (c && c.name) || e.name || '未命名课程';
  };
  const remindOn = () => { try { return localStorage.getItem(REMIND_KEY) === '1'; } catch (e) { return false; } };
  const setRemind = on => { try { localStorage.setItem(REMIND_KEY, on ? '1' : '0'); } catch (e) {} };

  function add(e) {
    const list = load();
    const it = Object.assign({ id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), day: 1, start: '09:00', end: '11:00', room: '', courseId: '', name: '' }, e);
    if (toMin(it.end) <= toMin(it.start)) it.end = fromMin(Math.min(23 * 60 + 59, toMin(it.start) + 120));
    list.push(it); save(list);
    return it;
  }
  const update = (id, patch) => save(load().map(x => x.id === id ? Object.assign({}, x, patch) : x));
  const remove = id => save(load().filter(x => x.id !== id));

  /* 下一次课：从今天起最多往后找 14 天。正在上的课算「现在」，不算「下一次」。 */
  function next(now = new Date()) {
    const list = load();
    if (!list.length) return null;
    let best = null;
    for (let i = 0; i < 14 && !best; i++) {
      const d = new Date(now); d.setDate(d.getDate() + i); d.setHours(0, 0, 0, 0);
      for (const e of list) {
        if (Number(e.day) !== d.getDay()) continue;
        const at = new Date(d); at.setMinutes(toMin(e.start));
        const end = new Date(d); end.setMinutes(toMin(e.end));
        if (end <= now) continue;
        if (!best || at < best.at) best = { entry: e, at, end };
      }
    }
    if (!best) return null;
    best.live = best.at <= now && now < best.end;
    best.inMs = best.at - now;
    best.leftMs = best.end - now;
    best.today = best.at.toDateString() === now.toDateString();
    best.tomorrow = best.at.toDateString() === new Date(now.getTime() + 864e5).toDateString();
    return best;
  }

  /* 某一天的课，按开始时间排 */
  function on(date = new Date()) {
    const day = date.getDay();
    return load().filter(e => Number(e.day) === day).sort((a, b) => toMin(a.start) - toMin(b.start));
  }

  const when = n => {
    if (!n) return '';
    const d = n.at;
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (n.today) return '今天 ' + hm;
    if (n.tomorrow) return '明天 ' + hm;
    return DAY[d.getDay()] + ' ' + hm;
  };
  const countdown = n => {
    if (!n) return '';
    const m = Math.max(0, Math.round(n.inMs / 60000));
    if (n.live) return '现在就在上课，还有 ' + Math.max(0, Math.round(n.leftMs / 60000)) + ' 分钟下课';
    if (m < 1) return '马上开始';
    if (m < 60) return '还有 ' + m + ' 分钟';
    return '还有 ' + Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分钟';
  };

  /* ---------- 提醒 ----------
     网页端做不到「关掉 App 也能提醒」（那是系统级日历或推送的能力）。
     这里退一步：只要听课本开着（含挂在后台的标签页），开课前 10 分钟提醒一次。 */
  async function askNotify() {
    try {
      if (typeof Notification === 'undefined') return 'no';
      if (Notification.permission === 'granted') return 'granted';
      if (Notification.permission === 'denied') return 'denied';
      return await Notification.requestPermission();
    } catch (e) { return 'no'; }
  }

  function tick() {
    if (!remindOn()) return;
    const n = next();
    if (!n || n.live || n.inMs > 10 * 60000) return;
    const key = 'tingkeben.reminded.' + n.entry.id + '.' + n.at.toDateString();
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch (e) {}
    const mins = Math.max(1, Math.round(n.inMs / 60000));
    const title = mins <= 1 ? '马上上课' : '还有 ' + mins + ' 分钟上课';
    const body = courseName(n.entry) + ' · ' + n.entry.start + (n.entry.room ? ' · ' + n.entry.room : '');
    try { if (typeof toast === 'function') toast(title + '：' + body, 9000); } catch (e) {}
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body, tag: key, silent: false });
    } catch (e) {}
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(tick, 60000);
    setTimeout(tick, 4000);
  }
  let timer = null;

  /* ---------- 添加课时的弹窗 ---------- */
  function addModal(after) {
    const courses = (typeof State !== 'undefined' && State.courses) || [];
    const now = new Date();
    const sel = courses.length ? courses.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') : '';
    modal(`<h2>添加上课时间</h2>
      <div class="two">
        <div class="field"><label for="sc-course">哪门课</label><select id="sc-course">${sel || '<option value="">先在首页新建课程</option>'}</select></div>
        <div class="field"><label for="sc-room">教室（可不填）</label><input id="sc-room" type="text" placeholder="例如 B203 / 线上"></div>
      </div>
      <div class="two">
        <div class="field"><label for="sc-day">星期几</label><select id="sc-day">${DAY.map((d, i) => `<option value="${i}" ${i === now.getDay() ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
        <div class="field"><label>时间</label><div class="row"><input id="sc-start" type="time" value="09:00" style="max-width:130px"><span class="hint">到</span><input id="sc-end" type="time" value="11:00" style="max-width:130px"></div></div>
      </div>
      <div class="hint">每周重复。放假或调课就在列表里删掉那一周；一门课一周上两次就加两条。</div>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" data-close>取消</button><button class="btn primary" id="sc-save">添加</button></div>`, (box, close) => {
      $('#sc-save', box).onclick = () => {
        const cid = $('#sc-course', box).value;
        const c = courses.find(x => x.id === cid);
        if (!cid) { toast('先建一门课'); return; }
        const start = $('#sc-start', box).value || '09:00';
        let end = $('#sc-end', box).value || '';
        if (!end || toMin(end) <= toMin(start)) end = fromMin(Math.min(23 * 60 + 59, toMin(start) + 120));
        add({ courseId: cid, name: c ? c.name : '', day: Number($('#sc-day', box).value), start, end, room: $('#sc-room', box).value.trim() });
        close(); toast('已加入课表');
        if (after) after();
      };
    });
  }

  return { load, add, update, remove, next, on, when, countdown, courseName, remindOn, setRemind, askNotify, start, tick, addModal, DAY };
})();
