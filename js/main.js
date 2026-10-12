// 主控：屏幕路由、对局调度、训练报告、闯关地图
import { clamp, AimInput, sfx, BOWS, setArFov } from './core.js';
import { Scene, RangeSession, drawTarget, outerR } from './engine.js';
import { ZONES, LEVELS, loadProgress, saveProgress, starsOf, isUnlocked } from './levels.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
let DPR = 1;
function resize() {
  DPR = Math.min(devicePixelRatio || 1, 2);
  canvas.width = innerWidth * DPR; canvas.height = innerHeight * DPR;
}
addEventListener('resize', resize); resize();

const input = new AimInput(canvas);
input.bind();

// ---------- 移动端触摸加固：禁系统二级菜单 / 框选 / 手势缩放 ----------
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('selectstart', (e) => e.preventDefault());
addEventListener('gesturestart', (e) => e.preventDefault());
addEventListener('dblclick', (e) => e.preventDefault());

// ---------- 屏幕路由 ----------
const screens = ['home', 'train', 'map', 'report'];
function show(name) {
  screens.forEach(s => $('screen-' + s).classList.toggle('hidden', s !== name));
  $('screens').style.pointerEvents = name ? 'auto' : 'none';
  if (name) $( 'screen-' + name).style.pointerEvents = 'auto';
}
function hideScreens() {
  screens.forEach(s => $('screen-' + s).classList.add('hidden'));
  $('screens').style.pointerEvents = 'none';
}

// ---------- 训练设置 ----------
const trainCfg = { dist: 18, env: 'indoor', arrows: 6, assist: true, face: 'std',
  bow: localStorage.getItem('xj_bow') || 'recurve',
  scaleMode: localStorage.getItem('xj_scale') || 'sport',
  arfov: +(localStorage.getItem('xj_arfov') || 67) };
