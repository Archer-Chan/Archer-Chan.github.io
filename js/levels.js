// 闯关进度读写（localStorage）；关卡/秘境/弓种数据见 shared/data.js
export function loadProgress() {
  try { return JSON.parse(localStorage.getItem('xj_progress') || '{}'); } catch { return {}; }
}
export function saveProgress(p) { localStorage.setItem('xj_progress', JSON.stringify(p)); }
