/* 听课本 — 导出学习资料
   · Docx：把 Markdown 直接在浏览器里写成 Word（.docx），不经过任何服务器
   · ExportPack：选好几份课件 + 笔记 + 课堂录音，导出成
       学习讲义（AI 把三样互相补充，写成能直接发给别人学的一份）
       笔记合集（不经过 AI，原样合并）
       AI 资料包（原始材料整理成 AI 最好读的 Markdown） */

/* ======================================================================
   Markdown → Word
   ====================================================================== */
const Docx = (() => {
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const ACCENT = '2C47A5';
  const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134, TEXT_W = PAGE_W - MARGIN * 2;
  const x = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // marked 给出来的行内文字是已经转义过的 HTML
  const unesc = s => String(s ?? '').replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ' }[k]));
  const pageRef = s => s.replace(/\[p\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?\]/g, (m, a, b) => `（p.${a}${b ? '–' + b : ''}）`);

  function rpr(f) {
    let s = '';
    if (f.code) s += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
    if (f.b) s += '<w:b/><w:bCs/>';
    if (f.i) s += '<w:i/><w:iCs/>';
    if (f.strike) s += '<w:strike/>';
    if (f.link) s += '<w:color w:val="1A56C4"/><w:u w:val="single"/>';
    if (f.code) s += '<w:shd w:val="clear" w:color="auto" w:fill="EEF0F5"/>';
    return s ? `<w:rPr>${s}</w:rPr>` : '';
  }
  function run(text, f) {
    text = String(text ?? ''); if (!text) return '';
    if (!f.code) text = pageRef(text);
    const p = rpr(f);
    return text.split('\n').map((line, i) => `<w:r>${p}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(line)}</w:t></w:r>`).join('');
  }
  const plainHtml = s => unesc(String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''));

  function inl(tokens, f, ctx) {
    let out = '';
    for (const t of tokens || []) {
      switch (t.type) {
        case 'strong': out += inl(t.tokens, Object.assign({}, f, { b: 1 }), ctx); break;
        case 'em': out += inl(t.tokens, Object.assign({}, f, { i: 1 }), ctx); break;
        case 'del': out += inl(t.tokens, Object.assign({}, f, { strike: 1 }), ctx); break;
        case 'codespan': out += run(unesc(t.text), Object.assign({}, f, { code: 1 })); break;
        case 'br': out += '<w:r><w:br/></w:r>'; break;
        case 'link': {
          if (/^(https?:|mailto:)/i.test(t.href || '') && !f.link) out += `<w:hyperlink r:id="${ctx.rel(t.href)}" w:history="1">${inl(t.tokens, Object.assign({}, f, { link: 1 }), ctx)}</w:hyperlink>`;
          else out += inl(t.tokens, f, ctx);
          break;
        }
        case 'image': out += run(t.text || t.title || '（图片）', f); break;
        case 'html': out += run(plainHtml(t.text || t.raw), f); break;
        default:
          if (t.tokens && t.tokens.length) out += inl(t.tokens, f, ctx);
          else out += run(unesc(t.text ?? t.raw ?? ''), f);
      }
    }
    return out;
  }

  /* 一段。o：style / num:{id,lvl} / ind（左缩进）/ jc / extra（额外的段落属性，按规范顺序放在 spacing 之前）*/
  function para(runs, o = {}) {
    let p = '';
    if (o.style) p += `<w:pStyle w:val="${o.style}"/>`;
    if (o.num) p += `<w:numPr><w:ilvl w:val="${o.num.lvl}"/><w:numId w:val="${o.num.id}"/></w:numPr>`;
    if (o.extra) p += o.extra;
    if (o.ind) p += `<w:ind w:left="${o.ind}"/>`;
    if (o.jc) p += `<w:jc w:val="${o.jc}"/>`;
    return `<w:p>${p ? `<w:pPr>${p}</w:pPr>` : ''}${runs || ''}</w:p>`;
  }
  const LVL_IND = l => 440 * (l + 1);

  function table(t, ctx) {
    const cols = t.header.length || 1;
    const len = c => Math.max(4, Math.min(42, String((c && c.text) || '').replace(/[^\x00-\xff]/g, 'xx').length));
    const w = t.header.map((h, i) => Math.max(len(h), ...t.rows.map(r => len(r[i]))));
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    const widths = w.map(v => Math.round(TEXT_W * v / sum));
    const jc = i => ({ center: 'center', right: 'right' }[(t.align || [])[i]] || '');
    const cell = (c, i, head) => `<w:tc><w:tcPr><w:tcW w:w="${widths[i]}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EAEEF9"/>' : ''}</w:tcPr>${para(inl((c && c.tokens) || [], head ? { b: 1 } : {}, ctx), { style: 'TableText', jc: jc(i) })}</w:tc>`;
    const bd = n => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="C5CBDA"/>`;
    let s = `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(bd).join('')}</w:tblBorders><w:tblLayout w:type="autofit"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
    s += `<w:tblGrid>${widths.map(v => `<w:gridCol w:w="${v}"/>`).join('')}</w:tblGrid>`;
    s += `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${t.header.map((c, i) => cell(c, i, true)).join('')}</w:tr>`;
    for (const r of t.rows) s += `<w:tr><w:trPr><w:cantSplit/></w:trPr>${Array.from({ length: cols }, (_, i) => cell(r[i], i, false)).join('')}</w:tr>`;
    return s + '</w:tbl>' + para('', { style: 'TableGap' });
  }

  /* c：{ quote, lvl（列表层级，-1 = 不在列表里）, lead（这一项的第一段要带的编号）} */
  function blocks(tokens, ctx, c) {
    let out = '';
    const style = c.quote ? 'Quote' : '';
    const text = (runs) => {
      if (c.lead) { out += para(runs, { style, num: c.lead }); c.lead = null; }
      else out += para(runs, { style, ind: c.lvl >= 0 ? LVL_IND(c.lvl) : 0 });
    };
    for (const t of tokens || []) {
      switch (t.type) {
        case 'space': break;
        case 'heading': {
          if (ctx.skipTitle && t.depth === 1 && !ctx.seen) { ctx.seen = true; if (plainHtml(t.text).trim() === ctx.skipTitle) break; }
          ctx.seen = true;
          out += para(inl(t.tokens, {}, ctx), { style: 'Heading' + Math.min(4, t.depth) });
          break;
        }
        case 'paragraph': text(inl(t.tokens, {}, ctx)); break;
        case 'text': text(t.tokens && t.tokens.length ? inl(t.tokens, {}, ctx) : run(unesc(t.text), {})); break;
        case 'blockquote': out += blocks(t.tokens, ctx, { quote: true, lvl: c.lvl, lead: c.lead }); c.lead = null; break;
        case 'code': out += para(run(t.text, { code: 0 }).replace(/<w:r>/g, '<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/></w:rPr>'), { style: 'Code', ind: c.lvl >= 0 ? LVL_IND(c.lvl) : 0 }); c.lead = null; break;
        case 'hr': out += para('', { style: 'Rule' }); break;
        case 'table': out += table(t, ctx); c.lead = null; break;
        case 'html': { const s = plainHtml(t.text || t.raw).trim(); if (s) text(run(s, {})); break; }
        case 'list': {
          const lvl = Math.min(8, c.lvl + 1);
          const id = t.ordered ? ctx.orderedNum(lvl, Number(t.start) || 1) : 1;
          for (const it of t.items) {
            const sub = { quote: c.quote, lvl, lead: { id, lvl } };
            let toks = it.tokens || [];
            if (it.task) toks = [{ type: 'text', text: it.checked ? '☑ ' : '☐ ', tokens: [{ type: 'text', text: it.checked ? '☑ ' : '☐ ' }, ...((toks[0] && toks[0].tokens) || [])] }, ...toks.slice(1)];
            const body = blocks(toks, ctx, sub);
            out += sub.lead ? para('', { num: sub.lead }) + body : body; // 空的列表项也要留一个编号
          }
          c.lead = null;
          break;
        }
        default: if (t.tokens && t.tokens.length) text(inl(t.tokens, {}, ctx)); else if (t.text) text(run(unesc(t.text), {}));
      }
    }
    return out;
  }

  const STYLES = () => {
    const st = (id, name, ppr, rprs, o = {}) => `<w:style w:type="paragraph" ${o.def ? 'w:default="1" ' : ''}w:styleId="${id}"><w:name w:val="${name}"/>${o.def ? '' : '<w:basedOn w:val="Normal"/>'}${o.next ? `<w:next w:val="${o.next}"/>` : ''}<w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${rprs ? `<w:rPr>${rprs}</w:rPr>` : ''}</w:style>`;
    const head = (n, sz, color, before, after) => st('Heading' + n, 'heading ' + n, `<w:keepNext/><w:keepLines/><w:spacing w:before="${before}" w:after="${after}"/><w:outlineLvl w:val="${n - 1}"/>`, `<w:b/><w:bCs/><w:color w:val="${color}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`, { next: 'Normal' });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Calibri"/><w:color w:val="1F2430"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="340" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
${st('Normal', 'Normal', '', '', { def: true })}
${st('Title', 'Title', '<w:spacing w:before="0" w:after="80" w:line="240" w:lineRule="auto"/>', `<w:b/><w:bCs/><w:color w:val="${ACCENT}"/><w:sz w:val="44"/><w:szCs w:val="44"/>`, { next: 'Normal' })}
${st('Subtitle', 'Subtitle', `<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="8" w:color="${ACCENT}"/></w:pBdr><w:spacing w:after="280"/>`, '<w:color w:val="6B7280"/><w:sz w:val="19"/><w:szCs w:val="19"/>', { next: 'Normal' })}
${head(1, 32, ACCENT, 400, 140)}
${head(2, 27, '1F2430', 320, 120)}
${head(3, 24, ACCENT, 240, 80)}
${head(4, 22, '1F2430', 200, 60)}
${st('Quote', 'Quote', `<w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="${ACCENT}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F4F6FB"/><w:ind w:left="280" w:right="140"/>`, '<w:color w:val="454C5C"/>')}
${st('Code', 'Code', '<w:shd w:val="clear" w:color="auto" w:fill="F1F3F7"/><w:spacing w:line="280" w:lineRule="auto"/>', '<w:sz w:val="19"/><w:szCs w:val="19"/>')}
${st('TableText', 'Table Text', '<w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="auto"/>', '<w:sz w:val="20"/><w:szCs w:val="20"/>')}
${st('TableGap', 'Table Gap', '<w:spacing w:before="0" w:after="60" w:line="120" w:lineRule="exact"/>', '<w:sz w:val="8"/><w:szCs w:val="8"/>')}
${st('Rule', 'Rule', '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C5CBDA"/></w:pBdr><w:spacing w:before="120" w:after="200" w:line="120" w:lineRule="exact"/>', '')}
${st('Footer', 'footer', '<w:spacing w:after="0"/><w:jc w:val="center"/>', '<w:color w:val="8A90A0"/><w:sz w:val="17"/><w:szCs w:val="17"/>')}
</w:styles>`;
  };

  function numbering(ordered) {
    const bullets = ['•', '◦', '▪'], fmts = ['decimal', 'lowerLetter', 'lowerRoman'];
    const lvls = fn => Array.from({ length: 9 }, (_, l) => fn(l)).join('');
    const ind = l => `<w:pPr><w:ind w:left="${LVL_IND(l)}" w:hanging="320"/></w:pPr>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(l => `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${bullets[l % 3]}"/><w:lvlJc w:val="left"/>${ind(l)}<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:hint="default"/></w:rPr></w:lvl>`)}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(l => `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${fmts[l % 3]}"/><w:lvlText w:val="%${l + 1}${l % 3 === 0 ? '.' : ')'}"/><w:lvlJc w:val="left"/>${ind(l)}</w:lvl>`)}</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
