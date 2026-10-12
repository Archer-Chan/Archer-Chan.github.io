// 基础工具：噪声、物理晃动模型、输入抽象（陀螺仪 + 指针）

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// ---- 1D 值噪声（用于风阵风、漂移）----
function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
export function vnoise(t, seed = 0) {
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i + seed * 91.7), hash1(i + 1 + seed * 91.7), u);
}

// ---- 持弓晃动模型 ----
// 组成：呼吸(低频垂直) + 肌肉震颤(高频小幅) + 缓慢漂移 + 阵风(环境)
// 疲劳随拉弓时间增长，振幅放大 —— 鼓励及时撒放
export const ENVS = {
  indoor: { name: '室内',   breath: 5.0, tremor: 1.1, drift: 2.5, gust: 0,  wind: 0 },
  breeze: { name: '户外微风', breath: 6.0, tremor: 1.3, drift: 3.5, gust: 9,  wind: 1.6 },
  windy:  { name: '户外阵风', breath: 7.5, tremor: 1.7, drift: 5.5, gust: 24, wind: 4.2 }
};

// ---- 弓种：瞄具形态 + 手感参数 ----
// swayMul 晃动倍率 / fatigueMul 疲劳增速倍率 / dropMul 下落倍率 / zoom 视野放大
export const BOWS = {
  trad:     { id: 'trad',     name: '传统弓', sight: '箭头尖参考',
              swayMul: 1.3,  fatigueMul: 1.2, dropMul: 1.45, zoom: 1.0,  assist: false },
  recurve:  { id: 'recurve',  name: '反曲弓', sight: '单针瞄',
              swayMul: 1.0,  fatigueMul: 1.0, dropMul: 1.0,  zoom: 1.0,  assist: true },
  compound: { id: 'compound', name: '复合弓', sight: '窥孔 + 瞄镜',
              swayMul: 0.6,  fatigueMul: 0.45, dropMul: 0.55, zoom: 1.32, assist: true }
};

export class Sway {
  constructor(envKey) {
    this.env = ENVS[envKey] || ENVS.indoor;
    this.t = Math.random() * 100;
    this.gust = 0;
    this.windDir = Math.random() < 0.5 ? -1 : 1; // 本组风向
    this.x = 0; this.y = 0;
    this.gustLevel = 0; // 0..1 供 HUD 风车显示
  }
  update(dt, holdSec) {
    const e = this.env, t = (this.t += dt);
    // 疲劳：前 4 秒稳定，之后加速增长（复合弓省力轮增速慢）
    const fm = this.fatigueMul || 1;
    const fatigue = (holdSec < 4 ? holdSec * 0.06 : 0.24 + (holdSec - 4) * 0.22) * fm;
    const m = 1 + fatigue;
    const w = t * 2 * Math.PI * 0.21; // 呼吸 ~0.21Hz
    // 呼吸相位：-1 = 呼气末（最稳），+1 = 吸气顶（最浮），整体振幅随之起伏
    this.breathPhase = Math.sin(w);
    const phaseMul = 1 + 0.45 * this.breathPhase;
    const breathY = Math.sin(w) * e.breath;
    const breathX = Math.sin(w + 1.2) * e.breath * 0.4;
    const tremorX = (Math.sin(t * 57) + Math.sin(t * 73 + 0.7)) * 0.5 * e.tremor;
    const tremorY = (Math.sin(t * 63 + 1.9) + Math.sin(t * 81)) * 0.5 * e.tremor;
    const driftX = vnoise(t * 0.33, 3.7) * e.drift;
    const driftY = vnoise(t * 0.28, 9.1) * e.drift * 0.7;
    // 阵风：噪声抬升过阈值后推动准星
    const g = Math.max(0, vnoise(t * 0.45, 17.3));
    this.gust += (g * e.gust - this.gust) * Math.min(1, dt * 1.6);
    this.gustLevel = e.gust > 0 ? clamp(this.gust / e.gust, 0, 1) : 0;
    this.x = (breathX + tremorX + driftX) * m * phaseMul + this.gust * this.windDir * m;
    this.y = (breathY + tremorY + driftY) * m * phaseMul - this.gust * 0.18 * m;
  }
}

