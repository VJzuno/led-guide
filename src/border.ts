/** 보더 마스크 엔진 (tools/border-maker.html 에서 옮김)
 *  - 마스크 값 1 = 영상 보임, 0 = 가림
 *  - 보이기 창들의 합집합(max) → 가리기 창들로 깎음 (mask = min(mask, 1 - block)). 보이기 창이 없으면 전체 보임에서 시작
 *  - 페더: 라운드 사각형 SDF 하드 마스크 + 분리형 박스블러 N패스 (가우시안 3 / 스무스 2 / 리니어 1)
 *  - edgeOpen: 캔버스 가장자리에 닿은 변은 밖으로 끝없이 늘려서 그 변엔 페더가 안 생김 */
import type { BorderLayer, BorderSet, BorderWin } from './types';

function blur(buf: Float32Array, w: number, h: number, F: number, passes: number) {
  const bw = Math.max(1, Math.round(F / passes));
  if (F <= 0.5 || bw <= 1) return;
  const n0 = Math.max(w, h);
  const line = new Float32Array(n0), out = new Float32Array(n0);
  const lo = Math.floor((bw - 1) / 2), hi = bw - 1 - lo, inv = 1 / bw;
  const blurLine = (n: number) => {
    let sum = 0;
    for (let j = 0; j <= hi && j < n; j++) sum += line[j];
    for (let i = 0; i < n; i++) {
      out[i] = sum * inv;
      const add = i + hi + 1, sub = i - lo;
      if (add < n) sum += line[add];
      if (sub >= 0) sum -= line[sub];
    }
  };
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const base = y * w;
      for (let x = 0; x < w; x++) line[x] = buf[base + x];
      blurLine(w);
      for (let x = 0; x < w; x++) buf[base + x] = out[x];
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) line[y] = buf[y * w + x];
      blurLine(h);
      for (let y = 0; y < h; y++) buf[y * w + x] = out[y];
    }
  }
}

/** 창 하나의 모양(라운드 사각형 + 페더)을 target에 max로 찍음. 값 1 = 창 안 */
function stamp(mask: Float32Array, win: BorderWin, L: BorderLayer, w: number, h: number, scale: number) {
  const passes = L.curve === 'linear' ? 1 : L.curve === 'smooth' ? 2 : 3;
  const block = win.t === 'block';
  const F = Math.max(0, win.f) * scale;
  const b = block ? 0 : Math.max(0, win.b);
  let hx0 = (win.x + b) * scale, hx1 = (win.x + win.w - b) * scale;
  let hy0 = (win.y + b) * scale, hy1 = (win.y + win.h - b) * scale;
  if (hx1 - hx0 <= 0 || hy1 - hy0 <= 0) return;
  if (L.edgeOpen) {
    const e = 0.5 * scale, FAR = 1e5;
    if (hx0 <= e) hx0 = -FAR;
    if (hy0 <= e) hy0 = -FAR;
    if (hx1 >= w - e) hx1 = w + FAR;
    if (hy1 >= h - e) hy1 = h + FAR;
  }
  // 방향: out = 보이는 영역 유지(페더가 가림 쪽으로), in = 가림 유지. 가리기 창은 안팎이 반대
  let off = L.dir === 'in' ? F / 2 : L.dir === 'out' ? -F / 2 : 0;
  if (block) off = -off;
  const margin = Math.ceil(F * 1.1) + 3;
  const lx0 = Math.max(-margin, Math.floor(hx0) - margin), ly0 = Math.max(-margin, Math.floor(hy0) - margin);
  const lx1 = Math.min(w + margin, Math.ceil(hx1) + margin), ly1 = Math.min(h + margin, Math.ceil(hy1) + margin);
  const lw = lx1 - lx0, lh = ly1 - ly0;
  if (lw <= 0 || lh <= 0) return;
  const cx = (hx0 + hx1) / 2, cy = (hy0 + hy1) / 2, hw = (hx1 - hx0) / 2, hh = (hy1 - hy0) / 2;
  const r = Math.min(Math.max(0, win.r) * scale, hw, hh);
  const bx = hw - r, by = hh - r;
  const loc = new Float32Array(lw * lh);
  let k = 0;
  for (let j = 0; j < lh; j++) {
    const qy = Math.abs(ly0 + j + 0.5 - cy) - by;
    for (let i = 0; i < lw; i++, k++) {
      const qx = Math.abs(lx0 + i + 0.5 - cx) - bx;
      const ox = qx > 0 ? qx : 0, oy = qy > 0 ? qy : 0;
      const d = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r + off;
      const m = 0.5 - d;
      loc[k] = m < 0 ? 0 : m > 1 ? 1 : m;
    }
  }
  blur(loc, lw, lh, F, passes);
  const sx = Math.max(0, lx0), ex = Math.min(w, lx1), sy = Math.max(0, ly0), ey = Math.min(h, ly1);
  for (let y = sy; y < ey; y++) {
    const lb = (y - ly0) * lw - lx0, mb = y * w;
    for (let x = sx; x < ex; x++) { const v = loc[lb + x]; if (v > mask[mb + x]) mask[mb + x] = v; }
  }
}

