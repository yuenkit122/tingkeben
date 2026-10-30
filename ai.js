/* AI 调用：DeepSeek 生成笔记，Gemini 负责翻译和扫描件识别 */
const AI = (() => {
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
  const DEEPSEEK = 'https://api.deepseek.com';

  class AIError extends Error {
    constructor(msg, status) { super(msg); this.status = status; }
  }

  function friendly(provider, status, body) {
    let detail = '';
    try { const j = JSON.parse(body); detail = j.error?.message || j.message || ''; } catch (e) { detail = (body || '').slice(0, 200); }
    if (status === 401 || status === 403) return `${provider} 拒绝了这个 API key（${status}）。去「设置」检查 key 是否正确、是否已开通。${detail ? '\n' + detail : ''}`;
    if (status === 402) return `${provider} 账户余额不足（402），充值后再试。`;
    if (status === 429) return `${provider} 请求太频繁或额度用完（429），等一会儿再试。${detail ? '\n' + detail : ''}`;
    if (status === 404) return `${provider} 找不到这个模型（404）。去「设置」换一个模型名。${detail ? '\n' + detail : ''}`;
    return `${provider} 出错（${status}）：${detail || '未知错误'}`;
  }

  const KEY_NAMES = { gemini: ['geminiKey', 'Gemini'], deepseek: ['deepseekKey', 'DeepSeek'] };
  function needKey(name) {
    const s = Settings.load();
    const [field, label] = KEY_NAMES[name];
    const k = s[field];
    if (!k) throw new AIError(`还没填 ${label} 的 API key，先去「设置」填。`, 0);
    return k.trim();
  }

  /* 生成笔记固定用 DeepSeek（对比过 GLM-5.3-Flash：GLM 慢 4 倍，而且不允许网页直接调用） */
  function notesProvider() {
    const s = Settings.load();
    return { id: 'deepseek', label: 'DeepSeek', url: DEEPSEEK + '/chat/completions', model: s.deepseekModel || 'deepseek-flash', thinking: s.deepseekThinking };
  }

  /* ---------- 流式生成笔记 ---------- */
  async function deepseekStream({ system, user, onText, onThinking, signal }) {
    const p = notesProvider();
    const key = needKey(p.id);
    const body = {
      model: p.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: true,
      max_tokens: 32000,
      thinking: { type: p.thinking ? 'enabled' : 'disabled' },
    };
    let res;
    try {
      res = await fetch(p.url, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new AIError(`连不上 ${p.label}（${e.message}）。检查网络；如果一直这样，可能是 ${p.label} 不允许网页直接调用，去「设置」换另一个模型。`, 0);
    }
    if (!res.ok) throw new AIError(friendly(p.label, res.status, await res.text()), res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', text = '', think = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const d = j.choices?.[0]?.delta || {};
          if (d.reasoning_content) { think += d.reasoning_content; onThinking && onThinking(think); }
          if (d.content) { text += d.content; onText && onText(text); }
        } catch (e) { /* 半行，忽略 */ }
      }
    }
    if (!text.trim()) throw new AIError(`${p.label} 没有返回内容，换个模型或少选几个文件再试。`, 0);
    return text;
  }

  /* ---------- Gemini：普通请求 ---------- */
  async function gemini({ model, parts, json, schema, temperature = 0.3, signal }) {
    const key = needKey('gemini');
    const generationConfig = { temperature };
    if (json) { generationConfig.responseMimeType = 'application/json'; if (schema) generationConfig.responseSchema = schema; }
    const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    });
    const raw = await res.text();
    if (!res.ok) throw new AIError(friendly('Gemini', res.status, raw), res.status);
    const j = JSON.parse(raw);
    const text = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    if (!text) throw new AIError('Gemini 没有返回内容' + (j.promptFeedback?.blockReason ? '（' + j.promptFeedback.blockReason + '）' : ''), 0);
    if (json) {
      try { return JSON.parse(text); } catch (e) {
        const m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]);
        throw new AIError('Gemini 返回的格式不对', 0);
      }
    }
    return text;
  }

  const b64 = buf => {
    const bytes = new Uint8Array(buf); let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  /* 扫描版 PDF / 照片：让 Gemini 读出文字 */
  async function ocr(blob, mimeType) {
    if (blob.size > 19 * 1024 * 1024) throw new AIError('文件超过 19MB，Gemini 一次读不了，先拆小一点。', 0);
    const data = b64(await blob.arrayBuffer());
    return gemini({
      model: Settings.load().geminiSmartModel,
      temperature: 0.1,
      parts: [
        { inlineData: { mimeType, data } },
        { text: '这是一份大学课件（或白板/讲义照片）。逐页完整转写上面所有文字，保持原文语言，不要翻译、不要总结。每页用一行“[第N页]”开头。标题保留层级，表格用 Markdown 表格，图表用一句话说明它表达了什么，写成“（图：……）”。只输出转写内容。' },
      ],
    });
  }

  /* ---------- 课堂实时翻译（一段一段翻） ---------- */
  const TRANSLATE_SCHEMA = {
    type: 'OBJECT',
    properties: {
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            en_fixed: { type: 'STRING', description: '修正识别错误后的英文；没错就照抄原文' },
            zh: { type: 'STRING', description: '中文翻译' },
            important: { type: 'BOOLEAN', description: '是否是考试/作业/截止日期/老师强调的重点' },
          },
          required: ['id', 'en_fixed', 'zh', 'important'],
        },
      },
      terms: { type: 'ARRAY', items: { type: 'OBJECT', properties: { en: { type: 'STRING' }, zh: { type: 'STRING' } }, required: ['en', 'zh'] } },
    },
    required: ['items', 'terms'],
  };

  /* 一次翻几句（免费版 Gemini 每分钟请求数有限，合并能省很多次） */
  async function translateBatch({ items, context, glossary, courseName, vocab, signal }) {
    const text = items.map(i => `<${i.id}> ${i.en}`).join('\n');
    const ctx = context.map(c => `EN: ${c.en}\n中: ${c.zh}`).join('\n');
    const gl = Object.entries(glossary).slice(-80).map(([en, zh]) => `${en} = ${zh}`).join('\n');
    const prompt = `你是马来西亚 Monash University 商科课堂的同声传译字幕员。听众是中文母语、英文还不熟练的大一新生。把【当前片段】翻译成简体中文字幕。

课程：${courseName || '（未指定）'}
课程常见词：${(vocab || []).slice(0, 40).join(', ') || '（无）'}

已统一的术语译法（必须沿用）：
${gl || '（暂无）'}

前文（只作理解用，不要重复翻译）：
${ctx || '（这是开头）'}

【当前片段】（语音识别结果，可能有错字；每行开头 <id> 是编号）：
${text}

每一行单独翻译，按编号原样返回到 items 里（id 不带尖括号），顺序不变；翻译时可以参考同一批里的上下句。

要求：
1. 意译，像好的中文字幕：通顺、口语化但准确，保留讲者的语气、例子和逻辑连接（所以、但是、比如）。不要逐词硬翻，不要加原文没有的内容。
2. 专业术语第一次出现写成“中文（English）”，之后只写中文；已统一的术语必须用同样的译法。把这次新出现的术语放进 terms。
3. 数字、金额（RM、$）、百分比、日期、公式、人名、公司名照原样保留。
4. 语音识别可能把专业词听错（例如 "debit" 听成 "the bit"）。结合课程常见词和前文判断讲者真正说的话，把修正后的英文写进 en_fixed；没错就照抄。
5. 讲到考试、作业、截止日期、评分、"this is important"、"remember this" 这类内容时，important 设为 true，并且翻译要特别准确。
6. 如果片段只是语气词、口头禅或不完整的半句，zh 可以很短或留空。`;
    return gemini({ model: Settings.load().geminiFastModel, parts: [{ text: prompt }], json: true, schema: TRANSLATE_SCHEMA, temperature: 0.2, signal });
  }

  /* ---------- 笔记提示词 ---------- */
  const NOTES_SYSTEM = `你是一名耐心的商科助教，服务对象是马来西亚 Monash University Diploma of Business 的一年级学生。他的母语是中文，英文学术阅读和听课都比较吃力，但考试和作业全部用英文。你的任务是把课件或课堂记录整理成他能真正看懂、也能拿去复习考试的中英对照笔记。

写作规则：
- 只根据提供的材料整理。材料里没有、但理解所必需的补充（包括额外的规则、例外情况），一律在句末标注“（补充）”。不要编造数字、日期或老师没说的考试范围。
- 页码 [p.N] 只能标在确实出自那一页的内容后面；你自己举的例子、自己编的金额，不要标页码。
- 专业术语一律保留课件里的英文原词（考试要用），后面加中文解释。
- 解释要用大白话，多用生活或马来西亚本地商业的小例子（金额用 RM）。
- 引用课件时标页码，例如 [p.5]。
- 输出 Markdown，不要用代码块包住整篇笔记。`;

  function notesPrompt({ courseName, title, sources, transcript, highlights, style, extra }) {
    const detail = style === 'brief'
      ? '精简版：每个概念 2-4 行，整篇控制在一页半左右，适合考前快速过一遍。'
      : '详细版：每个概念都要讲透，有定义、解释、例子和考试提示，适合第一次学这一讲。';
    let material = '';
    for (const s of sources) material += `\n\n===== 课件：${s.name} =====\n${s.text}`;
    if (transcript) material += `\n\n===== 课堂录音转写（英文原话 + 中文翻译）=====\n${transcript}`;
    if (highlights && highlights.length) material += `\n\n===== 学生在课上标记的重点时刻 =====\n${highlights.join('\n')}`;

    return `请为课程「${courseName}」整理一份笔记，标题用：「${title}」。
${detail}

按这个结构写（某一部分材料里没有就省略）：

# ${title}
> 一句话说清这一讲在讲什么（中文）

## 本讲要点
3-6 条，每条一句中文 + 关键英文词。

## 核心概念
每个概念一个小节：
### English Term（中文名）
- **定义**：课件里的英文原句（短的照抄，长的摘最关键半句）+ 中文意思
- **白话解释**：用中文讲清楚是什么、为什么重要
- **例子**：一个具体例子（会计题就写分录或算式）
- **考试提示**：通常怎么考、容易错在哪

## 公式 / 步骤
有计算或流程就用表格或编号步骤写清楚（会计分录用 Debit / Credit 表格）。

## 容易混淆
用表格对比容易搞混的概念（A vs B）。

## 关键词汇表
表格：English | 中文 | 一句话解释。把这讲所有重要英文词都放进去。

## 自测题
5 道题，混合选择题和简答题，题目用英文（模仿真实考试），每道题下面紧跟答案，格式：
**Q1.** 题目……
> **答案**：……（中文解释为什么）

${transcript ? '另外：如果课堂录音里老师强调了考试、作业或重点，在开头“本讲要点”之前加一个「⚠️ 老师强调」小节列出来。' : ''}
${extra ? '学生的额外要求：' + extra : ''}

以下是材料：${material}`;
  }

  /* ---------- 测试连接 ---------- */
  async function testGemini() {
    const key = needKey('gemini');
    const res = await fetch(`${GEMINI}/models?pageSize=100`, { headers: { 'x-goog-api-key': key } });
    const raw = await res.text();
    if (!res.ok) throw new AIError(friendly('Gemini', res.status, raw), res.status);
    const names = (JSON.parse(raw).models || []).map(m => m.name.replace('models/', ''));
    return names;
  }
  async function testDeepseek() {
    const key = needKey('deepseek');
    const res = await fetch(`${DEEPSEEK}/models`, { headers: { Authorization: 'Bearer ' + key } });
    const raw = await res.text();
    if (!res.ok) throw new AIError(friendly('DeepSeek', res.status, raw), res.status);
    const names = (JSON.parse(raw).data || []).map(m => m.id);
    let balance = null;
    try {
      const b = await fetch(`${DEEPSEEK}/user/balance`, { headers: { Authorization: 'Bearer ' + key } });
      if (b.ok) { const j = await b.json(); balance = j.balance_infos?.[0]; }
    } catch (e) { /* 查不到余额也没关系 */ }
    return { names, balance };
  }

  return { deepseekStream, gemini, ocr, translateBatch, notesPrompt, NOTES_SYSTEM, testGemini, testDeepseek, notesProvider, AIError, GEMINI };
})();
