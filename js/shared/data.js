// 纯数据与规则：关卡 / 秘境 / 弓种 / 星级 / 解锁 / 场景标定（无任何存储副作用）

// 场景背景标定（bx/by/br：背景烘焙靶心的相对位置与半径（相对 1216 高）；refDist：该尺寸对应的参考距离）
// 游戏靶面由 Canvas 按 refDist/dist 缩放实时绘制，近大远小，覆盖烘焙靶
// targetStyle: cloth=布纹 / paper=纸张 / straw=草靶 / astra=星辉；sizeMul: 场景靶面整体缩放修正
export const BG_DEFS = {
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

export const ZONES = [
  { id: 'forest', name: '青松谷',   theme: 'forest', shape: 'circle'   },
  { id: 'snow',   name: '雪岭',     theme: 'snow',   shape: 'triangle' },
  { id: 'astra',  name: '星坠荒原', theme: 'astra',  shape: 'hex'      }
];

// pass=解锁下一关所需总环；star2/star3=二星/三星线
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

// swayMul 晃动倍率 / fatigueMul 疲劳增速倍率 / dropMul 下落倍率 / zoom 视野放大
export const BOWS = {
  trad:     { id: 'trad',     name: '传统弓', sight: '箭头尖参考',
              swayMul: 1.3,  fatigueMul: 1.2,  dropMul: 1.45, zoom: 1.0,  assist: false },
  recurve:  { id: 'recurve',  name: '反曲弓', sight: '单针瞄',
              swayMul: 1.0,  fatigueMul: 1.0,  dropMul: 1.0,  zoom: 1.0,  assist: true },
  compound: { id: 'compound', name: '复合弓', sight: '窥孔 + 瞄镜',
              swayMul: 0.6,  fatigueMul: 0.45, dropMul: 0.55, zoom: 1.32, assist: true }
};

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
