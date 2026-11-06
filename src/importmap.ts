/** 인풋맵 불러오기
 *  - 이미지(PNG/JPG): 픽셀 분석으로 면(스크린) 사각형 자동 감지 + 캐비닛 px 추정
 *  - Resolume Advanced Output 프리셋(.xml): Screen별 Slice의 Input 영역
 *  DOM 의존 없음 (노드에서 테스트 가능). 결과를 LED에 적용하는 건 applyImport */
import type { Led, Face } from './types';

export interface Rect { x: number; y: number; w: number; h: number }
export interface MapScreen extends Rect { name: string; enabled: boolean }
/** Resolume의 Screen 하나 (= 출력 하나). 프리셋에 여러 개 들어 있음 (실제 출력 / MAP / VCR 등) */
export interface XmlGroup { name: string; enabled: boolean; screens: MapScreen[] }
export interface XmlResult { W: number; H: number; groups: XmlGroup[]; best: number }

type Px = Uint8ClampedArray | Uint8Array;

/* =================================================================== */
/* 이미지 분석                                                           */
/* =================================================================== */

/** 테두리 픽셀 최빈색 = 배경. 맨 가장자리와 조금 안쪽(8px) 두 테두리에서 모두 우세해야 함
 *  (면이 가장자리까지 꽉 찬 맵은 면 테두리선이 가장자리에 깔리므로 → 검정으로 간주) */
function borderColor(D: Px, W: number, H: number): [number, number, number] {
  const ring = (d: number) => {
    const cnt = new Map<string, number>();
    let tot = 0;
    const pick = (x: number, y: number) => {
      tot++;
      const k = (y * W + x) * 4;
      if (D[k + 3] < 24) return;
      const q = `${D[k] >> 4},${D[k + 1] >> 4},${D[k + 2] >> 4}`;
      cnt.set(q, (cnt.get(q) || 0) + 1);
    };
    const sx = Math.max(1, Math.floor(W / 400)), sy = Math.max(1, Math.floor(H / 400));
    for (let x = d; x < W - d; x += sx) { pick(x, d); pick(x, H - 1 - d); }
    for (let y = d; y < H - d; y += sy) { pick(d, y); pick(W - 1 - d, y); }
    return { cnt, tot };
  };
  const a = ring(0), d = Math.min(8, Math.floor(Math.min(W, H) / 4)), b = ring(d);
  const top = [...a.cnt.entries()].sort((p, q) => q[1] - p[1])[0];
  if (top && top[1] > a.tot * 0.4 && (b.cnt.get(top[0]) || 0) > b.tot * 0.4)
    return top[0].split(',').map((v) => (+v << 4) + 8) as [number, number, number];
  return [0, 0, 0];
}

/** 배경 마스크 (1 = 배경). 투명 / 배경색과 가까움 / 가이드 갭 색 */
function bgMask(D: Px, W: number, H: number) {
  const [r, g, b] = borderColor(D, W, H);
  const m = new Uint8Array(W * H);
  for (let i = 0, k = 0; i < W * H; i++, k += 4) {
    if (D[k + 3] < 24 || Math.abs(D[k] - r) + Math.abs(D[k + 1] - g) + Math.abs(D[k + 2] - b) < 24) m[i] = 1;
    // 이 앱이 그린 가이드의 갭 배경색(#0B0912)도 빈 곳으로 (빗금은 남지만 열 단위로는 대부분 비어 보임)
    else if (Math.abs(D[k] - 11) <= 4 && Math.abs(D[k + 1] - 9) <= 4 && Math.abs(D[k + 2] - 18) <= 4) m[i] = 1;
  }
  return m;
}

