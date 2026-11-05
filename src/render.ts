import { DEFAULT_TYPO, DEFAULT_MOTION, type Led, type GuideOptions, type MotionCfg } from './types';
import { meters, totalCabinets, fmtCab, type Layout, type FaceRect, type GapRect } from './layout';
import logoUrl from './assets/zuno-logo.png';

/* ============ 가이드 이미지 컬러 (여기만 바꾸면 PNG·영상 색이 바뀜) ============ */
export const GUIDE_COLORS = {
  bg: '#000000',            // 캔버스 빈 영역
  checkerA: '#2E2E33',      // 캐비닛 체커 1
  checkerB: '#3C3C43',      // 캐비닛 체커 2
  grid: '#55555F',          // 캐비닛 그리드 라인
  cabNumber: '#9A9AA8',     // 캐비닛 번호 (행-열)
  faceBorder: '#FFFFFF',    // 면 테두리
  // accent(퍼플)은 설정의 포인트 컬러를 사용 (기본 #A855F7)
  disc: 'rgba(0,0,0,0.5)',  // 로고 원 안쪽 (PNG). 살짝 투명해서 픽셀맵이 비침
  textBg: 'rgba(0,0,0,0.62)',
  labelText: '#FFFFFF',
  labelSub: '#C9C2E3',
  gapBg: '#0B0912',
  gapText: '#C9C2E3',
  tagBg: '#000000',       // 하단 코너 태그 배경 (글자는 포인트 컬러)
  overflow: '#FF4D6D',
};

/* ============ 모션 설정 ============ */
export const MOTION = {
  fps: 30,
  ringCount: 3,       // 동시에 퍼지는 링 개수
  pngTime: 0.9,       // PNG 정지 프레임 시점
};

const F_TITLE = 'Anton, "IBM Plex Sans KR", sans-serif';
const F_MONO = '"JetBrains Mono", "IBM Plex Sans KR", monospace';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const easeInOut = (x: number) => { const v = clamp(x, 0, 1); return v * v * (3 - 2 * v); };
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);

/* ---------- 로고 ---------- */
const logoCache = new Map<string, Promise<HTMLImageElement | null>>();
/** src 없으면 기본 ZUNO 로고 (프리셋), 있으면 LED에 첨부한 로고(dataURL) */
export function loadLogo(src?: string) {
  const k = src || logoUrl;
  let p = logoCache.get(k);
  if (!p) {
    p = new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = k;
    });
    logoCache.set(k, p);
  }
  return p;
}
export const DEFAULT_LOGO_URL = logoUrl;
const tintCache = new Map<string, HTMLCanvasElement>();
function tintedLogo(img: HTMLImageElement, color: string) {
  const k = img.src.slice(-64) + color;
  let c = tintCache.get(k);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
    tintCache.set(k, c);
  }
  return c;
}

/* ---------- 레이어 ---------- */
interface FaceGeo { f: FaceRect; cx: number; cy: number; r0: number; rMax: number; bw: number }
export interface Layers {
  l: Led; lay: Layout; opt: GuideOptions; accent: string; scale: number;
  W: number; H: number;           // 레이어 픽셀 크기 (= lay * scale)
  base: HTMLCanvasElement;        // 픽셀맵, 갭, 캔버스 외곽선
  top: HTMLCanvasElement;         // 테두리·브래킷·로고 원·라벨·헤더 바
  geo: FaceGeo[];
}

export interface RenderStyle { accent: string; logoTint: 'white' | 'accent'; logo: HTMLImageElement | null }

/** r0 = 로고 원 반지름. 모든 면이 같은 크기를 쓰도록 바깥에서 받음 */
function faceGeo(f: FaceRect, r0: number): FaceGeo {
  const m = Math.min(f.w, f.h);
  return { f, cx: f.x + f.w / 2, cy: f.y + f.h / 2, r0, rMax: Math.hypot(f.w, f.h) / 2 + m * 0.2, bw: Math.max(10, m * 0.16) };
}

function mk(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
}

