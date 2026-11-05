import type { Led, GuideKind, ExportRecord } from './types';
import { inputLayout, outputLayout, fileName, MAX_CANVAS_PX, type Layout } from './layout';
import { drawGuide, buildLayers, loadLogo, type RenderStyle, type Layers } from './render';
import { encodeVideo, type VideoVariant } from './video';
import { addExport } from './db';
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

/** 영상 추출: LOOP(링이 계속 퍼짐) / BUILD(하나씩 생기는 버전) */
export async function exportVideo(l: Led, kind: GuideKind, variant: VideoVariant, onProgress: (p: number) => void) {
  const L = await layersFor(l, kind, 1);
  const blob = await encodeVideo(L, variant, onProgress);
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const name = fileName(l, kind, L.W, L.H).replace(/\.png$/, `_${variant}.${ext}`);
  await record(l, kind, blob, name, L.W, L.H, ext, variant);
  await deliver(blob, name);
}

export async function deliver(blob: Blob, name: string) {
  const type = blob.type || (name.endsWith('.mp4') ? 'video/mp4' : 'image/png');
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