if (!BOWS[trainCfg.bow]) trainCfg.bow = 'recurve';
if (!['sport', 'real'].includes(trainCfg.scaleMode)) trainCfg.scaleMode = 'sport';
// 靶纸缩放（仅奥运赛场/复合弓）：标准 122cm 靶面，小靶≈80cm
const FACE_SCALE = { std: 1, small: 0.62 };
const BOW_DESCS = {
  trad: '无瞄具直觉射法：以箭头尖为参考。晃动大、箭速慢、疲劳快——最考验基本功。',
  recurve: '单针瞄环：标准手感基准，各项参数均衡。',
  compound: '窥孔+瞄镜视野：画面微放大、光纤点+水准泡；稳定器减震、省力轮延缓疲劳、箭速最快。'
};
function pills(el, items, key, fmt, persistKey) {
  el.innerHTML = '';
  for (const v of items) {
    const b = document.createElement('button');
    b.className = 'pill' + (trainCfg[key] === v ? ' on' : '');
    b.textContent = fmt ? fmt(v) : v;
    b.onclick = () => {
      trainCfg[key] = v;
      if (persistKey) localStorage.setItem(persistKey, v);
      pills(el, items, key, fmt, persistKey);
    };
    el.appendChild(b);
  }
}
const ENV_NAMES = { indoor: '室内', breeze: '户外微风', windy: '户外阵风', ar: '实景 AR' };
const SCALE_DESCS = {
  sport: '竞技：可读性优先，靶面按场景透视缩放，远靶仍清晰可见。',
  real: '写实：还原 25cm 持机视距下的真实张角——远靶会只有指甲盖大，请配合瞄具放大与右上监视器。'
};
function renderTrainForm() {
  // 弓种选择（含瞄具说明，切换时应用该弓种的默认补偿设置）
  const bowEl = $('train-bow');
  bowEl.innerHTML = '';
  for (const key of ['trad', 'recurve', 'compound']) {
    const b = document.createElement('button');
    b.className = 'pill' + (trainCfg.bow === key ? ' on' : '');
    b.textContent = BOWS[key].name;
    b.onclick = () => {
      trainCfg.bow = key;
      localStorage.setItem('xj_bow', key);
      trainCfg.assist = BOWS[key].assist;
      renderTrainForm();
    };
    bowEl.appendChild(b);
  }
  $('bow-desc').textContent = `${BOWS[trainCfg.bow].sight} —— ${BOW_DESCS[trainCfg.bow]}`;
  // 复合弓规则：仅 15m 以上标靶（现有档位中去掉 10m）；可选奥运标准/小尺寸靶纸
  const isComp = trainCfg.bow === 'compound';
  if (isComp && trainCfg.dist === 10) trainCfg.dist = 18;
  pills($('train-dist'), isComp ? [18, 30, 50, 70] : [10, 18, 30, 50, 70], 'dist', v => v + 'm');
  $('face-row').classList.toggle('hidden', !isComp);
  if (isComp) pills($('train-face'), ['std', 'small'], 'face', v => v === 'std' ? '标准靶纸' : '小尺寸靶纸');
  pills($('train-scale'), ['sport', 'real'], 'scaleMode', v => v === 'sport' ? '竞技' : '写实', 'xj_scale');
  $('scale-desc').textContent = SCALE_DESCS[trainCfg.scaleMode];
  pills($('train-env'), ['indoor', 'breeze', 'windy', 'ar'], 'env', v => ENV_NAMES[v]);
  // 实景视场角：靶面与实景贴合校准（陀螺转角→像素换算），仅实景模式显示
  const isAr = trainCfg.env === 'ar';
  $('arfov-row').classList.toggle('hidden', !isAr);
  if (isAr) {
    setArFov(trainCfg.arfov);
    const fovEl = $('train-arfov');
    fovEl.innerHTML = '';
    for (const v of [55, 67, 78]) {
      const b = document.createElement('button');
      b.className = 'pill' + (trainCfg.arfov === v ? ' on' : '');
      b.textContent = v + '°';
      b.onclick = () => {
        trainCfg.arfov = v;
        localStorage.setItem('xj_arfov', v);
        setArFov(v);
        renderTrainForm();
      };
      fovEl.appendChild(b);
    }
  }
  pills($('train-arrows'), [3, 6, 12], 'arrows', v => v + ' 支');
  $('train-assist').setAttribute('aria-checked', trainCfg.assist);
}
$('train-assist').onclick = (e) => {
  trainCfg.assist = !trainCfg.assist;
  e.target.setAttribute('aria-checked', trainCfg.assist);
};
// ---------- 陀螺仪：竖持引导校准 ----------
function setGyroToggle(on) { $('btn-gyro').setAttribute('aria-checked', on ? 'true' : 'false'); }
$('btn-gyro').onclick = () => {
  if (input.gyroOn) { input.disableGyro(); setGyroToggle(false); return; }
  $('gyro-state').textContent = '';
  $('gyro-guide').classList.remove('hidden');
};
$('btn-gyro-cancel').onclick = () => $('gyro-guide').classList.add('hidden');
$('btn-gyro-cal').onclick = async () => {
  $('gyro-state').textContent = '正在获取传感器权限…';
  const ok = await input.enableGyro();
  if (!ok) {
    $('gyro-guide').classList.add('hidden');
    alert('当前设备/浏览器不支持或未授权陀螺仪，可用拖拽瞄准替代。');
    return;
  }
  // 以当前竖持姿态为基准零点
  $('gyro-state').textContent = '保持竖持…正在采样';
  input.calibrate();
  const got = await input.waitCalibrated();
  if (!got) {
    $('gyro-state').textContent = '未读到传感器数据，请重试';
    return;
  }
  input.gyroGuided = true;
  $('gyro-guide').classList.add('hidden');
  setGyroToggle(true);
};
// 对局内重校准：按当前朝向重新归零（HUD ◎ 按钮）
$('hud-gyro-recal').onclick = () => {
  input.calibrate();
  const pop = $('shot-popup');
  pop.textContent = '已校准';
  pop.className = 'pop';
  setTimeout(() => pop.classList.add('hidden'), 700);
  pop.classList.remove('hidden');
};

