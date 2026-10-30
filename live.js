/* 课堂实时转写 + 翻译
   流程：麦克风 → 16kHz PCM（每 100ms 一块）→ Gemini Live 转写（gemini-3.5-transcribe-live，带课程词汇表）
        → 每凑够一句 → Gemini Flash-Lite 结合前文和术语表翻成中文 → 存进本机。
   Gemini Live 单次连接最长 10 分钟：到 9 分钟自动无缝换一条新连接，中间的声音先缓存不丢。 */

const WORKLET_SRC = `
class PCM16 extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.pos = 0; this.sum = 0; this.cnt = 0; this.out = new Int16Array(1600); this.n = 0; this.sq = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.sum += ch[i]; this.cnt++; this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        let v = this.sum / this.cnt; this.sum = 0; this.cnt = 0;
        v = Math.max(-1, Math.min(1, v));
        this.sq += v * v;
        this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        if (this.n === 1600) {
          this.port.postMessage({ pcm: this.out.slice(0), rms: Math.sqrt(this.sq / 1600) });
          this.n = 0; this.sq = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm16', PCM16);
`;

class AudioCapture {
  constructor(onChunk) { this.onChunk = onChunk; }
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.src = this.ctx.createMediaStreamSource(this.stream);
    if (this.ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      this.node = new AudioWorkletNode(this.ctx, 'pcm16');
      this.node.port.onmessage = e => this.onChunk(e.data.pcm, e.data.rms);
      this.src.connect(this.node);
      // 接一个静音输出，保证 Safari 持续处理
      const mute = this.ctx.createGain(); mute.gain.value = 0;
      this.node.connect(mute).connect(this.ctx.destination);
    } else {
      // 旧浏览器兜底
      const ratio = this.ctx.sampleRate / 16000;
      this.node = this.ctx.createScriptProcessor(4096, 1, 1);
      let acc = [], pos = 0;
      this.node.onaudioprocess = e => {
        const ch = e.inputBuffer.getChannelData(0);
        for (let i = 0; i < ch.length; i++) { pos += 1; if (pos >= ratio) { pos -= ratio; acc.push(ch[i]); } }
        while (acc.length >= 1600) {
          const part = acc.splice(0, 1600); let sq = 0;
          const out = new Int16Array(1600);
          part.forEach((v, i) => { v = Math.max(-1, Math.min(1, v)); sq += v * v; out[i] = v < 0 ? v * 0x8000 : v * 0x7fff; });
          this.onChunk(out, Math.sqrt(sq / 1600));
        }
      };
      this.src.connect(this.node); this.node.connect(this.ctx.destination);
    }
  }
  stop() {
    try { this.src && this.src.disconnect(); } catch (e) {}
    try { this.node && this.node.disconnect(); } catch (e) {}
    try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    try { this.ctx && this.ctx.close(); } catch (e) {}
  }
}

