// web 输入层：指针/触摸 + deviceorientation 陀螺仪（解算数学在 shared/pose.js）
import { clamp } from './shared/math.js';
import { e2m, relRot, toAimDelta, AR } from './shared/pose.js';

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
        const M = e2m(e.alpha, e.beta, e.gamma || 0);
        if (!this.baseM) this.baseM = M;
        const d = toAimDelta(relRot(this.baseM, M));
        const tx = d.tx * this.pxPerDeg, ty = d.ty * this.pxPerDeg;
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
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (this.baseM) { clearInterval(iv); resolve(true); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); resolve(false); }
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
      const k = innerWidth / AR.fov; // 摄像头 1° ≈ 多少 px
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
