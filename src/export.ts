import type { Led, GuideKind, ExportRecord } from './types';
import { inputLayout, outputLayout, fileName, MAX_CANVAS_PX, type Layout } from './layout';
import { drawGuide, buildLayers, loadLogo, type RenderStyle, type Layers } from './render';
import { encodeVideo, encodeCandidates, type VideoVariant } from './video';
import { addExport } from './db';
import { makeZip } from './zip';
import { state, uid, refreshExports, updateLed, toast, set } from './store';

export const layoutFor = (l: Led, kind: GuideKind): Layout => (kind === 'IN' ? inputLayout(l) : outputLayout(l));
export const optionsFor = (l: Led, kind: GuideKind) => (kind === 'IN' ? l.input.options : l.output.options);

/** 면 이름·헤더에 쓰인 한글 서브셋 폰트를 미리 로드 */
export async function ensureFontsFor(l: Led) {
  const text = [l.name, l.header, l.number, l.pitchModel, ...l.faces.map((f) => f.name)].join('') || 'A';
  try {
    await Promise.all([
      document.fonts.load('400 20px "IBM Plex Sans KR"', text),
      document.fonts.load('600 20px "IBM Plex Sans KR"', text),
      document.fonts.load('40px Anton', text),
    ]);
  } catch { /* ignore */ }
}

export async function renderStyle(l?: Led): Promise<RenderStyle> {
  return { accent: state.settings.accent, logoTint: state.settings.logoTint, logo: await loadLogo(l?.logo) };
}

function checkSize(lay: Layout) {
  if (lay.W * lay.H > MAX_CANVAS_PX) throw new Error(`이미지가 너무 큽니다 (${lay.W}×${lay.H}). iOS 한도 약 16.7MP`);
}

/** 원본 해상도 정지 이미지 */
export async function renderToCanvas(l: Led, kind: GuideKind, canvas = document.createElement('canvas')) {
  const lay = layoutFor(l, kind);
  checkSize(lay);
  await ensureFontsFor(l);
  drawGuide(canvas, l, lay, optionsFor(l, kind), await renderStyle(l));
  return { canvas, lay };
}

/** 애니메이션용 레이어 (scale < 1 이면 프리뷰용 축소본) */
export async function layersFor(l: Led, kind: GuideKind, scale = 1): Promise<Layers> {
  const lay = layoutFor(l, kind);
  if (scale === 1) checkSize(lay);
  await ensureFontsFor(l);
  return buildLayers(l, lay, optionsFor(l, kind), await renderStyle(l), scale);
}

const toBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG 생성 실패'))), 'image/png'));

export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

async function record(l: Led, kind: GuideKind, blob: Blob, name: string, w: number, h: number, format: ExportRecord['format'], variant?: VideoVariant) {
  const rec: ExportRecord = {
    id: uid(), projectId: l.projectId, ledId: l.id, kind, fileName: name,
    w, h, createdAt: Date.now(), blob, format, variant,
  };
  await addExport(rec);
  updateLed(l.id, (x) => {
    if (kind === 'IN') x.input.doneAt = rec.createdAt; else x.output.doneAt = rec.createdAt;
    return x;
  });
  refreshExports();
}

/** PNG 추출: 렌더 → IndexedDB 기록 → 저장(공유시트 / 다운로드 / 길게 눌러 저장 폴백) */
export async function exportPng(l: Led, kind: GuideKind) {
  const { canvas, lay } = await renderToCanvas(l, kind);
  const blob = await toBlob(canvas);
  const name = fileName(l, kind, lay.W, lay.H);
  await record(l, kind, blob, name, lay.W, lay.H, 'png');
  await deliver(blob, name);
}

/** 여러 LED 한 번에 PNG 추출 (기록은 남기고, 저장은 한꺼번에) */
export async function exportPngMany(leds: Led[], kinds: GuideKind[], onProgress?: (done: number, total: number) => void) {
  const files: { name: string; blob: Blob }[] = [];
  const total = leds.length * kinds.length;
  for (const l of leds) for (const kind of kinds) {
    const { canvas, lay } = await renderToCanvas(l, kind);
    const blob = await toBlob(canvas);
    const name = fileName(l, kind, lay.W, lay.H);
    await record(l, kind, blob, name, lay.W, lay.H, 'png');
    files.push({ name, blob });
    onProgress?.(files.length, total);
    await new Promise((r) => setTimeout(r, 0));
  }
  await deliverMany(files);
}

/** 여러 파일 저장: 아이폰은 공유 시트에 한꺼번에(사진에 저장 / 파일에 저장), PC는 ZIP 하나로 */
export async function deliverMany(files: { name: string; blob: Blob }[]) {
  if (!files.length) return;
  if (files.length === 1) return deliver(files[0].blob, files[0].name);
  const fs = files.map((f) => new File([f.blob], f.name, { type: f.blob.type || 'image/png' }));
  if (isIOS() && navigator.canShare?.({ files: fs })) {
    try { await navigator.share({ files: fs }); return; } catch (e: any) { if (e?.name === 'AbortError') return; }
  }
  const zip = await makeZip(files);
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  await deliver(zip, `LGM_${files.length}files_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.zip`);
}

/** 영상 추출: LOOP(링이 계속 퍼짐) / BUILD(하나씩 생기는 버전) */
export async function exportVideo(l: Led, kind: GuideKind, variant: VideoVariant, onProgress: (p: number) => void) {
  // 인코더 한도를 넘으면 가능한 최대 크기로 줄여서 (비율 유지). 큰 크기부터 실제로 인코딩해 보고 실패하면 다음 크기
  const lay = layoutFor(l, kind);
  await ensureFontsFor(l);
  const st = await renderStyle(l);
  let blob: Blob | null = null, L: Layers | null = null, lastErr: unknown = null;
  for (const c of await encodeCandidates(lay.W, lay.H)) {
    if (c.scale < 1) toast(`원본 ${lay.W}×${lay.H}은 이 기기에서 영상으로 못 만들어서 ${c.w}×${c.h}로 줄여 만드는 중…`);
    try {
      L = buildLayers(l, lay, optionsFor(l, kind), st, c.scale);
      onProgress(0);
      blob = await encodeVideo(L, variant, onProgress);
      break;
    } catch (e) { lastErr = e; console.warn('영상 인코딩 실패, 더 작은 크기로 다시 시도', c, e); }
  }
  if (!blob || !L) throw lastErr instanceof Error ? lastErr : new Error('영상 만들기 실패');
  if (L.scale < 1) toast(`${L.W}×${L.H}로 줄여서 저장했습니다 (원본 ${lay.W}×${lay.H})`);
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const name = fileName(l, kind, L.W, L.H).replace(/\.png$/, `_${variant}.${ext}`);
  await record(l, kind, blob, name, L.W, L.H, ext, variant);
  await deliver(blob, name);
}

export async function deliver(blob: Blob, name: string) {
  const type = blob.type || (name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.zip') ? 'application/zip' : 'image/png');
  const file = new File([blob], name, { type });
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      // 사용자 제스처 만료 등 → 폴백
    }
  }
  if (!isIOS()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('저장됨 · ' + name);
    return;
  }
  // iOS 폴백: 이미지는 길게 눌러 저장, 영상은 공유 버튼 다시 시도
  set({ saveFallback: { url: URL.createObjectURL(blob), name, type } });
}

export async function copyText(t: string) {
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('좌표 복사됨');
}
