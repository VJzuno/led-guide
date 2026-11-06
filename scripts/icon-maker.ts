/* 앱 아이콘 생성기 (개발용) — 평면 · 2톤(블랙 + 퍼플)
 * npm run dev → /scripts/icon-maker.html?draft=D
 * window.drafts = 시안 비교 시트, window.icons = 선택 시안의 실제 아이콘(아이폰용 / PC용 분리) */
import logoUrl from '../src/assets/zuno-logo.png';

const C1 = '#000000';   // 톤 1
const C2 = '#A855F7';   // 톤 2 (포인트)

export interface IconStyle {
  grid?: boolean;    // 수평·수직선 (2×2 캐비닛)
  diag?: boolean;    // 대각선
  outer?: boolean;   // 바깥 원
  invert: boolean;   // 원톤 반전: 퍼플 바탕 + 블랙 요소
  ref?: string;      // 레퍼런스 스타일: 큰 원 색 (남색 바탕 + 보라 글로우 + 흰 로고)
  cells?: number;    // 캐비닛 그리드 칸 수 (N×N)
  checker?: boolean; // 캐비닛 체커 (아주 은은하게)
  nums?: boolean;    // 캐비닛 번호
}
export const DRAFTS: Record<string, IconStyle> = {
  O: { invert: false, ref: 'inner', cells: 4 },
};
const DRAFT = (new URLSearchParams(location.search).get('draft') || 'O').toUpperCase();
/** 지금 그리는 아이콘의 모서리 반지름 비율 (아이폰 0.225, PC 0.22, 안드로이드 0.5 원형까지 고려해 0.2) */
let RAD = 0.225;

let logoP: Promise<HTMLImageElement> | null = null;
const loadLogo = () => (logoP ??= new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = logoUrl; }));
/** 흰 로고를 한 가지 색으로 */
async function tinted(color: string) {
  const img = await loadLogo();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d')!;
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** 아이콘 본체. S = 그릴 영역 크기, (ox,oy) = 위치. small = 작은 크기용 단순화 */
async function body(x: CanvasRenderingContext2D, ox: number, oy: number, S: number, st: IconStyle, small = false) {
  if (st.ref) return refBody(x, ox, oy, S, st.ref, small, st);
  const bg = st.invert ? C2 : C1, fg = st.invert ? C1 : C2;
  const cx = ox + S / 2, cy = oy + S / 2;
  x.fillStyle = bg; x.fillRect(ox, oy, S, S);

  const R = S * (small ? 0.4 : 0.34);       // 메인 원
  const R2 = S * 0.47;                      // 바깥 원 (C 처럼 한 겹 더)
  const lw = Math.max(1, S * (small ? 0.05 : 0.028));
  x.strokeStyle = fg;

  if ((st.grid || st.diag) && !small) {
    // 선 (원 안쪽은 비움)
    x.save();
    x.beginPath(); x.rect(ox, oy, S, S); x.arc(cx, cy, R, 0, Math.PI * 2, true); x.clip('evenodd');
    x.lineWidth = Math.max(1, S * 0.014);
    x.beginPath();
    if (st.grid) { x.moveTo(cx, oy); x.lineTo(cx, oy + S); x.moveTo(ox, cy); x.lineTo(ox + S, cy); }
    if (st.diag) { x.moveTo(ox, oy); x.lineTo(ox + S, oy + S); x.moveTo(ox + S, oy); x.lineTo(ox, oy + S); }
    x.stroke();
    x.restore();
  }
  if (st.outer && !small) {
    x.lineWidth = Math.max(1, S * 0.012);
    x.beginPath(); x.arc(cx, cy, R2, 0, Math.PI * 2); x.stroke();
  }
  x.lineWidth = lw;
  x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.stroke();

  const logo = await tinted(fg);
  const w = R * (small ? 1.5 : 1.42), h = w * (logo.height / logo.width);
  x.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
}

/** 아이폰용: 꽉 찬 정사각형 (iOS가 모서리를 둥글게 자름) */
async function iosIcon(S: number, st: IconStyle) {
  RAD = 0.225;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  await body(c.getContext('2d')!, 0, 0, S, st);
  return c;
}
/** PC용: 투명 바탕 위 둥근 사각형 (데스크톱 설치·탭 아이콘). 32px 이하는 단순화 */
async function pcIcon(S: number, st: IconStyle) {
  RAD = 0.22;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const x = c.getContext('2d')!;
  const small = S <= 48;
  const m = small ? 0 : S * 0.06, s = S - m * 2;
  x.save();
  x.beginPath(); x.roundRect(m, m, s, s, s * 0.22); x.clip();
  await body(x, m, m, s, st, small);
  x.restore();
  return c;
}
/** 안드로이드 maskable: 꽉 찬 사각형, 내용은 안쪽 80% */
async function maskIcon(S: number, st: IconStyle) {
  RAD = 0.2;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const x = c.getContext('2d')!;
  x.fillStyle = st.invert ? C2 : C1; x.fillRect(0, 0, S, S);
  await body(x, S * 0.1, S * 0.1, S * 0.8, st);
  return c;
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));