// ---------- 实景模式：后置摄像头采集 ----------
let camStream = null;
async function startCam() {
  if (camStream) return true;
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    const v = $('cam');
    v.srcObject = camStream;
    await v.play().catch(() => {});
    window.__camVideo = v;
    return true;
  } catch { camStream = null; return false; }
}
function stopCam() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  window.__camVideo = null;
  input.arMode = false;
}

// ---------- 对局调度 ----------
// 场景映射：闯关按秘境（青松谷/雪岭/星坠荒原各有专属背景），训练按弓种
const ZONE_BG = { forest: 'forest', snow: 'snow', astra: 'astra' };
const BOW_BG = { trad: 'hanfu', recurve: 'dojo', compound: 'olympic' };
let session = null, sessionMeta = null;
function startSession(opts, meta) {
  hideScreens();
  session = new RangeSession(opts);
  session.onShot = onShot;
  session.onEnd = (shots, total) => onSessionEnd(shots, total);
  sessionMeta = meta;
  window.__dbg = () => ({ state: session?.state, shots: session?.shots.length, power: session?.power,
    bow: session?.bowCfg?.id, assist: session?.assist, fx: session?.fx.length, markDur: session?.markDur,
    last: session?.shots.length ? ((s) => ({ dx: +s.dx.toFixed(1), dy: +s.dy.toFixed(1),
      stickAng: +s.stickAng.toFixed(2), trail: s.trail.length }))(session.shots[session.shots.length - 1]) : null });
  if (!input.gyroGuided) input.calibrate(); // 竖持引导校准后不再静默重归零
  $('hud').classList.remove('hidden');
  $('hud-gyro-recal').classList.toggle('hidden', !input.gyroOn);
  $('hud-level').textContent = meta.title;
  $('hud-wind').classList.toggle('hidden', session.sway.env.wind === 0);
  // 右下角弓种示意图（真实贴图）
  $('hud-bow-img').src = (window.__IMG && window.__IMG['bow-' + opts.bowCfg.id]) || `assets/bow-${opts.bowCfg.id}.png`;
  $('hud-bow-name').textContent = opts.bowCfg.name;
  updateHud();
}
function endSession() {
  session = null;
  $('hud').classList.add('hidden');
}
function updateHud() {
  if (!session) return;
  $('hud-arrows').textContent = `× ${session.arrows - session.shots.length}`;
  $('hud-score').textContent = session.total;
  if (session.sway.env.wind > 0) {
    $('hud-wind-v').textContent = session.sway.env.wind.toFixed(1) + ' m/s';
    $('hud-wind-arrow').textContent = session.sway.windDir > 0 ? '→' : '←';
  }
  const st = session.state === 'drawing' ? session.steady : null;
  $('steady-fill').style.width = st == null ? '0%' : st + '%';
  $('steady-num').textContent = st == null ? '--' : Math.round(st);
  // 呼吸体力条：相位 -1（呼气末·最稳）在顶端
  const ph = session.sway.breathPhase ?? 0;
  $('breath-dot').style.top = ((ph + 1) / 2 * 100) + '%';
  // 拉弓计时（整数秒）：拉弓中实时走表，否则显示上一箭时长
  const drawing = session.state === 'drawing';
  const sec = drawing ? session.holdSec
    : (session.shots.length ? session.shots[session.shots.length - 1].holdSec : 0);
  $('hud-timer-num').textContent = Math.floor(sec) + ' s';
  $('hud-timer').classList.toggle('active', drawing);
}
function onShot(shot) {
  const pop = $('shot-popup');
  pop.textContent = shot.score === 0 ? '脱靶' : (shot.x ? 'X' : shot.score);
  pop.className = shot.score >= 9 ? 'gold pop' : 'pop';
  setTimeout(() => pop.classList.add('hidden'), 900);
  pop.classList.remove('hidden');
  updateHud();
}
function onSessionEnd(shots, total) {
  updateHud();
  setTimeout(() => { endSession(); showReport(shots, total); }, 600);
}

