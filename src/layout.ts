import { PRESETS, type Led, type Face } from './types';

export interface FaceRect {
  face: Face;
  index: number;
  x: number; y: number; w: number; h: number;
  /** 인풋 가이드에서의 X (아웃풋 좌표표용) */
  inX: number;
  /** 캐비닛 수 (픽셀 / 캐비닛 px, 소수 가능) */
  cols: number; rows: number;
  overflow?: boolean;
}
export interface GapRect { x: number; y: number; w: number; h: number }

export interface Layout {
  kind: 'IN' | 'OUT';
  W: number; H: number;
  faces: FaceRect[];
  gaps: GapRect[];
  usage: number;          // 0..1 (면 면적 / 캔버스 면적)
  overflow: boolean;
  contentW: number; contentH: number;
}

export const facePx = (_l: Led, f: Face) => ({ w: Math.max(1, Math.round(f.w)), h: Math.max(1, Math.round(f.h)) });
export const cabCount = (l: Led, f: { w: number; h: number }) => ({ c: f.w / l.cabinet.pxW, r: f.h / l.cabinet.pxH });
/** 캐비닛 수 표시: 정수면 그대로, 아니면 소수 2자리 */
export const fmtCab = (n: number) => (Math.abs(n - Math.round(n)) < 1e-6 ? String(Math.round(n)) : n.toFixed(2));

/** ① 인풋: 기본은 왼쪽→오른쪽 + 앞 갭. 수동 위치(드래그)가 있으면 그 위치.
 *  캔버스 = auto(면 배치에 꼭 맞춤) 또는 직접 입력한 W×H (Resolume 컴포지션 크기처럼) */
export function inputLayout(l: Led): Layout {
  let x = 0;
  const faces: FaceRect[] = [];
  l.faces.forEach((f, i) => {
    if (i > 0 && f.gapBefore && l.gapPx > 0) x += l.gapPx;
    const { w, h } = facePx(l, f);
    const cc = cabCount(l, { w, h });
    faces.push({ face: f, index: i, x, y: 0, w, h, inX: x, cols: cc.c, rows: cc.r });
    x += w;
  });
  const man = l.input.manual;
  if (man) for (const f of faces) { const m = man[f.face.id]; if (m) { f.x = m.x; f.y = m.y; f.inX = m.x; } }

  // 갭: 앞 갭 on 인 면과 바로 앞 면 사이에 실제 빈 공간이 있을 때만 표시
  const gaps: GapRect[] = [];
  faces.forEach((f, i) => {
    if (i === 0 || !f.face.gapBefore) return;
    const p = faces[i - 1];
    const gx = p.x + p.w, gw = f.x - gx;
    const top = Math.max(p.y, f.y), bot = Math.min(p.y + p.h, f.y + f.h);
    if (gw > 0 && bot > top) gaps.push({ x: gx, y: top, w: gw, h: bot - top });
  });

  let cW = 1, cH = 1;
  for (const f of faces) { cW = Math.max(cW, f.x + f.w); cH = Math.max(cH, f.y + f.h); }
  const cv = l.input.canvas;
  const custom = cv?.mode === 'custom';
  const W = custom ? Math.max(1, cv!.w | 0) : cW;
  const H = custom ? Math.max(1, cv!.h | 0) : cH;
  let area = 0, overflow = false;
  for (const f of faces) {
    area += f.w * f.h;
    if (f.x < 0 || f.y < 0 || f.x + f.w > W || f.y + f.h > H) { f.overflow = true; overflow = true; }
  }
  return { kind: 'IN', W, H, faces, gaps, usage: area / (W * H), overflow, contentW: cW, contentH: cH };
}

/** 드래그 스냅: 캔버스 가장자리·중앙, 다른 면 가장자리에 붙음 */
export function snapPos(lay: Layout, id: string, x: number, y: number, w: number, h: number, th: number) {
  const xs = [0, lay.W, lay.W / 2], ys = [0, lay.H, lay.H / 2];
  for (const f of lay.faces) if (f.face.id !== id) { xs.push(f.x, f.x + f.w); ys.push(f.y, f.y + f.h); }
  const best = (v: number, size: number, cands: number[]) => {
    let out = v, d = th;
    for (const c of cands) for (const edge of [0, size, size / 2]) {
      const dd = Math.abs(v + edge - c);
      if (dd < d) { d = dd; out = c - edge; }
    }
    return Math.round(out);
  };
  return { x: best(x, w, xs), y: best(y, h, ys) };
}

