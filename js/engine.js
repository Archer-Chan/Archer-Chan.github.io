// 渲染引擎：主题场景（AI 背景图）、靶面、箭矢飞行、对局会话（训练/闯关共用）
import { clamp, lerp, vnoise, Sway, sfx, AR_FOV } from './core.js';

// ---------- 场景背景（AI 素材 + 透视标定） ----------
// bx/by/br：背景中烘焙靶心的相对位置与半径（相对 1216 高）；refDist：该尺寸对应的参考距离
// 游戏靶面由 Canvas 按 refDist/dist 缩放实时绘制，近大远小，覆盖烘焙靶
export const BG_IMG_W = 832, BG_IMG_H = 1216;
export const BG_DEFS = {
  // targetStyle: cloth=布纹靶面+剁草麻布木腿靶垛 / paper=纸张靶面+赛事靶架
  //              straw=草靶（螺旋草纹+草靶垛+A字木腿）/ astra=星辉金环靶+符文浮盘
  // sizeMul: 场景靶面整体缩放修正（奥运场景按透视应更小）
  dojo:    { src: 'assets/bg-dojo.png',    bx: 0.500, by: 0.505, br: 0.028, refDist: 30,
             panel: ['#4a3826', '#2c2116'], particle: 'mote',  targetStyle: 'cloth', sizeMul: 1 },
  hanfu:   { src: 'assets/bg-hanfu.png',   bx: 0.500, by: 0.512, br: 0.038, refDist: 50,
             panel: ['#c8b184', '#8f7a50'], particle: 'petal', targetStyle: 'cloth', sizeMul: 1 },
  olympic: { src: 'assets/bg-olympic.png', bx: 0.500, by: 0.435, br: 0.045, refDist: 70,
             panel: ['#2a5a9c', '#173a66'], particle: null,    targetStyle: 'paper', sizeMul: 0.55 },
  // 巡回之旅三秘境（mockup3 v2 烘焙背景，前景无弓）
  forest:  { src: 'assets/bg-forest.png',  bx: 0.502, by: 0.485, br: 0.064, refDist: 24,
             panel: ['#3c5a34', '#23351e'], particle: 'leaf',  targetStyle: 'straw', sizeMul: 1 },
  snow:    { src: 'assets/bg-snow.png',    bx: 0.505, by: 0.421, br: 0.072, refDist: 50,
             panel: ['#5a6b8c', '#33405a'], particle: 'snow',  targetStyle: 'straw', sizeMul: 1 },
  astra:   { src: 'assets/bg-astra.png',   bx: 0.502, by: 0.386, br: 0.045, refDist: 70,
             panel: ['#3a2d6e', '#1c1540'], particle: 'spark', targetStyle: 'astra', sizeMul: 1 },
  // 实景 AR：摄像头画面做底（无背景图），靶面纸质感 + 赛事靶架
  ar:      { src: null,                    bx: 0.500, by: 0.460, br: 0.028, refDist: 30,
             panel: ['#2c2f36', '#17191e'], particle: null,    targetStyle: 'paper', sizeMul: 1 },
};
export function bgScale(w, h) { return Math.max(w / BG_IMG_W, h / BG_IMG_H); }
// 靶面外圈（10 环外沿）像素半径。
// mode='sport'（竞技）：背景烘焙靶在参考距离恰好被覆盖，其余距离按透视缩放，钳制 [0.45,1.9]；
// mode='real'（写实）：按 25cm 持机视距还原真实张角（1 CSS px ≈ 0.2646mm），
//   半径 = 250mm·D/(2·L)/0.2646 ≈ 472.7·D/L，D 为靶面真实直径（纸靶 122cm / 布靶 80cm）
export function outerR(dist, bgKey, w, h, mode = 'sport') {
  const c = BG_DEFS[bgKey] || BG_DEFS.dojo;
  if (bgKey === 'ar') {
    // 实景：按摄像头水平视场的真实张角（1.22m 靶纸），1.5× 可读性放大
    const k = w / AR_FOV; // 1° ≈ 多少 px
    return Math.max(6, Math.atan(0.61 / dist) * (180 / Math.PI) * k * 1.5);
  }
  if (mode === 'real') {
    const D = c.targetStyle === 'paper' ? 1.22 : 0.80;
    return Math.max(5, 472.7 * D / dist);
  }
  const k = Math.min(1.9, Math.max(0.45, c.refDist / dist));
  return c.br * BG_IMG_H * bgScale(w, h) * k * (c.sizeMul || 1);
}

// 箭矢飞行时长（秒）：0.65 → 0.32，速度感提升约一倍
const FLIGHT_T = 0.32;

const _bgCache = {};
function bgImage(key) {
  if (!_bgCache[key]) {
    const img = new Image();
    img.src = (window.__IMG && window.__IMG[key]) || (BG_DEFS[key] || BG_DEFS.dojo).src;
    _bgCache[key] = img;
  }
  return _bgCache[key];
}

