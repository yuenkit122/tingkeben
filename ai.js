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
  /* ---------- 用量记账（按月，存在本机） ---------- */
  const COST_KEY = 'tingkeben.costs';
  const Costs = {
    month: () => new Date().toISOString().slice(0, 7),
    all() { try { return JSON.parse(localStorage.getItem(COST_KEY) || '{}'); } catch (e) { return {}; } },
    add(kind, patch) {
      const all = this.all(), m = this.month();
      const row = all[m] = all[m] || {};
      const k = row[kind] = row[kind] || {};
      for (const [a, v] of Object.entries(patch)) k[a] = (k[a] || 0) + (v || 0);
      try { localStorage.setItem(COST_KEY, JSON.stringify(all)); } catch (e) {}
    },
    // DeepSeek 价格（元 / 百万 tokens），可在设置里改
    price() { const s = Settings.load(); return { miss: Number(s.dsPriceIn) || 2, hit: Number(s.dsPriceHit) || 0.2, out: Number(s.dsPriceOut) || 8 }; },
    yuan(ds) { const p = this.price(); return ((ds.miss || 0) * p.miss + (ds.hit || 0) * p.hit + (ds.out || 0) * p.out) / 1e6; },
  };
  function recordDs(u, purpose) {
    if (!u) return;
    const hit = u.prompt_cache_hit_tokens || 0, miss = u.prompt_cache_miss_tokens != null ? u.prompt_cache_miss_tokens : Math.max(0, (u.prompt_tokens || 0) - hit);
    Costs.add('deepseek', { calls: 1, hit, miss, out: u.completion_tokens || 0 });
    Costs.add('ds_' + (purpose || 'other'), { calls: 1, hit, miss, out: u.completion_tokens || 0 });
  }

  function notesProvider() {
    const s = Settings.load();
    return { id: 'deepseek', label: 'DeepSeek', url: DEEPSEEK + '/chat/completions', model: s.deepseekModel || 'deepseek-flash', thinking: s.deepseekThinking };
  }

  /* ---------- 流式生成笔记 ---------- */
  async function deepseekStream({ system, user, messages, onText, onThinking, signal, thinking, json, maxTokens, purpose }) {
    const p = notesProvider();
    const key = needKey(p.id);
    const useThink = thinking === undefined ? p.thinking : thinking;
    const body = {
      model: p.model,
      messages: [{ role: 'system', content: system }, ...(messages || [{ role: 'user', content: user }])],
      stream: true, stream_options: { include_usage: true },
      max_tokens: maxTokens || 32000,
      thinking: { type: useThink ? 'enabled' : 'disabled' },
    };
    if (json) body.response_format = { type: 'json_object' };
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
          if (j.usage) recordDs(j.usage, purpose);
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
  async function gemini({ model, parts, json, schema, temperature = 0.3, signal, maxTokens }) {
    const key = needKey('gemini');
    const generationConfig = { temperature };
    if (maxTokens) generationConfig.maxOutputTokens = maxTokens;
    if (json) { generationConfig.responseMimeType = 'application/json'; if (schema) generationConfig.responseSchema = schema; }
    const res = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
    });
    const raw = await res.text();
    if (!res.ok) throw new AIError(friendly('Gemini', res.status, raw), res.status);
    const j = JSON.parse(raw);
    Costs.add('gemini', { calls: 1, tokens: j.usageMetadata?.totalTokenCount || 0 });
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

  /* ---------- 正式翻译：免费模型池 ----------
     按顺序轮流用几家的免费额度：哪家慢（5 秒没出字）、报错或额度用完，就自动换下一家。
     每家今天用了多少次记在本机，快到上限就先跳过。 */
  const POOL = [
    // Groq 的免费额度按模型分别算（实测每个模型每天 1000 次、每分钟 8000 token），同一个 key 用两个模型
    { id: 'groq', label: 'Groq · Qwen', keyField: 'groqKey', modelField: 'groqModel', defModel: 'qwen/qwen3.8-27b', kind: 'openai', base: 'https://api.groq.com/openai/v1', rpm: 30, rpd: 1000, tpm: 8000, extra: { reasoning_format: 'hidden' }, signup: 'https://console.groq.com/keys', note: '实测 0.4–0.7 秒翻完，术语标注最好' },
    { id: 'groq2', label: 'Groq · GPT-OSS', keyField: 'groqKey', modelField: 'groqModel2', defModel: 'openai/gpt-oss-120b', kind: 'openai', base: 'https://api.groq.com/openai/v1', rpm: 30, rpd: 1000, tpm: 8000, extra: { reasoning_effort: 'low', include_reasoning: false }, shareKey: 'Groq', note: '实测 0.6–0.7 秒，口语更自然' },
    // Gemini 免费额度也是按模型分别算：同一个 Gemini key 用几个实测能用的模型
    { id: 'gemini', label: 'Gemini 3.1 Flash-Lite Preview', keyField: 'geminiKey', modelField: 'gmPool1', defModel: 'gemini-3.1-flash-lite-preview', kind: 'gemini', rpm: 10, rpd: 500, tpm: 250000, shareKey: 'Gemini', note: '实测 0.7–0.8 秒' },
    { id: 'gemini2', label: 'Gemini 3.1 Flash-Lite', keyField: 'geminiKey', modelField: 'gmPool2', defModel: 'gemini-3.1-flash-lite', kind: 'gemini', rpm: 10, rpd: 500, tpm: 250000, shareKey: 'Gemini', note: '实测 0.9–1.1 秒' },
    { id: 'gemini3', label: 'Gemini 3.5 Flash-Lite', keyField: 'geminiKey', modelField: 'gmPool3', defModel: 'gemini-3.5-flash-lite', kind: 'gemini', rpm: 10, rpd: 500, tpm: 250000, shareKey: 'Gemini', note: '实测 0.7–2.4 秒，偶尔啰嗦' },
    { id: 'cerebras', label: 'Cerebras', keyField: 'cerebrasKey', modelField: 'cerebrasModel', defModel: 'llama-3.3-70b', kind: 'openai', base: 'https://api.cerebras.ai/v1', rpm: 30, rpd: 14400, tpm: 60000, signup: 'https://cloud.cerebras.ai', note: '没申请到也没关系，会自动跳过' },
    { id: 'mistral', label: 'Mistral', keyField: 'mistralKey', modelField: 'mistralModel', defModel: 'mistral-small-latest', kind: 'openai', base: 'https://api.mistral.ai/v1', rpm: 50, rpd: 50000, tpm: 500000, signup: 'https://console.mistral.ai/api-keys', note: '免费档要同意数据用于训练' },
    { id: 'gemini4', label: 'Gemini 3.6 Flash', keyField: 'geminiKey', modelField: 'gmPool4', defModel: 'gemini-3.6-flash', kind: 'gemini', rpm: 5, rpd: 20, tpm: 250000, shareKey: 'Gemini', note: '翻得好但每天只有 20 次，放最后' },
    { id: 'deepseek', label: 'DeepSeek（付费）', keyField: 'deepseekKey', modelField: 'deepseekModel', defModel: 'deepseek-flash', kind: 'openai', base: DEEPSEEK, rpm: 300, rpd: 1e9, tpm: 1e9, paid: true, extra: { thinking: { type: 'disabled' } }, note: '' },
  ];
  const USAGE_KEY = 'tingkeben.usage';
  const recent = {}, recentTok = {}, cooldown = {};
  const estTokens = text => Math.ceil(text.length / 2.2) + 250; // 粗估：提示词 + 输出
  function usage() {
    let u = {}; try { u = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); } catch (e) {}
    const today = new Date().toDateString();
    if (u.date !== today) u = { date: today, n: {} };
    return u;
  }
  function bump(id, tokens) {
    const u = usage(); u.n[id] = (u.n[id] || 0) + 1;
    if (id !== 'deepseek') Costs.add('pool', { [id]: 1, tokens: tokens || 0 });
    try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch (e) {}
    (recent[id] = recent[id] || []).push(Date.now());
    if (tokens) (recentTok[id] = recentTok[id] || []).push({ t: Date.now(), n: tokens });
  }
  function canUse(p, tokens) {
    // 每分钟 token 上限（Groq 只有 8000）：快到了就先用下一家
    if (p.tpm && tokens) {
      const used = (recentTok[p.id] = (recentTok[p.id] || []).filter(x => Date.now() - x.t < 60000)).reduce((a, x) => a + x.n, 0);
      if (used + tokens > p.tpm * 0.9) return false;
    }
    const s = Settings.load();
    if (!s[p.keyField]) return false;
    if ((s.poolOff || {})[p.id]) return false;
    if (p.paid && (s.poolFallback || 'deepseek') !== 'deepseek') return false;
    if ((cooldown[p.id] || 0) > Date.now()) return false;
    const n = usage().n[p.id] || 0;
    if (n >= p.rpd * 0.97) return false;
    const r = (recent[p.id] = (recent[p.id] || []).filter(t => Date.now() - t < 60000));
    return r.length < p.rpm * 0.9;
  }
  function poolStatus() {
    const s = Settings.load(), u = usage();
    return POOL.map(p => ({ ...p, model: s[p.modelField] || p.defModel, hasKey: !!s[p.keyField], off: !!(s.poolOff || {})[p.id], today: u.n[p.id] || 0, cooling: (cooldown[p.id] || 0) > Date.now() }));
  }

  /* 翻译模式：pool（免费模型池，默认）或 deepseek（只用 DeepSeek） */
  function translateProvider() { return Settings.load().translateProvider === 'deepseek' && Settings.load().deepseekKey ? 'deepseek' : 'pool'; }

  async function translateBatch(opts) {
    const s = Settings.load();
    const list = translateProvider() === 'deepseek' ? POOL.filter(p => p.id === 'deepseek') : POOL;
    let lastErr = null;
    const tokens = estTokens(translatePrompt(opts) + OUT_FORMAT);
    for (const p of list) {
      if (!canUse(p, tokens) && !(translateProvider() === 'deepseek')) continue;
      try {
        const r = await translateWith(p, opts);
        bump(p.id, tokens);
        r.provider = p.label;
        return r;
      } catch (e) {
        if (e.name === 'AbortError' && opts.signal?.aborted) throw e;
        lastErr = e;
        bump(p.id, tokens);
        // 额度用完：今天不再用这家；限流：歇 1 分钟；慢或其他错误：歇 20 秒
        const perDay = /per day|daily|RPD|quota/i.test(e.message || '');
        cooldown[p.id] = Date.now() + (e.status === 429 ? (perDay ? 6 * 3600e3 : 60e3) : 20e3);
      }
    }
    // 免费额度都用完了
    if ((s.poolFallback || 'deepseek') === 'local' && localT) {
      const items = [];
      for (const i of opts.items) items.push({ id: i.id, zh: await localT.translate(i.en), en_fixed: i.en, important: false });
      return { items, terms: [], provider: 'Chrome 内置翻译' };
    }
    throw new AIError('免费翻译额度暂时都用完了' + (lastErr ? '（' + lastErr.message.slice(0, 80) + '）' : ''), 429);
  }

  const OUT_FORMAT = `

输出格式（严格遵守，不要多写别的）：
先每行一句中文翻译，行首写编号，例如：
<s0> 中文翻译
<s1> 中文翻译
然后单独一行写 ###
最后一行写 JSON，只列出改过英文或是重点的句子，没有就写空数组：{"items":[{"id":"s0","en_fixed":"修正后的英文","important":true}],"terms":[{"en":"","zh":""}]}`;

  /* 用某一家翻译。4 秒内没出第一个字就放弃，换下一家 */
  async function translateWith(p, { items, context, glossary, courseName, vocab, lean, signal, onPartial }) {
    const s = Settings.load();
    const key = (s[p.keyField] || '').trim();
    const model = s[p.modelField] || p.defModel;
    const prompt = translatePrompt({ items, context, glossary, courseName, vocab, lean }) + OUT_FORMAT;
    const ctl = new AbortController();
    const onOuter = () => ctl.abort(); signal && signal.addEventListener('abort', onOuter);
    let firstTimer = setTimeout(() => ctl.abort(), 4000);
    const totalTimer = setTimeout(() => ctl.abort(), 20000);
    let res;
    try {
      if (p.kind === 'gemini') {
        const gc = { temperature: 0.3, maxOutputTokens: 1200 };
        if (/^gemini-3/.test(model)) gc.thinkingConfig = { thinkingLevel: 'minimal' };
        res = await fetch(`${GEMINI}/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gc }),
        });
      } else {
        res = await fetch(p.base + '/chat/completions', {
          method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify(Object.assign({ model, messages: [{ role: 'user', content: prompt }], stream: true, temperature: 0.3, max_tokens: 1500 }, p.id === 'deepseek' ? { stream_options: { include_usage: true } } : {}, p.extra || {})),
        });
      }
      if (!res.ok) throw new AIError(friendly(p.label, res.status, await res.text()), res.status);
      const reader = res.body.getReader(); const dec = new TextDecoder();
      let buf = '', text = '';
      const parseLines = () => {
        const zh = {};
        text.split('###')[0].split('\n').forEach(line => { const m = line.match(/^\s*<?(s\d+)>?\s*(.*)$/); if (m) zh[m[1]] = m[2].replace(/<\/?s\d+>\s*$/g, '').trim(); });
        return zh;
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        let changed = false;
        for (const l of lines) {
          const t = l.trim(); if (!t.startsWith('data:')) continue;
          const d = t.slice(5).trim(); if (d === '[DONE]') continue;
          try {
            const j = JSON.parse(d);
            if (j.usage && p.id === 'deepseek') recordDs(j.usage, 'translate');
            const c = p.kind === 'gemini'
              ? (j.candidates?.[0]?.content?.parts || []).filter(x => !x.thought).map(x => x.text || '').join('')
              : j.choices?.[0]?.delta?.content;
            if (c) { text += c; changed = true; if (firstTimer) { clearTimeout(firstTimer); firstTimer = null; } }
          } catch (e) {}
        }
        if (changed && !text.includes('###') && onPartial) onPartial(parseLines());
      }
      return finishOutput(text, items, parseLines());
    } catch (e) {
      if (e.name === 'AbortError' && !signal?.aborted) throw new AIError(`${p.label} 太慢了，换下一家`, 0);
      throw e;
    } finally {
      clearTimeout(firstTimer); clearTimeout(totalTimer);
      signal && signal.removeEventListener('abort', onOuter);
    }
  }

  function finishOutput(text, items, zh) {
    if (!Object.values(zh).some(Boolean)) throw new AIError('返回的格式不对', 0);
    let meta = { items: [], terms: [] };
    const tail = text.split('###')[1] || '';
    const jm = tail.match(/\{[\s\S]*\}/);
    if (jm) { try { meta = JSON.parse(jm[0]); } catch (e) { /* JSON 坏了就只用中文 */ } }
    const byId = {}; (meta.items || []).forEach(it => { byId[String(it.id).replace(/[<>]/g, '')] = it; });
    return {
      items: items.map(i => ({ id: i.id, zh: zh[i.id] || '', en_fixed: byId[i.id]?.en_fixed || i.en, important: !!byId[i.id]?.important })),
      terms: (meta.terms || []).map(t => ({ en: t.en, zh: String(t.zh || '').replace(/[（(][^）)]*[）)]/g, '').trim() })),
    };
  }

  /* Chrome 内置翻译（电脑本机运行，免费、不限次数）。第一次要下载英译中模型，必须在点击里触发 */
  let localT = null, localState = null;
  async function localAvailability() {
    if (!('Translator' in self)) return 'unsupported';
    try { return await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'zh' }); } catch (e) { return 'unsupported'; }
  }
  function prepareLocalTranslator(onProgress) {
    // 不要在这之前 await：Chrome 只在用户点击的那一刻允许开始下载
    if (localT || !('Translator' in self)) return Promise.resolve(localT);
    localState = 'downloading';
    const p = Translator.create({
      sourceLanguage: 'en', targetLanguage: 'zh',
      monitor(m) { m.addEventListener('downloadprogress', e => onProgress && onProgress(e.loaded)); },
    }).then(t => { localT = t; localState = 'ready'; return t; }).catch(e => { localState = 'failed'; return null; });
    return p;
  }
  const localReady = () => !!localT;

  /* 草稿翻译：句子还没说完就先翻已经说出来的部分（灰色字幕）
     免费模式用 Chrome 内置翻译；DeepSeek 模式更准 */
  async function translateDraft(opts) {
    const mode = Settings.load().draftMode || 'free';
    if (mode === 'free') {
      if (!localT) return '';
      const zh = await localT.translate(opts.text);
      opts.onPartial && opts.onPartial(zh);
      return zh;
    }
    return translateDraftDeepseek(opts);
  }
  async function translateDraftDeepseek({ text, context, glossary, courseName, signal, onPartial }) {
    const key = needKey('deepseek');
    const gl = Object.entries(glossary || {}).slice(-30).map(([en, zh]) => `${en}=${zh}`).join('；');
    const ctx = (context || []).slice(-2).map(c => c.zh).join(' ');
    // 固定的说明放在最前面，DeepSeek 会缓存这一段，重复请求更便宜更快
    const prompt = `你在给大学课堂做实时中文字幕的“草稿”。讲者这句话还没说完，只把已经说出来的英文翻成通顺的中文，不要补全后半句，不要解释，不要加引号，只输出中文。数字、金额、人名、课程代码照抄。
课程：${courseName || ''}
术语：${gl || '无'}
上文：${ctx || '无'}
英文（未说完）：${text}`;
    const res = await fetch(DEEPSEEK + '/chat/completions', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: Settings.load().deepseekModel || 'deepseek-flash', messages: [{ role: 'user', content: prompt }], stream: true, stream_options: { include_usage: true }, temperature: 0.2, max_tokens: 200, thinking: { type: 'disabled' } }),
    });
    if (!res.ok) throw new AIError(friendly('DeepSeek', res.status, await res.text()), res.status);
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = '', out = '';
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) {
        const t = l.trim(); if (!t.startsWith('data:')) continue; const d = t.slice(5).trim(); if (d === '[DONE]') continue;
        try { const j = JSON.parse(d); if (j.usage) recordDs(j.usage, 'draft'); const c = j.choices?.[0]?.delta?.content; if (c) { out += c; onPartial && onPartial(out.trim()); } } catch (e) {}
      }
    }
    return out.trim();
  }

  /* Gemini 免费版：一次翻几句，省请求次数 */
  async function translateGemini(opts) {
    const prompt = translatePrompt(opts) + '\n\n每一行单独翻译，按编号原样返回到 items 里（id 不带尖括号），顺序不变。';
    return gemini({ model: Settings.load().geminiFastModel, parts: [{ text: prompt }], json: true, schema: TRANSLATE_SCHEMA, temperature: 0.2, signal: opts.signal });
  }

  /* 规则放最前面、每次都一样，方便各家做前缀缓存；术语表只带这批用得上的，省 token */
  const TR_RULES = `你是 Monash 商科课堂的中文字幕员，听众是英文还不熟练的大一新生。把【当前片段】每一行译成简体中文字幕。
规则：
1. 意译、通顺口语，保留语气、例子和逻辑词（所以/但是/比如）；不加原文没有的内容。
2. 术语第一次出现写“中文（English）”，之后只写中文；已统一的译法必须沿用；新术语放进 terms。
3. 数字、金额、百分比、日期、公式、人名、公司名照原样。
4. 识别可能把专业词听错（如 "the bit"→"debit"），结合课程词和前文改正，改过的才写 en_fixed。
5. 讲到考试、作业、截止日期、评分、"this is important" 时 important=true。
6. 只是语气词或半句的，中文可以很短或留空。`;
  function pickGlossary(glossary, text, max) {
    const all = Object.entries(glossary || {});
    const low = text.toLowerCase();
    const hit = all.filter(([en]) => low.includes(en.toLowerCase()));
    const recent = all.slice(-6).filter(e => !hit.includes(e));
    return [...hit.slice(-max), ...recent].slice(0, max + 6);
  }
  function translatePrompt({ items, context, glossary, courseName, vocab, lean }) {
    const text = items.map(i => `<${i.id}> ${i.en}`).join('\n');
    const ctxList = lean ? context.slice(-2) : context;
    const ctx = ctxList.map(c => `EN: ${c.en}\n中: ${c.zh}`).join('\n');
    const gl = pickGlossary(glossary, text + ' ' + ctxList.map(c => c.en).join(' '), lean ? 12 : 30).map(([en, zh]) => `${en} = ${zh}`).join('\n');
    const low = text.toLowerCase();
    const vs = (vocab || []).filter(v => low.includes(v.toLowerCase().split(' ')[0]));
    const vv = (lean ? [...vs, ...(vocab || [])] : (vocab || [])).filter((v, i, a) => a.indexOf(v) === i).slice(0, lean ? 12 : 25);
    return `${TR_RULES}

课程：${courseName || '（未指定）'}
课程常见词：${vv.join(', ') || '（无）'}
已统一的术语：
${gl || '（暂无）'}
前文（只作理解，不要翻译）：
${ctx || '（开头）'}

【当前片段】（语音识别结果，<id> 是编号）：
${text}`;
  }


  /* ---------- 笔记提示词 ---------- */
  const NOTES_SYSTEM = `你是一名耐心的商科助教，服务对象是马来西亚 Monash University Diploma of Business 的一年级学生。他的母语是中文，英文学术阅读和听课都比较吃力，但考试和作业全部用英文。你的任务是把课件或课堂记录整理成他能真正看懂、也能拿去复习考试的中英对照笔记。

写作规则：
- 只根据提供的材料整理。材料里没有、但理解所必需的补充（包括额外的规则、例外情况），一律在句末标注“（补充）”。不要编造数字、日期或老师没说的考试范围。
- 页码 [p.N] 只能标在确实出自那一页的内容后面；你自己举的例子、自己编的金额，不要标页码。
- 中英分开：正文一律用中文写，不要中英混杂成句。专业术语写成「中文（English）」——英文原词放在中文后面的括号里（考试要用英文），每个小节第一次出现都要带括号，之后可以只写中文。英文原句只出现在「定义」那一行，并紧跟中文意思。
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

## 核心概念
每个概念一个小节：
### 中文名（English Term）
- **定义**：“课件里的英文原句”（短的照抄，长的摘最关键半句）—— 中文意思
- **白话解释**：用中文讲清楚是什么、为什么重要
- **例子**：一个具体例子（会计题就写分录或算式）
- **考试提示**：通常怎么考、容易错在哪

## 公式 / 步骤
有计算或流程就用表格或编号步骤写清楚（会计分录用 Debit / Credit 表格）。

## 容易混淆
用表格对比容易搞混的概念（A vs B）。

## 关键词汇表
表格：English | 中文 | 一句话解释。把这讲所有重要英文词都放进去。

（不要写“本讲要点”和“自测题”——重点知识点和测验题会另外单独生成。）

${transcript ? '另外：如果课堂录音里老师强调了考试、作业或重点，在开头加一个「⚠️ 老师强调」小节列出来；最后再加一节「## 课堂上老师提到的」，写课件之外老师讲的例子、补充、课堂提问和答案（每条标时间）。' : ''}
${extra ? '学生的额外要求：' + extra : ''}

以下是材料：${material}`;
  }

  /* ---------- 学习工具：重点 / 测验（一次生成，JSON） ---------- */
  const STUDY_SYSTEM = `你是给英语不好的中国留学生（Monash 马来西亚分校商科 Diploma）做复习材料的助教。只根据给你的笔记和课件出题，不要编材料里没有的内容。
中英分开：用简体中文写，专业术语写成「中文（English）」，英文原词放在括号里。考试是英文的，所以测验题题干后面附上关键英文原词。
只输出一个 JSON 对象，不要任何多余文字。`;
  /* parts：要哪几样，['points','quiz'] 的组合，只出要的那几样，省 token */
  const STUDY_PARTS = {
    points: { name: '重点知识点', schema: '"points": [ { "id": "p1", "title": "知识点名称，写成 中文（English）", "items": ["要点 1：一句中文，术语写成 中文（English）", "要点 2", "要点 3"], "page": "来源页码，比如 第5页；不知道就空字符串" } ]', rule: '- points 6-12 个知识点，每个 2-4 条要点（短句，能直接背），覆盖整份材料最重要、最可能考的内容，按学习顺序排。' },
    quiz: { name: '测验题', schema: '"quiz": [ { "type": "single", "q": "题目", "options": ["A 选项","B 选项","C 选项","D 选项"], "answer": 0, "explain": "为什么对、其他为什么错（2-3 句）", "point": "知识点 id" } ]', rule: '- quiz 10-15 道单选题，四个选项，干扰项要像真的；至少 1/3 是计算或情景应用题（如果材料有计算）。answer 是正确选项的下标（0-3），正确答案的位置要打乱，别总是同一个。\n- options 里不要写 A. B. 这样的字母前缀；explain 里也不要用字母指代选项，直接说内容（选项顺序会被打乱）。' },
  };
  function studyPrompt({ title, markdown, sources, parts = ['points', 'quiz'], points: known }) {
    const want = Object.keys(STUDY_PARTS).filter(k => parts.includes(k));
    const linkable = want.includes('points') || (known && known.length);
    const pointRule = want.includes('quiz')
      ? (linkable ? '- 每张卡片、每道题都必须填 point，指向一个知识点 id。' : '- 没有知识点列表，point 填空字符串。') : '';
    return `给这份材料生成复习材料，只要：${want.map(k => STUDY_PARTS[k].name).join('、')}。JSON 格式：
{
  ${want.map(k => STUDY_PARTS[k].schema).join(',\n  ')}
}
要求：
${want.map(k => STUDY_PARTS[k].rule).join('\n')}
${pointRule}
${!want.includes('points') && known && known.length ? `\n已有的知识点（point 用这些 id）：\n${known.map(p => `${p.id}: ${p.title}`).join('\n')}\n` : ''}
标题：${title}
${markdown ? `\n<笔记>\n${markdown}\n</笔记>` : ''}
${sources ? `\n<课件原文${markdown ? '（节选）' : ''}>\n${sources}\n</课件原文>` : ''}`;
  }
  async function studyPack({ title, markdown, sources, signal, onText, parts = ['points', 'quiz'], points: known }) {
    let j;
    const want = Object.keys(STUDY_PARTS).filter(k => parts.includes(k));
    const maxTokens = 2000 + want.reduce((n, k) => n + ({ points: 4500, quiz: 6000 })[k], 0);
    for (let attempt = 0; ; attempt++) {
      const text = await deepseekStream({ system: STUDY_SYSTEM, user: studyPrompt({ title, markdown, sources, parts: want, points: known }), signal, onText, thinking: false, json: true, maxTokens, purpose: 'study' });
      try { j = parseJSON(text); break; } catch (e) { if (attempt >= 1) throw e; } // 偶尔格式坏掉，自动再来一次
    }
    const out = { at: Date.now() };
    let points = known || [];
    if (want.includes('points')) points = out.points = (j.points || []).filter(p => p && p.title).map((p, i) => ({ id: String(p.id || 'p' + (i + 1)), title: String(p.title), items: (Array.isArray(p.items) ? p.items : [p.detail]).filter(Boolean).map(String), page: String(p.page || '') }));
    const ids = new Set(points.map(p => p.id));
    const fix = id => ids.has(String(id)) ? String(id) : '';
    if (want.includes('quiz')) out.quiz = (j.quiz || []).filter(q => q && q.q && Array.isArray(q.options) && q.options.length >= 2).map(q => {
      // 打乱选项顺序（模型爱把正确答案放在 B）；去掉选项开头自带的 "A." 之类
      const ans = Math.max(0, Math.min(q.options.length - 1, Number(q.answer) || 0));
      const opts = q.options.map((o, k) => ({ t: String(o).replace(/^\s*[A-F][.、)．]\s*/, ''), ok: k === ans })).sort(() => Math.random() - .5);
      return { q: String(q.q), options: opts.map(o => o.t), answer: opts.findIndex(o => o.ok), explain: String(q.explain || ''), point: fix(q.point) };
    });
    return out;
  }
  function parseJSON(text) {
    const t = String(text).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (e) {}
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {} }
    throw new AIError('AI 返回的格式不对，再点一次重新生成。', 0);
  }

  /* ---------- 课前包：5 分钟预习卡 + 术语表（一次生成） ---------- */
  async function prepPack({ name, text, courseName, signal, onText }) {
    const user = `课程：${courseName || ''}\n课件：${name}\n\n给这份课件做「课前包」，学生上课前花 5 分钟看，上课时能听懂老师在讲什么。只输出 JSON：
{
  "preview": {
    "summary": "这节课讲什么（2-3 句中文，大白话）",
    "concepts": [ { "term": "中文（English）", "why": "一句话：是什么、为什么重要" } ],
    "hard": [ "上课可能听不懂的地方（一句话说明，并告诉学生听到哪个英文词时要注意）" ],
    "listen_for": [ "老师可能会说的英文关键句或短语" ]
  },
  "terms": [ { "en": "英文术语（课件原词）", "ipa": "英式音标，例如 /əˈkruːəl/", "zh": "中文", "explain": "一句中文解释", "example": "一个简短英文例句（课堂/商业场景）", "example_zh": "例句中文" } ]
}
要求：concepts 正好 3 个；hard 2-4 条；listen_for 3-5 条；terms 15-35 个，按课件出现顺序，只收专业词和学生可能不认识的学术词，不收 the/and 这类常用词。ipa 用英式（RP），写成 /.../ 结尾，不确定就留空字符串，不要编。

<课件>
${String(text).slice(0, 60000)}
</课件>`;
    let j;
    for (let attempt = 0; ; attempt++) {
      const out = await deepseekStream({ system: '你是给英语不好的中国留学生做课前预习材料的助教。中英分开：中文解释，英文原词放括号里。只输出 JSON。', user, signal, onText, thinking: false, json: true, maxTokens: 8000, purpose: 'prep' });
      try { j = parseJSON(out); break; } catch (e) { if (attempt >= 1) throw e; }
    }
    const pv = j.preview || {};
    return {
      preview: { summary: String(pv.summary || ''), concepts: (pv.concepts || []).slice(0, 4).map(c => ({ term: String(c.term || ''), why: String(c.why || '') })), hard: (pv.hard || []).map(String), listen: (pv.listen_for || []).map(String) },
      terms: (j.terms || []).filter(t => t && t.en && t.zh).map(t => ({ en: String(t.en).trim(), ipa: String(t.ipa || '').trim(), zh: String(t.zh).trim(), explain: String(t.explain || ''), example: String(t.example || ''), example_zh: String(t.example_zh || '') })),
      at: Date.now(),
    };
  }

  /* ---------- 补音标：给已经生成过的术语补 IPA（一次一批，便宜） ---------- */
  async function ipaFor(words) {
    if (!words.length) return {};
    const out = await deepseekStream({
      thinking: false, json: true, maxTokens: 2000, purpose: 'prep',
      system: '你是英语发音词典。只输出 JSON，不要解释。',
      user: `给下面这些英文术语标注英式音标（RP），用国际音标，写成 /.../。不确定的留空字符串，不要编。只输出 JSON：{"items":[{"en":"术语","ipa":"/.../"}]}\n\n${words.map(w => '- ' + w).join('\n')}`,
    });
    const j = parseJSON(out);
    const map = {};
    (j.items || []).forEach(x => { if (x && x.en) map[String(x.en).trim().toLowerCase()] = String(x.ipa || '').trim(); });
    return map;
  }

  /* ---------- 没听懂：用中文重新解释那一段 ---------- */
  function confusedPrompt({ courseName, around, near }) {
    return `课程：${courseName || ''}\n学生在上课时这里没听懂（标记时间附近老师说的话，语音识别可能有错）：\n${around}\n\n请用中文重新讲一遍老师在这段说了什么：先一句话总结，再分点解释难懂的词和逻辑（术语写成 中文（English）），最后如果有例子或数字，一步步讲清楚。简短。`;
  }

  /* ---------- 问 AI（围绕笔记 / 课件 / 录音） ---------- */
  function chatSystem({ courseName, context, free }) {
    if (free || !String(context || '').trim()) {
      return `你是「听课本」里的学习助教，学生是英语不太好的中国留学生，在读 Monash 马来西亚分校商科 Diploma（${courseName || '某门课'}）。
这次学生没让你读任何资料，就是直接聊天/问问题：按你已有的知识回答，别假装看过他的课件或录音。
回答规则：
- 用简体中文，口语、简短，先给结论再解释。专业术语写成「中文（English）」。
- 需要用到他的课程材料时，明确说「这个要看你课件里的定义，可以切到『读资料』再问」。
- 拿不准的地方标「（不确定）」。
- 要你出题时：一次 1-3 道，答案和解析写在每题下面。
- 计算题一步一步写。
- 不要替他写要交的作业或论文全文。`;
    }
    return `你是「听课本」里的学习助教，学生是英语不太好的中国留学生，在读 Monash 马来西亚分校商科 Diploma（${courseName || '某门课'}）。
回答规则：
- 用简体中文，口语、简短，先给结论再解释。专业术语写成「中文（English）」。
- 优先根据下面的材料回答，引用时注明出处，比如（Week 3 讲义 第5页）或（录音 12:30）。材料里没有的，可以用常识补充，但要标「（材料里没有，补充）」。
- 拿不准的地方标「（不确定）」。
- 学生要你出题时：一次出 1-3 道，答案和解析直接写在每道题下面。
- 计算题要一步一步写，数字对齐。
- 不要替学生写要交的作业或论文全文；可以讲思路、给提纲、帮改语法。

<材料>
${context}
</材料>`;
  }

  /* ---------- 课件全文翻译（逐页，中英对照） ---------- */
  const DOC_TR_SYSTEM = `你是课件翻译。把英文课件逐页翻成简体中文，给英语不好的中国留学生看。
规则：
- 保持原来的分页标记，每页以「## 第N页」开头。
- 每页先写中文翻译，排版尽量保持原样（标题、要点、表格用 Markdown）。
- 专业术语写成「中文（English）」，同一个术语全文翻法一致。
- 公式、数字、人名、公司名保持原样。
- 页面里只是页码、版权声明、"Monash University" 之类的无意义文字，直接省略。
- 不要加任何解释或总结，只翻译。`;
  function docTranslatePrompt(text) { return `翻译下面这些页：\n\n${text}`; }

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

  /* ---------- 每页要点：不论这页讲什么，都从这页文字里提炼要点，标出重点 ---------- */
  async function pagePoints({ name, pages, onText }) {
    const body = pages.map(p => `[第${p.n}页]\n${String(p.text || '').slice(0, 1600)}`).join('\n\n');
    const out = await deepseekStream({
      thinking: false, json: true, maxTokens: 6000, purpose: 'prep', onText,
      system: '你是商科助教，负责把课件一页一页讲清楚。学生英语不好，用简体中文写，专业术语写成 中文（English）。只输出 JSON。',
      user: `课件：${name}\n\n给每一页提炼要点。不要照抄英文，用中文讲这页在说什么；术语保留英文原词。只输出 JSON：\n{"pages":[{"n":1,"title":"6-14 字小标题","points":[{"t":"一条要点（不超过 40 字）","strong":true}]}]}\n\n规则：\n- 每页 2-5 条；这页没什么内容就给 1 条或空数组。\n- strong=true 只给真正的重点：定义、公式、考点、老师一定会问的东西。每页最多 2 条。\n- 页数必须和下面完全一致，不要合并、不要漏页。\n\n${body}`,
    });
    const j = parseJSON(out);
    return (j.pages || []).filter(x => x && x.n).map(x => ({
      n: Number(x.n),
      title: String(x.title || '').trim(),
      points: (x.points || []).filter(y => y && y.t).slice(0, 6).map(y => ({ t: String(y.t).slice(0, 120), strong: !!y.strong })),
    }));
  }

  return { Costs, prepPack, confusedPrompt, studyPack, ipaFor, pagePoints, chatSystem, DOC_TR_SYSTEM, docTranslatePrompt, parseJSON, deepseekStream, gemini, ocr, translateBatch, translateDraft, translateProvider, POOL, poolStatus, translateWith, prepareLocalTranslator, localReady, localAvailability, localState: () => localState, notesPrompt, NOTES_SYSTEM, testGemini, testDeepseek, notesProvider, AIError, GEMINI };
})();
