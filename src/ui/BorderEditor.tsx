import { useEffect, useRef, useState } from 'preact/hooks';
import { useStore, getBorder, getProject, updateBorder, uid, ask, toast } from '../store';
import { renderLayer, renderMerged, toPng, layerFileName, mergedFileName, newLayer } from '../border';
import { deliver, deliverMany } from '../export';
import type { BorderSet, BorderLayer, BorderWin } from '../types';
import { TopBar, NumInput, Seg, Toggle, Section, Slider } from './common';

const PRESETS: [number, number][] = [[1920, 1080], [3840, 2160], [3840, 1080], [1280, 720], [1080, 1920]];
const LIM = 16384;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** 보더 묶음 편집: 캔버스 하나 + 레이어 여러 장 (레이어 = 보더 PNG 한 장) */
export function BorderEditor({ id }: { id: string }) {
  useStore();
  const B = getBorder(id);
  const [layerId, setLayerId] = useState<string | null>(null);
  const [winIdx, setWinIdx] = useState(0);
  const [only, setOnly] = useState(false);
  const [boxes, setBoxes] = useState(true);
  const [snap, setSnap] = useState(true);
  const [busy, setBusy] = useState('');
  const [guide, setGuide] = useState<{ url: string; op: number } | null>(null);

  if (!B || B.deletedAt) return <div class="screen"><TopBar title="보더 없음" back="/projects" /></div>;
  const L = B.layers.find((l) => l.id === layerId) || B.layers[0];
  const wi = Math.min(winIdx, Math.max(0, (L?.wins.length || 1) - 1));
  const W0 = L?.wins[wi];
  const up = (fn: (b: BorderSet) => void) => updateBorder(id, fn);
  const upL = (fn: (l: BorderLayer) => void) => up((b) => { const l = b.layers.find((x) => x.id === L.id); if (l) fn(l); });
  const upW = (fn: (w: BorderWin) => void) => upL((l) => { if (l.wins[wi]) fn(l.wins[wi]); });

  /* ---------- 저장 ---------- */
  const saveLayers = async (list: BorderLayer[]) => {
    setBusy('렌더링 중…');
    try {
      const files: { name: string; blob: Blob }[] = [];
      for (const l of list) {
        const i = B.layers.indexOf(l);
        files.push({ name: layerFileName(B, l, i), blob: await toPng(renderLayer(document.createElement('canvas'), B, l, 1)) });
      }
      setBusy('');
      await deliverMany(files);
    } catch (e: any) { toast(e?.message || '저장 실패'); }
    setBusy('');
  };
  const saveMerged = async () => {
    setBusy('렌더링 중…');
    try {
      const blob = await toPng(renderMerged(document.createElement('canvas'), B, 1));
      setBusy('');
      await deliver(blob, mergedFileName(B));
    } catch (e: any) { toast(e?.message || '저장 실패'); }
    setBusy('');
  };
  const visible = B.layers.filter((l) => l.visible);

  return (
    <div class="screen compact">
      <TopBar title={B.name || '보더'} sub={`${getProject(B.projectId)?.name ?? ''} · 보더 묶음`} back={`/project/${B.projectId}`} />

      <div class="canvas-row">
        <span class="lbl">캔버스</span>
        <div class="pair-row grow">
          <NumInput value={B.W} min={16} aria="캔버스 가로" onChange={(v) => up((b) => { b.W = clamp(v, 16, LIM); })} />
          <span class="x">×</span>
          <NumInput value={B.H} min={16} aria="캔버스 세로" onChange={(v) => up((b) => { b.H = clamp(v, 16, LIM); })} />
        </div>
      </div>
      <div class="row wrap" style="gap:6px;margin:-2px 0 10px">
        {PRESETS.map(([w, h]) => (
          <button key={w + 'x' + h} class={'chip' + (B.W === w && B.H === h ? ' on' : '')} onClick={() => up((b) => { b.W = w; b.H = h; })}>{w}×{h}</button>
        ))}
      </div>

      <BorderStage B={B} L={L} wi={wi} only={only} boxes={boxes} snap={snap} guide={guide}
        onSelectWin={setWinIdx} onChange={(fn) => upL(fn)} />

      <div class="pv-bar">
        <Seg<'all' | 'one'> value={only ? 'one' : 'all'} onChange={(v) => setOnly(v === 'one')} options={[['all', `겹쳐 보기 (${visible.length})`], ['one', '선택 레이어만']]} />
        <button class={'chip' + (boxes ? ' on' : '')} onClick={() => setBoxes(!boxes)}>창 테두리</button>
        <button class={'chip' + (snap ? ' on' : '')} onClick={() => setSnap(!snap)}>스냅</button>
        <label class="chip" style="position:relative">가이드 이미지
          <input type="file" accept="image/*" style="position:absolute;inset:0;opacity:0" onChange={(e) => {
            const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = '';
            if (f) { if (guide) URL.revokeObjectURL(guide.url); setGuide({ url: URL.createObjectURL(f), op: 0.5 }); }
          }} />
        </label>
        {guide && <>
          <input type="range" class="map-alpha" min={0.1} max={1} step={0.05} value={guide.op} aria-label="가이드 불투명도"
            onInput={(e) => setGuide({ ...guide, op: +(e.target as HTMLInputElement).value })} />
          <button class="chip" onClick={() => { URL.revokeObjectURL(guide.url); setGuide(null); }}>가이드 지우기</button>
        </>}
      </div>

      {/* 저장 */}
      <div class="border-save">
        <button class="btn primary" disabled={!!busy} onClick={() => saveLayers([L])}>이 레이어 PNG</button>
        <button class="btn" disabled={!!busy || !visible.length} onClick={() => saveLayers(visible)}>보이는 레이어 각각 ({visible.length}장)</button>
        <button class="btn" disabled={!!busy || !visible.length} onClick={saveMerged}>합쳐서 한 장</button>
      </div>
      {busy && <div class="small muted" style="margin-top:6px">{busy}</div>}
      <div class="small muted" style="margin-top:6px">캔버스 전체 크기 PNG. 아이폰은 공유 창 → <b>이미지 저장</b>, PC는 여러 장이면 ZIP 하나로 받아요.</div>

      {/* 레이어 */}
      <Section title="레이어" sub={`${B.layers.length}장 · 위쪽이 앞`} open>
        <div class="layer-list">
          {B.layers.map((l, i) => (
            <div key={l.id} class={'layer-row' + (l.id === L.id ? ' on' : '')} onClick={() => { setLayerId(l.id); setWinIdx(0); }}>
              <button class={'eye' + (l.visible ? ' on' : '')} aria-label={l.visible ? '숨기기' : '보이기'}
                onClick={(e) => { e.stopPropagation(); up((b) => { b.layers[i].visible = !b.layers[i].visible; }); }}>{l.visible ? '●' : '○'}</button>
              {l.id === L.id
                ? <input class="input lname" value={l.name} aria-label="레이어 이름" onClick={(e) => e.stopPropagation()}
                    onInput={(e) => up((b) => { b.layers[i].name = (e.target as HTMLInputElement).value; })} />
                : <span class="lname-text">{l.name || `레이어 ${i + 1}`}</span>}
              <span class="small muted mono lmeta">{l.mode === 'matte' ? '매트' : '오버레이'} · 창 {l.wins.length}</span>
              <div class="row lbtns" style="gap:2px" onClick={(e) => e.stopPropagation()}>
                <button class="btn icon sm ghost" aria-label="위로" disabled={i === 0} onClick={() => up((b) => { [b.layers[i - 1], b.layers[i]] = [b.layers[i], b.layers[i - 1]]; })}>↑</button>
                <button class="btn icon sm ghost" aria-label="아래로" disabled={i === B.layers.length - 1} onClick={() => up((b) => { [b.layers[i + 1], b.layers[i]] = [b.layers[i], b.layers[i + 1]]; })}>↓</button>
                <button class="btn icon sm ghost" aria-label="복제" onClick={() => { const nid = uid(); up((b) => { b.layers.splice(i, 0, { ...structuredClone(b.layers[i]), id: nid, name: b.layers[i].name + ' 복사본' }); }); setLayerId(nid); }}>⧉</button>
                <button class="btn icon sm ghost" aria-label="삭제" style="color:var(--danger)" disabled={B.layers.length === 1}
                  onClick={async () => { if (await ask(`"${l.name}" 레이어를 삭제할까요?`)) { up((b) => { b.layers.splice(i, 1); }); setLayerId(null); } }}>✕</button>
              </div>
            </div>
          ))}
        </div>
        <button class="btn block sm-btn" onClick={() => { const nl = newLayer(uid(), `레이어 ${B.layers.length + 1}`, B.W, B.H); up((b) => { b.layers.unshift(nl); }); setLayerId(nl.id); setWinIdx(0); }}>+ 레이어 추가</button>
      </Section>

      {/* 선택 레이어 */}
      <Section title={`레이어 설정 · ${L.name}`} sub="창 · 페더 · 출력" open>
        <div class="lbl" style="margin-bottom:6px">창</div>
        <div class="row wrap" style="gap:6px">
          {L.wins.map((w, i) => (
            <button key={i} class={'chip' + (i === wi ? ' on' : '') + (w.t === 'block' ? ' block-chip' : '')} onClick={() => setWinIdx(i)}>
              {i + 1}{w.t === 'block' ? ' 가리기' : ''} · {w.w}×{w.h}
            </button>
          ))}
        </div>
        <div class="row wrap" style="gap:6px;margin-top:8px">
          <button class="btn sm-btn" onClick={() => { upL((l) => { const w = Math.round(B.W / 3), h = Math.round(B.H / 3); l.wins.push({ t: 'hole', x: Math.round((B.W - w) / 2), y: Math.round((B.H - h) / 2), w, h, b: W0?.b ?? 0, f: W0?.f ?? 120, r: W0?.r ?? 0 }); }); setWinIdx(L.wins.length); }}>+ 창</button>
          <button class="btn sm-btn" onClick={() => { upL((l) => { const w = Math.round(B.W / 5); l.wins.push({ t: 'block', x: Math.round((B.W - w) / 2), y: 0, w, h: B.H, b: 0, f: Math.round(w / 2), r: 0 }); l.edgeOpen = true; }); setWinIdx(L.wins.length); }}>+ 세로 띠 (가리기)</button>
          <button class="btn sm-btn" onClick={() => { upL((l) => { const h = Math.round(B.H / 5); l.wins.push({ t: 'block', x: 0, y: Math.round((B.H - h) / 2), w: B.W, h, b: 0, f: Math.round(h / 2), r: 0 }); l.edgeOpen = true; }); setWinIdx(L.wins.length); }}>+ 가로 띠 (가리기)</button>
          {W0 && <button class="btn sm-btn" onClick={() => { upL((l) => { const c = { ...l.wins[wi], x: l.wins[wi].x + 40, y: l.wins[wi].y + 40 }; l.wins.push(c); }); setWinIdx(L.wins.length); }}>복제</button>}
          {W0 && <button class="btn sm-btn danger" onClick={() => { upL((l) => { l.wins.splice(wi, 1); }); setWinIdx(Math.max(0, wi - 1)); }}>창 삭제</button>}
        </div>
        {!L.wins.length && <div class="small muted" style="margin-top:8px">창이 없으면 전체가 보이는 상태예요 (가림 없음).</div>}

        {W0 && <div class="stack" style="margin-top:12px">
          <Seg<'hole' | 'block'> value={W0.t} onChange={(v) => upW((w) => { w.t = v; })} options={[['hole', '보이기 (창)'], ['block', '가리기 (블로커)']]} />
          <div class="fields wide4">
            {(['x', 'y', 'w', 'h'] as const).map((k) => (
              <div class="field" key={k}><label>{k === 'x' ? 'X' : k === 'y' ? 'Y' : k === 'w' ? '가로' : '세로'}</label>
                <NumInput value={W0[k]} min={k === 'w' || k === 'h' ? 1 : -LIM} aria={k} onChange={(v) => upW((w) => { w[k] = clamp(v, k === 'w' || k === 'h' ? 1 : -LIM, LIM); })} />
              </div>
            ))}
          </div>
          <div class="row wrap" style="gap:6px">
            {([['왼쪽', (w: BorderWin) => { w.x = 0; }], ['가로 중앙', (w: BorderWin) => { w.x = Math.round((B.W - w.w) / 2); }], ['오른쪽', (w: BorderWin) => { w.x = B.W - w.w; }],
              ['위', (w: BorderWin) => { w.y = 0; }], ['세로 중앙', (w: BorderWin) => { w.y = Math.round((B.H - w.h) / 2); }], ['아래', (w: BorderWin) => { w.y = B.H - w.h; }],
              ['꽉 채우기', (w: BorderWin) => { w.x = 0; w.y = 0; w.w = B.W; w.h = B.H; }]] as [string, (w: BorderWin) => void][]).map(([t, f]) => (
              <button key={t} class="chip" onClick={() => upW(f)}>{t}</button>
            ))}
          </div>
          {W0.t === 'hole' && <Slider label="보더 두께" value={W0.b} min={0} max={600} step={1} def={0} fmt={(v) => v + 'px'} onChange={(v) => upW((w) => { w.b = v; })} />}
          <Slider label="페더" value={W0.f} min={0} max={600} step={1} def={120} fmt={(v) => v + 'px'} onChange={(v) => upW((w) => { w.f = v; })} />
          <Slider label="모서리 라운드" value={W0.r} min={0} max={400} step={1} def={0} fmt={(v) => v + 'px'} onChange={(v) => upW((w) => { w.r = v; })} />
        </div>}

        <div class="lbl" style="margin:16px 0 6px">페더 방식</div>
        <div class="stack">
          <Seg<BorderLayer['dir']> value={L.dir} onChange={(v) => upL((l) => { l.dir = v; })} options={[['center', '경계 중심'], ['out', '바깥쪽'], ['in', '안쪽']]} />
          <Seg<BorderLayer['curve']> value={L.curve} onChange={(v) => upL((l) => { l.curve = v; })} options={[['gauss', '가우시안'], ['smooth', '스무스'], ['linear', '리니어']]} />
          <Toggle on={L.edgeOpen} label="캔버스 가장자리에 닿은 변은 페더 없음" onClick={() => upL((l) => { l.edgeOpen = !l.edgeOpen; })} />
        </div>

        <div class="lbl" style="margin:16px 0 6px">출력</div>
        <div class="stack">
          <Seg<BorderLayer['mode']> value={L.mode} onChange={(v) => upL((l) => { l.mode = v; })} options={[['overlay', '투명 오버레이'], ['matte', '흑백 매트']]} />
          {L.mode === 'overlay' ? (
            <div class="row" style="gap:10px">
              <label class="field" style="flex:none"><span class="lbl">마스크 색</span>
                <input type="color" class="color-in" value={L.color} onInput={(e) => upL((l) => { l.color = (e.target as HTMLInputElement).value; })} /></label>
              <div class="grow"><Slider label="불투명도" value={L.opacity} min={0} max={100} step={1} def={100} fmt={(v) => v + '%'} onChange={(v) => upL((l) => { l.opacity = v; })} /></div>
            </div>
          ) : <Toggle on={L.invert} label="반전 (가림 흰색 / 창 검정)" onClick={() => upL((l) => { l.invert = !l.invert; })} />}
          <div class="small muted">{L.mode === 'overlay' ? '보이는 영역은 투명, 가려지는 영역은 마스크 색. LED 아웃풋 위에 그대로 얹으면 돼요.' : '흰색 = 영상이 보이는 영역, 검정 = 가려지는 영역. 루마 매트용.'}</div>
        </div>
      </Section>

      <Section title="묶음 이름">
        <input class="input" value={B.name} onInput={(e) => up((b) => { b.name = (e.target as HTMLInputElement).value; })} aria-label="보더 묶음 이름" />
      </Section>
    </div>
  );
}