export function buildLayers(l: Led, lay: Layout, opt: GuideOptions, st: RenderStyle, scale = 1): Layers {
  const W = Math.round(lay.W * scale), H = Math.round(lay.H * scale);
  const base = mk(W, H), top = mk(W, H);
  const C = GUIDE_COLORS;
  const u = clamp(Math.min(l.cabinet.pxW, l.cabinet.pxH) / 128, 0.4, 4);
  // 로고 원은 모든 면에서 같은 크기: 가장 작은 면에 맞춤
  const rLogo = Math.min(...lay.faces.map((f) => Math.min(f.w, f.h))) * 0.2;
  const geo = lay.faces.map((f) => faceGeo(f, rLogo));

  const b = base.getContext('2d')!;
  b.setTransform(scale, 0, 0, scale, 0, 0);
  b.fillStyle = C.bg; b.fillRect(0, 0, lay.W, lay.H);
  for (const g of lay.gaps) drawGap(b, g, l.gapPx, u, st.accent);
  for (const f of lay.faces) drawFaceBase(b, l, f, opt);
  if (lay.kind === 'OUT') {
    b.strokeStyle = st.accent; b.globalAlpha = 0.5; b.lineWidth = Math.max(1, 2 * u);
    b.strokeRect(0.5, 0.5, lay.W - 1, lay.H - 1); b.globalAlpha = 1;
  }

  const t = top.getContext('2d')!;
  t.setTransform(scale, 0, 0, scale, 0, 0);
  for (const g of geo) drawFaceMarks(t, g, opt, u, st.accent);
  for (const g of geo) drawCenter(t, l, lay, g, opt, u, st);
  if (lay.kind === 'OUT') for (const f of lay.faces) if (f.overflow) {
    t.strokeStyle = C.overflow; t.lineWidth = 6 * u; t.setLineDash([20 * u, 10 * u]);
    t.strokeRect(f.x, f.y, f.w, f.h); t.setLineDash([]);
  }

  return { l, lay, opt, accent: st.accent, scale, W, H, base, top, geo };
}

/* ---------- 프레임 합성 ---------- */
export type FrameMode = 'static' | 'loop' | 'build';

export const motionOf = (l: Led): MotionCfg => ({ ...DEFAULT_MOTION, ...(l.motion || {}) });

/** 빌드업 타임라인
 *  ① sweep: 캐비닛이 왼쪽 아래부터 가로로 스르륵 쌓임
 *  ② fade : 다 쌓이면 테두리·로고·라벨·태그가 한 번에 천천히 페이드인
 *  ③ hold : 링이 퍼지며 유지 */
export function buildTimeline(L: { l: Led }) {
  const mo = motionOf(L.l);
  const s0 = 0.2;
  const sweep = Math.max(0.2, mo.sweep);
  const win = Math.min(0.45, sweep * 0.3);          // 캐비닛 하나가 나타나는 시간
  const overlayStart = s0 + sweep + 0.15;
  const fade = Math.max(0.1, mo.fade);
  const ringsStart = overlayStart + fade * 0.5;
  const duration = Math.ceil((overlayStart + fade + Math.max(0, mo.hold)) * 10) / 10;
  return { s0, sweep, win, overlayStart, fade, ringsStart, duration };
}

export const buildDuration = (l: Led) => buildTimeline({ l }).duration;