// 拉弓交互：按下=拉弓，松开=撒放
canvas.addEventListener('pointerdown', (e) => {
  if (!session) return;
  e.preventDefault();
  session.press();
});
addEventListener('pointerup', () => { if (session) session.release(input); });
addEventListener('pointercancel', () => { if (session) session.release(input); });
$('hud-exit').onclick = () => { endSession(); stopCam(); show(sessionMeta?.mode === 'quest' ? 'map' : 'train'); if (!sessionMeta) show('home'); };

// ---------- 报告 ----------
function showReport(shots, total) {
  const meta = sessionMeta;
  const n = shots.length;
  const avg = total / n;
  const steadyAvg = Math.round(shots.reduce((s, q) => s + q.steady, 0) / n);
  // 散布：以弹孔质心为基准的 RMS 半径（以环宽为单位）
  const mx = shots.reduce((s, q) => s + q.dx, 0) / n;
  const my = shots.reduce((s, q) => s + q.dy, 0) / n;
  const groupRMS = Math.sqrt(shots.reduce((s, q) => s + (q.dx - mx) ** 2 + (q.dy - my) ** 2, 0) / n);
  const groupRings = groupRMS / sessionRingR(shots);

  $('report-kicker').textContent = meta.mode === 'quest' ? 'QUEST RESULT' : 'SESSION REPORT';
  $('report-title').textContent = meta.title;
  $('r-score').textContent = total;
  $('r-avg').textContent = avg.toFixed(1);
  $('r-steady').textContent = steadyAvg;
  $('r-group').textContent = groupRings.toFixed(1) + ' 环';

  // 明细表
  let rows = '<tr><th>#</th><th>环数</th><th>稳定度</th><th>拉弓时长</th></tr>';
  shots.forEach((s, i) => {
    rows += `<tr><td>${i + 1}</td><td>${s.x ? 'X' : s.score}</td><td>${s.steady}</td><td>${s.holdSec.toFixed(1)}s</td></tr>`;
  });
  $('report-table').innerHTML = rows;

  // 小结建议
  const tips = [];
  if (meta.mode === 'quest') {
    const lv = meta.level, stars = starsOf(lv, total);
    if (stars > 0) {
      tips.push(`通关！获得 ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}，下一关已解锁。`);
      const p = loadProgress();
      if ((p[lv.id]?.stars || 0) < stars) { p[lv.id] = { stars, best: total }; saveProgress(p); }
    } else tips.push(`距离过关还差 ${lv.pass - total} 环，再试一次。`);
  }
  if (groupRings < 2 && Math.hypot(mx, my) / sessionRingR(shots) > 3)
    tips.push('散布集中但整体偏离靶心——一致性很好，调整瞄准基准点即可。');
  if (steadyAvg < 60) tips.push('稳定度偏低：试着在拉满后 2–4 秒内完成撒放，拖得越久晃动越大。');
  const spreadX = Math.sqrt(shots.reduce((s, q) => s + (q.dx - mx) ** 2, 0) / n);
  const spreadY = Math.sqrt(shots.reduce((s, q) => s + (q.dy - my) ** 2, 0) / n);
  if (spreadY > spreadX * 1.6) tips.push('上下离散明显大于左右：注意靠位一致性与背加力的直线感。');
  if (spreadX > spreadY * 1.6) tips.push('左右离散偏大：留意撒放瞬间是否带弦、风向变化时要等阵风间隙。');
  if (shots.some(s => s.holdSec > 7)) tips.push('有箭拉弓超过 7 秒——疲劳会显著放大晃动，该放就放。');
  if (!tips.length) tips.push('表现稳定，保持这个节奏。');
  $('report-tips').innerHTML = tips.map(t => `<li>${t}</li>`).join('');

  drawReportTarget(shots, mx, my);
  show('report');
}
function sessionRingR(shots) {
  // 与对局中一致的环宽像素（含写实/竞技比例），用于换算散布
  return outerR(sessionMeta.dist, sessionMeta.bg, innerWidth, innerHeight, sessionMeta.scaleMode || 'sport') / 10;
}
function drawReportTarget(shots, mx, my) {
  const c = $('report-target'), g = c.getContext('2d');
  const R = 10, scale = c.width / 2 / (R + 1.5);
  g.clearRect(0, 0, c.width, c.height);
  drawTarget(g, c.width / 2, c.height / 2, scale);
  const rr = sessionRingR(shots);
  for (const s of shots) {
    g.fillStyle = '#ff5f1f';
    g.beginPath();
    g.arc(c.width / 2 + (s.dx / rr) * scale, c.height / 2 + (s.dy / rr) * scale, 3, 0, 7);
    g.fill();
  }
  // 散布圈
  g.strokeStyle = 'rgba(245,197,66,.8)'; g.setLineDash([4, 4]);
  g.beginPath();
  g.arc(c.width / 2 + (mx / rr) * scale, c.height / 2 + (my / rr) * scale, 6, 0, 7);
  g.stroke(); g.setLineDash([]);
}

