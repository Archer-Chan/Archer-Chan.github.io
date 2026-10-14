// 极简音效（WebAudio 合成，无素材依赖）；AudioContext 来源由平台注入
let AC = null, PROVIDER = null;
export function setSfxProvider(fn) { PROVIDER = fn; }
function ac() { return AC || (AC = PROVIDER()); }

export function sfx(kind) {
  try {
    const ctx = ac(), t = ctx.currentTime;
    if (kind === 'draw') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(150, t + 0.25);
      g.gain.setValueAtTime(0.05, t); g.gain.linearRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.3);
    } else if (kind === 'release') {
      const b = ctx.createBufferSource(), g = ctx.createGain();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
      b.buffer = buf; g.gain.value = 0.25;
      b.connect(g).connect(ctx.destination); b.start(t);
    } else if (kind === 'hit' || kind === 'gold') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(kind === 'gold' ? 880 : 220, t);
      g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.35);
    }
  } catch { /* 无声环境静默失败 */ }
}