export function drawFrame(ctx: CanvasRenderingContext2D, L: Layers, t: number, mode: FrameMode) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = GUIDE_COLORS.bg;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (mode !== 'build') {
    ctx.drawImage(L.base, 0, 0);
    if (mode === 'static') { if (L.opt.fitCircle) drawFitCircles(ctx, L); }
    else if (L.opt.rings) drawRings(ctx, L, t, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (L.opt.logo) for (const g of L.geo) drawDisc(ctx, L, g, t, mode !== 'static');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(L.top, 0, 0);
    drawTags(ctx, L, 1);
    return;
  }

  const s = L.scale;
  const tl = buildTimeline(L);
  const { W: LW, H: LH } = L.lay;
  // 왼쪽 아래가 0, 오른쪽 위가 1 — 가로 진행이 주, 아래→위가 살짝
  const keyAt = (x: number, y: number) => clamp((x / LW) * 0.85 + (1 - y / LH) * 0.15, 0, 1);
  const alphaAt = (key: number) => easeInOut((t - tl.s0 - key * (tl.sweep - tl.win)) / tl.win);
  const blit = (x: number, y: number, w: number, h: number, a: number) => {
    if (a <= 0) return;
    ctx.globalAlpha = a;
    const sx = Math.floor(x * s), sy = Math.floor(y * s);
    const sw = Math.min(L.W - sx, Math.ceil((x + w) * s) - sx), sh = Math.min(L.H - sy, Math.ceil((y + h) * s) - sy);
    if (sw > 0 && sh > 0) ctx.drawImage(L.base, sx, sy, sw, sh, sx, sy, sw, sh);
  };

  // 1) 픽셀맵: 캐비닛이 왼쪽 아래부터 가로로 스르륵
  const cw = L.l.cabinet.pxW, ch = L.l.cabinet.pxH;
  for (const f of L.lay.faces) {
    for (let r = Math.ceil(f.rows - 1e-6) - 1; r >= 0; r--) for (let c = 0; c < f.cols - 1e-6; c++) {
      const x = f.x + c * cw, y = f.y + r * ch;
      blit(x, y, Math.min(cw, f.x + f.w - x), Math.min(ch, f.y + f.h - y), alphaAt(keyAt(x + cw / 2, y + ch / 2)));
    }
  }
  for (const g of L.lay.gaps) blit(g.x, g.y, g.w, g.h, alphaAt(keyAt(g.x + g.w / 2, g.y + g.h)));
  ctx.globalAlpha = 1;

  // 2) 링 (위 요소가 반쯤 들어올 때부터)
  if (L.opt.rings && t > tl.ringsStart) drawRings(ctx, L, t - tl.ringsStart, clamp((t - tl.ringsStart) / 0.6, 0, 1));

  // 3) 위 요소 전부: 한 번에 천천히 페이드인 + 살짝 떠오름
  const a = easeInOut((t - tl.overlayStart) / tl.fade);
  if (a > 0) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.setTransform(1, 0, 0, 1, 0, (1 - a) * 14 * s * (LH / 768));
    if (L.opt.logo) for (const g of L.geo) drawDisc(ctx, L, g, t, true);
    ctx.drawImage(L.top, 0, 0);
    ctx.restore();
    drawTags(ctx, L, a);
  }
}