// ---- 输入抽象 ----
// aim: 以靶心为原点的偏移(px)。桌面：鼠标移动；手机：陀螺仪（竖持校准）+ 触摸微调
export class AimInput {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0; this.y = 0;          // 合成后的瞄准偏移
    this.mouseX = 0; this.mouseY = 0;
    this.trimX = 0; this.trimY = 0;  // 触摸拖拽微调
    this.gyroOn = false;
    this.gyroGuided = false;         // 是否经过竖持引导校准
    this.gyroX = 0; this.gyroY = 0;
    this.base = null;                // 陀螺仪校准基准（竖持姿态）
    this._lastTouch = null;
    this.pxPerDeg = 9;               // 陀螺仪灵敏度（随距离微调）
    this.isCoarse = matchMedia('(pointer: coarse)').matches;
  }
  // 角度差（处理 0/360 环绕）：返回 a-b 的最短角差，范围 [-180,180]
  static _angDiff(a, b) { return ((a - b + 540) % 360) - 180; }
  async enableGyro() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      }
      if (typeof DeviceOrientationEvent === 'undefined') return false;
      window.addEventListener('deviceorientation', this._onGyro = (e) => {
        if (e.alpha == null || e.beta == null) return;
        if (!this.base) this.base = { alpha: e.alpha, beta: e.beta };
        // 竖持：alpha 左右转体（方位角）/ beta 抬压弓（俯仰角）
        const tx = AimInput._angDiff(e.alpha, this.base.alpha) * this.pxPerDeg;
        const ty = (e.beta - this.base.beta) * this.pxPerDeg;
        // 指数滑动平均低通滤波，抑制陀螺仪高频抖动
        this.gyroX += (tx - this.gyroX) * 0.3;
        this.gyroY += (ty - this.gyroY) * 0.3;
      });
      this.gyroOn = true;
      return true;
    } catch { return false; }
  }
  disableGyro() {
    if (this._onGyro) window.removeEventListener('deviceorientation', this._onGyro);
    this.gyroOn = false; this.gyroGuided = false;
    this.base = null; this.gyroX = this.gyroY = 0;
  }
  calibrate() { this.base = null; } // 下一帧陀螺仪数据作为新基准
  // 等待基准捕获（引导页用）：超时 3s 返回 false
  waitCalibrated(timeoutMs = 3000) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        if (this.base) { clearInterval(iv); resolve(true); }
        else if (performance.now() - t0 > timeoutMs) { clearInterval(iv); resolve(false); }
      }, 80);
    });
  }
  bind() {
    const c = this.canvas;
    c.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        this.mouseX = (e.clientX - innerWidth / 2) * 0.9;
        this.mouseY = (e.clientY - innerHeight / 2) * 0.9;
      } else if (this._lastTouch && e.isPrimary) {
        this.trimX += (e.clientX - this._lastTouch.x) * 1.4;
        this.trimY += (e.clientY - this._lastTouch.y) * 1.4;
        this._lastTouch = { x: e.clientX, y: e.clientY };
      }
    });
    c.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' && e.isPrimary)
        this._lastTouch = { x: e.clientX, y: e.clientY };
    });
    const end = () => { this._lastTouch = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }
  read() {
    const gx = this.gyroOn ? this.gyroX : this.mouseX;
    const gy = this.gyroOn ? this.gyroY : this.mouseY;
    const lim = Math.min(innerWidth, innerHeight) * 0.46;
    this.x = clamp(gx + this.trimX, -lim, lim);
    this.y = clamp(gy + this.trimY, -lim, lim);
    return this;
  }
}

// ---- 极简音效（WebAudio 合成，无素材依赖）----
let AC = null;
function ac() { return AC || (AC = new (window.AudioContext || window.webkitAudioContext)()); }
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
