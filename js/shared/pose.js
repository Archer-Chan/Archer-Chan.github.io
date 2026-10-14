// 姿态解算与实景视场角（纯数学）
// 竖持 beta≈90° 是欧拉角奇异点：必须用 欧拉角→旋转矩阵→相对旋转 R=基准ᵀ×当前→轴角分解，
// 取绕设备 Y 轴（转体）/X 轴（抬压）分量，严禁改回 alpha/beta 角度直减。

// 实景模式摄像头水平视场（度，可调），用于陀螺转角 → 屏幕像素换算。
// 对象属性而非模块级 let：任何模块系统/打包方式下读取都是当前值（活绑定）。
export const AR = { fov: 67 };
export function setArFov(f) { if (f >= 40 && f <= 100) AR.fov = f; }

// 欧拉角（ZXY 内旋，deviceorientation 规范）→ 旋转矩阵
export function e2m(a, b, g) {
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

// 相对旋转 R = baseᵀ·cur（3×3 行主序矩阵）
export function relRot(B, M) {
  const R = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
    R[i][j] = B[0][i] * M[0][j] + B[1][i] * M[1][j] + B[2][i] * M[2][j];
  return R;
}

// 轴角分解取旋转向量（弧度），封装已校准符号约定：tx=-ry、ty=-rx，符号已按真机校准，勿翻转。
// 竖持时「左右转体 = 绕设备 Y 轴」「抬压弓 = 绕设备 X 轴」，
// 水平灵敏度不随持机俯仰角衰减（ZXY 分解会错误衰减）。
export function toAimDelta(R) {
  const d = 180 / Math.PI;
  const tr = R[0][0] + R[1][1] + R[2][2];
  const th = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2)));
  let rx, ry;
  if (th < 1e-4) { rx = (R[2][1] - R[1][2]) / 2; ry = (R[0][2] - R[2][0]) / 2; }
  else {
    const s = 2 * Math.sin(th);
    rx = (R[2][1] - R[1][2]) / s * th;
    ry = (R[0][2] - R[2][0]) / s * th;
  }
  return { tx: -ry * d, ty: -rx * d };
}