function int16ToB64(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

class LiveTranscriber {
  constructor({ vocab, onInterim, onFinal, onStatus, onError }) {
    Object.assign(this, { vocab, onInterim, onFinal, onStatus, onError });
    this.ws = null; this.pending = null; this.queue = []; this.stopping = false; this.retries = 0; this.rotateTimer = null;
  }
  url() {
    const key = encodeURIComponent((Settings.load().geminiKey || '').trim());
    return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${key}`;
  }
  setupMessage() {
    const s = Settings.load();
    const cfg = { languageCodes: s.liveLanguage === 'auto' ? [] : [s.liveLanguage], mode: s.liveMode || 'SMART' };
    if (this.vocab && this.vocab.length) cfg.customVocabulary = this.vocab.slice(0, 100);
    return { setup: { model: 'models/' + s.liveModel, generationConfig: { responseModalities: ['TEXT'] }, inputAudioTranscription: cfg } };
  }
  start() { this.stopping = false; this.open(false); }

  open(isRotation) {
    const ws = new WebSocket(this.url());
    ws._ready = false;
    ws.onopen = () => ws.send(JSON.stringify(this.setupMessage()));
    ws.onmessage = async ev => {
      let raw = ev.data;
      if (raw instanceof Blob) raw = await raw.text();
      let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
      if (msg.setupComplete) {
        ws._ready = true; this.retries = 0;
        if (isRotation && this.ws && this.ws !== ws) {
          const old = this.ws;
          this.ws = ws;
          try { old.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch (e) {}
          setTimeout(() => { old._retired = true; try { old.close(); } catch (e) {} }, 4000);
        } else {
          this.ws = ws;
        }
        this.pending = null;
        this.flushQueue();
        this.onStatus && this.onStatus('live');
        clearTimeout(this.rotateTimer);
        this.rotateTimer = setTimeout(() => this.rotate(), 9 * 60 * 1000);
        return;
      }
      if (msg.goAway) { this.rotate(); return; }
      const sc = msg.serverContent;
      if (sc?.interimInputTranscription?.text) this.onInterim && this.onInterim(sc.interimInputTranscription.text);
      if (sc?.inputTranscription?.text) this.onFinal && this.onFinal(sc.inputTranscription.text);
      if (msg.error) this.onError && this.onError(msg.error.message || JSON.stringify(msg.error));
    };
    ws.onerror = () => { /* 细节在 onclose 里 */ };
    ws.onclose = ev => {
      if (ws._retired || this.stopping) return;
      if (ws === this.pending) this.pending = null;
      if (ws !== this.ws && this.ws) return; // 旧连接正常退休
      if (!ws._ready && ev.code !== 1000) {
        const reason = ev.reason || '';
        if (/API key|PERMISSION|UNAUTHENTICATED|invalid/i.test(reason) || ev.code === 1007 || ev.code === 1008) {
          this.onError && this.onError('Gemini 实时转写连不上：' + (reason || '请检查 API key 和模型名') + `（${ev.code}）`);
          this.onStatus && this.onStatus('error');
          return;
        }
      }
      // 意外断开：自动重连，期间声音先缓存
      this.ws = null;
      this.retries++;
      if (this.retries > 6) { this.onError && this.onError('实时转写多次断开，已停止重连。录音还在继续保存。' + (ev.reason ? '（' + ev.reason + '）' : '')); this.onStatus && this.onStatus('error'); return; }
      this.onStatus && this.onStatus('reconnecting');
      setTimeout(() => { if (!this.stopping) this.open(false); }, Math.min(500 * 2 ** this.retries, 8000));
    };
    if (isRotation) this.pending = ws; else this.ws = ws;
  }
  rotate() {
    if (this.stopping || this.pending) return;
    this.onStatus && this.onStatus('rotating');
    this.open(true);
  }
  sendAudio(int16) {
    const b64 = int16ToB64(int16);
    if (this.ws && this.ws._ready && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm;rate=16000' } } }));
    } else {
      this.queue.push(b64);
      if (this.queue.length > 600) this.queue.shift(); // 最多缓存 60 秒
    }
  }
  flushQueue() {
    while (this.queue.length && this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: this.queue.shift(), mimeType: 'audio/pcm;rate=16000' } } }));
    }
  }
  async stop() {
    this.stopping = true;
    clearTimeout(this.rotateTimer);
    const ws = this.ws;
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch (e) {}
      await new Promise(r => setTimeout(r, 2500)); // 等最后一句转写回来
      try { ws.close(); } catch (e) {}
    }
    try { this.pending && this.pending.close(); } catch (e) {}
  }
}

/* 把转写碎片凑成一句一句，按顺序翻译，术语保持一致 */
class LiveSession {
  constructor({ course, onUpdate, onInterim, onStatus, onError, onLevel }) {
    Object.assign(this, { course, onUpdate, onInterim, onStatus, onError, onLevel });
    this.segments = [];
    this.glossary = {};
    this.buffer = ''; this.bufferStart = null; this.flushTimer = null;
    this.translating = false; this.tq = [];
    this.audioChunks = []; this.audioIdx = 0; this.saveTimer = null;
    this.vocab = [];
  }
  async start() {
    const s = Settings.load();
    if (!s.geminiKey) throw new Error('还没填 Gemini API key，先去「设置」填。');
    // 课程词汇：从这门课已导入的课件里挑
    if (this.course) {
      const files = await DB.byIndex('files', 'courseId', this.course.id);
      this.vocab = Extract.vocabulary(files.map(f => f.text || ''), 100);
      if (this.course.glossary) this.vocab = [...new Set([...this.course.glossary, ...this.vocab])].slice(0, 100);
    }
    this.record = {
      id: DB.uid('s_'), courseId: this.course ? this.course.id : null,
      title: `${new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 课堂录音`,
      startedAt: Date.now(), duration: 0, segments: [], highlights: [], glossary: {}, hasAudio: s.saveAudio,
    };
    this.t0 = Date.now();
    this.transcriber = new LiveTranscriber({
      vocab: this.vocab,
      onInterim: t => this.onInterim && this.onInterim(t),
      onFinal: t => this.addFinal(t),
      onStatus: st => this.onStatus && this.onStatus(st),
      onError: m => this.onError && this.onError(m),
    });
    this.capture = new AudioCapture((pcm, rms) => {
      this.transcriber.sendAudio(pcm);
      this.onLevel && this.onLevel(rms);
      if (s.saveAudio) { this.audioChunks.push(pcm); if (this.audioChunks.length >= 600) this.flushAudio(); }
    });
    await this.capture.start();
    this.transcriber.start();
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch (e) { /* 不支持就算了 */ }
    await DB.put('sessions', this.record);
  }
  elapsed() { return Math.round((Date.now() - this.t0) / 1000); }
  addFinal(text) {
    text = (text || '').trim();
    if (!text) return;
    this.onInterim && this.onInterim('');
    if (!this.buffer) this.bufferStart = this.elapsed();
    this.buffer += (this.buffer ? ' ' : '') + text;
    clearTimeout(this.flushTimer);
    const endsSentence = /[.?!。？！]["')\]]?$/.test(this.buffer);
    if ((endsSentence && this.buffer.length > 40) || this.buffer.length > 280) this.flushBuffer();
    else this.flushTimer = setTimeout(() => this.flushBuffer(), endsSentence ? 1200 : 3500);
  }
  flushBuffer() {
    clearTimeout(this.flushTimer);
    if (!this.buffer.trim()) return;
    const seg = { id: DB.uid('g_'), t: this.bufferStart ?? this.elapsed(), en: this.buffer.trim(), zh: '', status: 'pending', important: false };
    this.buffer = ''; this.bufferStart = null;
    this.segments.push(seg);
    this.tq.push(seg);
    this.emit();
    this.pump();
  }
  /* 翻译节奏：两次请求之间至少隔 gap 毫秒（免费版默认 6 秒 ≈ 每分钟 10 次），
     等待期间新来的句子合并进同一次请求；遇到 429 自动放慢。 */
  async pump() {
    if (this.translating) return;
    this.translating = true;
    if (!this.gap) this.gap = Settings.load().translateGap || 6000;
    while (this.tq.length) {
      const wait = (this.lastCall || 0) + this.gap - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      const batch = this.tq.splice(0, 6);
      batch.forEach(s => { s.status = 'translating'; });
      this.emit();
      const done = this.segments.filter(s => s.status === 'done').slice(-4).map(s => ({ en: s.en, zh: s.zh }));
      this.lastCall = Date.now();
      try {
        const r = await AI.translateBatch({
          items: batch.map((s, i) => ({ id: 's' + i, en: s.en })),
          context: done, glossary: this.glossary, courseName: this.course?.name, vocab: this.vocab,
        });
        const byId = {};
        (r.items || []).forEach(it => { byId[String(it.id).replace(/[<>]/g, '')] = it; });
        batch.forEach((seg, i) => {
          const it = byId['s' + i];
          if (!it) { seg.status = 'failed'; seg.error = '这一句没有返回翻译'; return; }
          seg.zh = (it.zh || '').trim();
          if (it.en_fixed && it.en_fixed.trim() && it.en_fixed.trim() !== seg.en) { seg.raw = seg.en; seg.en = it.en_fixed.trim(); }
          seg.important = !!it.important;
          seg.status = 'done';
        });
        (r.terms || []).forEach(t => { if (t.en && t.zh && !this.glossary[t.en]) this.glossary[t.en] = t.zh; });
        this.gap = Math.max(Settings.load().translateGap || 6000, this.gap * 0.9);
      } catch (e) {
        if (e.status === 429) {
          // 免费额度：放慢节奏，把这批放回队列稍后再翻
          this.gap = Math.min(this.gap * 2, 60000);
          batch.forEach(s => { s.status = 'pending'; });
          this.tq.unshift(...batch);
          this.onStatus && this.onStatus('slow');
          if (this.gap >= 60000) {
            batch.forEach(s => { s.status = 'failed'; s.error = e.message; });
            this.tq.splice(0, batch.length);
            this.onError && this.onError('Gemini 免费额度暂时用完了，翻译先暂停（英文转写还在继续）。可以稍后点句子旁的「重试」。');
          }
        } else {
          batch.forEach(s => { s.status = 'failed'; s.error = e.message; });
          if (e.status === 401 || e.status === 403) this.onError && this.onError(e.message);
        }
      }
      this.emit();
      this.scheduleSave();
    }
    this.translating = false;
  }
  async retry(segId) {
    const seg = this.segments.find(s => s.id === segId);
    if (!seg) return;
    seg.status = 'pending'; this.tq.push(seg); this.emit(); this.pump();
  }
  mark() {
    const t = this.elapsed();
    const last = this.segments[this.segments.length - 1];
    this.record.highlights.push({ t, near: last ? last.en : '' });
    if (last) last.starred = true;
    this.emit(); this.scheduleSave();
    return t;
  }
  emit() { this.onUpdate && this.onUpdate(this.segments); }
  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 1500);
  }
  async save() {
    this.record.segments = this.segments.map(({ id, t, en, zh, raw, important, starred, status }) => ({ id, t, en, zh, raw, important, starred, status }));
    this.record.glossary = this.glossary;
    this.record.duration = this.elapsed();
    await DB.put('sessions', this.record);
  }
  async flushAudio() {
    if (!this.audioChunks.length) return;
    const blob = new Blob(this.audioChunks, { type: 'application/octet-stream' });
    this.audioChunks = [];
    await DB.put('audio', { id: this.record.id + '_' + String(this.audioIdx).padStart(4, '0'), sessionId: this.record.id, idx: this.audioIdx++, blob });
  }
  async stop() {
    this.capture && this.capture.stop();
    await (this.transcriber && this.transcriber.stop());
    this.flushBuffer();
    // 等翻译队列跑完（最多 20 秒）
    const until = Date.now() + 20000;
    while ((this.translating || this.tq.length) && Date.now() < until) await new Promise(r => setTimeout(r, 300));
    await this.flushAudio();
    await this.save();
    try { this.wake && this.wake.release(); } catch (e) {}
    return this.record;
  }
}

/* 把保存的 PCM 拼成 WAV，方便下载回听 */
async function sessionWav(sessionId) {
  const parts = (await DB.byIndex('audio', 'sessionId', sessionId)).sort((a, b) => a.idx - b.idx);
  if (!parts.length) return null;
  const size = parts.reduce((n, p) => n + p.blob.size, 0);
  const h = new DataView(new ArrayBuffer(44));
  const w = (o, s) => [...s].forEach((c, i) => h.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); h.setUint32(4, 36 + size, true); w(8, 'WAVE'); w(12, 'fmt ');
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, 16000, true); h.setUint32(28, 32000, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  w(36, 'data'); h.setUint32(40, size, true);
  return new Blob([h.buffer, ...parts.map(p => p.blob)], { type: 'audio/wav' });
}