${ordered.map(o => `<w:num w:numId="${o.id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="${o.lvl}"><w:startOverride w:val="${o.start}"/></w:lvlOverride></w:num>`).join('\n')}
</w:numbering>`;
  }

  /* markdown → Blob。opts：title（大标题）/ meta（标题下面一行小字）/ footer（页脚左边的字） */
  async function build(markdown, opts = {}) {
    if (!window.JSZip || !window.marked) throw new Error('导出 Word 需要的组件还没加载好，联网刷新一次再试');
    const title = String(opts.title || '').trim();
    const rels = [], ordered = [];
    const ctx = {
      skipTitle: title, seen: false,
      rel(href) { let r = rels.find(v => v.href === href); if (!r) { r = { id: 'rLink' + (rels.length + 1), href }; rels.push(r); } return r.id; },
      orderedNum(lvl, start) { const id = ordered.length + 2; ordered.push({ id, lvl, start }); return id; },
    };
    const tokens = marked.lexer(String(markdown || '').replace(/<!--[\s\S]*?-->/g, ''), { gfm: true, breaks: false });
    let body = '';
    if (title) body += para(run(title, {}), { style: 'Title' });
    if (opts.meta) body += para(run(String(opts.meta), {}), { style: 'Subtitle' });
    body += blocks(tokens, ctx, { quote: false, lvl: -1, lead: null });
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const fld = code => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${NS}>${para(run((opts.footer ? opts.footer + '　·　' : '') + '第 ', {}) + fld('PAGE') + run(' / ', {}) + fld('NUMPAGES') + run(' 页', {}), { style: 'Footer' })}</w:ftr>`;
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rFooter"/><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/><w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" w:header="600" w:footer="600" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const zip = new JSZip();
    zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
    zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>听课本</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`);
    zip.file('word/document.xml', doc);
    zip.file('word/styles.xml', STYLES());
    zip.file('word/numbering.xml', numbering(ordered));
    zip.file('word/footer1.xml', footer);
    zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="${R}/styles" Target="styles.xml"/><Relationship Id="rNum" Type="${R}/numbering" Target="numbering.xml"/><Relationship Id="rFooter" Type="${R}/footer" Target="footer1.xml"/>${rels.map(v => `<Relationship Id="${v.id}" Type="${R}/hyperlink" Target="${x(v.href)}" TargetMode="External"/>`).join('')}</Relationships>`);
    return zip.generateAsync({ type: 'blob', mimeType: MIME, compression: 'DEFLATE' });
  }

  const safeName = s => (String(s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || '学习资料');
  async function save(markdown, opts = {}) {
    const blob = await build(markdown, opts);
    download(blob, safeName(opts.filename || opts.title) + '.docx');
  }
  return { build, save, safeName };
})();