/** 연결 성분 (행 단위 런 + union-find) → bbox + 채움 비율 */
function components(bg: Uint8Array, W: number, H: number) {
  const par: number[] = [], bx: number[][] = [], area: number[] = [];
  const find = (a: number) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  let prev: number[][] = [];
  for (let y = 0; y < H; y++) {
    const cur: number[][] = [], row = y * W;
    let x = 0;
    while (x < W) {
      while (x < W && bg[row + x]) x++;
      if (x >= W) break;
      const s = x;
      while (x < W && !bg[row + x]) x++;
      const id = par.length;
      par.push(id); bx.push([s, y, x - 1, y]); area.push(x - s); cur.push([s, x - 1, id]);
      for (const q of prev) if (q[0] <= x - 1 && q[1] >= s) { const a = find(q[2]), b = find(id); if (a !== b) par[b] = a; }
    }
    prev = cur;
  }
  const mp = new Map<number, { b: number[]; a: number }>();
  bx.forEach((b, i) => {
    const r = find(i), o = mp.get(r);
    if (!o) mp.set(r, { b: [...b], a: area[i] });
    else { o.b[0] = Math.min(o.b[0], b[0]); o.b[1] = Math.min(o.b[1], b[1]); o.b[2] = Math.max(o.b[2], b[2]); o.b[3] = Math.max(o.b[3], b[3]); o.a += area[i]; }
  });
  return [...mp.values()].map(({ b, a }) => {
    const r = { x: b[0], y: b[1], w: b[2] - b[0] + 1, h: b[3] - b[1] + 1 };
    return { ...r, fill: a / (r.w * r.h) };
  });
}

/** 열(ax='x') 또는 행 단위 전경 비율 */
function fgProfile(bg: Uint8Array, W: number, r: Rect, ax: 'x' | 'y') {
  const X = ax === 'x', n = X ? r.w : r.h, m = X ? r.h : r.w, step = Math.max(1, Math.floor(m / 400));
  const P = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let f = 0, c = 0;
    for (let j = 0; j < m; j += step) { const px = X ? r.x + i : r.x + j, py = X ? r.y + j : r.y + i; if (!bg[py * W + px]) f++; c++; }
    P[i] = f / c;
  }
  return P;
}

/** 빈 열/행 판정 기준: 그 축에서 가장 꽉 찬 열/행의 절반 */
const thrOf = (P: Float32Array) => Math.max(0.08, 0.5 * P.reduce((m, v) => Math.max(m, v), 0));

/** 가장자리의 빈 열/행 잘라내기 */
function trim(bg: Uint8Array, W: number, r: Rect): Rect | null {
  const px = fgProfile(bg, W, r, 'x'), py = fgProfile(bg, W, r, 'y'), tx = thrOf(px), ty = thrOf(py);
  let a = 0, b = r.w, c = 0, d = r.h;
  while (a < b && px[a] < tx) a++;
  while (b > a && px[b - 1] < tx) b--;
  while (c < d && py[c] < ty) c++;
  while (d > c && py[d - 1] < ty) d--;
  if (b - a < 8 || d - c < 8) return null;
  return { x: r.x + a, y: r.y + c, w: b - a, h: d - c };
}

/** XY 컷: 비어 있는 열/행(갭, 빗금 갭, 면 사이 빈 공간)에서 나눔 */
function xyCut(bg: Uint8Array, W: number, r0: Rect, depth = 0): Rect[] {
  const r = trim(bg, W, r0);
  if (!r) return [];
  if (depth > 8) return [r];
  for (const ax of ['x', 'y'] as const) {
    const P = fgProfile(bg, W, r, ax), n = P.length, parts: Rect[] = [], thr = thrOf(P);
    let s = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && P[i] >= thr;
      if (on && s < 0) s = i;
      if (!on && s >= 0) {
        parts.push(ax === 'x' ? { x: r.x + s, y: r.y, w: i - s, h: r.h } : { x: r.x, y: r.y + s, w: r.w, h: i - s });
        s = -1;
      }
    }
    const big = parts.filter((p) => (ax === 'x' ? p.w : p.h) >= 8);
    // 둘 이상으로 나뉘었거나, 한쪽 빈 띠(가장자리 얇은 선 너머)가 잘려 나갔으면 다시
    if (big.length > 1 || (big.length === 1 && (big[0].w !== r.w || big[0].h !== r.h)))
      return big.flatMap((p) => xyCut(bg, W, p, depth + 1));
  }
  return [r];
}