export class Scene {
  constructor(bgKey) {
    this.key = BG_DEFS[bgKey] ? bgKey : 'dojo';
    this.def = BG_DEFS[this.key];
    this.img = this.def.src ? bgImage(this.key) : null;
    this.particles = [];
    for (let i = 0; i < 45; i++) this.particles.push(this._spawn(true));
  }
  _spawn(anywhere, bottom) {
    const kind = this.def.particle;
    return {
      x: Math.random(), y: anywhere ? Math.random() : (bottom ? 1.02 : -0.02),
      s: 0.4 + Math.random() * 1.1, v: 0.010 + Math.random() * 0.025,
      ph: Math.random() * 6.28, kind
    };
  }
  // 背景烘焙靶锚点的屏幕坐标（含视差平移），供靶面/弹孔对齐
  anchor(w, h, panX = 0, panY = 0) {
    if (this.key === 'ar') return { x: w / 2 + panX, y: h * 0.46 + panY };
    const s = bgScale(w, h);
    const dx = (w - BG_IMG_W * s) / 2 + panX, dy = (h - BG_IMG_H * s) / 2 + panY;
    return { x: this.def.bx * BG_IMG_W * s + dx, y: this.def.by * BG_IMG_H * s + dy };
  }
  draw(ctx, w, h, t, panX = 0, panY = 0) {
    if (this.key === 'ar') {
      // 实景：摄像头画面全屏铺满（cover），画面随手机转动天然旋转，无需平移
      const v = window.__camVideo;
      if (v && v.readyState >= 2 && v.videoWidth > 0) {
        const s = Math.max(w / v.videoWidth, h / v.videoHeight);
        const dw = v.videoWidth * s, dh = v.videoHeight * s;
        ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = '#0b0d11'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(236,231,221,.45)';
        ctx.font = '13px -apple-system, "PingFang SC", sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('正在等待摄像头画面…', w / 2, h * 0.42);
      }
      return;
    }
    const s = bgScale(w, h);
    const dx = (w - BG_IMG_W * s) / 2 + panX, dy = (h - BG_IMG_H * s) / 2 + panY;
    if (this.img.complete && this.img.naturalWidth > 0) {
      ctx.drawImage(this.img, dx, dy, BG_IMG_W * s, BG_IMG_H * s);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#14171d'); g.addColorStop(1, '#0b0d11');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    // 粒子：花瓣 / 落叶 / 雪花 / 星辉 / 暖尘
    const kind = this.def.particle;
    if (kind) {
      for (const p of this.particles) {
        p.ph += 0.02;
        if (kind === 'spark') {
          // 星辉：上升
          p.y -= p.v * 0.014; p.x += Math.sin(p.ph) * 0.0003;
          if (p.y < -0.02) Object.assign(p, this._spawn(false, true));
        } else {
          p.y += p.v * 0.016;
          p.x += Math.sin(p.ph) * 0.0004 + 0.0001;
          if (p.y > 1.02) Object.assign(p, this._spawn(false));
        }
        const px = p.x * w + panX * 0.5, py = p.y * h + panY * 0.5;
        if (kind === 'petal' || kind === 'leaf') {
          ctx.fillStyle = kind === 'petal' ? 'rgba(255,170,120,.5)' : 'rgba(158,208,112,.42)';
          ctx.save(); ctx.translate(px, py); ctx.rotate(p.ph);
          ctx.fillRect(-p.s, -p.s * 0.5, p.s * 2, p.s); ctx.restore();
        } else if (kind === 'snow') {
          ctx.fillStyle = 'rgba(255,255,255,.62)';
          ctx.beginPath(); ctx.arc(px, py, p.s * 0.9, 0, 7); ctx.fill();
        } else if (kind === 'spark') {
          const tw = 0.4 + 0.6 * Math.abs(Math.sin(p.ph * 2.2));
          ctx.fillStyle = p.s > 1.1
            ? `rgba(245,197,66,${(0.22 + tw * 0.5).toFixed(3)})`
            : `rgba(140,226,255,${(0.18 + tw * 0.5).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(px, py, p.s * 0.75, 0, 7); ctx.fill();
        } else {
          const tw = 0.5 + 0.5 * Math.sin(p.ph * 2);
          ctx.fillStyle = `rgba(255,226,170,${0.12 + tw * 0.3})`;
          ctx.beginPath(); ctx.arc(px, py, p.s * 0.8, 0, 7); ctx.fill();
        }
      }
    }
  }
}

// ---------- 靶面 ----------
// style: plain=纯色 / cloth=麻布纹（日式·国风靶垛）/ paper=纸纹噪点（奥运靶纸）
//        straw=草靶（暖草色环+螺旋草纹）/ astra=星辉金环靶（深空盘+发光金环）
export function drawTarget(ctx, cx, cy, ringR, zoom = 1, shadow = true, style = 'plain') {
  if (!(ringR > 0) || !isFinite(ringR)) return; // 视口异常（如隐藏标签页）时跳过
  ctx.save(); ctx.translate(cx, cy); ctx.scale(zoom, zoom);
  const R = ringR * 10;
  // ---- 星辉金环靶（星坠荒原）：深空石盘 + 发光金环 + 金核 ----
  if (style === 'astra') {
    const dg = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R);
    dg.addColorStop(0, '#332b62'); dg.addColorStop(0.6, '#241d46'); dg.addColorStop(1, '#16112e');
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
    // 环带明暗交替
    for (let i = 9; i >= 1; i -= 2) {
      ctx.beginPath(); ctx.arc(0, 0, ringR * (i + 1), 0, 7); ctx.arc(0, 0, ringR * i, 0, 7, true);
      ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.fill();
    }
    // 发光金环（越靠内越亮）
    ctx.save();
    ctx.shadowColor = 'rgba(245,197,66,.85)'; ctx.shadowBlur = Math.max(3, ringR * 0.9);
    for (let i = 10; i >= 1; i--) {
      ctx.strokeStyle = `rgba(245,197,66,${(0.26 + i * 0.055).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.8, ringR * 0.14);
      ctx.beginPath(); ctx.arc(0, 0, ringR * i, 0, 7); ctx.stroke();
    }
    // 金核（内十环）
    ctx.fillStyle = '#f5c542';
    ctx.beginPath(); ctx.arc(0, 0, ringR * 0.55, 0, 7); ctx.fill();
    ctx.restore();
    // 外围辉光晕
    const hg = ctx.createRadialGradient(0, 0, R * 0.9, 0, 0, R * 1.28);
    hg.addColorStop(0, 'rgba(245,197,66,.16)'); hg.addColorStop(1, 'rgba(245,197,66,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.28, 0, 7); ctx.fill();
    ctx.restore();
    return;
  }
  const colors = style === 'paper'
    ? ['#f7f4ec', '#f7f4ec', '#222225', '#222225', '#4a86de', '#4a86de',
       '#e05252', '#e05252', '#f7ce4e', '#f7ce4e']
    : style === 'straw'
    ? ['#e2cc96', '#e2cc96', '#4a3423', '#4a3423', '#5d84a8', '#5d84a8',
       '#c05a3c', '#c05a3c', '#e8b84b', '#e8b84b']
    : ['#f5f2ea', '#f5f2ea', '#1a1a1c', '#1a1a1c', '#3d7dd8', '#3d7dd8',
       '#d84a4a', '#d84a4a', '#f5c542', '#f5c542'];
  // 靶架阴影（报告页等独立靶面用；场景内由背景承担环境感）
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(0, ringR * 10.6, ringR * 4, ringR * 0.9, 0, 0, 7); ctx.fill();
  }
  // 环：从外到内（1环 → 10环）
  for (let i = 10; i >= 1; i--) {
    ctx.fillStyle = colors[10 - i];
    ctx.beginPath(); ctx.arc(0, 0, ringR * i, 0, 7); ctx.fill();
  }
  // 环间分界细线（纸靶/布靶的印刷感）
  ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = Math.max(0.6, ringR * 0.045);
  for (let i = 10; i >= 1; i--) {
    ctx.beginPath(); ctx.arc(0, 0, ringR * i, 0, 7); ctx.stroke();
  }
  // 材质纹理（裁剪在外圈内，确定性伪随机，避免逐帧闪烁）
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.clip();
  if (style === 'cloth') {
    // 麻布经纬：两组对角细线
    ctx.lineWidth = Math.max(0.5, ringR * 0.05);
    const gap = ringR * 0.72;
    for (const [ang, col] of [[Math.PI / 4, 'rgba(120,90,50,.08)'], [-Math.PI / 4, 'rgba(60,45,25,.07)']]) {
      ctx.strokeStyle = col;
      ctx.save(); ctx.rotate(ang);
      for (let y = -R * 1.5; y <= R * 1.5; y += gap) {
        ctx.beginPath(); ctx.moveTo(-R * 1.5, y); ctx.lineTo(R * 1.5, y); ctx.stroke();
      }
      ctx.restore();
    }
    // 布面轻微做旧晕
    const vg = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(72,52,26,.14)');
    ctx.fillStyle = vg; ctx.fillRect(-R, -R, R * 2, R * 2);
  } else if (style === 'paper') {
    // 纸张噪点
    for (let i = 0; i < 260; i++) {
      const fx = ((i * 0.6180339) % 1) * 2 - 1, fy = ((i * 0.7548776) % 1) * 2 - 1;
      if (fx * fx + fy * fy > 1) continue;
      ctx.fillStyle = i % 2 ? 'rgba(0,0,0,.05)' : 'rgba(255,255,255,.06)';
      ctx.fillRect(fx * R, fy * R, Math.max(0.8, ringR * 0.07), Math.max(0.8, ringR * 0.07));
    }
    // 纸面顶部受光、底部微暗
    const pg = ctx.createLinearGradient(0, -R, 0, R);
    pg.addColorStop(0, 'rgba(255,255,255,.10)'); pg.addColorStop(1, 'rgba(0,0,0,.08)');
    ctx.fillStyle = pg; ctx.fillRect(-R, -R, R * 2, R * 2);
  } else if (style === 'straw') {
    // 草靶盘绳纹：同心螺旋细圈
    ctx.strokeStyle = 'rgba(120,88,40,.14)';
    ctx.lineWidth = Math.max(0.5, ringR * 0.09);
    for (let r = ringR * 0.9; r < R; r += ringR * 0.55) {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    }
    // 草杆碎点（明暗两色）
    for (let i = 0; i < 200; i++) {
      const fx = ((i * 0.6180339) % 1) * 2 - 1, fy = ((i * 0.7548776) % 1) * 2 - 1;
      if (fx * fx + fy * fy > 1) continue;
      ctx.fillStyle = i % 2 ? 'rgba(90,64,28,.09)' : 'rgba(255,240,200,.07)';
      ctx.fillRect(fx * R, fy * R, Math.max(0.8, ringR * 0.12), Math.max(0.5, ringR * 0.05));
    }
    // 暖色做旧晕
    const vg = ctx.createRadialGradient(0, 0, R * 0.25, 0, 0, R);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(94,66,24,.20)');
    ctx.fillStyle = vg; ctx.fillRect(-R, -R, R * 2, R * 2);
  }
  ctx.restore();
  // 内十环 X
  ctx.strokeStyle = '#8d6b1f'; ctx.lineWidth = Math.max(1, ringR * 0.06);
  ctx.beginPath(); ctx.arc(0, 0, ringR * 0.5, 0, 7); ctx.stroke();
  ctx.restore();
}

export function scoreOf(distPx, ringR) {
  const r = distPx / ringR;
  if (r > 10) return { score: 0, x: false };
  if (r <= 0.5) return { score: 10, x: true };
  return { score: Math.max(1, Math.ceil(10 - r)), x: false };
}

// ---------- 对局会话 ----------
// 状态机: idle → drawing(拉弓/蓄力) → flying(箭飞行) → mark(命中展示) → 下一支 → done
export class RangeSession {
  constructor(opts) {
    // opts: {dist, env, arrows, theme, moving, assist, onShot, onEnd, hud}
    Object.assign(this, opts);
    this.scene = new Scene(this.theme);
    this.sway = new Sway(this.env);
    // 弓种：缩放晃动参数与疲劳增速
    const bm = this.bowCfg.swayMul, e = this.sway.env;
    this.sway.env = { ...e, breath: e.breath * bm, tremor: e.tremor * bm,
                      drift: e.drift * bm, gust: e.gust * bm };
    this.sway.fatigueMul = this.bowCfg.fatigueMul;
    this.shots = [];
    this.state = 'intro';    // 入场运镜：俯瞰 → 射手就位
    this.introT = 0;
    this.introDur = 2.2;
    this.stateT = 0;
    this.holdSec = 0;
    this.power = 0;
    this.samples = [];       // 拉弓期间的瞄准轨迹
    this.zoom = 1;
    this.flight = null;
    this.movingPh = Math.random() * 6.28;
    this.steady = 0;         // 实时稳定度
    this.total = 0;
    this.fx = [];            // 命中特效粒子
    this.shake = 0;          // 中靶抖动幅度
    this.markDur = 1.15;     // 命中展示时长（特效期间锁定射击）
    this.faceScale = this.faceScale || 1; // 靶纸缩放（奥运小靶纸）
    this.scaleMode = this.scaleMode || 'sport'; // 视觉比例：sport=竞技 / real=写实
  }
  get ringR() {
    return outerR(this.dist, this.scene.key, innerWidth, innerHeight, this.scaleMode) / 10 * this.faceScale;
  }
  targetCenter(t) {
    const base = this.scene.anchor(innerWidth, innerHeight, this.panX || 0, this.panY || 0);
    let x = 0;
    if (this.moving > 0) {
      x = Math.sin(t * this.moving * 1.4 + this.movingPh) * this.ringR * 9;
    }
    return { x: base.x + x, y: base.y };
  }
  _powerRing(ctx, ax, ay, r) {
    ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ax, ay, r, -Math.PI / 2, -Math.PI / 2 + this.power * Math.PI * 2); ctx.stroke();
  }

  // ---- 命中特效：10环彩带烟花 / 9环绿色光环 / 所有命中轻微抖动 ----
  spawnFx(shot, t) {
    const tc = this.targetCenter(t);
    const ix = tc.x + shot.dx, iy = tc.y + shot.dy;
    this.fx = [];
    this.shake = 4 + shot.score * 0.4;
    if (shot.score >= 10) {
      const colors = ['#ff5f1f', '#f5c542', '#6fe07a', '#3d7dd8', '#d84a4a', '#ece7dd'];
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 400;
        this.fx.push({ type: 'confetti', x: ix, y: iy,
          vx: Math.cos(a) * v, vy: Math.sin(a) * v - 130,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
          color: colors[i % colors.length], len: 6 + Math.random() * 8,
          life: 0, ttl: 1.2 + Math.random() * 0.6 });
      }
      this.markDur = 1.9;
    } else if (shot.score === 9) {
      this.fx.push({ type: 'ring', x: ix, y: iy, r: this.ringR, life: 0, ttl: 0.95 });
      this.markDur = 1.45;
    } else {
      this.markDur = 1.15;
    }
  }
  _updateFx(dt) {
    this.shake *= Math.pow(0.015, dt);
    for (const p of this.fx) {
      p.life += dt;
      if (p.type === 'confetti') {
        p.vy += 520 * dt; p.vx *= Math.max(0, 1 - 1.6 * dt);
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      } else {
        p.r += 300 * dt;
      }
    }
    this.fx = this.fx.filter(p => p.life < p.ttl);
  }
  _drawFx(ctx) {
    for (const p of this.fx) {
      const a = Math.max(0, 1 - p.life / p.ttl);
      if (p.type === 'confetti') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = a; ctx.fillStyle = p.color;
        ctx.fillRect(-p.len / 2, -1.6, p.len, 3.2);
        ctx.restore();
      } else {
        ctx.globalAlpha = a * 0.9;
        ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = a * 0.28; ctx.lineWidth = 9;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.92, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---- 瞄具材质 ----
  _metalGrad(ctx, x0, y0, x1, y1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#e9ebef'); g.addColorStop(0.35, '#969aa3');
    g.addColorStop(0.52, '#f6f7f9'); g.addColorStop(0.7, '#7d8087');
    g.addColorStop(1, '#56595f');
    return g;
  }
  // 暗金属（反曲/复合瞄具：阳极氧化铝的暗暗金属感）
  _darkGrad(ctx, x0, y0, x1, y1) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, '#6b6f77'); g.addColorStop(0.3, '#3a3d44');
    g.addColorStop(0.5, '#888c94'); g.addColorStop(0.72, '#2c2e34');
    g.addColorStop(1, '#484c54');
    return g;
  }
  // 柔影：给瞄具一个投在画面上的淡影，增加光影层次
  _softShadow(ctx, drawFn, dx = 2.5, dy = 3.5, alpha = 0.22) {
    ctx.save(); ctx.translate(dx, dy);
    ctx.globalAlpha = alpha; ctx.shadowColor = 'rgba(0,0,0,0)';
    drawFn(true);
    ctx.restore();
  }
  // 传统弓：光洁木质箭杆（木纹+顺杆高光）+ 金属质感箭头（箭尖即瞄准点）
  _tradArrow(ctx, ax, ay, w, h, active) {
    const bx = ax + (w / 2 - ax) * 0.62, by = h + 14, ty = ay + 12;
    const len = Math.hypot(ax - bx, ty - by), ux = (ax - bx) / len, uy = (ty - by) / len;
    // 柔影层
    this._softShadow(ctx, (shadow) => {
      const g = ctx.createLinearGradient(bx, by, ax, ty);
      g.addColorStop(0, '#96622e'); g.addColorStop(0.55, '#74491f'); g.addColorStop(1, '#ab7740');
      ctx.strokeStyle = shadow ? '#000' : g; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ax, ty); ctx.stroke();
    });
    // 箭杆木材质
    const g = ctx.createLinearGradient(bx, by, ax, ty);
    g.addColorStop(0, '#96622e'); g.addColorStop(0.55, '#74491f'); g.addColorStop(1, '#ab7740');
    ctx.strokeStyle = g; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ax, ty); ctx.stroke();
    // 顺杆受光细高光（光影质感）
    ctx.strokeStyle = 'rgba(255,230,190,.28)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(bx - uy * 1.6, by + ux * 1.6); ctx.lineTo(ax - uy * 1.6, ty + ux * 1.6); ctx.stroke();
    // 木纹（顺杆扰动细线）
    ctx.strokeStyle = 'rgba(58,35,13,.5)'; ctx.lineWidth = 1.1;
    for (const off of [-1.7, 1.5]) {
      ctx.beginPath();
      for (let f = 0.1; f < 0.99; f += 0.05) {
        const px = bx + (ax - bx) * f - uy * off + Math.sin(f * 46 + off * 8) * 0.7;
        const py = by + (ty - by) * f + ux * off;
        f <= 0.1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // 金属箭头（三棱渐变 + 深色描边）：尖端严格落在瞄准点 (ax, ay)
    const hg = ctx.createLinearGradient(ax - 5, ay, ax + 5, ay + 12);
    hg.addColorStop(0, '#f2f4f7'); hg.addColorStop(0.45, '#9aa0a8');
    hg.addColorStop(0.75, '#e6e9ee'); hg.addColorStop(1, '#5a5e66');
    const headPath = () => {
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + 4.5, ay + 9);
      ctx.lineTo(ax, ay + 11.5); ctx.lineTo(ax - 4.5, ay + 9); ctx.closePath();
    };
    ctx.save(); ctx.translate(2, 3); ctx.globalAlpha = 0.25; ctx.fillStyle = '#000';
    headPath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = hg; headPath(); ctx.fill();
    ctx.strokeStyle = 'rgba(30,32,38,.85)'; ctx.lineWidth = 1; ctx.stroke();
    if (active) {
      ctx.strokeStyle = '#ff5f1f'; ctx.lineWidth = 1.6;
      headPath(); ctx.stroke();
      this._powerRing(ctx, ax, ay, 22);
    }
  }
  // 反曲弓：仅暗金属单针瞄环（阳极氧化铝质感），无瞄杆/横臂
  _recurveSight(ctx, ax, ay, h, active) {
    const rr = 10 + (1 - this.steady / 100) * 6;
    const main = active ? '#ff5f1f' : '#b8bcc4';
    // 瞄环柔影
    this._softShadow(ctx, () => {
      ctx.beginPath(); ctx.arc(ax, ay, rr + 1, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
    });
    // 暗金属瞄环（带左上高光弧）
    ctx.strokeStyle = this._darkGrad(ctx, ax - rr, ay - rr, ax + rr, ay + rr);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ax, ay, rr + 1, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(ax, ay, rr + 1, Math.PI * 1.05, Math.PI * 1.45); ctx.stroke();
    // 内圈 + 针点
    ctx.strokeStyle = main; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(ax, ay, rr - 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax - rr - 8, ay); ctx.lineTo(ax - rr - 3, ay);
    ctx.moveTo(ax + rr + 3, ay); ctx.lineTo(ax + rr + 8, ay);
    ctx.moveTo(ax, ay - rr - 8); ctx.lineTo(ax, ay - rr - 3);
    ctx.moveTo(ax, ay + rr + 3); ctx.lineTo(ax, ay + rr + 8); ctx.stroke();
    ctx.fillStyle = main;
    ctx.beginPath(); ctx.arc(ax, ay, 1.8, 0, Math.PI * 2); ctx.fill();
    if (active) this._powerRing(ctx, ax, ay, rr + 9);
  }
  // 复合弓：窥孔暗角 + 深色金属瞄镜（滚花外壳 + 光纤点 + 水准泡）
  _compoundScope(ctx, cx, cy, ax, ay, w, h, active) {
    const main = active ? '#ff5f1f' : '#b8bcc4';
    const pr = Math.min(w, h) * 0.47;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.arc(cx, cy, pr, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(4,5,8,.68)'; ctx.fill('evenodd'); ctx.restore();
    // 窥孔金属圈（暗金属 + 左上高光弧）
    ctx.strokeStyle = this._darkGrad(ctx, cx - pr, cy - pr, cx + pr, cy + pr);
    ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.arc(cx, cy, pr, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(cx, cy, pr, Math.PI * 1.05, Math.PI * 1.5); ctx.stroke();
    // 瞄镜外壳柔影
    const sr = 24 + (1 - this.steady / 100) * 5;
    this._softShadow(ctx, () => {
      ctx.strokeStyle = '#000'; ctx.lineWidth = 5.5;
      ctx.beginPath(); ctx.arc(ax, ay, sr + 3, 0, Math.PI * 2); ctx.stroke();
    }, 2, 3, 0.3);
    // 瞄镜深色金属外壳
    ctx.strokeStyle = this._darkGrad(ctx, ax - sr - 6, ay - sr - 6, ax + sr + 6, ay + sr + 6);
    ctx.lineWidth = 5.5;
    ctx.beginPath(); ctx.arc(ax, ay, sr + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(ax, ay, sr + 3, Math.PI * 1.05, Math.PI * 1.45); ctx.stroke();
    // 滚花纹（更深，去塑料感）
    ctx.strokeStyle = 'rgba(10,11,13,.7)'; ctx.lineWidth = 1;
    for (let i = 0; i < 28; i++) {
      const an = (i / 28) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(ax + Math.cos(an) * (sr + 0.8), ay + Math.sin(an) * (sr + 0.8));
      ctx.lineTo(ax + Math.cos(an) * (sr + 5.4), ay + Math.sin(an) * (sr + 5.4));
      ctx.stroke();
    }
    // 内环 + 光纤点
    ctx.strokeStyle = main; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(ax, ay, sr - 2, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#6fe07a';
    ctx.beginPath(); ctx.arc(ax, ay, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(111,224,122,.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ax, ay, 5.5, 0, Math.PI * 2); ctx.stroke();
    // 水准泡
    ctx.strokeStyle = 'rgba(236,231,221,.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(ax, ay + sr * 1.9, 14, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    const bubbleX = clamp((ax - cx) * 0.06, -9, 9);
    ctx.fillStyle = '#f5c542';
    ctx.beginPath(); ctx.arc(ax + bubbleX, ay + sr * 1.9 - 12, 3, 0, Math.PI * 2); ctx.fill();
    if (active) this._powerRing(ctx, ax, ay, sr + 12);
  }
  // 靶架：布靶=剁草麻布靶垛+木腿；纸靶=复合材质挂架（竖杆+横梁+夹具）
  _drawStand(ctx, tc, out) {
    const style = this.scene.def.targetStyle;
    ctx.save();
    if (style === 'cloth') {
      // 地面投影
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.beginPath(); ctx.ellipse(tc.x, tc.y + out * 2.35, out * 1.5, out * 0.28, 0, 0, 7); ctx.fill();
      // 木腿（A 字）
      ctx.fillStyle = '#5a4128';
      for (const s of [-1, 1]) {
        ctx.save(); ctx.translate(tc.x + s * out * 0.55, tc.y + out * 1.1);
        ctx.rotate(s * 0.16);
        ctx.beginPath(); ctx.roundRect(-out * 0.09, 0, out * 0.18, out * 1.3, out * 0.06); ctx.fill();
        ctx.restore();
      }
      // 剁草靶垛（圆角矩形，草杆色渐变 + 麻布包边）
      const bw = out * 2.5, bh = out * 2.7, bx0 = tc.x - bw / 2, by0 = tc.y - out * 1.15;
      const g = ctx.createLinearGradient(bx0, by0, bx0, by0 + bh);
      g.addColorStop(0, '#d3bd8f'); g.addColorStop(0.5, '#c9b489'); g.addColorStop(1, '#a8935f');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(bx0, by0, bw, bh, out * 0.35); ctx.fill();
      // 草杆竖纹
      ctx.strokeStyle = 'rgba(90,68,32,.35)'; ctx.lineWidth = Math.max(1, out * 0.03);
      for (let i = -6; i <= 6; i++) {
        const x = tc.x + i * bw / 14;
        ctx.beginPath(); ctx.moveTo(x, by0 + out * 0.12); ctx.lineTo(x + i * 0.4, by0 + bh - out * 0.12); ctx.stroke();
      }
      // 麻布包边
      ctx.strokeStyle = '#8f7a50'; ctx.lineWidth = out * 0.12;
      ctx.beginPath(); ctx.roundRect(bx0, by0, bw, bh, out * 0.35); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = out * 0.04;
      ctx.beginPath(); ctx.roundRect(bx0 + out * 0.1, by0 + out * 0.1, bw - out * 0.2, bh - out * 0.2, out * 0.28); ctx.stroke();
    } else if (style === 'straw') {
      // 草靶垛（青松谷/雪岭）：圆形草靶 + A 字木腿；移动靶时横向加长盖住行程
      const baked = this.scene.def.br * BG_IMG_H * bgScale(innerWidth, innerHeight);
      const travel = this.moving > 0 ? this.ringR * 9 : 0;
      const rb = Math.max(out * 1.3, baked + 3);        // 垛体半径
      const halfW = Math.max(rb, baked + travel + 4);   // 横向半宽（覆盖移动行程）
      const groundY = tc.y + rb * 1.72;
      // 地面投影
      ctx.fillStyle = 'rgba(0,0,0,.26)';
      ctx.beginPath(); ctx.ellipse(tc.x, groundY + 2, halfW * 0.72, Math.max(3, rb * 0.16), 0, 0, 7); ctx.fill();
      // A 字木腿（左右各一对斜腿）
      ctx.lineCap = 'round';
      const legW = Math.max(2.5, rb * 0.09);
      for (const s of [-1, 1]) {
        const lx = tc.x + s * rb * 0.52;
        ctx.strokeStyle = '#4a3420'; ctx.lineWidth = legW + 1.5;
        ctx.beginPath(); ctx.moveTo(lx, tc.y + rb * 0.35); ctx.lineTo(lx - s * rb * 0.30, groundY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx, tc.y + rb * 0.35); ctx.lineTo(lx + s * rb * 0.30, groundY); ctx.stroke();
        ctx.strokeStyle = '#7a5834'; ctx.lineWidth = legW;
        ctx.beginPath(); ctx.moveTo(lx, tc.y + rb * 0.35); ctx.lineTo(lx - s * rb * 0.30, groundY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx, tc.y + rb * 0.35); ctx.lineTo(lx + s * rb * 0.30, groundY); ctx.stroke();
      }
      // 草靶垛（胶囊形：静态≈圆垛，移动靶为横向长垛）
      const bx0 = tc.x - halfW, by0 = tc.y - rb;
      const g = ctx.createLinearGradient(bx0, by0, bx0, by0 + rb * 2);
      g.addColorStop(0, '#dcc38f'); g.addColorStop(0.5, '#c8ac72'); g.addColorStop(1, '#9d8148');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(bx0, by0, halfW * 2, rb * 2, rb); ctx.fill();
      // 竖向草杆纹
      ctx.strokeStyle = 'rgba(96,70,30,.28)'; ctx.lineWidth = Math.max(0.8, rb * 0.02);
      const nSt = Math.max(8, Math.round(halfW * 2 / Math.max(6, rb * 0.16)));
      for (let i = 0; i <= nSt; i++) {
        const x = bx0 + (i / nSt) * halfW * 2;
        ctx.beginPath(); ctx.moveTo(x, by0 + rb * 0.1);
        ctx.lineTo(x + Math.sin(i * 2.3) * rb * 0.03, by0 + rb * 1.9); ctx.stroke();
      }
      // 深色捆边 + 两端麻绳捆扎线 + 顶部受光
      ctx.strokeStyle = '#6e5426'; ctx.lineWidth = Math.max(1.5, rb * 0.06);
      ctx.beginPath(); ctx.roundRect(bx0, by0, halfW * 2, rb * 2, rb); ctx.stroke();
      ctx.strokeStyle = 'rgba(74,52,32,.8)'; ctx.lineWidth = Math.max(1.2, rb * 0.045);
      for (const s of [-1, 1]) {
        const rx = tc.x + s * (halfW - rb * 0.28);
        ctx.beginPath(); ctx.moveTo(rx, by0 + rb * 0.06); ctx.lineTo(rx, by0 + rb * 1.94); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,244,210,.25)'; ctx.lineWidth = Math.max(1, rb * 0.04);
      ctx.beginPath(); ctx.moveTo(bx0 + rb * 0.4, by0 + rb * 0.12);
      ctx.lineTo(bx0 + halfW * 2 - rb * 0.4, by0 + rb * 0.12); ctx.stroke();
    } else if (style === 'astra') {
      // 符文浮盘（星坠荒原）：深空石盘 + 金辉描边 + 盘缘符文，悬浮无腿
      const baked = this.scene.def.br * BG_IMG_H * bgScale(innerWidth, innerHeight);
      const travel = this.moving > 0 ? this.ringR * 9 : 0;
      const rr = Math.max(out * 1.38, baked + 5);
      const halfW = Math.max(rr, baked + travel + 6);
      // 悬浮投影
      ctx.fillStyle = 'rgba(0,0,0,.30)';
      ctx.beginPath(); ctx.ellipse(tc.x, tc.y + rr * 1.6, halfW * 0.5, Math.max(2.5, rr * 0.12), 0, 0, 7); ctx.fill();
      // 金辉光晕
      const halo = ctx.createRadialGradient(tc.x, tc.y, rr * 0.4, tc.x, tc.y, halfW * 1.5);
      halo.addColorStop(0, 'rgba(245,197,66,.20)'); halo.addColorStop(1, 'rgba(245,197,66,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(tc.x, tc.y, halfW * 1.5, 0, 7); ctx.fill();
      // 石盘（胶囊形，深空紫渐变）
      const bx0 = tc.x - halfW, by0 = tc.y - rr;
      const g = ctx.createLinearGradient(bx0, by0, bx0, by0 + rr * 2);
      g.addColorStop(0, '#352b60'); g.addColorStop(0.5, '#241d46'); g.addColorStop(1, '#150f2e');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(bx0, by0, halfW * 2, rr * 2, rr); ctx.fill();
      // 金色发光描边
      ctx.save();
      ctx.shadowColor = 'rgba(245,197,66,.9)'; ctx.shadowBlur = Math.max(4, rr * 0.16);
      ctx.strokeStyle = '#e9bd55'; ctx.lineWidth = Math.max(1.2, rr * 0.05);
      ctx.beginPath(); ctx.roundRect(bx0, by0, halfW * 2, rr * 2, rr); ctx.stroke();
      ctx.restore();
      // 盘缘符文刻点（椭圆布点）
      ctx.fillStyle = 'rgba(245,197,66,.7)';
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(tc.x + Math.cos(a) * (halfW - rr * 0.12) * 0.92, tc.y + Math.sin(a) * rr * 0.86,
          Math.max(0.8, rr * 0.03), 0, 7);
        ctx.fill();
      }
      // 底部青色晶光
      const cg = ctx.createRadialGradient(tc.x, by0 + rr * 2, 1, tc.x, by0 + rr * 2, rr * 0.9);
      cg.addColorStop(0, 'rgba(120,230,255,.28)'); cg.addColorStop(1, 'rgba(120,230,255,0)');
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(tc.x, by0 + rr * 2, rr * 0.9, 0, 7); ctx.fill();
    } else {
      // 赛事靶架：方形泡沫靶垛 + 三脚铝架 + 顶部靶纸夹（参考 WA 赛事靶架）
      // 靶垛必须盖住背景烘焙靶（含移动靶行程）
      const baked = this.scene.def.br * BG_IMG_H * bgScale(innerWidth, innerHeight);
      const travel = this.moving > 0 ? this.ringR * 9 : 0;
      const bw = Math.max(out * 2.6, (baked + travel) * 2.15);
      const bh = bw * 1.02;
      const bx0 = tc.x - bw / 2, by0 = tc.y - bh * 0.52;
      const legTop = by0 + bh * 0.55, legBot = by0 + bh + Math.max(10, out * 0.85);
      // 地面投影
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.beginPath(); ctx.ellipse(tc.x, legBot + 2, bw * 0.4, Math.max(3, out * 0.18), 0, 0, 7); ctx.fill();
      // 三脚支架（两条外八前腿 + 中撑杆，铝灰色）
      const lw = Math.max(2.5, out * 0.09);
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#45494f'; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(tc.x - bw * 0.16, legTop); ctx.lineTo(tc.x - bw * 0.33, legBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tc.x + bw * 0.16, legTop); ctx.lineTo(tc.x + bw * 0.33, legBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tc.x, legTop + bh * 0.08); ctx.lineTo(tc.x, legBot); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(tc.x - bw * 0.16 - 1, legTop); ctx.lineTo(tc.x - bw * 0.33 - 1, legBot); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tc.x - 1, legTop + bh * 0.08); ctx.lineTo(tc.x - 1, legBot); ctx.stroke();
      // 泡沫靶垛（米白渐变 + 投影 + 深色封边）
      ctx.fillStyle = 'rgba(0,0,0,.32)';
      ctx.beginPath(); ctx.roundRect(bx0 + 4, by0 + 6, bw, bh, Math.max(4, out * 0.2)); ctx.fill();
      const g = ctx.createLinearGradient(bx0, by0, bx0 + bw, by0 + bh);
      g.addColorStop(0, '#e6e1d4'); g.addColorStop(0.5, '#d6d0be'); g.addColorStop(1, '#b3ac9b');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(bx0, by0, bw, bh, Math.max(4, out * 0.2)); ctx.fill();
      ctx.strokeStyle = '#87816f'; ctx.lineWidth = Math.max(1.5, out * 0.06);
      ctx.beginPath(); ctx.roundRect(bx0, by0, bw, bh, Math.max(4, out * 0.2)); ctx.stroke();
      // 泡沫层压横纹（靶垛材质）
      ctx.strokeStyle = 'rgba(120,112,92,.18)'; ctx.lineWidth = 1;
      for (let i = 1; i < 5; i++) {
        const yy = by0 + (bh * i) / 5;
        ctx.beginPath(); ctx.moveTo(bx0 + 3, yy); ctx.lineTo(bx0 + bw - 3, yy); ctx.stroke();
      }
      // 靶纸夹（顶部两枚黑夹，带高光）
      for (const s of [-1, 1]) {
        const cxp = tc.x + s * out * 7.0;
        ctx.fillStyle = '#22252b';
        ctx.beginPath(); ctx.roundRect(cxp - out * 0.26, by0 - out * 0.16, out * 0.52, out * 0.46, 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.22)';
        ctx.fillRect(cxp - out * 0.26, by0 - out * 0.16, out * 0.52, out * 0.09);
      }
    }
    ctx.restore();
  }
  // 右上角模拟显示器：放大呈现靶面中心与本次弹孔
  _drawMonitor(ctx, w, shot) {
    const S = Math.max(90, Math.min(150, w * 0.34));
    const mx = w - S - 14, my = 64;
    const rr = this.ringR, style = this.scene.def.targetStyle;
    ctx.save();
    // 机身 bezel
    ctx.fillStyle = 'rgba(10,12,16,.92)';
    ctx.beginPath(); ctx.roundRect(mx - 6, my - 6, S + 12, S + 34, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(mx - 6, my - 6, S + 12, S + 34, 10); ctx.stroke();
    // 屏幕
    ctx.save();
    ctx.beginPath(); ctx.roundRect(mx, my, S, S, 4); ctx.clip();
    ctx.fillStyle = '#14171d'; ctx.fillRect(mx, my, S, S);
    // 放大靶面：视野约 3.2 倍环宽半径，命中点居中
    const k = Math.max(0.5, (S * 0.5 - 10) / (rr * 3.2));
    drawTarget(ctx, mx + S / 2 - shot.dx * k, my + S / 2 - shot.dy * k, rr * k, 1, false, style);
    // 弹孔在屏幕中心
    ctx.fillStyle = 'rgba(20,14,8,.9)';
    ctx.beginPath(); ctx.arc(mx + S / 2, my + S / 2, Math.max(2, rr * k * 0.16), 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,95,31,.65)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(mx + S / 2, my + S / 2, Math.max(3.5, rr * k * 0.26), 0, 7); ctx.stroke();
    // 扫描线
    ctx.fillStyle = 'rgba(255,255,255,.04)';
    for (let y = my; y < my + S; y += 3) ctx.fillRect(mx, y, S, 1);
    ctx.restore();
    // 录制红点 + 角标
    ctx.fillStyle = '#e05252';
    ctx.beginPath(); ctx.arc(mx + 4, my + S + 12, 3, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(236,231,221,.85)';
    ctx.font = '600 11px ui-monospace, monospace'; ctx.textAlign = 'left';
    ctx.fillText(`第${this.shots.length}箭 · ${shot.x ? 'X' : shot.score}环`, mx + 12, my + S + 16);
    ctx.restore();
  }
  // 弹道尾迹：暖金色渐变轨迹，越靠箭尖越亮越粗
  _trail(ctx, trail, alphaMul = 1) {
    if (!trail || trail.length < 2 || alphaMul <= 0) return;
    for (let i = 1; i < trail.length; i++) {
      const k = i / trail.length;
      ctx.strokeStyle = `rgba(255,214,150,${(k * 0.55 * alphaMul).toFixed(3)})`;
      ctx.lineWidth = 1 + k * 1.8;
      ctx.beginPath(); ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y); ctx.stroke();
    }
  }
  // 画一支箭：tx/ty=箭尖位置，ang=飞行方向，len=露出杆长，quiver=绕箭尖的颤动角
  _arrow(ctx, tx, ty, ang, len, quiver = 0) {
    ctx.save(); ctx.translate(tx, ty); ctx.rotate(quiver);
    const dx = Math.cos(ang), dy = Math.sin(ang);
    const bx = -dx * len, by = -dy * len; // 杆尾
    // 木杆 + 受光细线
    ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = Math.max(2, len * 0.075); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,230,190,.32)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(-dy * 1.1, dx * 1.1); ctx.lineTo(bx - dy * 1.1, by + dx * 1.1); ctx.stroke();
    // 尾部箭羽（双色两片）
    const fx = bx + dx * len * 0.28, fy = by + dy * len * 0.28;
    for (const s of [1, -1]) {
      ctx.fillStyle = s > 0 ? 'rgba(255,95,31,.85)' : 'rgba(236,231,221,.75)';
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(bx - dy * len * 0.22 * s, by + dx * len * 0.22 * s);
      ctx.lineTo(fx + dx * len * 0.16, fy + dy * len * 0.16);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  press() {
    if (this.state !== 'idle') return;
    this.state = 'drawing'; this.stateT = 0;
    this.holdSec = 0; this.power = 0; this.samples = [];
    sfx('draw');
  }
  release(input) {
    if (this.state !== 'drawing') return;
    const p = this.power;
    const aimX = input.x + this.sway.x, aimY = input.y + this.sway.y;
    // 拉弓不足 → 箭速低 → 下落大、受风大；弓种箭速影响下落与风漂
    const dm = this.bowCfg.dropMul;
    const drop = ((1 - p) * this.ringR * 2.2 + this.ringR * 0.12 * (this.dist / 50)) * dm;
    const windDrift = this.sway.env.wind * this.sway.windDir *
      (this.dist / 30) * (1.3 - p) * this.ringR * 0.6 * dm;
    const impact = { x: aimX + windDrift, y: aimY + drop };
    // 稳定度：拉弓期间轨迹围绕其均值的 RMS
    let steady = 60;
    if (this.samples.length > 5) {
      const mx = this.samples.reduce((s, q) => s + q.x, 0) / this.samples.length;
      const my = this.samples.reduce((s, q) => s + q.y, 0) / this.samples.length;
      const rms = Math.sqrt(this.samples.reduce((s, q) => s + (q.x - mx) ** 2 + (q.y - my) ** 2, 0) / this.samples.length);
      steady = clamp(Math.round(100 - rms * 3.2), 1, 100);
    }
    this.flight = { impact, power: p, steady, holdSec: this.holdSec, t: 0,
      trail: [], // 弹道采样点
      isLast: this.shots.length + 1 >= this.arrows }; // 仅最后一箭放大靶面
    this.state = 'flying'; this.stateT = 0;
    sfx('release');
  }
  update(dt, t, input) {
    this.sway.update(dt, this.state === 'drawing' ? this.holdSec : 0);
    this.stateT += dt;
    // 视差平移：世界随瞄准点轻微反向移动（目标/背景一体）
    // 实景模式：靶面锚定在真实方向——陀螺转角整体平移靶位，准星留在屏幕中心附近
    if (this.theme === 'ar') {
      this.panX = -(input.worldX || 0);
      this.panY = -(input.worldY || 0);
    } else {
      this.panX = -(input.x + this.sway.x) * 0.10;
      this.panY = -(input.y + this.sway.y) * 0.10;
    }
    if (this.state === 'intro') {
      this.introT += dt;
      if (this.introT >= this.introDur) { this.state = 'idle'; this.stateT = 0; }
      return;
    }
    if (this.state === 'drawing') {
      this.holdSec += dt;
      this.power = clamp(this.power + dt / 0.9, 0, 1);
      const ax = input.x + this.sway.x, ay = input.y + this.sway.y;
      this.samples.push({ x: ax, y: ay });
      if (this.samples.length > 240) this.samples.shift();
      // 实时稳定度：近 0.8s 瞬时速度
      const n = Math.min(this.samples.length, 48);
      if (n > 4) {
        let v = 0;
        for (let i = this.samples.length - n + 1; i < this.samples.length; i++)
          v += Math.hypot(this.samples[i].x - this.samples[i - 1].x, this.samples[i].y - this.samples[i - 1].y);
        this.steady = clamp(100 - (v / n) * 26, 0, 100);
      }
    } else if (this.state === 'flying') {
      this.flight.t += dt;
      // 只有最后一箭飞行时推近靶面
      this.zoom = lerp(this.zoom, this.flight.isLast ? 2.4 : 1, dt * 5);
      // 弹道采样：抛物线弧（中段上拱、末端下落），逐帧记录供尾迹绘制
      const f = Math.min(1, this.flight.t / FLIGHT_T);
      const cx = innerWidth / 2, cy = innerHeight * 0.46;
      const sx = cx + (input.x + this.sway.x) * (1 - f) * 0.4, sy = innerHeight * 0.95;
      const ex = cx + this.flight.impact.x, ey = cy + this.flight.impact.y;
      const arcH = clamp(this.ringR * 6 * (0.5 + this.dist / 100), 10, 70);
      this.flight.trail.push({
        x: lerp(sx, ex, f * f),
        y: lerp(sy, ey, f * f) - arcH * Math.sin(Math.PI * f)
      });
      if (this.flight.t > FLIGHT_T) {
        // 命中判定（相对当前靶心，移动靶按命中时刻位置）
        const tc = this.targetCenter(t);
        const dx = this.flight.impact.x - (tc.x - innerWidth / 2);
        const dy = this.flight.impact.y - (tc.y - innerHeight * 0.46);
        const { score, x } = scoreOf(Math.hypot(dx, dy), this.ringR);
        const shot = { ...this.flight, score, x, dx, dy };
        // 插靶角度：箭飞行方向的反向（从弹孔指向射手/屏幕下方）
        shot.stickAng = Math.atan2(-(ey - innerHeight * 0.95), -(this.flight.impact.x));
        this.shots.push(shot);
        this.total += score;
        this.onShot?.(shot, this.shots.length, this.arrows);
        sfx(score >= 9 ? 'gold' : 'hit');
        this.spawnFx(shot, t);
        this.state = 'mark'; this.stateT = 0;
      }
    } else if (this.state === 'mark') {
      this._updateFx(dt);
      if (this.stateT > this.markDur) {
        this.zoom = 1;
        if (this.shots.length >= this.arrows) { this.state = 'done'; this.onEnd?.(this.shots, this.total); }
        else this.state = 'idle';
      }
    } else {
      this.zoom = lerp(this.zoom, 1, dt * 5);
    }
  }
  draw(ctx, w, h, t, input) {
    // 入场运镜：世界整体从俯瞰（放大+上抬）缓动到射手就位（easeOutCubic）
    let iz = 1, iDy = 0;
    if (this.state === 'intro') {
      const f = clamp(this.introT / this.introDur, 0, 1);
      const e = 1 - Math.pow(1 - f, 3);
      iz = lerp(2.4, 1, e); iDy = lerp(-h * 0.22, 0, e);
    }
    ctx.save();
    if (iz !== 1 || iDy !== 0) {
      const anc = this.scene.anchor(w, h);
      ctx.translate(anc.x, anc.y); ctx.scale(iz, iz); ctx.translate(-anc.x, -anc.y);
      ctx.translate(0, iDy);
    }
    // 瞄准时背景虚化（景深），靶面与瞄具保持清晰
    ctx.save();
    if (this.state === 'drawing' && 'filter' in ctx) ctx.filter = 'blur(3px)';
    this.scene.draw(ctx, w, h, t, this.panX || 0, this.panY || 0);
    ctx.restore();
    const tc = this.targetCenter(t);
    const cx = w / 2, cy = h * 0.46;
    // 距离牌（置于靶面/靶垛下方）
    let labDy = this.ringR * 10 + Math.max(18, this.ringR * 2.4);
    const ts0 = this.scene.def.targetStyle;
    if (ts0 === 'paper') {
      // 纸靶：牌子挂在靶垛底沿之下
      const bakedL = this.scene.def.br * BG_IMG_H * bgScale(w, h);
      const travelL = this.moving > 0 ? this.ringR * 9 : 0;
      const bwL = Math.max(this.ringR * 26, (bakedL + travelL) * 2.15);
      labDy = bwL * 1.02 * 0.48 + Math.max(14, this.ringR * 1.6);
    } else if (ts0 === 'straw' || ts0 === 'astra') {
      // 草垛/浮盘：牌子挂在垛体底沿之下
      const bakedL = this.scene.def.br * BG_IMG_H * bgScale(w, h);
      const rbL = Math.max(this.ringR * 10 * (ts0 === 'astra' ? 1.38 : 1.3), bakedL + 4);
      labDy = rbL + Math.max(13, this.ringR * 1.8);
    }
    const labText = `${this.dist}M`;
    const labFs = Math.max(11, this.ringR * 0.9);
    ctx.font = `600 ${labFs}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    const labW = ctx.measureText(labText).width;
    // 深色底牌保证在各种背景上可读
    ctx.fillStyle = 'rgba(10,12,16,.55)';
    ctx.beginPath();
    ctx.roundRect(tc.x - labW / 2 - 7, tc.y + labDy - labFs * 0.85 - 3, labW + 14, labFs + 8, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 3;
    ctx.fillText(labText, tc.x, tc.y + labDy);
    ctx.shadowBlur = 0;
    // 靶面（复合弓瞄镜微放大；飞行时推近）
    const z = this.zoom * this.bowCfg.zoom;
    ctx.save();
    if (z > 1.01) {
      ctx.translate(tc.x, tc.y); ctx.scale(z, z); ctx.translate(-tc.x, -tc.y);
    }
    // 中靶抖动
    if (this.shake > 0.1)
      ctx.translate((Math.random() * 2 - 1) * this.shake, (Math.random() * 2 - 1) * this.shake);
    // 靶挡/靶架：布靶按需挡板；草靶/星辉/纸靶始终用靶架（垛体盖住烘焙靶）
    const baked = this.scene.def.br * BG_IMG_H * bgScale(w, h);
    const out = this.ringR * 10;
    const hasPanel = this.scene.def.targetStyle === 'cloth' && out < baked * 0.98;
    if (hasPanel) {
      const base = this.scene.anchor(w, h, this.panX || 0, this.panY || 0);
      const travel = this.moving > 0 ? this.ringR * 9 : 0;
      const pw = (baked + travel) * 2 + Math.max(18, baked * 0.3), ph = baked * 2.6;
      const px = base.x - pw / 2, py = base.y - ph * 0.44;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath(); ctx.roundRect(px + 5, py + 7, pw, ph, 14); ctx.fill();
      const g = ctx.createLinearGradient(px, 0, px + pw, 0);
      g.addColorStop(0, this.scene.def.panel[0]); g.addColorStop(1, this.scene.def.panel[1]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 14); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(px + 3, py + 3, pw - 6, ph - 6, 11); ctx.stroke();
    } else {
      // 布靶=剁草麻布靶垛+木腿 / 纸靶=赛事靶架
      this._drawStand(ctx, tc, out);
    }
    drawTarget(ctx, tc.x, tc.y, this.ringR, 1, false, this.scene.def.targetStyle);
    // 插靶的箭（杆身从弹孔向射手方向支出，最新一支带高频颤动）
    this.shots.forEach((s, idx) => {
      const isNew = idx === this.shots.length - 1 && this.state === 'mark';
      const quiver = isNew ? Math.sin(this.stateT * 38) * 0.10 * Math.exp(-this.stateT * 5) : 0;
      this._arrow(ctx, tc.x + s.dx, tc.y + s.dy, s.stickAng + Math.PI,
        Math.max(22, this.ringR * 3.2), quiver);
    });
    // 弹孔（压在箭杆根部之上，像入靶口）
    for (const s of this.shots) {
      ctx.fillStyle = 'rgba(20,14,8,.9)';
      ctx.beginPath(); ctx.arc(tc.x + s.dx, tc.y + s.dy, Math.max(2, this.ringR * 0.16), 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,95,31,.65)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(tc.x + s.dx, tc.y + s.dy, Math.max(3.5, this.ringR * 0.26), 0, 7); ctx.stroke();
    }
    // 弹道尾迹 + 飞箭（按 update 采样轨迹绘制）
    if (this.state === 'flying' && this.flight && this.flight.trail.length > 1) {
      const tr = this.flight.trail;
      this._trail(ctx, tr, 1);
      const tip = tr[tr.length - 1], prev = tr[tr.length - 2];
      this._arrow(ctx, tip.x, tip.y, Math.atan2(tip.y - prev.y, tip.x - prev.x), 17);
    } else if (this.state === 'mark' && this.shots.length) {
      // 命中后尾迹快速淡出
      this._trail(ctx, this.shots[this.shots.length - 1].trail, Math.max(0, 1 - this.stateT * 2));
    }
    ctx.restore();
    ctx.restore(); // 入场运镜
    // 瞄具（入场/飞行/命中展示时隐藏）
    if (this.state !== 'intro' && this.state !== 'flying' && this.state !== 'mark') {
      const ax = cx + input.x + this.sway.x, ay = cy + input.y + this.sway.y;
      const bow = this.bowCfg.id;
      const active = this.state === 'drawing';
      if (bow === 'trad') this._tradArrow(ctx, ax, ay, w, h, active);
      else if (bow === 'recurve') this._recurveSight(ctx, ax, ay, h, active);
      else this._compoundScope(ctx, cx, cy, ax, ay, w, h, active);
      // 下落补偿参考点
      if (this.assist) {
        const dm = this.bowCfg.dropMul;
        const drop = ((1 - this.power) * this.ringR * 2.2 + this.ringR * 0.12 * (this.dist / 50)) * dm;
        ctx.strokeStyle = 'rgba(141,140,136,.5)'; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.arc(ax, ay + drop * this.bowCfg.zoom, 5, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // 命中特效（屏坐标，不随瞄准点晃动）
    this._drawFx(ctx);
    // 非最后一箭：右上角模拟显示器，呈现放大后的靶面中心
    const lastShot = this.shots[this.shots.length - 1];
    if (this.state === 'mark' && lastShot && !lastShot.isLast)
      this._drawMonitor(ctx, w, lastShot);
    // 风向袋
    if (this.sway.env.wind > 0) {
      const fx = w * 0.12, fy = h * 0.62, fl = 34;
      const swayA = this.sway.gustLevel * 0.5 * this.sway.windDir;
      ctx.strokeStyle = 'rgba(236,231,221,.4)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 46); ctx.stroke();
      ctx.save(); ctx.translate(fx, fy - 46); ctx.rotate(swayA);
      ctx.fillStyle = '#ff5f1f';
      const len = fl * (0.4 + this.sway.gustLevel * 0.6) * this.sway.windDir;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, -5); ctx.lineTo(len, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }
}