export function outputSize(l: Led) {
  if (l.output.preset === 'CUSTOM') return { w: Math.max(1, l.output.customW | 0), h: Math.max(1, l.output.customH | 0) };
  return { w: PRESETS[l.output.preset].w, h: PRESETS[l.output.preset].h };
}

/** ② 아웃풋: 프리셋 캔버스 안에 면 배치. 기본 갭 제거 + 왼쪽 위부터, 폭 넘치면 다음 줄 */
export function outputLayout(l: Led): Layout {
  const inp = inputLayout(l);
  const { w: W, h: H } = outputSize(l);
  const o = l.output;
  const faces: FaceRect[] = [];
  const gaps: GapRect[] = [];
  let x = 0, y = 0, lineMax = 0;

  for (const fr of inp.faces) {
    const gap = o.keepGap && fr.face.gapBefore && fr.index > 0 ? l.gapPx : 0;
    if (o.flow === 'row-wrap') {
      if (x > 0 && x + gap + fr.w > W) { y += lineMax; x = 0; lineMax = 0; }
      const g = x > 0 ? gap : 0;
      if (g) gaps.push({ x, y, w: g, h: fr.h });
      x += g;
      faces.push({ ...fr, x, y, overflow: false });
      x += fr.w;
      lineMax = Math.max(lineMax, fr.h);
    } else {
      // column-wrap: 위→아래로 쌓고 높이 넘치면 다음 열 (갭은 세로 간격으로 사용)
      if (y > 0 && y + gap + fr.h > H) { x += lineMax; y = 0; lineMax = 0; }
      const g = y > 0 ? gap : 0;
      if (g) gaps.push({ x, y, w: fr.w, h: g });
      y += g;
      faces.push({ ...fr, x, y, overflow: false });
      y += fr.h;
      lineMax = Math.max(lineMax, fr.w);
    }
  }

  // 수동 위치가 있으면 우선 (향후 드래그 편집용 구조)
  if (o.manual) for (const f of faces) { const m = o.manual[f.face.id]; if (m) { f.x = m.x; f.y = m.y; } }

  let cW = 0, cH = 0;
  for (const f of faces) { cW = Math.max(cW, f.x + f.w); cH = Math.max(cH, f.y + f.h); }

  if (o.align === 'center' && !o.manual) {
    const dx = Math.max(0, Math.floor((W - cW) / 2)), dy = Math.max(0, Math.floor((H - cH) / 2));
    for (const r of [...faces, ...gaps]) { r.x += dx; r.y += dy; }
  }

  let area = 0, overflow = false;
  for (const f of faces) {
    area += f.w * f.h;
    if (f.x + f.w > W || f.y + f.h > H) { f.overflow = true; overflow = true; }
  }
  return { kind: 'OUT', W, H, faces, gaps, usage: area / (W * H), overflow, contentW: cW, contentH: cH };
}

export const meters = (l: Led, f: FaceRect) => ({
  w: (f.cols * l.cabinet.mmW) / 1000,
  h: (f.rows * l.cabinet.mmH) / 1000,
});

export const totalCabinets = (l: Led) => l.faces.reduce((s, f) => { const c = cabCount(l, f); return s + c.c * c.r; }, 0);

export function safeName(s: string) {
  return (s || 'LED').trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_');
}

export function fileName(l: Led, kind: 'IN' | 'OUT', W: number, H: number) {
  return `${safeName(l.number || '00')}_${safeName(l.name)}_${kind === 'IN' ? 'INPUT' : 'OUTPUT'}_${W}x${H}.png`;
}

/** 좌표 복사용 텍스트 */
export function coordsText(l: Led, lay: Layout) {
  const head = `${l.number} ${l.name} — ${lay.kind === 'IN' ? 'INPUT' : 'OUTPUT'} ${lay.W}x${lay.H}`;
  const rows = lay.faces.map((f) => {
    const base = `${f.face.name.padEnd(12)} X ${String(f.x).padStart(5)}  Y ${String(f.y).padStart(5)}  W ${String(f.w).padStart(5)}  H ${String(f.h).padStart(5)}  AE ${f.x + f.w / 2},${f.y + f.h / 2}`;
    return lay.kind === 'OUT' ? `${base}  (IN X ${f.inX} → OUT ${f.x},${f.y})` : base;
  });
  return [head, ...rows].join('\n');
}

/** iOS Safari 캔버스 최대 픽셀(약 16.7MP) */
export const MAX_CANVAS_PX = 16_777_216;
