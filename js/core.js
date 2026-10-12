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
  windy:  { name: '户外阵风', breath: 7.5, tremor: 1.7, drift: 5.5, gust: 24, wind: 4.2 },
  // 实景 AR：手持真实晃动（无环境风）
  ar:     { name: '实景',   breath: 4.5, tremor: 1.0, drift: 2.5, gust: 0,  wind: 0 }
};

// 实景模式摄像头水平视场（度，可调），用于陀螺转角 → 屏幕像素换算
export let AR_FOV = 67;
export function setArFov(f) { if (f >= 40 && f <= 100) AR_FOV = f; }

// 欧拉角（ZXY 内旋，deviceorientation 规范）→ 旋转矩阵
function _e2m(a, b, g) {
  const d = Math.PI / 180;
  a *= d; b *= d; g *= d;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b),
        cg = Math.cos(g), sg = Math.sin(g);
  return [
    [ca * cg - sa * sb * sg, -cb * sa, ca * sg + cg * sa * sb],
    [cg * sa + ca * sb * sg, ca * cb, sa * sg - ca * cg * sb],
    [-cb * sg, sb, cb * cg]
  ];
}

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
    this.baseM = null;               // 陀螺仪校准基准（竖持姿态，旋转矩阵）
    this._lastTouch = null;
    this.pxPerDeg = 9;               // 陀螺仪灵敏度（随距离微调）
    this.isCoarse = matchMedia('(pointer: coarse)').matches;
    this.arMode = false;             // 实景模式：准星=触摸微调，世界平移=陀螺转角
    this.worldX = 0; this.worldY = 0; // 世界锚定平移（px，按摄像头视场换算）
  }
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
        const M = _e2m(e.alpha, e.beta, e.gamma || 0);
        if (!this.baseM) this.baseM = M;
        // 相对旋转 R = baseMᵀ·M，提取旋转向量（轴角）：
        // 竖持时「左右转体 = 绕设备 Y 轴」「抬压弓 = 绕设备 X 轴」，
        // 直接取旋转向量的 y/x 分量——绕开竖持 beta≈90° 的欧拉角奇异点，
        // 且水平灵敏度不随持机俯仰角衰减（ZXY 分解会错误衰减）
        const B = this.baseM, d = 180 / Math.PI;
        const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
          R[i][j] = B[0][i] * M[0][j] + B[1][i] * M[1][j] + B[2][i] * M[2][j];
        const tr = R[0][0] + R[1][1] + R[2][2];
        const th = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
        let rx, ry;
        if (th < 1e-4) { rx = (R[2][1] - R[1][2]) / 2; ry = (R[0][2] - R[2][0]) / 2; }
        else {
          const s = 2 * Math.sin(th);
          rx = (R[2][1] - R[1][2]) / s * th;
          ry = (R[0][2] - R[2][0]) / s * th;
        }
        // 取反：转体/抬弓方向与屏幕坐标系相反（抬弓准星应上移，屏幕 y 为负）
        const tx = -ry * d * this.pxPerDeg;
        const ty = -rx * d * this.pxPerDeg;
        // 指数滑动平均低通滤波：实景模式加重滤波，世界锚定的靶面对噪声更敏感
        const sm = this.arMode ? 0.12 : 0.3;
        this.gyroX += (tx - this.gyroX) * sm;
        this.gyroY += (ty - this.gyroY) * sm;
      });
      this.gyroOn = true;
      return true;
    } catch { return false; }
  }
  disableGyro() {
    if (this._onGyro) window.removeEventListener('deviceorientation', this._onGyro);
    this.gyroOn = false; this.gyroGuided = false;
    this.baseM = null; this.gyroX = this.gyroY = 0;
  }
  calibrate() { this.baseM = null; } // 下一帧陀螺仪数据作为新基准
  // 等待基准捕获（引导页用）：超时 3s 返回 false
  waitCalibrated(timeoutMs = 3000) {
    return new Promise((resolve) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        if (this.baseM) { clearInterval(iv); resolve(true); }
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
    const lim = Math.min(innerWidth, innerHeight) * 0.46;
    if (this.arMode) {
      // 实景：陀螺转角换算为世界平移（靶面锚定在真实方向），准星只由触摸微调驱动
      const k = innerWidth / AR_FOV; // 摄像头 1° ≈ 多少 px
      this.worldX = (this.gyroX / this.pxPerDeg) * k;
      this.worldY = (this.gyroY / this.pxPerDeg) * k;
      this.x = clamp(this.trimX, -lim, lim);
      this.y = clamp(this.trimY, -lim, lim);
      return this;
    }
    const gx = this.gyroOn ? this.gyroX : this.mouseX;
    const gy = this.gyroOn ? this.gyroY : this.mouseY;
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