/** 맞붙은 면 나누기: ① 흰 세로/가로 줄(면 테두리) ② 평균색 계단 변화(면마다 다른 색) */
function splitTouching(D: Px, W: number, b: Rect, ax: 'x' | 'y'): Rect[] {
  const X = ax === 'x', n = X ? b.w : b.h, m = X ? b.h : b.w, step = Math.max(1, Math.floor(m / 500));
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), Wh = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0, g = 0, bl = 0, w = 0, c = 0;
    for (let j = 0; j < m; j += step) {
      const px = X ? b.x + i : b.x + j, py = X ? b.y + j : b.y + i, k = (py * W + px) * 4, r0 = D[k], g0 = D[k + 1], b0 = D[k + 2];
      r += r0; g += g0; bl += b0; if (r0 > 215 && g0 > 215 && b0 > 215) w++; c++;
    }
    R[i] = r / c; G[i] = g / c; B[i] = bl / c; Wh[i] = w / c;
  }
  const cuts: number[] = [];
  // ① 흰 줄: 가장자리(양 끝 3px)는 면 자체의 테두리라 제외
  for (let i = 0; i < n;) {
    if (Wh[i] > 0.6) {
      const s = i;
      while (i < n && Wh[i] > 0.6) i++;
      if (s > 3 && i < n - 3 && i - s < Math.max(12, n * 0.02)) cuts.push(Math.round((s + i) / 2));
    } else i++;
  }
  // ② 색 계단: 양쪽 창이 각각 고르고(분산 작음) 평균색 차이가 클 때
  const K = Math.max(12, Math.round(n * 0.06));
  const stat = (a: number, z: number) => {
    let mr = 0, mg = 0, mb = 0;
    for (let i = a; i < z; i++) { mr += R[i]; mg += G[i]; mb += B[i]; }
    const c = z - a; mr /= c; mg /= c; mb /= c;
    let v = 0;
    for (let i = a; i < z; i++) v += (R[i] - mr) ** 2 + (G[i] - mg) ** 2 + (B[i] - mb) ** 2;
    return [mr, mg, mb, Math.sqrt(v / c)];
  };
  // 진짜 면 경계인지: 양쪽 창의 '쓰인 색 목록'이 달라야 함.
  // 같은 면 안의 라벨 글자·체커 칸 위치 차이는 색 비율만 바뀌고 목록은 거의 같음
  const palette = (a: number, z: number) => {
    const h = new Map<number, number>();
    let c = 0;
    const sa = Math.max(1, Math.floor((z - a) / 24)), sj = Math.max(1, Math.floor(m / 200));
    for (let i = a; i < z; i += sa) for (let j = 0; j < m; j += sj) {
      const px = X ? b.x + i : b.x + j, py = X ? b.y + j : b.y + i, k = (py * W + px) * 4;
      const q = ((D[k] >> 5) << 6) | ((D[k + 1] >> 5) << 3) | (D[k + 2] >> 5);
      h.set(q, (h.get(q) || 0) + 1); c++;
    }
    return new Set([...h.entries()].filter(([, v]) => v >= c * 0.06).map(([q]) => q));
  };
  const wide = (i: number) => {
    const L = palette(i - K, i), Q = palette(i, i + K);
    const inter = [...L].filter((q) => Q.has(q)).length, uni = new Set([...L, ...Q]).size;
    return uni > 0 && inter / uni < 0.34;
  };
  let best = -1, bv = 0;
  const push = (i: number) => { if (wide(i)) cuts.push(i); };
  for (let i = K; i <= n - K; i++) {
    const L = stat(i - K, i), Q = stat(i, i + K), d = Math.hypot(L[0] - Q[0], L[1] - Q[1], L[2] - Q[2]);
    if (d > 45 && L[3] < 14 && Q[3] < 14) { if (d > bv) { bv = d; best = i; } }
    else if (best >= 0) { push(best); best = -1; bv = 0; }
  }
  if (best >= 0) push(best);

  const cs = [...new Set(cuts)].sort((a, c) => a - c).filter((c, i, a) => i === 0 || c - a[i - 1] > 8);
  const mn = Math.max(8, n * 0.02), keep: number[] = [];
  let p = 0;
  for (const c of cs) if (c - p >= mn && n - c >= mn) { keep.push(c); p = c; }
  const parts: Rect[] = [];
  p = 0;
  for (const c of [...keep, n]) { parts.push(X ? { x: b.x + p, y: b.y, w: c - p, h: b.h } : { x: b.x, y: b.y + p, w: b.w, h: c - p }); p = c; }
  return parts;
}

