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
