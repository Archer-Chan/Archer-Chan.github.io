// 持弓晃动模型（纯算法）：环境参数 + 呼吸/震颤/漂移/阵风合成
import { clamp, vnoise } from './math.js';

export const ENVS = {
  indoor: { name: '室内',   breath: 5.0, tremor: 1.1, drift: 2.5, gust: 0,  wind: 0 },
  breeze: { name: '户外微风', breath: 6.0, tremor: 1.3, drift: 3.5, gust: 9,  wind: 1.6 },
  windy:  { name: '户外阵风', breath: 7.5, tremor: 1.7, drift: 5.5, gust: 24, wind: 4.2 },
  ar:     { name: '实景',   breath: 4.5, tremor: 1.0, drift: 2.5, gust: 0,  wind: 0 }
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
    const fm = this.fatigueMul || 1;
    const fatigue = (holdSec < 4 ? holdSec * 0.06 : 0.24 + (holdSec - 4) * 0.22) * fm;
    const m = 1 + fatigue;
    const w = t * 2 * Math.PI * 0.21; // 呼吸 ~0.21Hz
    this.breathPhase = Math.sin(w);
    // 稳→浮：幅度 0.25x ~ 1.75x，呼气末几乎钉住、吸气顶明显放大
    const phaseMul = 1 + 0.75 * this.breathPhase;
    const breathY = Math.sin(w) * e.breath;
    const breathX = Math.sin(w + 1.2) * e.breath * 0.4;
    // 莫比乌斯环式慢漂：近倍频双正弦 + 相位差 → 空中画 8 字（狙击镜式自然波动）
    const mobX = Math.sin(t * 2.1) * e.tremor * 0.9;
    const mobY = Math.sin(t * 4.2 + 1.1) * e.tremor * 0.65;
    // 轻微细颤（高频成分大幅削减，不再"嗡嗡"抖）
    const tremorX = (Math.sin(t * 18.5) + Math.sin(t * 24.7 + 0.7)) * 0.5 * e.tremor * 0.28;
    const tremorY = (Math.sin(t * 20.3 + 1.9) + Math.sin(t * 26.1)) * 0.5 * e.tremor * 0.28;
    const driftX = vnoise(t * 0.33, 3.7) * e.drift;
    const driftY = vnoise(t * 0.28, 9.1) * e.drift * 0.7;
    const g = Math.max(0, vnoise(t * 0.45, 17.3));
    this.gust += (g * e.gust - this.gust) * Math.min(1, dt * 1.6);
    this.gustLevel = e.gust > 0 ? clamp(this.gust / e.gust, 0, 1) : 0;
    this.x = (breathX + mobX + tremorX + driftX) * m * phaseMul + this.gust * this.windDir * m;
    this.y = (breathY + mobY + tremorY + driftY) * m * phaseMul - this.gust * 0.18 * m;
  }
}
