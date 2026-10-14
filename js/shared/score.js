// 计分与靶面尺寸换算（纯算法）
import { AR } from './pose.js';
import { BG_DEFS } from './data.js';

export const BG_IMG_W = 832, BG_IMG_H = 1216;

export function bgScale(w, h) { return Math.max(w / BG_IMG_W, h / BG_IMG_H); }

// mode='sport'（竞技）：背景烘焙靶在参考距离恰好被覆盖，其余距离按透视缩放，钳制 [0.45,1.9]；
// mode='real'（写实）：按 25cm 持机视距还原真实张角（1 CSS px ≈ 0.2646mm），
//   半径 = 250mm·D/(2·L)/0.2646 ≈ 472.7·D/L，D 为靶面真实直径（纸靶 122cm / 布靶 80cm）
export function outerR(dist, bgKey, w, h, mode = 'sport') {
  const c = BG_DEFS[bgKey] || BG_DEFS.dojo;
  if (bgKey === 'ar') {
    // 实景：按摄像头水平视场的真实张角（1.22m 靶纸），1.5× 可读性放大
    const k = w / AR.fov; // 1° ≈ 多少 px
    return Math.max(6, Math.atan(0.61 / dist) * (180 / Math.PI) * k * 1.5);
  }
  if (mode === 'real') {
    const D = c.targetStyle === 'paper' ? 1.22 : 0.80;
    return Math.max(5, 472.7 * D / dist);
  }
  const k = Math.min(1.9, Math.max(0.45, c.refDist / dist));
  return c.br * BG_IMG_H * bgScale(w, h) * k * (c.sizeMul || 1);
}

export function scoreOf(distPx, ringR) {
  const r = distPx / ringR;
  if (r > 10) return { score: 0, x: false };
  if (r <= 0.5) return { score: 10, x: true };
  return { score: Math.max(1, Math.ceil(10 - r)), x: false };
}