/** 이미지에서 면 사각형 감지. 결과는 위→아래 줄, 줄 안에서 왼→오 순서 */
export function detectScreens(D: Px, W: number, H: number): Rect[] {
  const bg = bgMask(D, W, H);
  let comps = components(bg, W, H)
    .filter((c) => c.w >= 16 && c.h >= 16 && c.w * c.h >= W * H * 0.002 && c.fill >= 0.3);
  comps = comps.filter((a) => !comps.some((b) => b !== a && b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h));
  const out: Rect[] = [];
  for (const c of comps)
    for (const r of xyCut(bg, W, c))
      for (const a of splitTouching(D, W, r, 'x'))
        for (const b of splitTouching(D, W, a, 'y'))
          if (b.w >= 16 && b.h >= 16 && b.w * b.h >= W * H * 0.002) out.push(b); // 글자 조각 등 제외
  return sortRects(out);
}

/** 제목·정보 바처럼 보이는 조각 (가로로 아주 길고 낮음) → 기본 선택 해제용 */
export const likelyLabel = (r: Rect, W: number, H: number) => r.h < H * 0.1 && r.w / r.h > 12;

export function sortRects<T extends Rect>(list: T[]): T[] {
  const band = Math.max(8, Math.min(...list.map((r) => r.h), 1e9) * 0.5);
  return [...list].sort((a, b) => (Math.round(a.y / band) - Math.round(b.y / band)) || a.x - b.x);
}

/** 캐비닛 px 추정: 체커/그리드 경계가 면 왼쪽(위쪽)에서 일정 간격으로 반복되는지 봄.
 *  간격 c의 배수 위치의 경계 에너지 / 평균 에너지가 가장 큰 c 중 가장 작은 값 */
export function estimateCabinet(D: Px, W: number, rects: Rect[]): { w: number; h: number } | null {
  const lum = (k: number) => D[k] * 0.299 + D[k + 1] * 0.587 + D[k + 2] * 0.114;
  const energy = (r: Rect, ax: 'x' | 'y') => {
    const X = ax === 'x', n = X ? r.w : r.h, m = X ? r.h : r.w, step = Math.max(1, Math.floor(m / 300));
    const E = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      let e = 0;
      for (let j = 0; j < m; j += step) {
        const k1 = X ? ((r.y + j) * W + r.x + i) * 4 : ((r.y + i) * W + r.x + j) * 4;
        const k0 = X ? k1 - 4 : k1 - W * 4;
        e += Math.abs(lum(k1) - lum(k0));
      }
      E[i] = e;
    }
    // ±1px 허용 (안티앨리어싱·JPEG): 이웃 3칸 최대값
    const M = new Float32Array(n);
    for (let i = 1; i < n - 1; i++) M[i] = Math.max(E[i - 1], E[i], E[i + 1]);
    return M;
  };
  const pick = (ax: 'x' | 'y') => {
    const Es = rects.filter((r) => (ax === 'x' ? r.w : r.h) >= 48).map((r) => energy(r, ax));
    const none = { c: 0, score: [] as number[], best: 0 };
    if (!Es.length) return none;
    const maxN = Math.max(...Es.map((e) => e.length));
    let tot = 0, cnt = 0;
    for (const E of Es) for (let i = 2; i < E.length - 1; i++) { tot += E[i]; cnt++; }
    const mean = tot / Math.max(1, cnt);
    if (mean <= 0) return none;
    // 하위 분위수: 가운데 크로스·면 테두리 같은 큰 선 몇 개에 끌려가지 않고, 모든 배수 위치에 경계가 있어야 높음
    const score: number[] = [];
    for (let c = 8; c <= Math.floor(maxN / 2); c++) {
      const v: number[] = [];
      for (const E of Es) if (E.length - 4 > 2 * c) for (let i = c; i < E.length - 4; i += c) v.push(E[i]); // 면마다 2번 이상 반복
      if (v.length < 3) { score[c] = 0; continue; }
      v.sort((a, b) => a - b);
      score[c] = v[v.length >> 2] / mean; // 하위 25%: 배수 위치 대부분에 경계가 있어야 높음
    }
    const best = Math.max(0, ...score.filter((v) => v > 0));
    if (best < 3) return none; // 반복되는 경계가 뚜렷하지 않음
    for (let c = 8; c < score.length; c++) if (score[c] >= best * 0.8) return { c, score, best };
    return none;
  };
  const X = pick('x'), Y = pick('y');
  let w = X.c, h = Y.c;
  if (!w && !h) return null;
  // 캐비닛은 대개 정사각형: 한 축이 다른 축 값에서도 충분히 높으면 정사각형으로
  if (w && h && w !== h) {
    if (w < h && (Y.score[w] ?? 0) >= Y.best * 0.6) h = w;
    else if (h < w && (X.score[h] ?? 0) >= X.best * 0.6) w = h;
  }
  return { w: w || h, h: h || w };
}