/** 로고 원에서 바깥으로 퍼지는 링. 면 밖은 잘림. t 초, 주기 = 루프 길이 */
function drawRings(ctx: CanvasRenderingContext2D, L: Layers, t: number, master: number) {
  const s = L.scale;
  const T = motionOf(L.l).loop, K = MOTION.ringCount;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);
  for (const g of L.geo) {
    const { f } = g;
    ctx.save();
    ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip();
    for (let k = 0; k < K; k++) {
      const p = (((t / T) + k / K) % 1 + 1) % 1;
      const R = g.r0 + Math.pow(p, 0.85) * (g.rMax - g.r0);
      const a = master * Math.min(1, p * 12) * Math.pow(1 - p, 0.55);
      if (a <= 0.01) continue;
      const inner = Math.max(g.r0, R - g.bw);
      const grad = ctx.createRadialGradient(g.cx, g.cy, inner, g.cx, g.cy, R);
      // 진하고 쨍한 링: 안쪽 글로우 + 선명한 바깥 엣지 + 밝은 하이라이트
      grad.addColorStop(0, hexA(L.accent, 0));
      grad.addColorStop(0.45, hexA(L.accent, 0.38 * a));
      grad.addColorStop(0.84, hexA(L.accent, 1 * a));
      grad.addColorStop(0.93, hexA(mixHex(L.accent, '#FFFFFF', 0.35), 1 * a));
      grad.addColorStop(1, hexA(L.accent, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(g.cx, g.cy, R, 0, Math.PI * 2);
      ctx.arc(g.cx, g.cy, inner, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
    }
    ctx.restore();
  }
  ctx.restore();
}

/** PNG/정지: 면에 꽉 맞는 원 */
function drawFitCircles(ctx: CanvasRenderingContext2D, L: Layers) {
  const s = L.scale;
  const u = clamp(Math.min(L.l.cabinet.pxW, L.l.cabinet.pxH) / 128, 0.4, 4);
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.strokeStyle = L.accent;
  for (const g of L.geo) {
    const lw = Math.max(1.5, 2.5 * u);
    const r = Math.min(g.f.w, g.f.h) / 2 - lw / 2;
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.arc(g.cx, g.cy, r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

/** 로고 원 배경. 정지 = 살짝 투명한 블랙(픽셀맵이 비침), 영상 = 어두운 보라+블랙 그라데이션이 돌며 숨쉼 */
function drawDisc(ctx: CanvasRenderingContext2D, L: Layers, g: FaceGeo, t: number, animated: boolean) {
  const s = L.scale;
  const cx = g.cx * s, cy = g.cy * s, r = g.r0 * s;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  if (!animated) {
    ctx.fillStyle = GUIDE_COLORS.disc;
  } else {
    const ang = (t / motionOf(L.l).loop) * Math.PI * 2;       // 루프 길이에 맞춰 한 바퀴 → 끊김 없음
    const ox = cx + Math.cos(ang) * r * 0.42, oy = cy + Math.sin(ang) * r * 0.42;
    const pulse = 0.5 + 0.5 * Math.sin(ang * 2);
    const grad = ctx.createRadialGradient(ox, oy, 0, cx, cy, r);
    grad.addColorStop(0, hexA(mixHex(L.accent, '#000000', 0.45), 0.92));
    grad.addColorStop(0.35 + 0.2 * pulse, hexA(mixHex(L.accent, '#000000', 0.78), 0.88));
    grad.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = grad;
  }
  ctx.fill();
  ctx.restore();
}

/** a 와 b 를 k(0..1) 비율로 섞음 */
function mixHex(a: string, b: string, k: number) {
  const p = (h: string) => { const n = parseInt(h.replace('#', '').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

function hexA(hex: string, a: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1).toFixed(3)})`;
}

/* ---------- 단일 이미지 (PNG / 프리뷰 정지) ---------- */
export function drawGuide(canvas: HTMLCanvasElement, l: Led, lay: Layout, opt: GuideOptions, st: RenderStyle) {
  const L = buildLayers(l, lay, opt, st, 1);
  canvas.width = L.W; canvas.height = L.H;
  drawFrame(canvas.getContext('2d')!, L, MOTION.pngTime, 'static');
  return L;
}

/* ---------- 그리기 요소 ---------- */
function drawFaceBase(ctx: CanvasRenderingContext2D, l: Led, f: FaceRect, opt: GuideOptions) {
  const C = GUIDE_COLORS;
  const cw = l.cabinet.pxW, ch = l.cabinet.pxH;
  ctx.save();
  ctx.beginPath(); ctx.rect(f.x, f.y, f.w, f.h); ctx.clip(); // 픽셀 기준이라 마지막 캐비닛은 잘릴 수 있음
  for (let r = 0; r < f.rows - 1e-6; r++) for (let c = 0; c < f.cols - 1e-6; c++) {
    ctx.fillStyle = (r + c) % 2 ? C.checkerB : C.checkerA;
    ctx.fillRect(f.x + c * cw, f.y + r * ch, cw, ch);
  }
  ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let c = 1; c < f.cols - 1e-6; c++) { const x = f.x + c * cw + 0.5; ctx.moveTo(x, f.y); ctx.lineTo(x, f.y + f.h); }
  for (let r = 1; r < f.rows - 1e-6; r++) { const y = f.y + r * ch + 0.5; ctx.moveTo(f.x, y); ctx.lineTo(f.x + f.w, y); }
  ctx.stroke();
  if (opt.panelNumbers) {
    const fs = clamp(Math.min(cw, ch) * 0.1, 7, 48);
    ctx.font = `500 ${fs}px ${F_MONO}`; ctx.fillStyle = C.cabNumber;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const pad = Math.max(2, fs * 0.45);
    for (let r = 0; r < f.rows - 1e-6; r++) for (let c = 0; c < f.cols - 1e-6; c++)
      ctx.fillText(`${r + 1}-${c + 1}`, f.x + c * cw + pad, f.y + r * ch + pad);
  }
  ctx.restore();
}

function drawFaceMarks(ctx: CanvasRenderingContext2D, g: FaceGeo, opt: GuideOptions, u: number, accent: string) {
  const C = GUIDE_COLORS;
  const { x, y, w, h } = g.f;
  const { cx, cy } = g;
  const m = Math.min(w, h);
  const lw = Math.max(1, 2 * u);
  const hole = opt.logo ? g.r0 : 0;   // 로고 원 안쪽은 선을 비움

  ctx.save();
  if (hole) {
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.arc(cx, cy, hole, 0, Math.PI * 2, true); ctx.clip('evenodd');
  }
  ctx.strokeStyle = accent;
  if (opt.diagonals) {
    ctx.globalAlpha = 0.5; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke();
  }
  if (opt.crosshair) {
    ctx.globalAlpha = 0.85; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.moveTo(cx, y); ctx.lineTo(cx, y + h); ctx.stroke();
  }
  ctx.restore();

  const bw = Math.max(2, 3 * u);
  ctx.strokeStyle = C.faceBorder; ctx.lineWidth = bw;
  ctx.strokeRect(x + bw / 2, y + bw / 2, w - bw, h - bw);

  const L = clamp(m * 0.05, 8, 160), T = Math.max(2, 3.5 * u);
  ctx.fillStyle = accent;
  const corners: [number, number, number, number][] = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]];
  for (const [px, py, sx, sy] of corners) {
    ctx.fillRect(sx > 0 ? px : px - L, sy > 0 ? py : py - T, L, T);
    ctx.fillRect(sx > 0 ? px : px - T, sy > 0 ? py : py - L, T, L);
  }
  // 가로·세로 중앙 표시: 가늘고 날카로운 삼각형 (밑변 좁고 길게)
  const s = clamp(m * 0.02, 4, 60), b = s * 0.5, len = s * 2.4;
  ctx.beginPath();
  ctx.moveTo(cx - b, y); ctx.lineTo(cx + b, y); ctx.lineTo(cx, y + len); ctx.closePath();
  ctx.moveTo(cx - b, y + h); ctx.lineTo(cx + b, y + h); ctx.lineTo(cx, y + h - len); ctx.closePath();
  ctx.moveTo(x, cy - b); ctx.lineTo(x, cy + b); ctx.lineTo(x + len, cy); ctx.closePath();
  ctx.moveTo(x + w, cy - b); ctx.lineTo(x + w, cy + b); ctx.lineTo(x + w - len, cy); ctx.closePath();
  ctx.fill();
}

/** 가운데: 원 안에 로고, 원 위에 LED 명, 원 아래에 정보 */
function drawCenter(ctx: CanvasRenderingContext2D, l: Led, lay: Layout, g: FaceGeo, opt: GuideOptions, u: number, st: RenderStyle) {
  const C = GUIDE_COLORS;
  const { f, cx, cy } = g;
  const r = opt.logo ? g.r0 : 0;

  if (opt.logo) {
    ctx.strokeStyle = st.accent; ctx.lineWidth = Math.max(2, r * 0.035);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.55; ctx.lineWidth = Math.max(1, r * 0.015);
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.86, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    if (st.logo) {
      const src: CanvasImageSource = st.logoTint === 'accent' ? tintedLogo(st.logo, st.accent) : st.logo;
      const lw = r * 1.32;
      const lh = lw * (st.logo.naturalHeight / st.logo.naturalWidth);
      ctx.drawImage(src, cx - lw / 2, cy - lh / 2, lw, lh);
    }
  }
  if (!opt.faceLabels) return;
  const ty = { ...DEFAULT_TYPO, ...(l.typo || {}) };

  // 위: LED 명
  const topSpace = f.h / 2 - r;
  const name = f.face.name || '—';
  let ns = clamp(Math.min(topSpace * 0.4, f.w * 0.12), 8, 200) * ty.nameSize;
  ctx.font = `${ns}px ${F_TITLE}`;
  let nTrack = ns * ty.nameTracking;
  let nW = measureTracked(ctx, name, nTrack);
  if (nW > f.w * 0.86) { ns *= (f.w * 0.86) / nW; nTrack = ns * ty.nameTracking; ctx.font = `${ns}px ${F_TITLE}`; nW = measureTracked(ctx, name, nTrack); }
  // 실제 글자 잉크 영역 기준으로 정중앙 배치
  const ink = inkBounds(ctx, name, nTrack);   // 기준선·왼쪽 시작점 기준
  const nameCy = f.y + topSpace * 0.55;
  const x0 = cx - (ink.left + ink.right) / 2;          // 잉크 가로 중앙 = cx
  const base = nameCy + (ink.ascent - ink.descent) / 2; // 잉크 세로 중앙 = nameCy
  ctx.fillStyle = '#FFFFFF'; // 블럭 없이 생화이트 텍스트
  fillTrackedLeft(ctx, name, x0, base, nTrack);

  // 아래: 좌표·크기·실사이즈·캐비닛 (헤더 바에 가리지 않게)
  const mt = meters(l, f);
  const lines: [string, boolean][] = [
    [`X ${f.x}  Y ${f.y}  ·  ${f.w}×${f.h} PX`, false],
    [`${fmt(mt.w)} × ${fmt(mt.h)} M  ·  ${fmtCab(f.cols)}×${fmtCab(f.rows)} = ${fmtCab(f.cols * f.rows)} CAB`, false],
  ];
  if (lay.kind === 'OUT') lines.push([`IN X ${f.inX} → OUT ${f.x},${f.y}`, true]);
  if (opt.aeCoords) lines.push([`AE ${f.x + f.w / 2}, ${f.y + f.h / 2}`, true]);
  const bottom = f.y + f.h;
  const space = bottom - (cy + r);
  let ls = clamp(Math.min(space / (lines.length * 1.7 + 1.2), f.w * 0.03), 6, 48) * ty.infoSize;
  const widest = () => Math.max(...lines.map(([t]) => measureTracked(ctx, t, ls * ty.infoTracking)));
  ctx.font = `500 ${ls}px ${F_MONO}`;
  let bw = widest();
  if (bw > f.w * 0.9) { ls *= (f.w * 0.9) / bw; ctx.font = `500 ${ls}px ${F_MONO}`; bw = widest(); }
  const cap = capHeight(ctx);
  const lh = ls * ty.infoLeading;
  const pY = ls * 0.6, pX = ls * 0.9;
  const bh = cap + (lines.length - 1) * lh + pY * 2;
  const by = cy + r + (space - bh) / 2;
  ctx.fillStyle = C.textBg;
  ctx.fillRect(cx - bw / 2 - pX, by, bw + pX * 2, bh);
  lines.forEach(([t, hi], i) => {
    ctx.fillStyle = hi ? st.accent : C.labelSub;
    fillTracked(ctx, t, cx, by + pY + cap + i * lh, ls * ty.infoTracking);
  });
}

/** 현재 폰트의 대문자 높이 (세로 중앙 정렬용) */
function capHeight(ctx: CanvasRenderingContext2D) {
  const m = ctx.measureText('HX0');
  return m.actualBoundingBoxAscent || parseFloat(ctx.font) * 0.72;
}
/** 자간 포함 너비 */
function measureTracked(ctx: CanvasRenderingContext2D, t: string, track: number) {
  if (!track) return ctx.measureText(t).width;
  const chars = [...t];
  return chars.reduce((s, c) => s + ctx.measureText(c).width, 0) + track * (chars.length - 1);
}
/** 가운데 정렬 + 자간. y 는 글자 기준선(baseline) */
function fillTracked(ctx: CanvasRenderingContext2D, t: string, cx: number, y: number, track: number) {
  ctx.textBaseline = 'alphabetic';
  if (!track) { ctx.textAlign = 'center'; ctx.fillText(t, cx, y); return; }
  ctx.textAlign = 'left';
  let x = cx - measureTracked(ctx, t, track) / 2;
  for (const c of t) { ctx.fillText(c, x, y); x += ctx.measureText(c).width + track; }
}

function drawGap(ctx: CanvasRenderingContext2D, g: GapRect, gapPx: number, u: number, accent: string) {
  const C = GUIDE_COLORS;
  ctx.fillStyle = C.gapBg; ctx.fillRect(g.x, g.y, g.w, g.h);
  ctx.save();
  ctx.beginPath(); ctx.rect(g.x, g.y, g.w, g.h); ctx.clip();
  ctx.strokeStyle = accent; ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(1, 2 * u);
  const step = Math.max(8, 14 * u);
  ctx.beginPath();
  for (let d = -g.h; d < g.w + g.h; d += step) { ctx.moveTo(g.x + d, g.y + g.h); ctx.lineTo(g.x + d + g.h, g.y); }
  ctx.stroke();
  ctx.globalAlpha = 1;
  const label = `GAP ${gapPx}PX`;
  const vertical = g.h > g.w;
  const fs = clamp((vertical ? g.w : g.h) * 0.28, 9, 90);
  ctx.font = `${fs}px ${F_TITLE}`;
  ctx.translate(g.x + g.w / 2, g.y + g.h / 2);
  if (vertical) ctx.rotate(-Math.PI / 2);
  const tw = ctx.measureText(label).width + fs;
  ctx.fillStyle = C.gapBg; ctx.fillRect(-tw / 2, -fs * 0.75, tw, fs * 1.5);
  ctx.fillStyle = C.gapText; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

/** 하단 코너 태그: 좌하단 = 헤더(번호·헤더 문구·이름·가이드 종류), 우하단 = 정보. 각각 on/off.
 *  매 프레임 직접 그림 (작아서 가벼움). p = 등장 진행도 0..1 */
function drawTags(ctx: CanvasRenderingContext2D, L: Layers, p = 1) {
  const { l, lay, opt, accent, scale: s } = L;
  if ((!opt.headerBars && !opt.infoTag) || p <= 0) return;
  const C = GUIDE_COLORS;
  const th = Math.round(clamp(Math.min(lay.H, lay.W * 0.5) * 0.04, 16, 80));
  const fs = th * 0.62;
  const pad = th * 0.45;
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.globalAlpha = easeOut(p);
  ctx.font = `${fs}px ${F_TITLE}`;
  const cap = capHeight(ctx);
  const tag = (text: string, right: boolean) => {
    const maxW = lay.W * (opt.headerBars && opt.infoTag ? 0.48 : 0.9);
    let w = ctx.measureText(text).width;
    const k = Math.min(1, (maxW - pad * 2) / w);
    w = w * k + pad * 2;
    const slide = (1 - easeOut(p)) * th * 1.2;
    const x = right ? lay.W - w : 0, y = lay.H - th + slide;
    ctx.fillStyle = C.tagBg; ctx.fillRect(x, y, w, th);
    ctx.fillStyle = accent; ctx.fillRect(right ? x : x + w - Math.max(2, th * 0.08), y, Math.max(2, th * 0.08), th);
    ctx.fillStyle = accent; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.save(); ctx.translate(x + pad, y + th / 2 + cap / 2); ctx.scale(k, 1); ctx.fillText(text, 0, 0); ctx.restore();
  };
  if (opt.headerBars) {
    const kind = lay.kind === 'IN' ? 'INPUT GUIDE' : 'OUTPUT GUIDE';
    tag([l.number, [l.header, l.name].filter(Boolean).join('  —  '), kind].filter(Boolean).join('  ·  ').toUpperCase(), false);
  }
  if (opt.infoTag) {
    const c = l.cabinet;
    const info = lay.kind === 'IN'
      ? [`${lay.W}×${lay.H}`, l.pitchModel, `CAB ${c.mmW}×${c.mmH}MM · ${c.pxW}×${c.pxH}PX`, `${fmtCab(totalCabinets(l))} CAB`]
      : [`${lay.W}×${lay.H}`, `USAGE ${(lay.usage * 100).toFixed(1)}%`, `GAP ${l.output.keepGap ? 'KEPT' : 'REMOVED'}`, l.pitchModel];
    tag(info.filter(Boolean).join('  ·  ').toUpperCase(), true);
  }
  ctx.restore();
}

function fitText(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, maxW: number) {
  const w = ctx.measureText(t).width;
  if (w <= maxW || maxW <= 0) { ctx.fillText(t, x, y); return; }
  ctx.save(); ctx.translate(x, y); ctx.scale(maxW / w, 1); ctx.fillText(t, 0, 0); ctx.restore();
}

export async function loadGuideFonts() {
  try {
    await Promise.all([
      document.fonts.load('40px Anton', 'ABC'),
      document.fonts.load('500 20px "JetBrains Mono"', '0123'),
      document.fonts.load('400 20px "IBM Plex Sans KR"', '가A'),
      document.fonts.load('600 20px "IBM Plex Sans KR"', '가A'),
      loadLogo(),
    ]);
  } catch { /* ignore */ }
}

/** 자간 포함 텍스트의 실제 잉크 영역. x 는 왼쪽 시작점 기준, ascent/descent 는 기준선 기준 */
function inkBounds(ctx: CanvasRenderingContext2D, t: string, track: number) {
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const chars = [...t];
  let x = 0, left = Infinity, right = -Infinity, ascent = 0, descent = 0;
  for (const c of chars) {
    const m = ctx.measureText(c);
    if (c.trim()) {
      left = Math.min(left, x - m.actualBoundingBoxLeft);
      right = Math.max(right, x + m.actualBoundingBoxRight);
      ascent = Math.max(ascent, m.actualBoundingBoxAscent);
      descent = Math.max(descent, m.actualBoundingBoxDescent);
    }
    x += m.width + track;
  }
  if (!isFinite(left)) { left = 0; right = 0; }
  return { left, right, ascent, descent };
}
function fillTrackedLeft(ctx: CanvasRenderingContext2D, t: string, x: number, y: number, track: number) {
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  for (const c of t) { ctx.fillText(c, x, y); x += ctx.measureText(c).width + track; }
}