(async () => {
  const out = document.getElementById('out')!;
  // 시안 시트: 행 = 시안, 열 = 아이폰(둥글게 잘린 모습) / PC / 작은 크기들
  const keys = Object.keys(DRAFTS);
  const rowH = 330, sheet = document.createElement('canvas');
  sheet.width = 1180; sheet.height = 70 + rowH * keys.length;
  const sx = sheet.getContext('2d')!;
  sx.fillStyle = '#2a2a2e'; sx.fillRect(0, 0, sheet.width, sheet.height);
  sx.fillStyle = '#ddd'; sx.font = 'bold 22px sans-serif';
  sx.fillText('아이폰 홈 화면', 150, 44); sx.fillText('PC (설치 앱 / 탭)', 520, 44); sx.fillText('실제 크기', 860, 44);
  for (let i = 0; i < keys.length; i++) {
    const st = DRAFTS[keys[i]], y = 70 + i * rowH;
    sx.fillStyle = '#fff'; sx.font = 'bold 34px sans-serif'; sx.fillText(keys[i], 30, y + 150);
    const ios = await iosIcon(512, st);
    sx.save(); sx.beginPath(); sx.roundRect(120, y, 280, 280, 280 * 0.225); sx.clip(); sx.drawImage(ios, 120, y, 280, 280); sx.restore();
    sx.drawImage(await pcIcon(512, st), 480, y, 280, 280);
    sx.save(); sx.beginPath(); sx.roundRect(840, y + 40, 60, 60, 13.5); sx.clip(); sx.drawImage(ios, 840, y + 40, 60, 60); sx.restore();
    sx.drawImage(await pcIcon(48, st), 930, y + 46);
    sx.drawImage(await pcIcon(32, st), 1000, y + 54);
    sx.drawImage(await pcIcon(16, st), 1056, y + 62);
    sx.fillStyle = '#999'; sx.font = '14px sans-serif';
    sx.fillText('iPhone 60', 840, y + 125); sx.fillText('48', 945, y + 125); sx.fillText('32', 1008, y + 125); sx.fillText('16', 1058, y + 125);
  }
  (window as any).drafts = await toBlob(sheet);
  sheet.style.width = '100%'; out.appendChild(sheet);

  const st = DRAFTS[DRAFT] || DRAFTS.O;
  (window as any).icons = {
    'apple-touch-icon-v2.png': await toBlob(await iosIcon(180, st)),
    'icon-192-v2.png': await toBlob(await pcIcon(192, st)),
    'icon-512-v2.png': await toBlob(await pcIcon(512, st)),
    'icon-maskable-512-v2.png': await toBlob(await maskIcon(512, st)),
    'favicon-32-v2.png': await toBlob(await pcIcon(32, st)),
    'favicon-16-v2.png': await toBlob(await pcIcon(16, st)),
  } as Record<string, Blob>;
  (window as any).iconsReady = true;
})();

/** 레퍼런스 스타일: 남색 바탕 + 가운데 보라 글로우 + 흰 로고.
 *  획(테두리·큰 원·안쪽 원·대각선)은 전부 연한 흰색이고, 테두리는 아이폰/PC 아이콘의 둥근 외곽을 따라감.
 *  ring 값이 'dots' 면 대각선이 테두리와 만나는 곳에 보라 점 */