/* ======================================================================
   导出学习资料
   ====================================================================== */
const ExportPack = (() => {
  const KINDS = [
    ['handout', '学习讲义', 'AI 把课件、录音、笔记互相补充，写成一份能直接发给别人学的讲义'],
    ['merge', '笔记合集', '不经过 AI、不花钱，把选中的笔记原样合成一份'],
    ['pack', 'AI 资料包', '课件原文 + 录音转写 + 笔记，排成 AI 最好读的格式，拿去喂给任何 AI'],
  ];
  const Pref = {
    get() { try { return JSON.parse(localStorage.getItem('tingkeben.export') || '{}') || {}; } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem('tingkeben.export', JSON.stringify(Object.assign(Pref.get(), v))); } catch (e) {} },
  };
  let running = null;   // 正在写的讲义：{ title, text, think, ctl, repaint }
  let last = null;      // 上一次导出的结果，关了窗口还能再打开：{ kind, title, markdown, meta, courseId }

  const cleanMd = s => String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const attr = s => String(s ?? '').replace(/"/g, "'").replace(/[\r\n]+/g, ' ');
  const today = () => new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const noteSessIds = n => [...new Set([].concat(n.sessionIds || [], n.sessionId || []).filter(Boolean))];
  const noteHasText = n => !!(String(n.markdown || '').trim() || String(n.extraNotes || '').trim());

  /* 录音转写：一句一行。只开了英文转写时没有中文那一行 */
  function transcriptOf(s) {
    return (s.segments || []).map(g => `[${fmtTime(g.t)}]${g.important ? '【老师强调】' : ''}${g.starred ? '【学生标记】' : ''}${g.confused ? '【学生没听懂】' : ''} ${g.en || ''}${g.zh ? '\n　　' + g.zh : ''}`).join('\n');
  }
  const marksOf = s => (s.highlights || []).map(h => `[${fmtTime(h.t)}] ${String(h.near || '').trim()}`).filter(v => v.length > 8);
  const confusedOf = s => (s.confused || []).map(c => `[${fmtTime(c.t)}] ${String(c.near || '').trim().slice(-400)}`).filter(v => v.length > 8);

  /* 一份笔记里学生自己的东西：正文 + 课后补充 + 还没搞懂的 */
  function noteBody(n, { personal = true } = {}) {
    let s = cleanMd(n.markdown);
    const extra = String(n.extraNotes || '').trim();
    if (extra) s += `\n\n## 我的补充笔记\n${extra}`;
    const todo = (n.todo || []).filter(v => !v.done);
    if (personal && todo.length) s += `\n\n## 还没搞懂的\n${todo.map(v => `- ${v.t}${v.detail ? '：' + v.detail : ''}`).join('\n')}`;
    return s.trim();
  }

  async function gather(course, { fileIds = [], noteIds = [], sessionIds = [] }) {
    const get = async (store, ids) => (await Promise.all(ids.map(id => DB.get(store, id)))).filter(Boolean);
    const files = sortFiles((await get('files', fileIds)).filter(f => f.status === 'ready'));
    const notes = (await get('notes', noteIds)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const sessions = (await get('sessions', sessionIds)).filter(s => (s.segments || []).length).sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));
    return { course, files, notes, sessions };
  }
  const metaLine = m => [m.course.name, [m.files.length && `课件 ${m.files.length} 份`, m.sessions.length && `课堂录音 ${m.sessions.length} 段`, m.notes.length && `笔记 ${m.notes.length} 份`].filter(Boolean).join(' + '), today()].filter(Boolean).join('　·　');

  /* ---------- 笔记合集（不经过 AI） ---------- */
  function buildMerge(m, title) {
    if (m.notes.length === 1) {
      const n = m.notes[0], body = noteBody(n, { personal: false });
      return /^#\s/.test(body) ? body : `# ${title}\n\n${body}`;
    }
    // 好几份：每份笔记自己的标题降一级，放在各自的大标题下面
    const demote = s => s.replace(/^(#{1,5})(\s)/gm, '#$1$2');
    return `# ${title}\n\n` + m.notes.map(n => `## ${n.title}\n\n${demote(noteBody(n, { personal: false }).replace(/^#\s+.*\n+/, ''))}`).join('\n\n---\n\n');
  }

  /* ---------- AI 资料包：原始材料，不改写、不删减 ----------
     外层用 Markdown 标题分区，每份材料用 <标签> 包住：
     AI 能分清哪段是课件、哪段是老师说的、哪段是学生记的，笔记里自己的 # 标题也不会打乱结构。 */
  function buildPack(m, title) {
    const dur = m.sessions.reduce((n, s) => n + (s.duration || 0), 0);
    const parts = [`# 课堂资料包：${title}`, '',
      '> 这是一节课（或几节课）的完整原始材料，由「听课本」导出，供 AI 阅读。',
      '> - `<courseware>` 是老师的课件原文，内容最权威；`[第N页]` 是页码。',
      '> - `<transcript>` 是课堂录音的语音识别结果，可能有听错的词，专业术语以课件为准；`[分:秒]` 是时间。带【老师强调】【学生标记】【学生没听懂】的句子要特别留意。',
      '> - `<notes>` 是学生整理的笔记（Markdown），里面的 `[p.N]` 指课件第 N 页。',
      '> - 三样讲的是同一批内容，请互相对照：课件是骨架，录音补充老师口头讲的例子和考试提示，笔记反映学生的理解和疑问。',
      '',
      `- 课程：${m.course.name}`,
      `- 导出日期：${today()}`,
      `- 内容：课件 ${m.files.length} 份 · 课堂录音 ${m.sessions.length} 段${dur ? '（共 ' + fmtTime(dur) + '）' : ''} · 笔记 ${m.notes.length} 份`];
    if (m.files.length) {
      parts.push('', '## 一、课件原文');
      m.files.forEach((f, i) => parts.push('', `<courseware index="${i + 1}" name="${attr(f.name)}" week="${attr(weekOf(f).label)}"${phaseOf(f) ? ` type="${attr(phaseOf(f))}"` : ''}${f.pages ? ` pages="${f.pages}"` : ''}>`, String(f.text || '').trim(), '</courseware>'));
    }
    if (m.sessions.length) {
      parts.push('', '## 二、课堂录音转写');
      m.sessions.forEach((s, i) => {
        parts.push('', `<transcript index="${i + 1}" title="${attr(s.title)}" date="${attr(fmtDate(s.startedAt))}" duration="${fmtTime(s.duration || 0)}">`, transcriptOf(s), '</transcript>');
        const mk = marksOf(s), cf = confusedOf(s);
        if (mk.length) parts.push('', `<student_marked_important transcript="${i + 1}">`, mk.join('\n'), '</student_marked_important>');
        if (cf.length) parts.push('', `<student_confused transcript="${i + 1}">`, cf.join('\n'), '</student_confused>');
      });
    }
    if (m.notes.length) {
      parts.push('', '## 三、学生笔记');
      m.notes.forEach((n, i) => parts.push('', `<notes index="${i + 1}" title="${attr(n.title)}">`, noteBody(n), '</notes>'));
    }
    return parts.join('\n') + '\n';
  }

  /* ---------- 学习讲义：AI 整合 ---------- */
  const SYSTEM = lang => `你是一名出色的大学助教，负责把一节课的三样材料——老师的课件、课堂录音转写、学生的课堂笔记——整合成一份可以直接发给别的同学自学的学习讲义。读的人没有上这节课，手里也没有课件，只靠这份讲义就要能学会。

三样材料怎么互相补充：
- 课件是骨架和权威来源：概念的定义、公式、数字、专业术语的写法，一律以课件为准。
- 录音是老师的讲解：课件上只有一个标题或几个词的地方，用老师口头的解释把它讲明白；老师举的例子、打的比方、提醒的易错点、说到的考试和作业要求，都要写进对应的知识点里。录音是语音识别出来的，会有听错的词，按课件和上下文改正；意思实在判断不了的句子不要用。
- 笔记是学生的理解：采用其中讲得清楚的说法和例子；笔记里标了没听懂、有疑问的地方，说明那里难，要讲得更细、多给一个例子。笔记和课件矛盾时以课件为准。
- 同一个内容在三样材料里都出现，只写一遍，合并成最完整的版本。课件讲了但老师没提的内容也要保留。课上闲聊、点名、设备调试之类和学习无关的话不要写。

写作要求：
- ${lang === 'en' ? 'Write the whole handout in clear, simple English suitable for first-year students whose first language is not English. Keep sentences short. Section headings in English.' : '用简体中文讲解，专业术语写成「中文（English）」，每个小节第一次出现时带英文；定义的英文原句照抄课件，后面紧跟中文意思。'}
- 像老师讲课那样写成连贯的讲解，不要只列提纲；每个知识点都要有「是什么、为什么、怎么用」和一个具体例子。
- 只用材料里有的内容，不编造数字、日期和考试范围。理解所必需、但材料里没有的补充，在句末标注${lang === 'en' ? ' "(added)"' : '「（补充）」'}。
- 出自课件的关键内容在句末标页码，例如 [p.5]；选了多份课件时写成 [课件2 p.5]。
- 用第三人称客观地写，不要出现「我没听懂」「学生标记」这类针对某个学生的话。
- 输出 Markdown，直接从一级标题开始，不要开场白，不要用代码块包住全文。

结构（某一部分材料里没有就省略）：
# 标题
> 两三句话：这一讲解决什么问题、学完能做什么
## ${lang === 'en' ? 'Learning goals' : '学习目标'}
## ${lang === 'en' ? 'Big picture' : '知识框架'}（用缩进列表画出概念之间的关系）
## ${lang === 'en' ? 'Key content' : '知识点讲解'}（主体。按逻辑顺序，每个知识点一个三级标题；有计算或流程的写清步骤，适合对比的用表格）
## ${lang === 'en' ? 'What the lecturer stressed' : '老师课上强调的'}（考试、作业、易错点；只写录音或笔记里确实有的）
## ${lang === 'en' ? 'Easily confused' : '容易混淆'}（表格对比）
## ${lang === 'en' ? 'Glossary' : '关键词汇表'}（表格：English | 中文 | 一句话解释）
## ${lang === 'en' ? 'Self-check' : '自测题'}（5–8 道，覆盖最重要的内容；答案和简短解析统一放在最后的「参考答案」小节）`;

  function handoutPrompt(m, { title, extra }) {
    const cap = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '\n…（太长，后面的省略）' : s; };
    const fBudget = Math.floor(360000 / Math.max(1, m.files.length)), sBudget = Math.floor(200000 / Math.max(1, m.sessions.length)), nBudget = Math.floor(140000 / Math.max(1, m.notes.length));
    let s = `课程：${m.course.name}\n讲义标题：${title}\n`;
    m.files.forEach((f, i) => { s += `\n<课件${m.files.length > 1 ? i + 1 : ''} 文件名="${attr(f.name)}">\n${cap(f.text, fBudget)}\n</课件${m.files.length > 1 ? i + 1 : ''}>\n`; });
    m.sessions.forEach((x, i) => {
      s += `\n<课堂录音转写 第${i + 1}段="${attr(x.title)}">\n${cap(transcriptOf(x), sBudget)}\n</课堂录音转写>\n`;
      const mk = marksOf(x), cf = confusedOf(x);
      if (mk.length) s += `<课上标记的重点时刻>\n${mk.join('\n')}\n</课上标记的重点时刻>\n`;
      if (cf.length) s += `<课上没听懂的地方（这些地方要讲得更细）>\n${cf.join('\n')}\n</课上没听懂的地方>\n`;
    });
    m.notes.forEach(n => { s += `\n<学生笔记 标题="${attr(n.title)}">\n${cap(noteBody(n), nBudget)}\n</学生笔记>\n`; });
    if (!m.sessions.length) s += '\n（这次没有课堂录音，「老师课上强调的」只根据笔记写，笔记里也没有就省略这一节。）\n';
    if (extra) s += `\n额外要求：${extra}\n`;
    return s + '\n请写出这份学习讲义。';
  }

  function startHandout(m, opts) {
    const ctl = new AbortController();
    const run = running = { title: opts.title, text: '', think: '', ctl, repaint: null };
    const job = Jobs.start('export', '学习讲义：' + opts.title);
    const src = m.files.reduce((n, f) => n + (f.text || '').length, 0) + m.notes.reduce((n, x) => n + (x.markdown || '').length, 0);
    job.phase('正在连接 DeepSeek', 0, .04, { expectSec: 3 });
    let phase = 0;
    (async () => {
      let text = '', err = null;
      try {
        text = await AI.deepseekStream({
          system: SYSTEM(opts.lang), user: handoutPrompt(m, opts), signal: ctl.signal, purpose: 'notes',
          onThinking: t => { if (!phase) { phase = 1; job.phase('正在对照课件、录音和笔记', .04, .3, { expectLen: 5000 }); } run.think = t; job.len(t.length).sub(`已思考 ${t.length} 字`); },
          onText: t => { if (phase < 2) { phase = 2; job.phase('正在写讲义', .3, .98, { expectLen: Math.max(5000, Math.min(16000, src * .7)) }); } run.text = t; job.len(t.length).sub(`已写 ${t.length} 字`); run.repaint && run.repaint(); },
        });
      } catch (e) { err = e; text = run.text; }
      job.done();
      if (running === run) running = null;
      const stopped = err && err.name === 'AbortError';
      if (!String(text).trim()) { toast(stopped ? '已停止' : '讲义没写成：' + (err ? err.message : '没有内容'), 6000); if (run.repaint) open({ course: m.course, fileIds: m.files.map(f => f.id), noteIds: m.notes.map(n => n.id) }); return; }
      last = { kind: 'handout', title: opts.title, markdown: cleanMd(text), meta: metaLine(m), courseId: m.course.id, partial: !!err };
      if (err && !stopped) toast('写到一半断了（' + String(err.message).slice(0, 60) + '），已写的部分保留着', 7000);
      // 窗口还开着就直接换成结果；关掉了就提示一声，再点「导出学习资料」能打开
      if (run.repaint || $('#modal').hidden) showResult();
      else toast('学习讲义写好了：' + opts.title + '。点「导出学习资料」打开', 6000);
    })();
    showRunning();
  }

  function showRunning() {
    const run = running; if (!run) return;
    modal(`<div class="row"><h2 class="grow">正在写学习讲义</h2><button class="btn small" id="xp-stop">停止</button><button class="btn small" data-close>先去忙别的</button></div>
      ${Jobs.slot('export')}
      <p class="hint" style="margin:0">关掉这个窗口也会继续写，左下角能看到进度，写好了会提醒你。</p>
      <div class="xp-prev md" id="xp-live"></div>`, (box, close) => {
      box.classList.add('xp-box');
      const live = $('#xp-live', box);
      let t = 0;
      const paint = () => { if (!live.isConnected) { run.repaint = null; return; } live.innerHTML = run.text ? md(run.text) : '<p class="hint">AI 正在读材料…</p>'; live.scrollTop = live.scrollHeight; };
      run.repaint = () => { if (!live.isConnected) { run.repaint = null; return; } const now = Date.now(); if (now - t > 500) { t = now; paint(); } };
      paint();
      $('#xp-stop', box).onclick = () => run.ctl.abort();
    });
  }

  function showResult() {
    const r = last; if (!r) return;
    const isPack = r.kind === 'pack';
    const kb = Math.max(1, Math.round(new Blob([r.markdown]).size / 1024));
    const tip = isPack
      ? `约 ${Math.round(r.markdown.length / 1000)}k 字 · ${kb} KB。<b>喂给 AI 用 Markdown</b>：把 .md 文件直接拖进 Claude / ChatGPT / DeepSeek / NotebookLM，或者点「复制全文」粘进对话框。`
      : r.kind === 'handout' ? `${r.partial ? '⚠️ 没写完，下面是已写的部分。' : ''}发给别人学用 <b>Word</b>；要接着喂给 AI 用 <b>Markdown</b>。想留在听课本里就点「存进笔记」。`
        : '发给别人用 <b>Word</b>；喂给 AI 用 <b>Markdown</b>。';
    modal(`<div class="row"><h2 class="grow">${esc(r.title)}</h2><button class="btn small" data-close>关闭</button></div>
      <p class="hint" style="margin:0">${tip}</p>
      ${isPack ? `<pre class="xp-raw">${esc(r.markdown.slice(0, 6000))}${r.markdown.length > 6000 ? '\n\n…（预览只显示开头，导出的是全部）' : ''}</pre>` : `<div class="xp-prev md">${md(r.markdown)}</div>`}
      <div class="row xp-acts">
        <button class="btn ${isPack ? '' : 'primary'}" id="xp-docx">下载 Word（.docx）</button>
        <button class="btn ${isPack ? 'primary' : ''}" id="xp-md">下载 Markdown（.md）</button>
        <button class="btn" id="xp-copy">复制全文</button>
        ${isPack ? '' : '<button class="btn" id="xp-pdf" title="在打印窗口里选「存储为 PDF」">PDF</button>'}
        <span class="grow"></span>
        ${r.kind === 'handout' && !r.savedId ? '<button class="btn" id="xp-save" title="存成这门课的一份笔记，以后还能再导出、出题、问 AI">存进笔记</button>' : ''}
        ${r.savedId ? `<a class="btn" href="#note-${r.savedId}" id="xp-open">打开这份笔记</a>` : ''}
      </div>`, (box, close) => {
      box.classList.add('xp-box');
      $('#xp-docx', box).onclick = async e => {
        const b = e.currentTarget; b.disabled = true;
        try { await Docx.save(r.markdown, { title: r.title, meta: r.meta, footer: r.title }); toast('Word 文件已下载，可以直接发给别人'); }
        catch (err) { toast('导出 Word 失败：' + err.message, 6000); }
        b.disabled = false;
      };
      $('#xp-md', box).onclick = () => { download(new Blob([r.markdown], { type: 'text/markdown;charset=utf-8' }), Docx.safeName(r.title) + '.md'); toast(isPack ? 'Markdown 已下载，直接拖进 AI 的对话框' : 'Markdown 已下载'); };
      $('#xp-copy', box).onclick = async () => { try { await navigator.clipboard.writeText(r.markdown); toast('已复制全文'); } catch (e) { toast('复制失败，改用「下载 Markdown」'); } };
      const pdf = $('#xp-pdf', box); if (pdf) pdf.onclick = () => printMd(r);
      const op = $('#xp-open', box); if (op) op.onclick = () => close();
      const sv = $('#xp-save', box); if (sv) sv.onclick = async () => {
        const n = { id: DB.uid('n_'), courseId: r.courseId, createdAt: Date.now(), title: r.title, markdown: r.markdown, status: 'done', sourceFileIds: [], aiFiles: [], model: (p => p.label + ' ' + p.model)(AI.notesProvider()), handout: true };
        await DB.put('notes', n); r.savedId = n.id;
        toast('已存进这门课的笔记'); showResult();
      };
    });
  }

  /* PDF：开一个只有讲义的打印页，选「存储为 PDF」 */
  function printMd(r) {
    const w = window.open('', '_blank');
    if (!w) { toast('浏览器拦住了新窗口。先下载 Word，再用 Word 另存为 PDF'); return; }
    w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(r.title)}</title><style>
      body{font:15px/1.75 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2430;max-width:760px;margin:32px auto;padding:0 24px}
      h1{font-size:26px;color:#2C47A5}h2{font-size:20px;margin-top:30px;border-bottom:1px solid #d5d9e4;padding-bottom:5px}h3{font-size:17px;color:#2C47A5}
      table{border-collapse:collapse;width:100%;margin:10px 0;font-size:14px}th,td{border:1px solid #c5cbda;padding:6px 9px;text-align:left;vertical-align:top}th{background:#eaeef9}
      blockquote{margin:10px 0;padding:8px 14px;border-left:4px solid #2C47A5;background:#f4f6fb;color:#454c5c}code{background:#eef0f5;padding:1px 4px;border-radius:3px}
      .meta{color:#6b7280;font-size:13px;border-bottom:2px solid #2C47A5;padding-bottom:10px;margin-bottom:18px}tr,blockquote{break-inside:avoid}h2,h3{break-after:avoid}
    </style><div class="meta">${esc(r.meta || '')}</div>${md(r.markdown)}`);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 400);
  }

  /* ---------- 入口：选材料、选导出成什么 ---------- */
  async function open({ course, fileIds = [], noteIds = [] } = {}) {
    if (running) { showRunning(); return; }
    if (!course) { toast('先进到一门课里再导出'); return; }
    const [allFiles, allNotes, allSessions] = await Promise.all([DB.byIndex('files', 'courseId', course.id), DB.byIndex('notes', 'courseId', course.id), DB.byIndex('sessions', 'courseId', course.id)]);
    const files = sortFiles(allFiles.filter(f => f.status === 'ready' && String(f.text || '').trim()));
    const notes = allNotes.filter(noteHasText).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const sessions = allSessions.filter(s => (s.segments || []).length).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    if (!files.length && !notes.length && !sessions.length) { toast('这门课还没有能导出的内容：先导入课件、录一节课或者写点笔记'); return; }

    // 从笔记页进来：把这份笔记用到的课件也带上
    const fromNotes = notes.filter(n => noteIds.includes(n.id));
    let selF = new Set([...fileIds, ...fromNotes.flatMap(n => n.sourceFileIds || [])].filter(id => files.some(f => f.id === id)));
    // 自动带上有关的：选了课件 → 用到这些课件的笔记；选了笔记 → 它关联的录音。手动改过的就不再自动动它
    const touchedN = new Set(), touchedS = new Set();
    const linkedNotes = () => new Set(notes.filter(n => noteIds.includes(n.id) || (n.sourceFileIds || []).some(id => selF.has(id))).map(n => n.id));
    let selN = linkedNotes();
    const linkedSess = () => new Set(notes.filter(n => selN.has(n.id)).flatMap(noteSessIds).filter(id => sessions.some(s => s.id === id)));
    let selS = linkedSess();

    const pref = Pref.get();
    const autoTitle = () => {
      const ns = notes.filter(n => selN.has(n.id)), fs = files.filter(f => selF.has(f.id));
      if (ns.length === 1 && fs.length <= 1) return ns[0].title;
      if (fs.length) {
        const weeks = [...new Set(fs.map(f => weekOf(f).label))];
        if (fs.length > 1 && weeks.length === 1 && /^Week/.test(weeks[0])) return `${courseCode(course.name) || course.name} ${weeks[0]}`;
        return fs[0].name.replace(/\.[^.]+$/, '') + (fs.length > 1 ? ` 等 ${fs.length} 份` : '');
      }
      return ns[0] ? ns[0].title : course.name;
    };
    const tagOf = f => phaseOf(f) ? `<span class="tag ${phaseOf(f) === '预习' ? 'pre' : phaseOf(f) === '正课' ? 'cls' : phaseOf(f) === '课后' ? 'post' : 'asm'}">${phaseOf(f)}</span>` : '';
    const list = (id, items, sel, row) => items.length ? `<div class="checklist xp-list" id="${id}">${items.map(it => `<label><input type="checkbox" value="${it.id}" ${sel.has(it.id) ? 'checked' : ''}>${row(it)}</label>`).join('')}</div>` : '';

    modal(`
      <div class="row"><h2 class="grow">导出学习资料</h2>${last ? `<button class="btn small" id="xp-last" title="${esc(last.title)}">打开上次导出的</button>` : ''}</div>
      <div class="field"><label>导出成什么</label>
        <div class="outs xp-kinds" id="xp-kinds">${KINDS.map(([k, l, d]) => `<label class="out"><input type="radio" name="xp-kind" value="${k}" ${(pref.kind || 'handout') === k ? 'checked' : ''}><b>${l}</b><small>${d}</small></label>`).join('')}</div></div>
      <div class="field"><label>课件 <span class="hint" id="xp-nf"></span></label>${list('xp-files', files, selF, f => `<span class="hint" style="min-width:58px">${esc(weekOf(f).label)}</span>${tagOf(f)}<span class="xp-name">${esc(f.name)}</span>`) || '<span class="hint">这门课还没有已读取的课件</span>'}</div>
      <div class="field"><label>笔记 <span class="hint" id="xp-nn"></span></label>${list('xp-notes', notes, selN, n => `<span class="xp-name">${esc(n.title)}</span><span class="hint">${fmtDate(n.createdAt)}${noteSessIds(n).length ? ' · 有录音' : ''}</span>`) || '<span class="hint">这门课还没有写了内容的笔记</span>'}</div>
      <div class="field"><label>课堂录音 <span class="hint" id="xp-ns"></span></label>${list('xp-sess', sessions, selS, s => `<span class="xp-name">${esc(s.title)}</span><span class="hint">${fmtDate(s.startedAt)} · ${fmtTime(s.duration || 0)}</span>`) || '<span class="hint">这门课还没有课堂录音</span>'}</div>
      <div class="field"><label for="xp-title">标题</label><input id="xp-title" type="text" value="${esc(autoTitle())}"></div>
      <div class="field xp-ai"><label>讲义用什么语言</label><div class="radios">
        <label><input type="radio" name="xp-lang" value="zh" ${pref.lang === 'en' ? '' : 'checked'}>中文讲解，术语带英文</label>
        <label><input type="radio" name="xp-lang" value="en" ${pref.lang === 'en' ? 'checked' : ''}>全英文（简单英语）</label></div></div>
      <div class="field xp-ai"><label for="xp-extra">额外要求（可不填）</label><input id="xp-extra" type="text" placeholder="例如：计算题多给几个例子 / 重点讲第 3 章"></div>
      <div class="hint" id="xp-est"></div>
      <div class="row" style="justify-content:flex-end"><button class="btn" data-close>取消</button><button class="btn primary" id="xp-go"></button></div>`, (box, close) => {
      box.classList.add('xp-box');
      const kind = () => ($('input[name=xp-kind]:checked', box) || {}).value || 'handout';
      const read = id => new Set($$(`#${id} input:checked`, box).map(i => i.value));
      const write = (id, set) => $$(`#${id} input`, box).forEach(i => { i.checked = set.has(i.value); });
      const titleEl = $('#xp-title', box); let titleEdited = false;
      titleEl.oninput = () => { titleEdited = true; };
      const paint = () => {
        const k = kind(), p = AI.notesProvider();
        $$('.xp-ai', box).forEach(el => { el.hidden = k !== 'handout'; });
        $('#xp-nf', box).textContent = files.length ? `已选 ${selF.size} / ${files.length}` : '';
        $('#xp-nn', box).textContent = notes.length ? `已选 ${selN.size} / ${notes.length}` + (k === 'handout' ? '' : '') : '';
        $('#xp-ns', box).textContent = sessions.length ? `已选 ${selS.size} / ${sessions.length}` : '';
        $$('#xp-files, #xp-sess', box).forEach(el => { el.closest('.field').classList.toggle('xp-off', k === 'merge'); });
        if (!titleEdited) titleEl.value = autoTitle();
        const chars = files.filter(f => selF.has(f.id)).reduce((n, f) => n + (f.text || '').length, 0)
          + sessions.filter(s => selS.has(s.id)).reduce((n, s) => n + s.segments.reduce((a, g) => a + (g.en || '').length + (g.zh || '').length, 0), 0)
          + notes.filter(n => selN.has(n.id)).reduce((a, n) => a + (n.markdown || '').length + (n.extraNotes || '').length, 0);
        $('#xp-go', box).innerHTML = k === 'handout' ? `${ICON.spark}生成学习讲义` : k === 'merge' ? '合成笔记合集' : '打包给 AI';
        $('#xp-est', box).textContent = k === 'handout' ? `用 ${p.label}（${p.model}）整合 · 材料约 ${Math.round(chars / 3.2 / 1000) + 2}k tokens · 写好后可以存 Word / Markdown / PDF`
          : k === 'merge' ? '只用上面勾选的笔记，课件和录音不会放进去 · 不花钱'
            : `原样打包，不改写不删减，约 ${Math.round(chars / 1000)}k 字 · 不花钱。AI 读 Markdown 最准、最省额度，所以默认存成 .md`;
      };
      $$('#xp-files input', box).forEach(i => i.onchange = () => {
        selF = read('xp-files');
        const auto = linkedNotes(); notes.forEach(n => { if (!touchedN.has(n.id)) { if (auto.has(n.id)) selN.add(n.id); else if (!noteIds.includes(n.id)) selN.delete(n.id); } });
        const as = linkedSess(); sessions.forEach(s => { if (!touchedS.has(s.id)) { if (as.has(s.id)) selS.add(s.id); else selS.delete(s.id); } });
        write('xp-notes', selN); write('xp-sess', selS); paint();
      });
      $$('#xp-notes input', box).forEach(i => i.onchange = () => {
        touchedN.add(i.value); selN = read('xp-notes');
        const as = linkedSess(); sessions.forEach(s => { if (!touchedS.has(s.id)) { if (as.has(s.id)) selS.add(s.id); else selS.delete(s.id); } });
        write('xp-sess', selS); paint();
      });
      $$('#xp-sess input', box).forEach(i => i.onchange = () => { touchedS.add(i.value); selS = read('xp-sess'); paint(); });
      $$('input[name=xp-kind]', box).forEach(i => i.onchange = paint);
      const lb = $('#xp-last', box); if (lb) lb.onclick = showResult;
      paint();

      $('#xp-go', box).onclick = async () => {
        const k = kind(), title = titleEl.value.trim() || autoTitle();
        const lang = ($('input[name=xp-lang]:checked', box) || {}).value || 'zh', extra = $('#xp-extra', box).value.trim();
        if (k === 'merge' && !selN.size) { toast('笔记合集至少要勾一份笔记'); return; }
        if (!selF.size && !selN.size && !selS.size) { toast('至少勾一份课件、笔记或录音'); return; }
        if (k === 'handout' && !Settings.load().deepseekKey) { toast('生成讲义要用 DeepSeek：先去设置里填 key', 5000); return; }
        Pref.set({ kind: k, lang });
        const m = await gather(course, { fileIds: [...selF], noteIds: [...selN], sessionIds: k === 'merge' ? [] : [...selS] });
        if (k === 'merge') { m.files = []; last = { kind: k, title, markdown: buildMerge(m, title), meta: [course.name, `笔记 ${m.notes.length} 份`, today()].join('　·　'), courseId: course.id }; showResult(); return; }
        if (k === 'pack') { last = { kind: k, title: title + ' 资料包', markdown: buildPack(m, title), meta: metaLine(m), courseId: course.id }; showResult(); return; }
        startHandout(m, { title, lang, extra });
      };
    });
  }

  return { open, showResult, buildPack, buildMerge, running: () => !!running };
})();