/* =================================================================== */
/* Resolume Advanced Output XML                                          */
/* =================================================================== */

const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? unesc(m[1]) : undefined; };
/** <Params name="Common"> 안의 <Param name="X" value="..."> (Slice/Screen 자신의 것만 보도록 첫 Params 블록만) */
function commonParam(block: string, name: string) {
  const common = block.match(/<Params name="Common">([\s\S]*?)<\/Params>/)?.[1] ?? '';
  const tag = common.match(new RegExp(`<Param name="${name}"[^>]*>`))?.[0];
  return tag ? attr(tag, 'value') ?? attr(tag, 'default') : undefined;
}

/** 오류 시 사용자에게 보여줄 문장을 담은 Error를 던짐 */
export function parseResolumeXml(text: string): XmlResult {
  if (!/<ScreenSetup[\s>]/.test(text)) throw new Error('Resolume Advanced Output 프리셋(.xml)이 아니에요.');
  const ct = text.match(/<CurrentCompositionTextureSize[^>]*>/)?.[0];
  const W = ct ? Math.round(+(attr(ct, 'width') ?? 0)) : 0;
  const H = ct ? Math.round(+(attr(ct, 'height') ?? 0)) : 0;

  const groups: XmlGroup[] = [];
  // <Screen ...> ... </Screen> (ScreenSetup / ScreenGuide 제외)
  const screenRe = /<Screen\s[^>]*>([\s\S]*?)<\/Screen>/g;
  let sm: RegExpExecArray | null;
  while ((sm = screenRe.exec(text))) {
    const open = sm[0].slice(0, sm[0].indexOf('>') + 1), body = sm[1];
    const head = body.split(/<layers[\s>]/)[0];
    const gName = commonParam(head, 'Name') || attr(open, 'name') || `Screen ${groups.length + 1}`;
    const gEnabled = commonParam(head, 'Enabled') !== '0';
    const screens: MapScreen[] = [];
    const seen = new Set<string>();
    const sliceRe = /<Slice[\s>][\s\S]*?<\/Slice>/g;
    let lm: RegExpExecArray | null;
    while ((lm = sliceRe.exec(body))) {
      const s = lm[0];
      const ir = s.match(/<InputRect[^>]*>([\s\S]*?)<\/InputRect>/)?.[1];
      if (!ir) continue;
      const vs = [...ir.matchAll(/<v\s[^>]*>/g)].map((v) => [+(attr(v[0], 'x') ?? NaN), +(attr(v[0], 'y') ?? NaN)]).filter((v) => isFinite(v[0]) && isFinite(v[1]));
      if (!vs.length) continue;
      const xs = vs.map((v) => v[0]), ys = vs.map((v) => v[1]);
      const x0 = Math.round(Math.min(...xs)), y0 = Math.round(Math.min(...ys));
      const r = { x: x0, y: y0, w: Math.round(Math.max(...xs)) - x0, h: Math.round(Math.max(...ys)) - y0 };
      if (r.w < 1 || r.h < 1) continue;
      const key = `${r.x},${r.y},${r.w},${r.h}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const name = (commonParam(s, 'Name') || `SLICE_${screens.length + 1}`).trim();
      screens.push({ name, enabled: commonParam(s, 'Enabled') !== '0', ...r });
    }
    if (screens.length) groups.push({ name: gName.trim(), enabled: gEnabled, screens: sortRects(screens) });
  }
  if (!groups.length) throw new Error('XML에서 슬라이스 Input 영역을 찾지 못했어요.');

  // 기본 선택: 서로 겹치지 않는 켜진 슬라이스가 덮는 면적이 가장 큰 Screen (= 실제 LED 출력일 가능성이 큼)
  // 슬라이스 하나가 컴포지션 전체를 덮는 FULL 류는 맵/미리보기용이라 제외
  const full = (s: Rect) => W > 0 && s.w >= W * 0.95 && s.h >= H * 0.95;
  const score = (g: XmlGroup) => (g.enabled ? 1e12 : 0) +
    nonOverlapping(g.screens.filter((s) => s.enabled && !full(s))).reduce((a, s) => a + s.w * s.h, 0);
  let best = 0;
  groups.forEach((g, i) => { if (score(g) > score(groups[best])) best = i; });
  return { W, H, groups, best };
}

/** 겹치는 사각형 빼고 남는 것 (앞에서부터 욕심내서 고름) */
export function nonOverlapping<T extends Rect>(list: T[]): T[] {
  const out: T[] = [];
  for (const r of list) if (!out.some((o) => overlap(o, r) > 0.05 * Math.min(o.w * o.h, r.w * r.h))) out.push(r);
  return out;
}
export const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/* =================================================================== */
/* LED에 적용                                                            */
/* =================================================================== */

export interface ApplyOpts {
  W: number; H: number;
  screens: { name: string; x: number; y: number; w: number; h: number }[];
  /** 캐비닛 px도 바꿈 */
  cabinet?: { w: number; h: number } | null;
  /** 크기를 캐비닛 배수에 맞춤 (차이가 캐비닛의 6% 이내일 때만) */
  snap?: boolean;
  map?: { src: string; w: number; h: number } | null;
  newId: () => string;
}

const snapTo = (v: number, c: number) => {
  if (!c) return v;
  const r = Math.round(v / c) * c;
  return r > 0 && Math.abs(r - v) <= Math.max(1, c * 0.06) ? r : v;
};

/** 면 목록·위치·캔버스를 맞춤. 가로 한 줄 + 일정한 갭이면 자동 배치(앞 갭)로, 아니면 수동 위치로 */
export function applyImport(l: Led, o: ApplyOpts): Led {
  const cab = o.cabinet && o.cabinet.w > 0 && o.cabinet.h > 0 ? o.cabinet : null;
  const cw = cab?.w ?? l.cabinet.pxW, ch = cab?.h ?? l.cabinet.pxH;
  const list = sortRects(o.screens).map((s) => ({
    name: (s.name || 'FACE').slice(0, 40), x: Math.round(s.x), y: Math.round(s.y),
    w: Math.max(1, Math.round(o.snap ? snapTo(s.w, cw) : s.w)), h: Math.max(1, Math.round(o.snap ? snapTo(s.h, ch) : s.h)),
  }));
  const faces: Face[] = list.map((s) => ({ id: o.newId(), name: s.name, w: s.w, h: s.h, gapBefore: false }));

  // 자동 배치로 똑같이 재현되는지: 모두 y=0, 왼→오로 겹치지 않음, 사이 간격이 0 또는 같은 값 하나
  const gaps = list.slice(1).map((s, i) => s.x - (list[i].x + list[i].w));
  const pos = gaps.filter((g) => g > 0);
  const g0 = pos[0] ?? 0;
  const auto = list[0]?.x === 0 && list.every((s) => s.y === 0) && gaps.every((g) => g === 0 || g === g0);

  const n: Led = { ...l, faces, input: { ...l.input }, output: { ...l.output } };
  if (cab) n.cabinet = { ...l.cabinet, pxW: cab.w, pxH: cab.h };
  delete n.output.manual;
  if (auto) {
    faces.forEach((f, i) => { f.gapBefore = i > 0 && gaps[i - 1] > 0; });
    if (g0 > 0) n.gapPx = g0;
    delete n.input.manual;
  } else {
    n.input.manual = Object.fromEntries(faces.map((f, i) => [f.id, { x: list[i].x, y: list[i].y }]));
  }
  let cW = 1, cH = 1;
  for (const s of list) { cW = Math.max(cW, s.x + s.w); cH = Math.max(cH, s.y + s.h); }
  const W = o.W || cW, H = o.H || cH;
  n.input.canvas = W === cW && H === cH ? { mode: 'auto', w: W, h: H } : { mode: 'custom', w: W, h: H };
  if (o.map !== undefined) { if (o.map) n.input.map = o.map; else delete n.input.map; }
  return n;
}
