/* 课堂实时转写 + 翻译
   流程：麦克风 → 16kHz PCM（每 100ms 一块）→ Gemini Live 转写（gemini-3.5-transcribe-live，带课程词汇表）
        → 每凑够一句 → Gemini Flash-Lite 结合前文和术语表翻成中文 → 存进本机。
   Gemini Live 单次连接最长 10 分钟：到 9 分钟自动无缝换一条新连接，中间的声音先缓存不丢。 */

const WORKLET_SRC = `
/* 降到 16kHz 前先低通：直接平均相邻采样挡不住 8kHz 以上的声音，它们会折回语音频段，
   s / f / t 这些辅音就糊了。这里用带 Hann 窗的 sinc 滤波，44.1k 这种非整数倍也按小数位置取值。 */
class PCM16 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000; this.out = new Int16Array(1600); this.n = 0; this.sq = 0;
    const P = this.P = 32, half = this.half = Math.max(8, Math.ceil(this.ratio * 8)), c = Math.min(.5, 7200 / sampleRate);
    this.table = Array.from({ length: P }, (_, ph) => {
      const h = new Float32Array(2 * half); let sum = 0;
      for (let k = 0; k < 2 * half; k++) {
        const x = k - half + 1 - ph / P, a = 2 * Math.PI * c * x;
        const w = Math.abs(x) < half ? .5 + .5 * Math.cos(Math.PI * x / half) : 0;
        h[k] = (x === 0 ? 2 * c : Math.sin(a) / (Math.PI * x)) * w; sum += h[k];
      }
      for (let k = 0; k < 2 * half; k++) h[k] /= sum;
      return h;
    });
    this.size = 2 * half + 8; this.buf = new Float32Array(this.size); this.count = 0; this.at = half;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    const { buf, size, half, P, table } = this;
    for (let i = 0; i < ch.length; i++) {
      buf[this.count % size] = ch[i]; this.count++;
      while (this.at + half + 1 < this.count) {
        let c0 = Math.floor(this.at), ph = Math.round((this.at - c0) * P);
        if (ph === P) { ph = 0; c0++; }
        const h = table[ph]; let v = 0;
        for (let k = 0; k < 2 * half; k++) v += buf[(c0 + k - half + 1) % size] * h[k];
        this.at += this.ratio;
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

/* 录什么：mic = 麦克风（默认）；system = 电脑里播放的声音（上网课）；both = 两个混在一起（网课上自己也要发言）
   只有桌面版能录电脑声音；网页版 / iPad 一律当麦克风。 */
function sysAudioMode() { try { return (window.tkDesktop && tkDesktop.sysAudio && tkDesktop.sysAudio.mode) || 'none'; } catch (e) { return 'none'; } }
function audioSource() {
  let v = 'mic'; try { v = Settings.load().audioSource || 'mic'; } catch (e) {}
  if (v !== 'system' && v !== 'both') return 'mic';
  return sysAudioMode() === 'none' ? 'mic' : v;
}
const AUDIO_SOURCE_LABEL = { mic: '麦克风', system: '电脑里的声音', both: '麦克风 + 电脑声音' };
/* 录音页 / 工作台共用的「录什么」选择。网页版、iPad 不显示（录不了电脑声音） */
function audioSourcePickerHTML(id) {
  if (sysAudioMode() === 'none') return '';
  const cur = audioSource();
  const opts = [['mic', '🎙 麦克风', '在教室上课'], ['system', '💻 电脑里的声音', '上网课：录 Zoom、Teams、浏览器里放的声音'], ['both', '🎙＋💻 两个一起', '网课上你也要发言']];
  return `<div class="field asrc"><label>录什么</label><div class="seg" id="${id}" role="radiogroup" aria-label="录什么">${opts.map(([v, l, t]) => `<button type="button" data-asrc="${v}" class="${cur === v ? 'on' : ''}" title="${t}">${l}</button>`).join('')}</div>
    <span class="hint">${cur === 'mic' ? '录麦克风收到的声音。' : cur === 'system' ? '直接录电脑正在播放的声音，不用外放，戴耳机也行。' : '电脑声音和你的麦克风混在一起录。'}${cur !== 'mic' && sysAudioMode() === 'helper' ? '第一次用时 macOS 会问能不能录制系统声音，点「允许」。' : ''}</span></div>`;
}
function bindAudioSourcePicker(root, id, after) {
  const box = root.querySelector('#' + id); if (!box) return;
  box.querySelectorAll('[data-asrc]').forEach(b => b.onclick = () => { Settings.save({ audioSource: b.dataset.asrc }); after && after(); });
}
/* 只录电脑声音时不用麦克风，开始前别去查麦克风权限 */
const needsMic = () => audioSource() !== 'system';
/* 电脑声音没开起来的错误：给一句能照着做的话 */
function sysAudioHelp(e) {
  const m = String((e && e.message) || e || '');
  if (/权限|permission|denied|-?\d{3,}/i.test(m) && sysAudioMode() === 'helper') return '没能录到电脑声音：' + m + '。请到「系统设置 → 隐私与安全性 → 录屏与系统录音」里打开听课本，然后重新开始。';
  return '没能录到电脑声音：' + m;
}

/* 只录英文：录音的唯一用途是课后整理笔记，实时中文翻译用别的软件就够了 */
function liveEnglishOnly() { try { return Settings.load().liveEnglishOnly !== false; } catch (e) { return true; } }

class AudioCapture {
  constructor(onChunk, onLost) { this.onChunk = onChunk; this.onLost = onLost; }
  async start() {
    this.stopped = false;
    this.source = audioSource();
    this.mixQ = [];   // Mac 电脑声音：助手送来的 16k 样本先排队，和麦克风一块一块对齐着混
    if (this.source !== 'mic' && sysAudioMode() === 'helper') await this.startHelper();
    if (this.source === 'system' && sysAudioMode() === 'helper') return;   // 只录电脑声音：不用开麦克风
    if (this.source !== 'mic' && sysAudioMode() === 'loopback') {
      // Windows：系统声音走 getDisplayMedia（主进程直接给 loopback），画面那一路马上关掉
      const ds = await navigator.mediaDevices.getDisplayMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: true });
      ds.getVideoTracks().forEach(t => t.stop());
      if (!ds.getAudioTracks().length) throw Object.assign(new Error('没拿到电脑的声音。'), { name: 'SysAudioError' });
      this.sysStream = ds;
      ds.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (!this.stopped && this.onLost) this.onLost('system'); }));
    }
    if (this.source === 'system') { await this.startGraph(null); return; }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: Object.assign({ channelCount: 1, echoCancellation: false, noiseSuppression: !Settings.load().micRaw, autoGainControl: true }, Settings.load().micId ? { deviceId: { ideal: Settings.load().micId } } : {}),
    });
    // 麦克风中途没了（AirPods 断开、拔掉耳机、系统换了输入设备）：以前没人知道，界面还显示在录，其实后面全是空的
    this.stream.getAudioTracks().forEach(t => t.addEventListener('ended', () => { if (!this.stopped && this.onLost) this.onLost('mic'); }));
    await this.startGraph(this.stream);
  }
  /* Mac：启动 tkb-syscap 助手，等它说 READY（最多 6 秒）。第一次用时 macOS 会弹窗要「录制系统声音」的权限 */
  async startHelper() {
    const sa = tkDesktop.sysAudio;
    this.offData = sa.onData(buf => this.onHelperData(new Int16Array(buf)));
    let ready, failed;
    const wait = new Promise((res, rej) => { ready = res; failed = rej; });
    this.offStatus = sa.onStatus(line => {
      if (/^READY/.test(line)) ready();
      else if (/^LEVEL\s/.test(line)) this.sysLevel = Number(line.split(/\s+/)[1]) || 0;
      else if (/^ERROR/.test(line)) { const m = line.replace(/^ERROR\s*/, ''); this.helperErr = m; failed(Object.assign(new Error(m), { name: 'SysAudioError' })); }
      else if (/^EXIT/.test(line)) { failed(Object.assign(new Error(this.helperErr || '电脑声音采集意外退出了'), { name: 'SysAudioError' })); if (!this.stopped && this.helperOn && this.onLost) this.onLost('system'); this.helperOn = false; }
    });
    const r = await sa.start();
    if (!r || !r.ok) { this.cleanHelper(); throw Object.assign(new Error((r && r.error) || '电脑声音采集启动失败'), { name: 'SysAudioError' }); }
    try { await Promise.race([wait, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('电脑声音采集 6 秒没有响应。第一次用请在弹出的窗口里点「允许」，然后再点一次开始。'), { name: 'SysAudioError' })), 6000))]); }
    catch (e) { this.cleanHelper(); throw e; }
    this.helperOn = true;
  }
  cleanHelper() {
    this.helperOn = false;
    try { this.offData && this.offData(); } catch (e) {}
    try { this.offStatus && this.offStatus(); } catch (e) {}
    this.offData = this.offStatus = null;
    try { tkDesktop.sysAudio.stop(); } catch (e) {}
  }
  /* 助手送来的 PCM：只录电脑声音时每 1600 个样本交出去；和麦克风一起录时先排队，等麦克风那一块来了再混 */
  onHelperData(int16) {
    if (this.stopped) return;
    if (this.source === 'both') {
      for (let i = 0; i < int16.length; i++) this.mixQ.push(int16[i]);
      if (this.mixQ.length > 16000 * 3) this.mixQ.splice(0, this.mixQ.length - 16000 * 3);   // 最多压 3 秒，免得越积越多、对不上
      return;
    }
    if (this.pend && this.pend.length) { const m = new Int16Array(this.pend.length + int16.length); m.set(this.pend); m.set(int16, this.pend.length); this.pend = m; } else this.pend = int16;
    while (this.pend.length >= 1600) {
      const out = this.pend.slice(0, 1600); this.pend = this.pend.slice(1600);
      let sq = 0; for (let i = 0; i < out.length; i++) { const v = out[i] / 32768; sq += v * v; }
      this.onChunk(out, Math.sqrt(sq / 1600));
    }
  }
  /* 麦克风一块（1600 个样本）+ 排队里同样多的电脑声音，相加后限幅 */
  mix(pcm) {
    if (this.source !== 'both' || sysAudioMode() !== 'helper') return null;
    const out = new Int16Array(pcm.length); let sq = 0;
    const n = Math.min(pcm.length, this.mixQ.length), sys = this.mixQ.splice(0, n);
    for (let i = 0; i < pcm.length; i++) {
      const v = Math.max(-32768, Math.min(32767, pcm[i] + (i < n ? sys[i] : 0)));
      out[i] = v; const f = v / 32768; sq += f * f;
    }
    return { pcm: out, rms: Math.sqrt(sq / pcm.length) };
  }
  /* 把一个或两个声音源接进降采样的 worklet（Windows 的电脑声音也在这里一起混） */
  async startGraph(micStream) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    const streams = [micStream, this.sysStream].filter(Boolean);
    this.srcs = streams.map(st => this.ctx.createMediaStreamSource(st));
    this.src = this.srcs[0];
    if (this.ctx.audioWorklet) {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      this.node = new AudioWorkletNode(this.ctx, 'pcm16');
      this.node.port.onmessage = e => { const m = this.mix(e.data.pcm); if (m) this.onChunk(m.pcm, m.rms); else this.onChunk(e.data.pcm, e.data.rms); };
      this.srcs.forEach(x => x.connect(this.node));
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
          const m = this.mix(out); if (m) this.onChunk(m.pcm, m.rms); else this.onChunk(out, Math.sqrt(sq / 1600));
        }
      };
      this.srcs.forEach(x => x.connect(this.node)); this.node.connect(this.ctx.destination);
    }
  }
  /* 切到别的 App 再回来、来电话之后，音频可能被系统暂停：回来时接着跑 */
  wake() { try { if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume(); } catch (e) {} }
  stop() {
    this.stopped = true;
    if (this.helperOn || this.offData) this.cleanHelper();
    try { (this.srcs || []).forEach(x => x.disconnect()); } catch (e) {}
    try { this.sysStream && this.sysStream.getTracks().forEach(t => t.stop()); } catch (e) {}
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
  start() {
    this.stopping = false; this.open(false);
    // 网络回来了就马上连，不等下一次定时重试
    this._online = () => { if (!this.stopping && !this.ws) { clearTimeout(this.retryTimer); this.open(false); } };
    window.addEventListener('online', this._online);
  }
  /* 连接看着还在、其实已经不通了（合盖再打开、换了 Wi-Fi）：不等它自己报断开，直接换一条新的 */
  kick() {
    if (this.stopping) return;
    const old = this.ws;
    if (old) { old._retired = true; try { old.close(); } catch (e) {} }
    this.ws = null;
    clearTimeout(this.retryTimer);
    this.onStatus && this.onStatus('reconnecting');
    this.open(false);
  }
  stalled() { const ws = this.ws; return !!(ws && ws.readyState === 1 && ws.bufferedAmount > 2000000); }
  ready() { const ws = this.ws; return !!(ws && ws._ready && ws.readyState === 1); }

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
      if (ws === this.pending) {
        this.pending = null;
        // 换线没换成：旧连接还在用，过几秒再换一次。以前这里就不再试了，旧连接到 10 分钟被服务器掐掉，中间会漏一小段
        if (this.ws && this.ws !== ws) { clearTimeout(this.rotateTimer); this.rotateTimer = setTimeout(() => this.rotate(), 8000); return; }
      }
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
      // 以前连续断 6 次（大约半分钟）就永久放弃，教室 Wi-Fi 掉一下，后面整节课都没有转写。
      // 现在一直重连：前几次很快，之后每 10 秒一次；只在第 7 次时提醒一句。
      if (this.retries === 7) this.onError && this.onError('实时转写断开了，正在每 10 秒重连一次，网络恢复后会自动接上。录音还在继续保存。' + (ev.reason ? '（' + ev.reason + '）' : ''));
      this.onStatus && this.onStatus('reconnecting');
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => { if (!this.stopping && !this.ws) this.open(false); }, this.retries > 6 ? 10000 : Math.min(500 * 2 ** this.retries, 8000));
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
    clearTimeout(this.rotateTimer); clearTimeout(this.retryTimer);
    if (this._online) window.removeEventListener('online', this._online);
    const ws = this.ws;
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); } catch (e) {}
      await new Promise(r => setTimeout(r, 2500)); // 等最后一句转写回来
      try { ws.close(); } catch (e) {}
    }
    try { this.pending && this.pending.close(); } catch (e) {}
  }
}

const splitWords = t => t.split(/\s+/).filter(Boolean);
const normWord = w => w.toLowerCase().replace(/[^a-z0-9]/g, '');
const sameStart = (a, b) => {
  const x = splitWords(a).slice(0, 3).map(normWord).join(' '), y = splitWords(b).slice(0, 3).map(normWord).join(' ');
  return x === y || y.startsWith(x) || x.startsWith(y);
};

/* 把转写碎片凑成一句一句，按顺序翻译，术语保持一致 */
/* 翻译节奏。min=凑够几句一起翻，hold=最多等多久(ms)，max=一批最多几句，gap=两次请求最少间隔，ctx=带几句前文，lean=精简提示词 */
/* 老师强调的话：自动标成重点 */
const EMPHASIS = /\b(exam|final|mid-?term|test|quiz|assessment|assignment|due|deadline|submit|marks?|grade|important|remember (this|that)|make sure|don'?t forget|key point|will be (tested|examined|asked)|must know|pay attention)\b/i;

const PACE = {
  fast:     { min: 1, hold: 0,    max: 3, gap: 0,    ctx: 4, lean: false },
  balanced: { min: 2, hold: 4500, max: 4, gap: 1200, ctx: 3, lean: true },
  saver:    { min: 3, hold: 8000, max: 6, gap: 3000, ctx: 2, lean: true },
};

class LiveSession {
  constructor({ course, onUpdate, onInterim, onStatus, onError, onLevel, onQuiet, resume }) {
    Object.assign(this, { course, onUpdate, onInterim, onStatus, onError, onLevel, onQuiet, resume });
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
      // 词表只放得下约 100 个：这节课用的课件先占位，其余才从整门课里补
      const focus = files.find(f => f.id === this.focusFileId);
      const near = focus && focus.text ? Extract.vocabulary([focus.text], 60) : [];
      this.vocab = [...new Set([...near, ...Extract.vocabulary(files.map(f => f.text || ''), 100)])].slice(0, 100);
      if (this.course.glossary) this.vocab = [...new Set([...this.course.glossary, ...this.vocab])].slice(0, 100);
      // 课前包里的术语表：这节课用的课件优先，英文进识别词表，中文译法直接定死
      const prepped = files.filter(f => f.prep && f.prep.terms).sort((a, b) => (b.id === this.focusFileId) - (a.id === this.focusFileId));
      const terms = prepped.flatMap(f => f.prep.terms).slice(0, 120);
      if (terms.length) {
        this.vocab = [...new Set([...terms.slice(0, 60).map(t => t.en), ...this.vocab])].slice(0, 100);
        this.seedGlossary = {}; terms.slice(0, 60).forEach(t => { this.seedGlossary[t.en] = t.zh; });
      }
    }
    // 同一门课同一天录第二段时，标题带上时间，列表里一眼能分清
    const hm = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const today = new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
    this.record = {
      id: DB.uid('s_'), courseId: this.course ? this.course.id : null,
      title: `${today} ${hm} 课堂录音`,
      startedAt: Date.now(), duration: 0, segments: [], highlights: [], confused: [], glossary: {}, hasAudio: s.saveAudio, audioSource: audioSource(),
    };
    if (this.seedGlossary) Object.assign(this.glossary, this.seedGlossary);
    this.t0 = Date.now();
    // 接着上一段录：同一条录音记录，时间轴从上次结束的地方往后走，录音文件按顺序接在后面（不再分成新的一段）
    if (this.resume && this.resume.id) {
      const r = this.resume;
      this.segments = (r.segments || []).map(x => Object.assign({}, x));
      this.record = Object.assign({}, r, { segments: r.segments || [], highlights: r.highlights || [], confused: r.confused || [], glossary: r.glossary || {}, hasAudio: r.hasAudio || s.saveAudio, resumedAt: (r.resumedAt || []).concat(Date.now()) });
      Object.assign(this.glossary, r.glossary || {});
      const prev = Math.max(r.duration || 0, ...this.segments.map(g => (g.t || 0) + 5), 0);
      this.t0 = Date.now() - prev * 1000;
      try { this.audioIdx = (await DB.byIndex('audio', 'sessionId', r.id)).length; } catch (e) {}
    }
    this.transcriber = new LiveTranscriber({
      vocab: this.vocab,
      onInterim: t => this.onDraft(t),
      onFinal: t => this.onFinalText(t),
      onStatus: st => this.onStatus && this.onStatus(st),
      onError: m => this.onError && this.onError(m),
    });
    const onChunk = (pcm, rms) => {
      this.transcriber.sendAudio(pcm);
      this.onLevel && this.onLevel(rms);
      if (rms > 0.02) this.loudNoText = (this.loudNoText || 0) + 1;   // 明显有人在说话、却一直没出字的时长（每块 0.1 秒）
      // 声音够响就算「在说话」，用来判断老师有没有停顿（只录英文时按停顿断句）
      if (rms > 0.008) { this.lastLoudAt = Date.now(); this.heard(); }
      if (s.saveAudio) { this.audioChunks.push(pcm); if (this.audioChunks.length >= 600) this.flushAudio(); }
    };
    // 麦克风中途断了：自动重新打开一次（会用系统当前的输入设备），打不开就明说
    const onLost = async which => {
      if (this.stopped || this.reopening) return;
      this.reopening = true;
      this.onError && this.onError(which === 'system' ? '电脑声音采集断开了，正在重新打开…' : '麦克风断开了（耳机没电 / 拔掉了？），正在重新打开…');
      try { this.capture.stop(); } catch (e) {}
      await new Promise(r => setTimeout(r, 800));
      try {
        if (this.stopped) return;
        const cap = new AudioCapture(onChunk, onLost);
        await cap.start();
        if (this.stopped) { cap.stop(); return; }
        this.capture = cap;
        this.onError && this.onError((which === 'system' ? '电脑声音' : '麦克风') + '重新接上了，继续录。中间断开的那几秒没有录到。');
      } catch (e) {
        this.onError && this.onError((which === 'system' ? '电脑声音' : '麦克风') + '断开后重新打不开：' + (e.message || e) + '。现在没有在录音，请停止后再重新开始。');
        this.onStatus && this.onStatus('error');
      } finally { this.reopening = false; }
    };
    this.capture = new AudioCapture(onChunk, onLost);
    await this.capture.start();
    this.transcriber.start();
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch (e) { /* 不支持就算了 */ }
    // 切走再回来：屏幕常亮会被系统收回，音频也可能被暂停，回来时都补上（iPad 上最常见）
    this._vis = async () => {
      if (this.stopped || document.visibilityState !== 'visible') return;
      this.capture && this.capture.wake();
      try { this.wake = await navigator.wakeLock?.request('screen'); } catch (e) {}
    };
    document.addEventListener('visibilitychange', this._vis);
    this.lastTextAt = Date.now(); this.loudNoText = 0; this.lastKickAt = 0;
    this.watchQuiet();
    this.watchSegments();
    await DB.put('sessions', this.record);
  }
  elapsed() { return Math.round((Date.now() - this.t0) / 1000); }
  /* 静音看门狗（借鉴 Otter 的 NO_SPEECH 计时）：
     下课了忘了点停止、或者麦克风被系统静音，会一直录下去——两个半小时的空录音很常见。
     这里不自动停（自动停了万一只是老师在看视频就更糟），只到点提醒一次，人来决定。 */
  watchQuiet() {
    this.lastVoiceAt = Date.now();
    this.quietWarned = false;
    this.quietSnoozeUntil = 0;
    clearInterval(this.quietTimer);
    this.quietTimer = setInterval(() => {
      if (this.stopped) return;
      // 连接假死：数据发不出去越积越多，或者明明一直有人说话（累计 30 秒以上）却 1 分钟没出一个字 → 换一条连接。3 分钟内最多换一次。
      const tr = this.transcriber;
      if (tr && Date.now() - this.lastKickAt > 180000 && (tr.stalled() || (tr.ready() && this.loudNoText >= 300 && Date.now() - this.lastTextAt > 60000))) {
        this.lastKickAt = Date.now(); this.loudNoText = 0; tr.kick();
      }
      if (Date.now() < this.quietSnoozeUntil) return;
      const mins = Math.floor((Date.now() - this.lastVoiceAt) / 60000);
      if (mins >= 10 && !this.quietWarned) {
        this.quietWarned = true;
        this.onQuiet && this.onQuiet(mins);
      }
    }, 30000);
  }
  heard() { this.lastVoiceAt = Date.now(); this.quietWarned = false; }

  /* ---------- 只录英文时的自然断句 ----------
     以前为了尽快翻译，草稿攒到十几个词就急着切，切口经常落在词组中间（"because the" / "which is"）。
     现在录音只用来整理笔记，不需要抢时间，所以改成按「说话人真的停了」来断：
       · 音量掉下去 0.7 秒 = 老师停顿 → 在停顿处（优先逗号后）收一句
       · 定稿（Gemini 在停顿后给的 final）自带标点 → 直接在 . ? ! 处切
       · 一直不停口：讲满 14 秒、攒够 26 个词才在逗号处切一段，不硬切
     翻译模式（关掉「只录英文」）还是走原来的快速切分。 */
  watchSegments() {
    clearInterval(this.segTimer);
    this.lastLoudAt = Date.now();
    this.segTimer = setInterval(() => {
      if (this.stopped) { clearInterval(this.segTimer); return; }
      if (!liveEnglishOnly() || !this.turn) return;
      const pending = splitWords(this.turn.text).length - this.turn.committed;
      if (pending < 3) return;
      const quietFor = Date.now() - (this.lastLoudAt || 0);
      if (quietFor >= 700) { this.cutNatural('pause'); this.showDraft(); return; }
      if (pending >= 26 && Date.now() - (this.turn.startAt || Date.now()) > 14000) { this.cutNatural('long'); this.showDraft(); }
    }, 200);
  }
  /* 定稿里自带标点：按句子切开，碎句并到前一句 */
  commitSentenceWords(words) {
    const parts = [];
    let cur = [];
    for (const w of words) {
      cur.push(w);
      if (/[.?!]["')\]]?$/.test(w) && cur.length >= 3) { parts.push(cur); cur = []; }
    }
    if (cur.length) parts.push(cur);
    if (parts.length > 1 && parts[parts.length - 1].length < 4) parts[parts.length - 2] = parts[parts.length - 2].concat(parts.pop());
    for (const part of parts) this.commitWords(part);
  }
  cutNatural(reason) {
    if (!this.turn) return;
    const rest = splitWords(this.turn.text).slice(this.turn.committed);
    if (!rest.length) return;
    if (reason === 'force') { this.commitSentenceWords(rest); return; }
    if (rest.length < 3) return;
    let cut = rest.length - 1;
    if (reason === 'pause') {
      // 停顿前最后几个词里挑一个逗号收尾，句子更像人说的
      for (let k = rest.length - 1; k >= Math.max(2, rest.length - 7); k--) if (/[,;:]$/.test(rest[k])) { cut = k; break; }
    } else {
      // 讲了很久没停：切在整句中间偏后的逗号处
      cut = Math.min(rest.length - 1, Math.max(8, Math.round(rest.length * .7)));
      for (let k = cut; k >= 6; k--) if (/[,;:]$/.test(rest[k])) { cut = k; break; }
    }
    this.commitWords(rest.slice(0, cut + 1));
  }
  /* Gemini 实时转写的规律（实测）：讲者不停顿时，只有一份一直变长的“草稿”(interim)，
     要等讲者停下来才给一次“定稿”(final)，一段可能长达一分钟。
     所以直接从草稿里切句子：一句话后面已经接着说了几个词，这句就不会再变了，马上拿去翻译。 */
  onDraft(t) {
    t = (t || '').trim();
    if (!t) return;
    this.heard(); this.lastTextAt = Date.now(); this.loudNoText = 0;
    // 草稿从头换了内容 = 新的一段开始了；上一段没切完的先收尾
    if (this.turn && !sameStart(this.turn.text, t)) { this.commitWords(splitWords(this.turn.text).slice(this.turn.committed)); this.turn = null; }
    if (!this.turn) this.turn = { text: '', committed: 0, tail: [], pendingSince: Date.now() };
    this.turn.text = t;
    if (this.turn.startAt == null) this.turn.startAt = Date.now();
    this.showDraft();
    clearTimeout(this.stableTimer);
    if (liveEnglishOnly()) {
      // 草稿只是因为停顿才停下来的（1.4 秒没再变长），这时候收一句最自然
      this.stableTimer = setTimeout(() => { if (this.turn) { this.cutNatural('pause'); this.showDraft(); } }, 1400);
      return;
    }
    this.cutSentences(false);
    // 讲者停顿了一会儿：剩下的半句也先翻
    this.stableTimer = setTimeout(() => { if (this.turn) { this.cutSentences(true); this.showDraft(); } }, 800);
  }
  cutSentences(force) {
    const words = splitWords(this.turn.text);
    let rest = words.slice(this.turn.committed);
    while (rest.length) {
      if (force) { this.commitWords(rest); return; }
      let cut = -1, chars = 0;
      for (let i = 0; i < rest.length; i++) {
        chars += rest[i].length + 1;
        const endsSentence = /[.?!]["')\]]?$/.test(rest[i]);
        // 句子结束，后面已经开始说下一句（≥1 个词），而且这句不是太短（太短就和下一句合并）
        if (endsSentence && rest.length - i - 1 >= 1 && chars >= 15) { cut = i; break; }
        // 一直没有句号：太长就在逗号处切
        if (i >= 34 && rest.length - i - 1 >= 3) {
          let j = i; while (j > 12 && !/[,;:]$/.test(rest[j])) j--;
          cut = j > 12 ? j : i; break;
        }
      }
      // 长从句：已经有 10 个词以上、逗号后又说了 2 个词、等了 2.5 秒还没句号，就先在逗号处翻
      if (cut < 0 && Date.now() - this.turn.pendingSince > 2500) {
        for (let k = rest.length - 3; k >= 9; k--) if (/[,;:]$/.test(rest[k])) { cut = k; break; }
      }
      // 老师一直讲没有句号：超过设定秒数就强制翻一次（优先在逗号处切，最后两三个词留着等下文）
      if (cut < 0) {
        const maxWait = (Settings.load().maxWaitSec || 6) * 1000;
        if (rest.length >= 6 && Date.now() - this.turn.pendingSince > maxWait) {
          let j = rest.length - 3; while (j >= 3 && !/[,;:]$/.test(rest[j])) j--;
          cut = j >= 3 ? j : rest.length - 3;
        } else return;
      }
      this.commitWords(rest.slice(0, cut + 1));
      rest = rest.slice(cut + 1);
    }
  }
  commitWords(ws) {
    if (!ws.length) return;
    if (this.turn) { this.turn.committed += ws.length; this.turn.tail = ws.slice(-4).map(normWord); this.turn.pendingSince = Date.now(); }
    const text = ws.join(' ').trim();
    if (!text || !/[a-z0-9]/i.test(text)) return;
    const seg = { id: DB.uid('g_'), t: Math.max(0, this.elapsed() - Math.round(ws.length * 0.35) - 1), en: text, zh: '', status: 'pending', important: EMPHASIS.test(text) };
    this.draftVer = (this.draftVer || 0) + 1; this.draftZh = ''; this.draftFor = '';
    // 只录英文：这句直接算完成，不排队翻译、不花任何额度
    // 也要存盘：以前只有翻译完才存，「只录英文」（默认）下整节课的文字都只在内存里，中途闪退 / 刷新就全没了，只有点了「停止」才写进去
    if (liveEnglishOnly()) { seg.status = 'done'; this.segments.push(seg); this.emit(); this.scheduleSave(); return; }
    // 草稿基本就是这一句的话，先把草稿中文挂上，正式翻译出来前不会空白
    const dw = splitWords(this.draftFor || '').length;
    if (this.draftZh && dw && ws.length >= dw * 0.75 && ws.length <= dw * 1.6) seg.zhDraft = this.draftZh;
    this.segments.push(seg);
    seg.queuedAt = Date.now();
    this.tq.push(seg);
    this.emit();
    this.pump();
  }
  /* 定稿到了：只把还没切过的部分补上（定稿的标点和数字格式可能跟草稿略有不同，用最后几个词对齐） */
  onFinalText(t) {
    t = (t || '').trim();
    clearTimeout(this.stableTimer);
    if (!t) return;
    this.heard(); this.lastTextAt = Date.now(); this.loudNoText = 0;
    const words = splitWords(t);
    let start = 0;
    if (this.turn && this.turn.committed) {
      const norm = words.map(normWord), tail = this.turn.tail;
      start = Math.min(this.turn.committed, words.length);
      for (let i = norm.length - tail.length; i >= 0; i--) {
        if (tail.every((w, k) => norm[i + k] === w)) { start = i + tail.length; break; }
      }
    }
    if (liveEnglishOnly()) this.commitSentenceWords(words.slice(start));
    else this.commitWords(words.slice(start));
    this.turn = null;
    this.showDraft();
  }
  /* 草稿字幕：还没说完的这半句，英文实时显示，中文大约每秒更新一次（灰色），整句定下来后换成正式翻译 */
  showDraft() {
    const en = this.turn ? splitWords(this.turn.text).slice(this.turn.committed).join(' ') : '';
    if (en !== this.draftEn) { this.draftEn = en; if (!en) { this.draftZh = ''; this.draftVer = (this.draftVer || 0) + 1; } }
    this.paintDraft();
    this.kickDraft();
  }
  paintDraft() { this.onInterim && this.onInterim({ en: this.draftEn || '', zh: this.draftZh || '' }); }
  draftOn() {
    if (liveEnglishOnly()) return false;
    const s = Settings.load(), mode = s.draftMode || 'free';
    if (mode === 'off') return false;
    if (mode === 'free') return AI.localReady();
    return !!s.deepseekKey;
  }
  async kickDraft() {
    if (!this.draftOn() || this.draftBusy || this.stopped) return;
    const en = this.draftEn;
    if (!en || splitWords(en).length < 3 || en === this.draftFor) return;
    const gap = (Settings.load().draftMode || 'free') === 'free' ? 300 : 900;
    const wait = (this.draftLast || 0) + gap - Date.now();
    if (wait > 0) { clearTimeout(this.draftTimer); this.draftTimer = setTimeout(() => this.kickDraft(), wait); return; }
    this.draftBusy = true; this.draftLast = Date.now(); this.draftFor = en;
    const ver = this.draftVer = (this.draftVer || 0) + 1;
    try {
      const ctx = this.segments.filter(s => s.status === 'done').slice(-2).map(s => ({ en: s.en, zh: s.zh }));
      const full = await AI.translateDraft({
        text: en, context: ctx, glossary: this.glossary, courseName: this.course?.name,
        // 新草稿还没比旧的长时先不换，避免字幕“缩回去再长出来”地闪
        onPartial: zh => { if (ver === this.draftVer && zh.length >= (this.draftZh || '').length) { this.draftZh = zh; this.paintDraft(); } },
      });
      if (ver === this.draftVer && full) { this.draftZh = full; this.paintDraft(); }
    } catch (e) { /* 草稿翻译失败不影响正式翻译 */ }
    this.draftBusy = false;
    if (this.draftEn && this.draftEn !== this.draftFor) this.kickDraft();
  }
  flushBuffer() {
    // 停止录音时：草稿里剩下的也收掉
    clearTimeout(this.stableTimer);
    if (!this.turn) return;
    if (liveEnglishOnly()) this.cutNatural('force'); else this.cutSentences(true);
    this.turn = null;
  }
  /* 翻译节奏：两次请求之间至少隔 gap 毫秒（免费版默认 6 秒 ≈ 每分钟 10 次），
     等待期间新来的句子合并进同一次请求；遇到 429 自动放慢。 */
  async pump() {
    if (this.translating) return;
    this.translating = true;
    // 翻译节奏：极速 = 一句一翻；均衡 = 凑够 2 句或等 2.5 秒；省额度 = 凑够 3 句或等 5 秒
    const P = PACE[Settings.load().translatePace] || PACE.balanced;
    const minGap = P.gap;
    if (this.gap == null || this.gap < minGap) this.gap = minGap;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    while (this.tq.length) {
      const wait = (this.lastCall || 0) + this.gap - Date.now();
      if (wait > 0) await sleep(wait);
      // 句子还不够一批、也没等太久：再等等，让后面的句子一起翻（停止录音时不等）
      const age = Date.now() - (this.tq[0].queuedAt || 0);
      if (!this.stopped && this.tq.length < P.min && age < P.hold) { await sleep(Math.min(250, P.hold - age)); continue; }
      const batch = this.tq.splice(0, P.max);
      batch.forEach(s => { s.status = 'translating'; });
      this.emit();
      const done = this.segments.filter(s => s.status === 'done').slice(-P.ctx).map(s => ({ en: s.en, zh: s.zh }));
      this.lastCall = Date.now();
      let lastPaint = 0;
      try {
        const r = await AI.translateBatch({
          items: batch.map((s, i) => ({ id: 's' + i, en: s.en })),
          context: done, glossary: this.glossary, courseName: this.course?.name, vocab: this.vocab, lean: P.lean,
          // 流式：中文一边出来一边显示
          onPartial: zh => {
            batch.forEach((seg, i) => { if (zh['s' + i]) { seg.zh = zh['s' + i]; seg.status = 'streaming'; } });
            if (Date.now() - lastPaint > 120) { lastPaint = Date.now(); this.emit(); }
          },
        });
        const byId = {};
        (r.items || []).forEach(it => { byId[String(it.id).replace(/[<>]/g, '')] = it; });
        batch.forEach((seg, i) => {
          const it = byId['s' + i];
          if (!it) { seg.status = 'failed'; seg.error = '这一句没有返回翻译'; return; }
          seg.zh = (it.zh || '').trim();
          if (it.en_fixed && it.en_fixed.trim() && it.en_fixed.trim() !== seg.en) { seg.raw = seg.en; seg.en = it.en_fixed.trim(); }
          seg.important = seg.important || !!it.important;
          seg.by = r.provider;
          seg.status = 'done';
        });
        (r.terms || []).forEach(t => { if (t.en && t.zh && !this.glossary[t.en]) this.glossary[t.en] = t.zh; });
        this.gap = Math.max(minGap, this.gap * 0.9);
      } catch (e) {
        if (e.status === 429) {
          // 额度到了：放慢节奏，把这批放回队列稍后再翻
          this.gap = Math.min(Math.max(this.gap, 3000) * 2, 60000);
          batch.forEach(s => { s.status = 'pending'; });
          this.tq.unshift(...batch);
          this.onStatus && this.onStatus('slow');
          if (this.gap >= 60000) {
            batch.forEach(s => { s.status = 'failed'; s.error = e.message; });
            this.tq.splice(0, batch.length);
            this.onError && this.onError('免费翻译额度暂时都用完了，翻译先暂停（英文转写还在继续）。可以去「设置」多加一家免费模型，或者把「额度用完时」改成 DeepSeek / Chrome 内置翻译。');
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
    if (liveEnglishOnly()) { seg.status = 'done'; seg.zh = ''; this.emit(); return; }
    seg.status = 'pending'; seg.queuedAt = 0; this.tq.push(seg); this.emit(); this.pump();
  }
  /* 没听懂：记下时间和前后几句，课后让 AI 用中文重讲 */
  confused() {
    const t = this.elapsed();
    const near = this.segments.filter(g => g.t >= t - 45).map(g => g.en).join(' ') + (this.turn ? ' ' + (this.turn.text || '') : '');
    (this.record.confused = this.record.confused || []).push({ t, near: near.slice(-1200) });
    const last = this.segments[this.segments.length - 1]; if (last) last.confused = true;
    this.emit(); this.scheduleSave();
    return t;
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
    // 已经排了一次就不往后推：老师一直讲的时候每几秒都有新句子，一直往后推就一直存不上
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save().catch(e => { if (!this.saveWarned) { this.saveWarned = true; this.onError && this.onError('转写内容存不进本机：' + (e.message || e) + '。可能是存储空间满了，先别关这一页。'); } }); }, 1500);
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
    try { await DB.put('audio', { id: this.record.id + '_' + String(this.audioIdx).padStart(4, '0'), sessionId: this.record.id, idx: this.audioIdx++, blob }); }
    catch (e) { if (!this.audioWarned) { this.audioWarned = true; this.onError && this.onError('录音音频存不进本机（' + (e.message || e) + '），可能是存储空间满了。文字转写还在继续。'); } }
  }
  async stop() {
    this.stopped = true; clearTimeout(this.draftTimer); clearInterval(this.quietTimer); clearInterval(this.segTimer);
    clearTimeout(this.saveTimer); this.saveTimer = null;
    if (this._vis) document.removeEventListener('visibilitychange', this._vis);
    this.capture && this.capture.stop();
    await (this.transcriber && this.transcriber.stop());
    this.flushBuffer();
    this.pump();
    // 等翻译队列跑完（最多 20 秒）
    const until = Date.now() + 20000;
    while ((this.translating || this.tq.length) && Date.now() < until) await new Promise(r => setTimeout(r, 300));
    await this.flushAudio();
    await this.save();
    try { AI.Costs.add('live', { sec: this.elapsed(), sessions: 1 }); } catch (e) {}
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