export function buildMask(L: BorderLayer, w: number, h: number, scale: number) {
  const holes = L.wins.filter((x) => x.t !== 'block'), blocks = L.wins.filter((x) => x.t === 'block');
  const mask = new Float32Array(w * h);
  if (!holes.length) mask.fill(1);
  for (const win of holes) stamp(mask, win, L, w, h, scale);
  if (blocks.length) {
    const bm = new Float32Array(w * h);
    for (const win of blocks) stamp(bm, win, L, w, h, scale);
    for (let k = 0; k < w * h; k++) { const v = 1 - bm[k]; if (v < mask[k]) mask[k] = v; }
  }
  return mask;
}

const hexRGB = (hex: string) => [1, 3, 5].map((i) => parseInt((hex || '#000000').slice(i, i + 2), 16) || 0);

/** 레이어 한 장을 RGBA로 (오버레이: 가림 영역 = 마스크 색 × 불투명도 / 매트: 흰색 = 보임) */
export function layerImage(L: BorderLayer, W: number, H: number, scale: number): ImageData {
  const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
  const mask = buildMask(L, w, h, w / W);
  const img = new ImageData(w, h), d8 = img.data;
  const [cr, cg, cb] = hexRGB(L.color);
  const op = Math.max(0, Math.min(100, L.opacity)) / 100;
  for (let k = 0, i = 0; k < w * h; k++, i += 4) {
    const a = 1 - mask[k];
    if (L.mode === 'overlay') { d8[i] = cr; d8[i + 1] = cg; d8[i + 2] = cb; d8[i + 3] = Math.round(a * op * 255); }
    else { const v = Math.round((L.invert ? a : 1 - a) * 255); d8[i] = d8[i + 1] = d8[i + 2] = v; d8[i + 3] = 255; }
  }
  return img;
}

/** 레이어 한 장 → 캔버스 */
export function renderLayer(canvas: HTMLCanvasElement, S: BorderSet, L: BorderLayer, scale = 1) {
  const img = layerImage(L, S.W, S.H, scale);
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas;
}

/** 보이는 레이어를 아래(목록 끝)부터 위(목록 처음)로 겹쳐 한 장 */
export function renderMerged(canvas: HTMLCanvasElement, S: BorderSet, scale = 1, only?: BorderLayer[]) {
  const w = Math.max(1, Math.round(S.W * scale)), h = Math.max(1, Math.round(S.H * scale));
  canvas.width = w; canvas.height = h;
  const x = canvas.getContext('2d')!;
  x.clearRect(0, 0, w, h);
  const list = (only || S.layers.filter((l) => l.visible)).slice().reverse();
  const tmp = document.createElement('canvas');
  for (const L of list) {
    const img = layerImage(L, S.W, S.H, scale);
    tmp.width = img.width; tmp.height = img.height;
    tmp.getContext('2d')!.putImageData(img, 0, 0);
    x.drawImage(tmp, 0, 0, w, h);
  }
  return canvas;
}

export const toPng = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG 생성 실패 — 캔버스가 너무 큽니다'))), 'image/png'));

const safe = (s: string) => (s || 'border').trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').slice(0, 40);
export function layerFileName(S: BorderSet, L: BorderLayer, i: number) {
  return `${safe(S.name)}_${String(i + 1).padStart(2, '0')}_${safe(L.name)}_${S.W}x${S.H}${L.mode === 'matte' ? '_matte' : ''}.png`;
}
export const mergedFileName = (S: BorderSet) => `${safe(S.name)}_MERGED_${S.W}x${S.H}.png`;

export function newLayer(id: string, name: string, W: number, H: number): BorderLayer {
  const w = Math.round(W * 0.75), h = Math.round(H * 0.75);
  return {
    id, name, visible: true,
    wins: [{ t: 'hole', x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h, b: 0, f: Math.round(Math.min(W, H) * 0.11), r: 0 }],
    dir: 'center', curve: 'gauss', edgeOpen: true, mode: 'overlay', color: '#000000', opacity: 100, invert: false,
  };
}