/** 미리보기 + 창 드래그·리사이즈·스냅 */
function BorderStage({ B, L, wi, only, boxes, snap, guide, onSelectWin, onChange }: {
  B: BorderSet; L: BorderLayer; wi: number; only: boolean; boxes: boolean; snap: boolean; guide: { url: string; op: number } | null;
  onSelectWin: (i: number) => void; onChange: (fn: (l: BorderLayer) => void) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: string; sx: number; sy: number; o: BorderWin; i: number } | null>(null);
  const [lines, setLines] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const raf = useRef(0), dragging = useRef(false);

  // 렌더: 화면 폭 × DPR, 드래그 중엔 절반 해상도
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const c = ref.current, el = wrap.current;
      if (!c || !el) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      let s = Math.min(1, (el.clientWidth * dpr) / B.W, 1400 / Math.max(B.W, B.H) * dpr);
      if (dragging.current) s *= 0.5;
      s = Math.max(s, 0.02);
      if (only) renderLayer(c, B, L, s); else renderMerged(c, B, s);
    });
    return () => cancelAnimationFrame(raf.current);
  }, [B, L.id, only]);

  const toCanvas = (e: PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * B.W, y: ((e.clientY - r.top) / r.height) * B.H, k: B.W / r.width };
  };
  const cands = (axis: 'x' | 'y', skip: number) => {
    const T = axis === 'x' ? B.W : B.H, c = [0, T / 2, T];
    L.wins.forEach((w, i) => { if (i !== skip) { const a = axis === 'x' ? w.x : w.y, s = axis === 'x' ? w.w : w.h; c.push(a, a + s / 2, a + s); } });
    return c;
  };
  const best = (vals: number[], cs: number[], thr: number) => {
    let b: { d: number; line: number } | null = null;
    for (const v of vals) for (const c of cs) { const d = c - v; if (Math.abs(d) <= thr && (!b || Math.abs(d) < Math.abs(b.d))) b = { d, line: c }; }
    return b;
  };
  const down = (e: PointerEvent, i: number, kind: string) => {
    e.preventDefault(); e.stopPropagation();
    try { (wrap.current as any).setPointerCapture(e.pointerId); } catch { /* ignore */ }
    onSelectWin(i);
    const p = toCanvas(e);
    drag.current = { kind, sx: p.x, sy: p.y, o: { ...L.wins[i] }, i };
    dragging.current = true;
  };
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const p = toCanvas(e), o = d.o, thr = 10 * p.k, doSnap = snap && !e.altKey;
    const dx = p.x - d.sx, dy = p.y - d.sy, lx: number[] = [], ly: number[] = [];
    let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
    if (d.kind === 'move') {
      nx = o.x + dx; ny = o.y + dy;
      if (doSnap) {
        const sx = best([nx, nx + o.w / 2, nx + o.w], cands('x', d.i), thr), sy = best([ny, ny + o.h / 2, ny + o.h], cands('y', d.i), thr);
        if (sx) { nx += sx.d; lx.push(sx.line); } if (sy) { ny += sy.d; ly.push(sy.line); }
      }
    } else {
      const k = d.kind;
      let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
      if (k.includes('w')) x0 += dx; if (k.includes('e')) x1 += dx; if (k.includes('n')) y0 += dy; if (k.includes('s')) y1 += dy;
      if (doSnap) {
        const cx = cands('x', d.i), cy = cands('y', d.i);
        const sn = (v: number, cs: number[], arr: number[]) => { const s = best([v], cs, thr); if (s) { arr.push(s.line); return v + s.d; } return v; };
        if (k.includes('w')) x0 = sn(x0, cx, lx); if (k.includes('e')) x1 = sn(x1, cx, lx);
        if (k.includes('n')) y0 = sn(y0, cy, ly); if (k.includes('s')) y1 = sn(y1, cy, ly);
      }
      if (x1 - x0 < 8) { if (k.includes('w')) x0 = x1 - 8; else x1 = x0 + 8; }
      if (y1 - y0 < 8) { if (k.includes('n')) y0 = y1 - 8; else y1 = y0 + 8; }
      if (e.shiftKey && k.length === 2) {
        const ratio = o.w / o.h; let w = x1 - x0, h = y1 - y0;
        if (w / h > ratio) h = w / ratio; else w = h * ratio;
        if (k.includes('w')) x0 = x1 - w; else x1 = x0 + w;
        if (k.includes('n')) y0 = y1 - h; else y1 = y0 + h;
      }
      nx = x0; ny = y0; nw = x1 - x0; nh = y1 - y0;
    }
    setLines({ x: lx, y: ly });
    onChange((l) => { const w = l.wins[d.i]; if (!w) return; w.x = Math.round(nx); w.y = Math.round(ny); w.w = Math.max(1, Math.round(nw)); w.h = Math.max(1, Math.round(nh)); });
  };
  const up = () => { if (!drag.current) return; drag.current = null; dragging.current = false; setLines({ x: [], y: [] }); onChange(() => {}); };

  const pct = (v: number, t: number) => (v / t) * 100 + '%';
  return (
    <div class="preview-wrap">
      <div class="preview border-stage" ref={wrap} style={{ aspectRatio: `${B.W} / ${B.H}` }}
        onPointerMove={(e) => move(e as any)} onPointerUp={up} onPointerCancel={up}>
        <canvas ref={ref} />
        {guide && <img class="map-overlay" src={guide.url} alt="" style={{ width: '100%', height: '100%', opacity: guide.op }} />}
        {boxes && L.wins.map((w, i) => (
          <div key={i} class={'bwin' + (i === wi ? ' sel' : '') + (w.t === 'block' ? ' block' : '')}
            style={{ left: pct(w.x, B.W), top: pct(w.y, B.H), width: pct(w.w, B.W), height: pct(w.h, B.H) }}
            onPointerDown={(e) => down(e as any, i, 'move')}>
            {w.t !== 'block' && w.b > 0 && w.w > 2 * w.b && w.h > 2 * w.b && (
              <div class="bhole" style={{ left: pct(w.b, w.w), right: pct(w.b, w.w), top: pct(w.b, w.h), bottom: pct(w.b, w.h) }} />
            )}
            <span class="btag">{i + 1}{w.t === 'block' ? ' 가리기' : ''} · {w.w}×{w.h}</span>
            {i === wi && (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((h) => (
              <i key={h} class={'bh ' + h} onPointerDown={(e) => down(e as any, i, h)} />
            ))}
          </div>
        ))}
        {lines.x.map((x, i) => <div key={'x' + i} class="bsnap" style={{ left: pct(x, B.W), top: 0, bottom: 0, width: '1px' }} />)}
        {lines.y.map((y, i) => <div key={'y' + i} class="bsnap" style={{ top: pct(y, B.H), left: 0, right: 0, height: '1px' }} />)}
      </div>
    </div>
  );
}