// ---------- 闯关地图 ----------
function nodeShape(shape, unlocked) {
  const stroke = unlocked ? '#ff5f1f' : '#3a3f47';
  const fill = unlocked ? 'rgba(255,95,31,.15)' : 'rgba(38,42,50,.4)';
  if (shape === 'triangle')
    return `<svg viewBox="0 0 40 40"><path d="M20 6 L34 32 L6 32 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/></svg>`;
  if (shape === 'hex')
    return `<svg viewBox="0 0 40 40"><path d="M20 4 L33 12 L33 28 L20 36 L7 28 L7 12 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/></svg>`;
  return `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/></svg>`;
}
function renderMap() {
  const progress = loadProgress();
  const inner = $('map-inner');
  inner.innerHTML = '';
  const H = 1150, W = innerWidth;
  const pos = LEVELS.map((lv, i) => ({
    x: W / 2 + Math.sin(i * 1.15) * Math.min(W * 0.28, 130),
    y: H - 120 - i * 118
  }));
  // 连接路径
  let d = `M ${pos[0].x} ${pos[0].y}`;
  for (let i = 1; i < pos.length; i++) {
    const p = pos[i - 1], q = pos[i];
    d += ` C ${p.x} ${(p.y + q.y) / 2}, ${q.x} ${(p.y + q.y) / 2}, ${q.x} ${q.y}`;
  }
  inner.innerHTML = `<svg id="map-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin slice">
    <path d="${d}" fill="none" stroke="#2a2d33" stroke-width="1.5" stroke-dasharray="5 6"/></svg>`;
  // 区域标签
  const zoneFirst = {};
  LEVELS.forEach((lv, i) => { if (!(lv.zone in zoneFirst)) zoneFirst[lv.zone] = i; });
  for (const z of ZONES) {
    const i = zoneFirst[z.id];
    const el = document.createElement('div');
    el.className = 'map-zone'; el.textContent = z.name;
    el.style.left = '20px'; el.style.top = (pos[i].y - 40) + 'px';
    inner.appendChild(el);
  }
  // 节点
  let totalStars = 0;
  LEVELS.forEach((lv, i) => {
    const unlocked = isUnlocked(lv, progress);
    const stars = progress[lv.id]?.stars || 0;
    totalStars += stars;
    const zone = ZONES.find(z => z.id === lv.zone);
    const el = document.createElement('button');
    el.className = 'map-node' + (unlocked ? '' : ' locked');
    el.style.left = pos[i].x + 'px'; el.style.top = pos[i].y + 'px';
    el.innerHTML = `${nodeShape(zone.shape, unlocked)}
      <span class="n-stars">${stars ? '★'.repeat(stars) : ''}</span>
      <span class="n-label">${lv.name}<span class="n-sub">${BOWS[lv.bow].name} · ${lv.dist}m${lv.moving ? ' · 移动靶' : ''}</span></span>`;
    if (unlocked) el.onclick = () => startLevel(lv);
    inner.appendChild(el);
  });
  $('map-star-total').textContent = totalStars;
}
function startLevel(lv) {
  // 关卡绑定弓种：青松谷=传统弓 / 雪岭=反曲弓 / 星坠荒原=复合弓
  const bg = ZONE_BG[lv.zone] || 'dojo';
  const scaleMode = localStorage.getItem('xj_scale') || 'sport';
  startSession(
    { dist: lv.dist, env: lv.env, arrows: lv.arrows, theme: bg,
      moving: lv.moving, assist: true, bowCfg: BOWS[lv.bow], scaleMode },
    { mode: 'quest', title: `${lv.name} · ${BOWS[lv.bow].name}`, level: lv, dist: lv.dist, bg, scaleMode }
  );
}

