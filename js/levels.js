// 闯关关卡数据：三个秘境 × 三关，高尔夫式沿路径解锁
// pass=解锁下一关所需总环；star2/star3=二星/三星线
export const ZONES = [
  { id: 'forest', name: '青松谷',   theme: 'forest', shape: 'circle'   },
  { id: 'snow',   name: '雪岭',     theme: 'snow',   shape: 'triangle' },
  { id: 'astra',  name: '星坠荒原', theme: 'astra',  shape: 'hex'      }
];

export const LEVELS = [
  { id: 1, zone: 'forest', bow: 'trad',     name: '初入林径',   dist: 18, env: 'indoor', arrows: 6, moving: 0,    pass: 30, star2: 38, star3: 46 },
  { id: 2, zone: 'forest', bow: 'trad',     name: '林间微风',   dist: 30, env: 'breeze', arrows: 6, moving: 0,    pass: 34, star2: 42, star3: 50 },
  { id: 3, zone: 'forest', bow: 'trad',     name: '鹿影穿梭',   dist: 30, env: 'breeze', arrows: 5, moving: 0.6,  pass: 28, star2: 34, star3: 41 },
  { id: 4, zone: 'snow',   bow: 'recurve',  name: '雪线',       dist: 50, env: 'breeze', arrows: 6, moving: 0,    pass: 34, star2: 42, star3: 50 },
  { id: 5, zone: 'snow',   bow: 'recurve',  name: '呼啸山口',   dist: 50, env: 'windy',  arrows: 6, moving: 0,    pass: 32, star2: 40, star3: 47 },
  { id: 6, zone: 'snow',   bow: 'recurve',  name: '冰湖游靶',   dist: 50, env: 'windy',  arrows: 5, moving: 0.8,  pass: 26, star2: 32, star3: 39 },
  { id: 7, zone: 'astra',  bow: 'compound', name: '星尘试炼',   dist: 70, env: 'windy',  arrows: 6, moving: 0,    pass: 32, star2: 40, star3: 47 },
  { id: 8, zone: 'astra',  bow: 'compound', name: '浮岛疾风',   dist: 70, env: 'windy',  arrows: 5, moving: 1.0,  pass: 25, star2: 31, star3: 38 },
  { id: 9, zone: 'astra',  bow: 'compound', name: '传说 · 一箭', dist: 70, env: 'windy',  arrows: 3, moving: 1.3,  pass: 20, star2: 24, star3: 28 }
];

export function loadProgress() {
  try { return JSON.parse(localStorage.getItem('xj_progress') || '{}'); } catch { return {}; }
}
export function saveProgress(p) { localStorage.setItem('xj_progress', JSON.stringify(p)); }
export function starsOf(level, score) {
  if (score >= level.star3) return 3;
  if (score >= level.star2) return 2;
  if (score >= level.pass) return 1;
  return 0;
}
export function isUnlocked(level, progress) {
  if (level.id === 1) return true;
  const prev = LEVELS[level.id - 2];
  return (progress[prev.id]?.stars || 0) > 0;
}
