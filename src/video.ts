/* 가이드 영상 추출: 프레임 단위 오프라인 렌더 → WebCodecs(H.264) → MP4
 * 실시간 녹화가 아니라 프레임을 하나씩 그려서 인코딩하므로 4K에서도 프레임 드랍이 없음.
 * WebCodecs 가 없는 브라우저는 MediaRecorder(실시간) 로 폴백. */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { drawFrame, buildTimeline, motionOf, MOTION, type Layers } from './render';

export type VideoVariant = 'LOOP' | 'BUILD';

export function videoDuration(L: Layers, v: VideoVariant) {
  return v === 'LOOP' ? motionOf(L.l).loop : buildTimeline(L).duration;
}

const AVC_CODECS = ['avc1.640034', 'avc1.640033', 'avc1.4d0034', 'avc1.640028', 'avc1.42003e'];

async function pickConfig(w: number, h: number, fps: number): Promise<VideoEncoderConfig | null> {
  const bitrate = Math.round(Math.min(60e6, Math.max(6e6, w * h * fps * 0.12)));
  for (const codec of AVC_CODECS) {
    for (const hw of ['prefer-hardware', 'no-preference'] as const) {
      const cfg: VideoEncoderConfig = { codec, width: w, height: h, bitrate, framerate: fps, hardwareAcceleration: hw, avc: { format: 'avc' } };
      try {
        const r = await VideoEncoder.isConfigSupported(cfg);
        if (r.supported) return cfg;
      } catch { /* try next */ }
    }
  }
  return null;
}

/** 시도할 영상 크기 후보 (큰 것부터, 비율 유지). 인코더가 "된다"고 해도 실제로 실패할 때가 있어서
 *  호출하는 쪽에서 순서대로 실제 인코딩을 시도하고, 실패하면 다음 크기로 넘어감. */
export async function encodeCandidates(W: number, H: number): Promise<{ scale: number; w: number; h: number }[]> {
  // encodeVideo 와 같은 방식(반올림 후 홀수면 +1)으로 계산해서 안내 문구와 실제 파일 크기가 같게
  const even = (n: number) => { const r = Math.max(2, Math.round(n)); return r + (r % 2); };
  const mk = (s: number) => ({ scale: s, w: even(W * s), h: even(H * s) });
  if (typeof VideoEncoder === 'undefined') return [mk(Math.min(1, 3840 / Math.max(W, H)))]; // 실시간 녹화 폴백
  // 흔한 H.264 한도: 가로·세로 최대 4096, 넓이 4096×2304
  const limits: [number, number][] = [[Infinity, Infinity], [4096, 4096], [4096, 2304], [3840, 2160], [2560, 1600], [1920, 1080], [1280, 720]];
  const out: { scale: number; w: number; h: number }[] = [];
  for (const [mw, mh] of limits) {
    const long = Math.max(W, H), short = Math.min(W, H);
    const s = Math.min(1, mw / long, mh / short, mw === Infinity ? 1 : Math.sqrt((4096 * 2304) / (W * H)));
    const c = mk(s);
    if (out.some((o) => o.w === c.w && o.h === c.h)) continue;
    if (await pickConfig(c.w, c.h, MOTION.fps)) out.push(c);
  }
  if (!out.length) throw new Error('이 기기에서는 영상을 만들 수 없습니다');
  return out;
}

export async function encodeVideo(L: Layers, v: VideoVariant, onProgress: (p: number) => void): Promise<Blob> {
  const fps = MOTION.fps;
  const dur = videoDuration(L, v);
  const frames = Math.round(dur * fps);
  // H.264 는 짝수 해상도 필요 → 홀수면 1px 패딩
  const w = L.W + (L.W % 2), h = L.H + (L.H % 2);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const mode = v === 'LOOP' ? 'loop' : 'build';

  if (typeof VideoEncoder === 'undefined') return recordFallback(canvas, ctx, L, mode, dur, onProgress);

  const cfg = await pickConfig(w, h, fps);
  if (!cfg) throw new Error(`이 기기의 H.264 인코더가 ${w}×${h} 를 지원하지 않습니다 (보통 최대 4096 폭)`);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' });
  let err: unknown = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { err = e; },
  });
  enc.configure(cfg);

  for (let i = 0; i < frames; i++) {
    if (err) throw err;
    drawFrame(ctx, L, i / fps, mode);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(frame, { keyFrame: i % fps === 0 });
    frame.close();
    while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 4));
    if (i % 3 === 0) { onProgress(i / frames); await new Promise((r) => setTimeout(r, 0)); }
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
  muxer.finalize();
  onProgress(1);
  return new Blob([target.buffer], { type: 'video/mp4' });
}

/** WebCodecs 미지원 브라우저: 실시간 캔버스 녹화 */
async function recordFallback(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, L: Layers, mode: 'loop' | 'build', dur: number, onProgress: (p: number) => void) {
  if (typeof MediaRecorder === 'undefined' || !canvas.captureStream) throw new Error('이 브라우저는 영상 추출을 지원하지 않습니다');
  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const stream = canvas.captureStream(MOTION.fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 30e6 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  drawFrame(ctx, L, 0, mode);
  rec.start();
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      drawFrame(ctx, L, Math.min(t, dur), mode);
      onProgress(Math.min(1, t / dur));
      if (t >= dur) return resolve();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await done;
  return new Blob(chunks, { type: mime.split(';')[0] || 'video/webm' });
}
