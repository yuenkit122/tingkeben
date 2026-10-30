/* 课件文字提取：PDF / PPTX / DOCX / TXT / MD / Moodle 打包下载的 ZIP */
const Extract = (() => {
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const ext = name => (name.split('.').pop() || '').toLowerCase();
  const SUPPORTED = ['pdf', 'pptx', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp'];
  const MIME = {
    pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  };

  function isSupported(name) { return SUPPORTED.includes(ext(name)); }

  async function pdfText(buf, onProgress) {
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      // 按行重组：y 坐标变化就换行
      let lastY = null, line = '', lines = [];
      for (const it of tc.items) {
        const y = it.transform ? Math.round(it.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { lines.push(line.trim()); line = ''; }
        line += it.str + (it.hasEOL ? '\n' : (it.str.endsWith(' ') ? '' : ' '));
        lastY = y;
      }
      if (line.trim()) lines.push(line.trim());
      const pageText = lines.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      out.push(`[第${i}页]\n${pageText}`);
      onProgress && onProgress(i / pdf.numPages);
    }
    return { text: out.join('\n\n'), pages: pdf.numPages };
  }

  function xmlTexts(xml, paraTag, textTag) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const paras = doc.getElementsByTagName(paraTag);
    const lines = [];
    for (const p of paras) {
      const ts = p.getElementsByTagName(textTag);
      let s = '';
      for (const t of ts) s += t.textContent;
      if (s.trim()) lines.push(s.trim());
    }
    return lines;
  }

  async function pptxText(buf) {
    const zip = await JSZip.loadAsync(buf);
    const slideNames = Object.keys(zip.files)
      .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
    const out = [];
    for (const n of slideNames) {
      const num = parseInt(n.match(/slide(\d+)/)[1]);
      const xml = await zip.file(n).async('string');
      const lines = xmlTexts(xml, 'a:p', 'a:t');
      let block = `[第${num}页]\n${lines.join('\n')}`;
      const notesFile = zip.file(`ppt/notesSlides/notesSlide${num}.xml`);
      if (notesFile) {
        const notes = xmlTexts(await notesFile.async('string'), 'a:p', 'a:t').filter(l => !/^\d+$/.test(l));
        if (notes.length) block += `\n（讲者备注）${notes.join(' ')}`;
      }
      out.push(block);
    }
    return { text: out.join('\n\n'), pages: slideNames.length };
  }

  async function docxText(buf) {
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');
    const lines = xmlTexts(xml, 'w:p', 'w:t');
    return { text: lines.join('\n'), pages: null };
  }

  /* 把一个文件读成 {text, pages, scanned}；图片和扫描版 PDF 交给 Gemini 识别 */
  async function fromFile(file, onProgress) {
    const e = ext(file.name);
    const buf = await file.arrayBuffer();
    let r;
    if (e === 'pdf') r = await pdfText(buf, onProgress);
    else if (e === 'pptx') r = await pptxText(buf);
    else if (e === 'docx') r = await docxText(buf);
    else if (e === 'txt' || e === 'md') r = { text: new TextDecoder().decode(buf), pages: null };
    else if (['png', 'jpg', 'jpeg', 'webp'].includes(e)) r = { text: '', pages: 1 };
    else throw new Error('不支持的文件类型：' + e);
    const chars = r.text.replace(/\[第\d+页\]/g, '').replace(/\s/g, '').length;
    r.scanned = (e === 'pdf' && r.pages && chars / r.pages < 30) || ['png', 'jpg', 'jpeg', 'webp'].includes(e);
    return r;
  }

  /* Moodle 的“下载文件夹”是 ZIP：拆开，留下支持的文件 */
  async function unzipFiles(file) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const out = [];
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const base = path.split('/').pop();
      if (base.startsWith('.') || path.includes('__MACOSX')) continue;
      if (!isSupported(base)) continue;
      const blob = await entry.async('blob');
      const folder = path.includes('/') ? path.split('/').slice(0, -1).join(' / ') : '';
      out.push({ file: new File([blob], base, { type: MIME[ext(base)] || '' }), folder });
    }
    return out;
  }

  /* 从课件里挑出专业词，用来提高实时转写的准确度（Gemini customVocabulary） */
  const STOP = new Set(('the a an and or of to in on for with by from as at is are was were be been this that these those it its into than then which who what when where how why can will may must should would could not no yes all any each more most other some such only own same so very just also about over under after before between through during without within upon per via our your their his her they them we you i he she us using use used based include includes including example examples chapter week lecture slide slides page topic unit learning objectives objective understand explain describe identify discuss overview summary introduction conclusion question questions answer answers figure table source copyright monash university malaysia').split(' '));

  function vocabulary(texts, max = 100) {
    const score = new Map();
    const add = (t, w) => { const k = t.trim(); if (k.length < 3 || k.length > 40) return; score.set(k, (score.get(k) || 0) + w); };
    for (const raw of texts) {
      const text = raw.replace(/\[第\d+页\]/g, ' ');
      // 连续大写开头的词组：Double Entry, Statement of Financial Position
      // 只在同一行里找词组（跨行拼起来的不算）
      const phraseRe = /\b([A-Z][a-z]+(?:[ \t]+(?:of|and|the|&)?[ \t]*[A-Z][a-z]+){1,4})\b/g;
      let m;
      while ((m = phraseRe.exec(text))) {
        const words = m[1].split(/[ \t]+/);
        if (STOP.has(words[words.length - 1].toLowerCase())) continue;
        add(m[1].replace(/[ \t]+/g, ' '), 3);
      }
      // 缩写：GST, SME, IFRS
      const acr = /\b([A-Z]{2,6}s?)\b/g;
      const notAcr = ['THE', 'AND', 'FOR', 'PAGE', 'NOTE', 'NOT', 'ARE', 'YOU', 'ALL', 'BUT'];
      while ((m = acr.exec(text))) if (!notAcr.includes(m[1])) add(m[1], 2);
      // 常见长词
      const words = text.toLowerCase().match(/[a-z][a-z-]{5,}/g) || [];
      for (const w of words) if (!STOP.has(w)) add(w, 1);
    }
    return [...score.entries()]
      .filter(([k, v]) => v >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([k]) => k);
  }

  return { fromFile, unzipFiles, isSupported, vocabulary, ext, MIME };
})();