async function refBody(x: CanvasRenderingContext2D, ox: number, oy: number, S: number, ring: string, small: boolean, st?: IconStyle) {
  const cx = ox + S / 2, cy = oy + S / 2;
  const rad = RAD * S;                         // 이 플랫폼 아이콘의 모서리 반지름
  x.fillStyle = '#0B1014'; x.fillRect(ox, oy, S, S);
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, S * 0.5);
  g.addColorStop(0, 'rgba(98,32,210,0.95)');
  g.addColorStop(0.45, 'rgba(60,20,140,0.55)');
  g.addColorStop(1, 'rgba(11,16,20,0)');
  x.fillStyle = g; x.fillRect(ox, oy, S, S);

  const W = (a: number) => `rgba(255,255,255,${a})`;
  const lw = Math.max(1, S * (small ? 0.03 : 0.005));
  if (!small) {
    const i = S * 0.045;                       // 테두리 안쪽 여백
    const r = Math.max(0, rad - i);
    // LED 가이드 느낌: 캐비닛 그리드 / 체커 / 번호 (테두리 안쪽만)
    if (st?.cells) {
      const n = st.cells, cs = (S - i * 2) / n, gx = ox + i, gy = oy + i;
      x.save();
      x.beginPath(); x.roundRect(gx, gy, S - i * 2, S - i * 2, r); x.clip();
      if (st.checker) {
        for (let rr = 0; rr < n; rr++) for (let q = 0; q < n; q++) if ((rr + q) % 2) {
          x.fillStyle = W(0.045); x.fillRect(gx + q * cs, gy + rr * cs, cs, cs);
        }
      }
      x.strokeStyle = W(n > 4 ? 0.08 : 0.12); x.lineWidth = Math.max(1, S * 0.0025);
      x.beginPath();
      for (let k = 1; k < n; k++) { x.moveTo(gx + k * cs, gy); x.lineTo(gx + k * cs, gy + S - i * 2); x.moveTo(gx, gy + k * cs); x.lineTo(gx + S - i * 2, gy + k * cs); }
      x.stroke();
      if (st.nums) {
        x.fillStyle = W(0.32); x.font = `500 ${S * 0.026}px "JetBrains Mono", monospace`; x.textBaseline = 'top'; x.textAlign = 'left';
        for (let rr = 0; rr < n; rr++) for (let q = 0; q < n; q++) x.fillText(`${rr + 1}-${q + 1}`, gx + q * cs + S * 0.012, gy + rr * cs + S * 0.012);
      }
      x.restore();
    }
    // (2026-11-06) 둥근 외곽을 따라가던 안쪽 테두리 선은 뺌 — 바깥 검은 틀 하나만
    // 대각선: 테두리 안쪽만
    const k = r * (1 - Math.SQRT1_2);          // 대각선이 둥근 모서리와 만나는 지점까지의 거리
    const a = i + k, b = S - i - k;
    x.strokeStyle = W(0.3); x.lineWidth = lw;
    x.beginPath();
    x.moveTo(ox + a, oy + a); x.lineTo(ox + b, oy + b);
    x.moveTo(ox + b, oy + a); x.lineTo(ox + a, oy + b);
    // 가운데 가로·세로선
    x.moveTo(ox + i, cy); x.lineTo(ox + S - i, cy);
    x.moveTo(cx, oy + i); x.lineTo(cx, oy + S - i);
    x.stroke();
    // 원은 하나만: inner = 로고 감싸는 원 / outer = 테두리 안 큰 원
    x.strokeStyle = W(0.5); x.lineWidth = lw * 1.2;
    x.beginPath(); x.arc(cx, cy, ring === 'outer' ? S / 2 - i - S * 0.02 : S * 0.36, 0, Math.PI * 2); x.stroke();
    // 가이드의 중앙 표시: 가늘고 날카로운 삼각형 (테두리에서 안쪽으로)
    if (st?.cells) {
      const tb = S * 0.016, tl = S * 0.06;
      x.fillStyle = W(0.75);
      x.beginPath();
      x.moveTo(cx - tb, oy + i); x.lineTo(cx + tb, oy + i); x.lineTo(cx, oy + i + tl); x.closePath();
      x.moveTo(cx - tb, oy + S - i); x.lineTo(cx + tb, oy + S - i); x.lineTo(cx, oy + S - i - tl); x.closePath();
      x.moveTo(ox + i, cy - tb); x.lineTo(ox + i, cy + tb); x.lineTo(ox + i + tl, cy); x.closePath();
      x.moveTo(ox + S - i, cy - tb); x.lineTo(ox + S - i, cy + tb); x.lineTo(ox + S - i - tl, cy); x.closePath();
      x.fill();
    }
    if (ring === 'dots') {
      x.fillStyle = '#6B2BE0';
      for (const [px, py] of [[a, a], [b, a], [a, b], [b, b]]) { x.beginPath(); x.arc(ox + px, oy + py, S * 0.028, 0, Math.PI * 2); x.fill(); }
    }
  } else {
    x.strokeStyle = W(0.6); x.lineWidth = lw;
    x.beginPath(); x.arc(cx, cy, S / 2 - lw, 0, Math.PI * 2); x.stroke();
  }
  const logo = await loadLogo();
  const w = S * (small ? 0.74 : 0.6), h = w * (logo.naturalHeight / logo.naturalWidth);
  x.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
}
