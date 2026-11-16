/* 导入转写文稿：把别的软件转写好的课堂文字（听悟导出的「原文和译文」Word、txt、字幕 srt/vtt）
   变成听课本里的一段课堂录音（只有文字、没有音频），之后可以照常整理笔记、按话题分段、问 AI、导出。
   支持的写法：
   - 听悟：「发言人 1   00:42」一行，下面一行英文原文、一行中文译文（只有原文也行）
   - 每行带时间：「[00:12] text」「00:12 text」「00:01:02 text」
   - 字幕：srt / vtt
   - 什么时间都没有：按段落切，时间按字数估 */
const TranscriptImport = (() => {
  const CJK = /[㐀-鿿]/g;
  const isZh = s => { const t = s.replace(/\s/g, ''); return t.length > 0 && (t.match(CJK) || []).length / t.length > 0.3; };
  const toSec = str => str.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
  const TIME = '(\\d{1,2}:\\d{2}(?::\\d{2})?)';
  const SPEAKER = new RegExp('^(?:发言人|说话人|Speaker|讲者|发言者)\\s*[^\\s]*\\s+' + TIME + '$', 'i');
  const SPEAKER_ONLY_TIME = new RegExp('^\\S{1,20}\\s{2,}' + TIME + '$'); // 改过名的发言人：「Ms Lee   03:12」
  const LINE_TIME = new RegExp('^\\[?' + TIME + '\\]?\\s*[-–—:：]?\\s+(.+)$');

  function addText(seg, line) {
    if (isZh(line)) seg.zh = seg.zh ? seg.zh + line : line;
    else seg.en = seg.en ? seg.en + ' ' + line : line;
  }

  function parseBlocks(lines) {
    const segs = []; let cur = null;
    for (const line of lines) {
      const m = line.match(SPEAKER) || line.match(SPEAKER_ONLY_TIME);
      if (m) { cur = { t: toSec(m[1]), en: '', zh: '' }; segs.push(cur); continue; }
      if (cur) addText(cur, line);
    }
    return segs;
  }
  function parseLineTimes(lines) {
    const segs = []; let cur = null;
    for (const line of lines) {
      const m = line.match(LINE_TIME);
      if (m) { cur = { t: toSec(m[1]), en: '', zh: '' }; segs.push(cur); addText(cur, m[2]); }
      else if (cur) addText(cur, line);
    }
    return segs;
  }
  function parseSubtitles(text) {
    const segs = [];
    const re = /(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})[.,]\d{1,3}\s*-->\s*[^\n]+\n([\s\S]*?)(?=\n\s*\n|$)/g;
    let m;
    while ((m = re.exec(text))) {
      const seg = { t: toSec(m[1]), en: '', zh: '' };
      m[2].split('\n').map(s => s.replace(/<[^>]+>/g, '').trim()).filter(Boolean).forEach(l => addText(seg, l));
      segs.push(seg);
    }
    return segs;
  }
  function parsePlain(lines) {
    // 没有时间：英文一段 + 紧跟的中文一段算一句；时间按英文 150 词/分钟估
    const segs = []; let t = 0, cur = null;
    for (const line of lines) {
      if (isZh(line) && cur && !cur.zh && cur.en) { cur.zh = line; continue; }
      cur = { t: Math.round(t), en: '', zh: '' }; addText(cur, line); segs.push(cur);
      const words = (cur.en || '').split(/\s+/).length || Math.ceil((cur.zh || '').length / 4);
      t += Math.max(3, words / 2.5);
    }
    return segs;
  }

  /* 读出标题、开始时间、句子 */
  function parse(text, fileName = '') {
    text = String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');
    const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
    let segs = [];
    if (/-->/.test(text)) segs = parseSubtitles(text);
    if (!segs.length && lines.some(l => SPEAKER.test(l))) segs = parseBlocks(lines);
    if (!segs.length) { const s2 = parseLineTimes(lines); if (s2.length >= 2) segs = s2; }
    if (!segs.length) {
      const body = lines.filter((l, i) => !(i < 3 && (/^\d{4}年\d{1,2}月\d{1,2}日/.test(l) || /记录|transcript/i.test(l) && l.length < 60)));
      segs = parsePlain(body);
    }
    segs = segs.filter(g => g.en || g.zh).sort((a, b) => a.t - b.t);
    // 听悟文件头：第一行标题，第二行「2026年11月16日 09:09」
    let startedAt = null;
    const dm = text.slice(0, 300).match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})/) || text.slice(0, 300).match(/(\d{4})-(\d{1,2})-(\d{1,2})[ _T](\d{1,2})[:_](\d{2})/)
      || String(fileName).match(/(\d{4})-(\d{1,2})-(\d{1,2})[ _](\d{1,2})[:_](\d{2})/);
    if (dm) startedAt = new Date(+dm[1], +dm[2] - 1, +dm[3], +dm[4], +dm[5]).getTime();
    const hasZh = segs.some(g => g.zh), hasEn = segs.some(g => g.en);
    // 只有中文时，中文放 en 位置当原文显示（整理笔记读的是 en）
    if (!hasEn && hasZh) segs.forEach(g => { g.en = g.zh; g.zh = ''; });
    const last = segs[segs.length - 1];
    const duration = last ? last.t + Math.max(5, Math.round(((last.en || '').split(/\s+/).length) / 2.5)) : 0;
    return { segments: segs, startedAt, duration, hasZh: hasZh && hasEn, timed: segs.some(g => g.t > 0) };
  }

  async function readFile(file) {
    const e = (file.name.split('.').pop() || '').toLowerCase();
    if (e === 'docx') {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const xml = await zip.file('word/document.xml').async('string');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const out = [];
      for (const p of doc.getElementsByTagName('w:p')) {
        let s = '';
        for (const n of p.getElementsByTagName('*')) { if (n.tagName === 'w:t') s += n.textContent; else if (n.tagName === 'w:tab') s += '  '; else if (n.tagName === 'w:br') s += '\n'; }
        out.push(s);
      }
      return out.join('\n');
    }
    if (['txt', 'md', 'srt', 'vtt', 'text'].includes(e) || !e) return file.text();
    throw new Error('只支持 Word（.docx）、txt、srt、vtt 文稿');
  }

  function baseTitle(file, startedAt) {
    const name = file.name.replace(/\.[^.]+$/, '').replace(/([_ ]*(记录|原文和译文|原文|译文|transcript))+$/gi, '').replace(/_/g, ' ').trim();
    // 听悟默认文件名只有日期时间，换成和 App 里录音一样的「11/16 09:09 课堂录音」
    if (name && !/^[\d\s:\-./年月日]+$/.test(name)) return name;
    const d = new Date(startedAt || Date.now());
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 课堂录音`;
  }

  async function save({ parsed, title, courseId, fileName }) {
    const rec = {
      id: DB.uid('s_'), courseId: courseId || null, title,
      startedAt: parsed.startedAt || Date.now(), duration: parsed.duration,
      segments: parsed.segments.map(g => ({ id: DB.uid('g_'), t: g.t, en: g.en, zh: g.zh, status: 'done' })),
      highlights: [], confused: [], glossary: {}, hasAudio: false,
      imported: { from: fileName, at: Date.now() },
    };
    await DB.put('sessions', rec);
    return rec;
  }

  /* 弹窗：选文件 → 预览 → 选课程、改标题 → 存成一段课堂录音 */
  function open({ courseId } = {}) {
    let parsed = null, file = null;
    modal(`<h2>导入转写文稿</h2>
      <p class="hint" style="margin:0 0 10px">别的软件转写好的课堂文字，比如听悟导出的「原文和译文」Word。导进来就是一段课堂录音（只有文字、没有声音），可以照常整理笔记、按话题分段、问 AI。</p>
      <div class="field"><label class="btn" style="cursor:pointer;align-self:flex-start">选择文稿（.docx / .txt / .srt / .vtt）<input type="file" id="ti-file" accept=".docx,.txt,.md,.srt,.vtt" hidden></label>
        <span class="hint" id="ti-info"></span></div>
      <div id="ti-more" hidden>
        <div class="field"><label for="ti-title">标题</label><input id="ti-title" type="text"></div>
        <div class="field"><label for="ti-course">放进哪门课</label><select id="ti-course"><option value="">不属于任何课程</option>${State.courses.map(c => `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="ti-prev card pad" id="ti-prev" style="max-height:30vh;overflow:auto;font-size:14px;line-height:1.6"></div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" data-close>取消</button><button class="btn primary" id="ti-go" disabled>导入</button></div>`, (box, close) => {
      const info = $('#ti-info', box), go = $('#ti-go', box);
      $('#ti-file', box).onchange = async e => {
        file = e.target.files[0]; if (!file) return;
        info.textContent = '正在读取…'; go.disabled = true; $('#ti-more', box).hidden = true;
        try {
          parsed = parse(await readFile(file), file.name);
          if (!parsed.segments.length) throw new Error('没在文件里找到转写内容');
          info.innerHTML = `<b>${esc(file.name)}</b> · ${parsed.segments.length} 句 · ${parsed.timed ? '约 ' + fmtTime(parsed.duration) : '没有时间信息（按字数估算）'} · ${parsed.hasZh ? '英文 + 中文译文' : '只有原文'}`;
          $('#ti-title', box).value = baseTitle(file, parsed.startedAt);
          $('#ti-prev', box).innerHTML = parsed.segments.slice(0, 6).map(g => `<div style="margin-bottom:8px"><span class="hint">${fmtTime(g.t)}</span> ${esc(g.en.slice(0, 200))}${g.zh ? `<div class="hint">${esc(g.zh.slice(0, 120))}</div>` : ''}</div>`).join('') + (parsed.segments.length > 6 ? `<div class="hint">… 还有 ${parsed.segments.length - 6} 句</div>` : '');
          $('#ti-more', box).hidden = false; go.disabled = false;
        } catch (err) { info.textContent = '读不了：' + err.message; parsed = null; }
      };
      go.onclick = async () => {
        if (!parsed) return; go.disabled = true;
        try {
          const rec = await save({ parsed, title: $('#ti-title', box).value.trim() || baseTitle(file, parsed.startedAt), courseId: $('#ti-course', box).value, fileName: file.name });
          close(); toast(`已导入 ${rec.segments.length} 句`); location.hash = 'session-' + rec.id;
        } catch (err) { toast('导入失败：' + err.message, 6000); go.disabled = false; }
      };
    });
  }

  return { open, parse, readFile, save };
})();