// ---------- 主循环 ----------
const idleScenes = { home: new Scene('hanfu') };
let last = performance.now();
function step(dt, now) {
  const t = now / 1000;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  input.read();
  if (session) {
    session.update(dt, t, input);
    session.draw(ctx, innerWidth, innerHeight, t, input);
    updateHud();
  } else {
    idleScenes.home.draw(ctx, innerWidth, innerHeight, t);
  }
}
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  step(dt, now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// 调试/测试钩子：手动推进游戏循环（用于无 rAF 的环境）
window.__step = (n = 1, dtms = 16.7) => {
  for (let i = 0; i < n; i++) step(dtms / 1000, performance.now() + i * dtms);
};

// ---------- 路由绑定 ----------
$('btn-mode-train').onclick = () => { renderTrainForm(); show('train'); };
$('btn-mode-quest').onclick = () => { renderMap(); show('map'); };
$('btn-train-back').onclick = () => show('home');
$('btn-map-back').onclick = () => show('home');
// 重置巡回进度（星级/解锁），与练习模式完全无关
$('btn-map-reset').onclick = () => {
  if (confirm('清除巡回之旅的全部星级与解锁进度？此操作不可恢复。')) {
    saveProgress({});
    renderMap();
  }
};
$('btn-train-start').onclick = async () => {
  const useAr = trainCfg.env === 'ar';
  if (useAr) {
    const ok = await startCam();
    if (!ok) {
      alert('无法开启摄像头（需要 HTTPS 环境并授权），已回退为室内场景。');
      trainCfg.env = 'indoor';
      renderTrainForm();
      return;
    }
    input.arMode = true;
    // 实景以陀螺仪锚定靶位方向；未开启时靶面固定在画面中央，仍可触摸微调游玩
    if (!input.gyroOn) input.calibrate();
  } else {
    stopCam();
  }
  const theme = useAr ? 'ar' : BOW_BG[trainCfg.bow];
  startSession(
    { dist: trainCfg.dist, env: trainCfg.env, arrows: trainCfg.arrows, theme,
      moving: 0, assist: trainCfg.assist, bowCfg: BOWS[trainCfg.bow],
      faceScale: trainCfg.bow === 'compound' ? FACE_SCALE[trainCfg.face] : 1,
      scaleMode: trainCfg.scaleMode },
    { mode: 'train', title: `${BOWS[trainCfg.bow].name} · ${trainCfg.dist}m · ${ENV_NAMES[trainCfg.env]}`,
      dist: trainCfg.dist, bg: theme, scaleMode: trainCfg.scaleMode }
  );
};
$('btn-report-back').onclick = () => {
  stopCam();
  if (sessionMeta?.mode === 'quest') { renderMap(); show('map'); } else show('train');
};
$('btn-report-again').onclick = () => {
  if (sessionMeta?.mode === 'quest') startLevel(sessionMeta.level);
  else $('btn-train-start').onclick();
};
show('home');
