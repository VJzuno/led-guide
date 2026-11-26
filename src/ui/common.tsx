import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { DEFAULT_TYPO, DEFAULT_MOTION, type Led, type GuideKind, type GuideOptions, type Typography, type MotionCfg } from '../types';
import { renderToCanvas, layersFor, layoutFor, exportPng, exportVideo } from '../export';
import { useStore, toast, updateLed } from '../store';
import { drawFrame, buildTimeline, buildDuration, motionOf, MOTION, DEFAULT_LOGO_URL, type Layers } from '../render';
import { snapPos } from '../layout';
import { evalExpr, isExpr } from '../calc';
import type { VideoVariant } from '../video';
import { MapOverlay } from './ImportMap';
import { onFirebaseHost, cloudStatus, cloudUser, cloudChecking } from '../cloud';

export const go = (path: string) => { location.hash = '#' + path; };

/** 메인 탭 화면 상단: ZUNO 로고 | 화면 이름 · 오른쪽 상태 알약 (레퍼런스: 진한 상단 띠) */
export function AppHeader({ title, right }: { title: string; right?: ComponentChildren }) {
  const s = useStore();
  return (
    <header class="app-header">
      <img class="ah-logo" src={DEFAULT_LOGO_URL} alt="ZUNO" />
      <span class="ah-div" aria-hidden="true" />
      <h1 class="ah-title">{title}</h1>
      <div class="ah-right">{right}<StatusPill online={s.online} /></div>
    </header>
  );
}

/** 연결·동기화 상태. 동기화가 멈췄으면 눌러서 다시 연결 */
function StatusPill({ online }: { online: boolean }) {
  if (onFirebaseHost()) {
    const st = cloudStatus(), u = cloudUser();
    const [label, cls] = !online ? ['오프라인', 'off'] : !u && cloudChecking() ? ['연결 중', 'busy'] : !u ? ['로그인', 'warn'] : st === 'syncing' || st === 'connecting' ? ['동기화 중', 'busy'] : st === 'error' ? ['동기화 오류', 'warn'] : ['동기화됨', ''];
    return <button class={'ah-pill ' + cls} onClick={() => go('/menu/backup')} aria-label={`상태: ${label}`}><i />{label}</button>;
  }
  if (!online) return <button class="ah-pill off" onClick={() => go('/menu/backup')}><i />오프라인</button>;
  return <button class="ah-pill warn" onClick={() => go('/menu/backup')} aria-label="새 주소로 옮기기"><i />새 주소로</button>;
}

export function TopBar({ title, sub, back, right }: { title: string; sub?: string; back?: string; right?: ComponentChildren }) {
  return (
    <div class="topbar">
      {back && (
        <button class="btn icon ghost" aria-label="뒤로" onClick={() => (back === '<' ? history.back() : go(back))}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
      )}
      <div class="grow">
        <h1>{title}</h1>
        {sub && <div class="sub">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/* ---------- 수식 입력용 연산자 바 (터치 기기에서 숫자 칸을 누르면 키보드 위에 뜸) ---------- */
let calcTarget: HTMLInputElement | null = null;
const calcSubs = new Set<() => void>();
const setCalcTarget = (el: HTMLInputElement | null) => { calcTarget = el; calcSubs.forEach((f) => f()); };

export function CalcBar() {
  const [, force] = useState(0);
  const [bottom, setBottom] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    calcSubs.add(f);
    const vv = window.visualViewport;
    const place = () => { if (vv) setBottom(Math.max(0, window.innerHeight - vv.height - vv.offsetTop)); };
    vv?.addEventListener('resize', place); vv?.addEventListener('scroll', place); place();
    return () => { calcSubs.delete(f); vv?.removeEventListener('resize', place); vv?.removeEventListener('scroll', place); };
  }, []);
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (!calcTarget || !coarse) return null;
  const put = (ch: string) => {
    const el = calcTarget!;
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
    el.setRangeText(ch, s, e, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const keys: [string, string][] = [['÷', '/'], ['×', '*'], ['−', '-'], ['+', '+'], ['(', '('], [')', ')']];
  return (
    <div class="calc-bar" style={{ bottom: bottom + 'px' }} onPointerDown={(e) => e.preventDefault()}>
      {keys.map(([label, ch]) => (
        <button key={ch} onPointerDown={(e) => { e.preventDefault(); put(ch); }}>{label}</button>
      ))}
      <button class="eq" onPointerDown={(e) => { e.preventDefault(); calcTarget?.blur(); }}>=</button>
    </div>
  );
}

/** 숫자 입력칸: 입력 중 문자열 유지, 유효할 때만 반영. 230/2 같은 수식도 계산 */
export function NumInput({ value, onChange, min = 0, int = true, aria }: {
  value: number; onChange: (v: number) => void; min?: number; int?: boolean; aria?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);
  const parse = (s: string) => {
    const v = evalExpr(s);
    if (v === null) return null;
    const n = int ? Math.round(v) : Math.round(v * 1000) / 1000;
    return n >= min ? n : null;
  };
  const result = parse(draft);
  const invalid = result === null;
  const showEq = focused.current && isExpr(draft) && result !== null;
  return (
    <span class="num-wrap">
      <input
        class={'input num' + (invalid ? ' invalid' : '')} aria-label={aria}
        type="text" inputMode="decimal" enterKeyHint="done" autoComplete="off"
        value={draft}
        onFocus={(e) => { focused.current = true; setCalcTarget(e.target as HTMLInputElement); (e.target as HTMLInputElement).select(); }}
        onBlur={() => { focused.current = false; if (calcTarget) setCalcTarget(null); setDraft(String(value)); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onInput={(e) => {
          const s = (e.target as HTMLInputElement).value;
          setDraft(s);
          const n = parse(s);
          if (n !== null && n !== value) onChange(n);
        }}
      />
      {showEq && <span class="num-eq">= {result}</span>}
    </span>
  );
}

export function NumField({ label, value, onChange, min = 0, int = true, full }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; step?: number; int?: boolean; full?: boolean;
}) {
  return (
    <div class={'field' + (full ? ' full' : '')}>
      <label>{label}</label>
      <NumInput value={value} onChange={onChange} min={min} int={int} aria={label} />
    </div>
  );
}

/** W × H 한 줄 입력 */
export function PairField({ label, a, b, onA, onB, min = 1, int = true, unit }: {
  label: string; a: number; b: number; onA: (v: number) => void; onB: (v: number) => void; min?: number; int?: boolean; unit?: string;
}) {
  return (
    <div class="field pair">
      <label>{label}{unit && <span class="muted"> · {unit}</span>}</label>
      <div class="pair-row">
        <NumInput value={a} onChange={onA} min={min} int={int} aria={label + ' W'} />
        <span class="x">×</span>
        <NumInput value={b} onChange={onB} min={min} int={int} aria={label + ' H'} />
      </div>
    </div>
  );
}

/** 접히는 섹션 */
export function Section({ title, sub, open = false, children }: { title: string; sub?: string; open?: boolean; children: ComponentChildren }) {
  return (
    <details class="sec" open={open}>
      <summary><span class="grow">{title}{sub && <span class="muted small"> {sub}</span>}</span><span class="chev">›</span></summary>
      <div class="sec-body">{children}</div>
    </details>
  );
}

export function TextField({ label, value, onChange, full, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; full?: boolean; placeholder?: string;
}) {
  return (
    <div class={'field' + (full ? ' full' : '')}>
      <label>{label}</label>
      <input class="input" type="text" value={value} placeholder={placeholder} autoComplete="off" autoCapitalize="characters"
        onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} class={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button class={'toggle' + (on ? ' on' : '')} onClick={onClick} aria-pressed={on}>
      <span class="dot" />{label}
    </button>
  );
}

const OPTION_LABELS: [keyof GuideOptions, string][] = [
  ['logo', '로고 원'], ['fitCircle', '핏 원 (PNG)'], ['rings', '링 모션 (영상)'], ['faceLabels', '면 라벨'],
  ['panelNumbers', '판넬 번호'], ['crosshair', '십자선'], ['diagonals', '대각선'],
  ['headerBars', '좌하단 헤더'], ['infoTag', '우하단 정보'], ['aeCoords', 'AE 좌표'],
];
export function OptionToggles({ opt, onChange }: { opt: GuideOptions; onChange: (o: GuideOptions) => void }) {
  return (
    <div class="toggles">
      {OPTION_LABELS.map(([k, l]) => (
        <Toggle key={k} on={opt[k]} label={l} onClick={() => onChange({ ...opt, [k]: !opt[k] })} />
      ))}
    </div>
  );
}

const PREVIEW_MAX_W = 1600;

/** 가이드 프리뷰 (상단 고정용)
 *  - 루프/빌드업/PNG 모양 미리보기
 *  - 위치 편집: 면을 마우스·터치로 끌어서 배치, 자석 스냅 on/off
 *  - 꾹 누르기 또는 ⤢ 버튼 = 원본 해상도 전체화면 */
type Box = { x: number; y: number; w: number; h: number };

export function GuidePreview({ led, kind, motion = true }: { led: Led; kind: GuideKind; motion?: boolean }) {
  const s = useStore();
  const ref = useRef<HTMLCanvasElement>(null);
  const layers = useRef<Layers | null>(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);
  const [mode, setMode] = useState<'loop' | 'build' | 'pause'>(motion ? 'loop' : 'pause');
  const [edit, setEdit] = useState(false);
  const [snap, setSnap] = useState(true);
  const [active, setActive] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const group = useRef<{ px: number; py: number; b: Box; fs: (Box & { id: string })[]; rs?: 'br' | 'r' | 'b' } | null>(null);
  const [mapOn, setMapOn] = useState(false);
  const [mapAlpha, setMapAlpha] = useState(0.5);
  const timer = useRef<number>();
  const start = useRef<[number, number]>([0, 0]);
  const t0 = useRef(performance.now());
  const drag = useRef<{ id: string; ox: number; oy: number; px: number; py: number; w: number; h: number; rs?: 'br' | 'r' | 'b' } | null>(null);
  const raf = useRef(0);

  const lay = layoutFor(led, kind);
  const key = kind === 'IN' ? 'input' : 'output';
  const manual = led[key].manual;

  // 레이어 다시 만들기 (입력이 바뀔 때). 드래그 중엔 즉시
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const scale = Math.min(1, PREVIEW_MAX_W / lay.W, 1200 / lay.H);
        const L = await layersFor(led, kind, scale);
        if (!alive || !ref.current) return;
        ref.current.width = L.W; ref.current.height = L.H;
        layers.current = L;
        drawFrame(ref.current.getContext('2d')!, L, MOTION.pngTime, 'static');
        setErr('');
      } catch (e: any) { if (alive) setErr(e.message); }
    };
    const tm = setTimeout(run, drag.current ? 0 : 60);
    return () => { alive = false; clearTimeout(tm); };
  }, [led, kind, s.settings.accent, s.settings.logoTint, s.fontsReady]);

  // 애니메이션 루프
  useEffect(() => {
    if (mode === 'pause') {
      const L = layers.current;
      if (L && ref.current) drawFrame(ref.current.getContext('2d')!, L, MOTION.pngTime, 'static');
      return;
    }
    t0.current = performance.now();
    let id = 0;
    const tick = () => {
      const L = layers.current, c = ref.current;
      if (L && c && !document.hidden) {
        let t = (performance.now() - t0.current) / 1000;
        if (mode === 'build') t = t % (buildTimeline(L).duration + 0.8);
        drawFrame(c.getContext('2d')!, L, t, mode);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [mode]);
  // 정지 모드에서 레이어가 바뀌면 다시 그림
  useEffect(() => {
    if (mode !== 'pause') return;
    const L = layers.current;
    if (L && ref.current) drawFrame(ref.current.getContext('2d')!, L, MOTION.pngTime, 'static');
  });

  const cancel = () => { clearTimeout(timer.current); setPressing(false); };
  const open = async () => {
    cancel();
    try { navigator.vibrate?.(10); } catch { /* ignore */ }
    try {
      const { canvas } = await renderToCanvas(led, kind);
      setView(canvas.toDataURL('image/png'));
    } catch (e: any) { setErr(e.message); }
  };

  /* ---------- 드래그 배치 ---------- */
  const toLayout = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * lay.W, y: ((e.clientY - r.top) / r.height) * lay.H, k: lay.W / r.width };
  };
  const onFaceDown = (e: PointerEvent, id: string) => {
    if (!edit) return;
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const f = lay.faces.find((x) => x.face.id === id)!;
    // 처음 끌 때 현재 배치를 전부 고정 (다른 면이 다시 흐르지 않게)
    if (!manual) updateLed(led.id, (x) => {
      x[key].manual = Object.fromEntries(lay.faces.map((fr) => [fr.face.id, { x: fr.x, y: fr.y }]));
      return x;
    });
    const p = toLayout(e);
    drag.current = { id, ox: f.x, oy: f.y, px: p.x, py: p.y, w: f.w, h: f.h };
    setActive(id);
  };
  /** 아웃풋: 모서리·변 핸들로 면 크기 늘이기 (Shift = 비율 유지) */
  const onHandleDown = (e: PointerEvent, id: string, rs: 'br' | 'r' | 'b') => {
    if (!edit || kind !== 'OUT') return;
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const f = lay.faces.find((x) => x.face.id === id)!;
    updateLed(led.id, (x) => {
      if (!x.output.manual) x.output.manual = Object.fromEntries(lay.faces.map((fr) => [fr.face.id, { x: fr.x, y: fr.y }]));
      x.output.size = { ...(x.output.size || {}), [id]: { w: f.w, h: f.h } };
      return x;
    });
    const p = toLayout(e);
    drag.current = { id, ox: f.x, oy: f.y, px: p.x, py: p.y, w: f.w, h: f.h, rs };
    setActive(id);
  };
  const onFaceMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toLayout(e);
    if (d.rs) {
      let nw = d.rs === 'b' ? d.w : Math.max(8, Math.round(d.w + p.x - d.px));
      let nh = d.rs === 'r' ? d.h : Math.max(8, Math.round(d.h + p.y - d.py));
      if (e.shiftKey && d.rs === 'br') { const k = Math.max(nw / d.w, nh / d.h); nw = Math.round(d.w * k); nh = Math.round(d.h * k); }
      if (snap) {
        const th = 12 * p.k;
        const xs = [lay.W, lay.W / 2], ys = [lay.H, lay.H / 2];
        for (const f of lay.faces) if (f.face.id !== d.id) { xs.push(f.x, f.x + f.w); ys.push(f.y, f.y + f.h); }
        const sx = xs.find((v) => Math.abs(d.ox + nw - v) < th); if (sx != null && d.rs !== 'b') nw = Math.round(sx - d.ox);
        const sy = ys.find((v) => Math.abs(d.oy + nh - v) < th); if (sy != null && d.rs !== 'r') nh = Math.round(sy - d.oy);
      }
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => updateLed(led.id, (x) => {
        x.output.size = { ...(x.output.size || {}), [d.id]: { w: nw, h: nh } };
        return x;
      }));
      return;
    }
    let nx = Math.round(d.ox + p.x - d.px), ny = Math.round(d.oy + p.y - d.py);
    if (snap) ({ x: nx, y: ny } = snapPos(lay, d.id, nx, ny, d.w, d.h, 12 * p.k));
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => updateLed(led.id, (x) => {
      x[key].manual = { ...(x[key].manual || {}), [d.id]: { x: nx, y: ny } };
      return x;
    }));
  };
  const onFaceUp = () => { drag.current = null; setActive(null); };

  /* ---------- 아웃풋 전체 선택: 모든 면을 한 묶음으로 이동·크기 조절 ---------- */
  const groupAll = all && edit && kind === 'OUT' && lay.faces.length > 0;
  const bbox = (): Box => {
    const x = Math.min(...lay.faces.map((f) => f.x)), y = Math.min(...lay.faces.map((f) => f.y));
    return { x, y, w: Math.max(...lay.faces.map((f) => f.x + f.w)) - x, h: Math.max(...lay.faces.map((f) => f.y + f.h)) - y };
  };
  /** 묶음 기준(b)에서 새 묶음(nb)으로: 각 면 위치·크기를 같은 비율로 */
  const applyGroup = (fs: (Box & { id: string })[], b: Box, nb: Box) => {
    const kx = nb.w / b.w, ky = nb.h / b.h;
    updateLed(led.id, (x) => {
      x.output.manual = Object.fromEntries(fs.map((f) => [f.id, { x: Math.round(nb.x + (f.x - b.x) * kx), y: Math.round(nb.y + (f.y - b.y) * ky) }]));
      x.output.size = Object.fromEntries(fs.map((f) => [f.id, { w: Math.max(1, Math.round(f.w * kx)), h: Math.max(1, Math.round(f.h * ky)) }]));
      return x;
    });
  };
  const snapshot = () => lay.faces.map((f) => ({ id: f.face.id, x: f.x, y: f.y, w: f.w, h: f.h }));
  const setGroupBox = (nb: Box) => applyGroup(snapshot(), bbox(), nb);
  const onGroupDown = (e: PointerEvent, rs?: 'br' | 'r' | 'b') => {
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toLayout(e);
    group.current = { px: p.x, py: p.y, b: bbox(), fs: snapshot(), rs };
    setActive('__all');
  };
  const onGroupMove = (e: PointerEvent) => {
    const g = group.current;
    if (!g) return;
    const p = toLayout(e), th = 12 * p.k, b = g.b;
    let nb: Box;
    if (g.rs) {
      let w = g.rs === 'b' ? b.w : Math.max(8, b.w + p.x - g.px);
      let h = g.rs === 'r' ? b.h : Math.max(8, b.h + p.y - g.py);
      if (g.rs === 'br') { const k = Math.max(w / b.w, h / b.h); w = b.w * k; h = b.h * k; } // 전체는 비율 유지
      if (snap) {
        if (g.rs !== 'b' && Math.abs(b.x + w - lay.W) < th) { const k = (lay.W - b.x) / w; w *= k; if (g.rs === 'br') h *= k; }
        else if (g.rs !== 'r' && Math.abs(b.y + h - lay.H) < th) { const k = (lay.H - b.y) / h; h *= k; if (g.rs === 'br') w *= k; }
      }
      nb = { x: b.x, y: b.y, w, h };
    } else {
      let x = b.x + p.x - g.px, y = b.y + p.y - g.py;
      if (snap) {
        const sx = [0, lay.W - b.w, (lay.W - b.w) / 2].find((v) => Math.abs(x - v) < th); if (sx != null) x = sx;
        const sy = [0, lay.H - b.h, (lay.H - b.h) / 2].find((v) => Math.abs(y - v) < th); if (sy != null) y = sy;
      }
      nb = { x, y, w: b.w, h: b.h };
    }
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => applyGroup(g.fs, b, nb));
  };
  const onGroupUp = () => { group.current = null; setActive(null); };

  return (
    <div class="preview-wrap">
      <div
        class={'preview' + (pressing ? ' pressing' : '') + (edit ? ' editing' : '')}
        onPointerDown={(e) => { if (edit) return; start.current = [e.clientX, e.clientY]; setPressing(true); timer.current = window.setTimeout(open, 420); }}
        onPointerMove={(e) => { if (Math.hypot(e.clientX - start.current[0], e.clientY - start.current[1]) > 10) cancel(); }}
        onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
        onContextMenu={(e) => e.preventDefault()}
        onDblClick={() => !edit && open()}
      >
        <canvas ref={ref} />
        {kind === 'IN' && mapOn && <MapOverlay led={led} W={lay.W} H={lay.H} opacity={mapAlpha} />}
        {edit && lay.faces.map((f) => (
          <div key={f.face.id} class={'face-box' + (active === f.face.id ? ' on' : '') + (f.overflow ? ' over' : '') + (groupAll ? ' in-group' : '')}
            style={{ left: (f.x / lay.W) * 100 + '%', top: (f.y / lay.H) * 100 + '%', width: (f.w / lay.W) * 100 + '%', height: (f.h / lay.H) * 100 + '%' }}
            onPointerDown={(e) => onFaceDown(e as any, f.face.id)} onPointerMove={(e) => onFaceMove(e as any)}
            onPointerUp={onFaceUp} onPointerCancel={onFaceUp}>
            <span>{f.face.name} · {f.x},{f.y}{kind === 'OUT' ? ` · ${f.w}×${f.h}` : ''}</span>
            {kind === 'OUT' && (['r', 'b', 'br'] as const).map((h) => (
              <i key={h} class={'face-h ' + h} onPointerDown={(e) => onHandleDown(e as any, f.face.id, h)}
                onPointerMove={(e) => onFaceMove(e as any)} onPointerUp={onFaceUp} onPointerCancel={onFaceUp} />
            ))}
          </div>
        ))}
        {groupAll && (() => { const b = bbox(); return (
          <div class={'face-box group' + (active === '__all' ? ' on' : '')}
            style={{ left: (b.x / lay.W) * 100 + '%', top: (b.y / lay.H) * 100 + '%', width: (b.w / lay.W) * 100 + '%', height: (b.h / lay.H) * 100 + '%' }}
            onPointerDown={(e) => onGroupDown(e as any)} onPointerMove={(e) => onGroupMove(e as any)} onPointerUp={onGroupUp} onPointerCancel={onGroupUp}>
            <span>전체 {lay.faces.length}면 · {Math.round(b.x)},{Math.round(b.y)} · {Math.round(b.w)}×{Math.round(b.h)}</span>
            {(['r', 'b', 'br'] as const).map((h) => (
              <i key={h} class={'face-h ' + h} onPointerDown={(e) => onGroupDown(e as any, h)}
                onPointerMove={(e) => onGroupMove(e as any)} onPointerUp={onGroupUp} onPointerCancel={onGroupUp} />
            ))}
          </div>); })()}
        <button class="pv-btn" aria-label="크게 보기" onPointerDown={(e) => e.stopPropagation()} onClick={open}>⤢</button>
      </div>
      <div class="pv-bar">
        {motion && <Seg<'loop' | 'build' | 'pause'> value={mode} onChange={setMode}
          options={[['loop', '▶ 루프'], ['build', '▶ 빌드업'], ['pause', 'PNG']]} />}
        <button class={'chip' + (edit ? ' on' : '')} onClick={() => setEdit(!edit)}>✥ 위치 편집</button>
        {edit && <button class={'chip' + (snap ? ' on' : '')} onClick={() => setSnap(!snap)}>자석 스냅 {snap ? 'ON' : 'OFF'}</button>}
        {edit && manual && <button class="chip" onClick={() => updateLed(led.id, (x) => { delete x[key].manual; if (kind === 'OUT') delete x.output.size; return x; })}>자동 배치</button>}
        {edit && kind === 'OUT' && <button class={'chip' + (all ? ' on' : '')} onClick={() => setAll(!all)}>▣ 전체 선택</button>}
        {edit && kind === 'OUT' && !groupAll && <span class="small muted">모서리 □를 끌면 크기 조절 · Shift = 비율 유지</span>}
        {kind === 'IN' && led.input.map && <button class={'chip' + (mapOn ? ' on' : '')} onClick={() => setMapOn(!mapOn)}>◧ 인풋맵 겹쳐보기</button>}
        {kind === 'IN' && led.input.map && mapOn && (
          <>
            <input type="range" class="map-alpha" min={0.1} max={1} step={0.05} value={mapAlpha} aria-label="인풋맵 불투명도"
              onInput={(e) => setMapAlpha(+(e.target as HTMLInputElement).value)} />
            <button class="chip" onClick={() => { setMapOn(false); updateLed(led.id, (x) => { delete x.input.map; return x; }); }}>맵 지우기</button>
          </>
        )}
      </div>
      {groupAll && (() => { const b = bbox(); const W = Math.round(b.w), H = Math.round(b.h); const f0 = lay.faces[0]; const k0 = f0.w / Math.max(1, f0.face.w); /* 원래 면 크기 대비 배율 */ return (
        <div class="pv-bar group-bar">
          <span class="small muted">전체 크기</span>
          <NumInput value={W} min={8} aria="전체 W" onChange={(v) => setGroupBox({ x: b.x, y: b.y, w: v, h: b.h * (v / b.w) })} />
          <span class="x">×</span>
          <NumInput value={H} min={8} aria="전체 H" onChange={(v) => setGroupBox({ x: b.x, y: b.y, w: b.w * (v / b.h), h: v })} />
          <NumInput value={Math.round(k0 * 100)} min={1} aria="배율 %" onChange={(v) => { const r = v / 100 / k0; setGroupBox({ x: b.x, y: b.y, w: b.w * r, h: b.h * r }); }} />
          <span class="small muted">%</span>
          <button class="chip" onClick={() => { const k = lay.W / b.w; setGroupBox({ x: 0, y: b.y, w: lay.W, h: b.h * k }); }}>폭 맞춤</button>
          <button class="chip" onClick={() => { const k = lay.H / b.h; setGroupBox({ x: b.x, y: 0, w: b.w * k, h: lay.H }); }}>높이 맞춤</button>
          <button class="chip" onClick={() => setGroupBox({ x: (lay.W - b.w) / 2, y: (lay.H - b.h) / 2, w: b.w, h: b.h })}>가운데</button>
          <span class="small muted">묶음을 끌면 이동 · 모서리 □ = 비율 유지 크기</span>
        </div>); })()}
      {err && <div class="small" style="color:var(--danger);margin-top:6px">{err}</div>}
      {view && <Viewer src={view} onClose={() => setView(null)} />}
    </div>
  );
}

/** 로고: 기본(ZUNO) 프리셋 / 이미지 첨부로 교체 */
export function LogoPicker({ led }: { led: Led }) {
  const pick = async (e: Event) => {
    const inp = e.target as HTMLInputElement;
    const file = inp.files?.[0];
    inp.value = '';
    if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const data = c.toDataURL('image/png');
      updateLed(led.id, (x) => { x.logo = data; return x; });
      toast('로고 변경됨');
    } catch { toast('이미지를 읽을 수 없습니다'); }
  };
  return (
    <>
    <div class="logo-pick">
      <img src={led.logo || DEFAULT_LOGO_URL} alt="로고" />
      <div class="grow small">
        <div style="font-weight:600">{led.logo ? '첨부한 로고' : '기본 로고 (ZUNO)'}</div>
        <div class="muted">투명 배경 PNG 권장 · 인풋/아웃풋 공통</div>
      </div>
      <label class="chip">첨부<input type="file" accept="image/*" style="display:none" onChange={pick} /></label>
      {led.logo && <button class="chip" onClick={() => updateLed(led.id, (x) => { delete x.logo; return x; })}>기본</button>}
    </div>
    <Slider label="로고 원 크기 (모든 면 동일)" value={led.logoScale ?? 1} min={0.5} max={2.4} step={0.05} def={1}
      fmt={(v) => Math.round(v * 100) + '%'}
      onChange={(v) => updateLed(led.id, (x) => { if (Math.abs(v - 1) < 0.001) delete x.logoScale; else x.logoScale = Math.round(v * 100) / 100; return x; })} />
    <div class="small muted" style="margin:-2px 0 10px">가장 작은 면에 맞춰 계산되고, 면을 넘을 만큼 커지지는 않아요. 숫자 버튼을 누르면 기본(100%)</div>
    </>
  );
}

/** PNG + 영상 2종 추출 버튼 */
export function ExportButtons({ led, kind, onCopy, video = true }: { led: Led; kind: GuideKind; onCopy: () => void; video?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [prog, setProg] = useState(0);
  const run = async (what: 'PNG' | VideoVariant) => {
    if (busy) return;
    setBusy(what); setProg(0);
    try {
      if (what === 'PNG') await exportPng(led, kind);
      else await exportVideo(led, kind, what, setProg);
    } catch (e: any) { toast(e?.message || '실패'); console.error(e); }
    setBusy(null);
  };
  const label = (what: 'PNG' | VideoVariant, text: string) =>
    busy === what ? (what === 'PNG' ? '렌더링…' : `인코딩 ${Math.round(prog * 100)}%`) : text;
  return (
    <div class="stack" style="margin-top:10px">
      <div class="row">
        <button class="btn primary big grow" disabled={!!busy} onClick={() => run('PNG')}>{label('PNG', 'PNG 추출')}</button>
        <button class="btn big grow" onClick={onCopy}>좌표 복사</button>
      </div>
      {video && <div class="row">
        <button class="btn big grow" disabled={!!busy} onClick={() => run('LOOP')}>{label('LOOP', '영상 · 루프')}</button>
        <button class="btn big grow" disabled={!!busy} onClick={() => run('BUILD')}>{label('BUILD', '영상 · 빌드업')}</button>
      </div>}
      {busy && busy !== 'PNG' && <div class="meter"><i style={{ width: prog * 100 + '%' }} /></div>}
      {video && <div class="small muted">MP4 · {MOTION.fps}fps · 원본 해상도 · 루프 {motionOf(led).loop}초 · 빌드업 {buildDuration(led).toFixed(1)}초</div>}
    </div>
  );
}


/** 전체화면 뷰어: 세로 화면이면 90° 돌려 가로로 표시, 핀치 줌 / 드래그 */
export function Viewer({ src, onClose }: { src: string; onClose: () => void }) {
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  const [tf, setTf] = useState({ s: 1, x: 0, y: 0 });
  const g = useRef<{ d0: number; s0: number; p0: [number, number]; x0: number; y0: number; moved: boolean } | null>(null);

  useEffect(() => {
    const r = () => setSize({ w: innerWidth, h: innerHeight });
    addEventListener('resize', r);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('resize', r); removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, []);

  const rotate = size.h > size.w;
  const sw = rotate ? size.h : size.w, sh = rotate ? size.w : size.h;

  const pts = (e: TouchEvent) => [...e.touches].map((t) => [t.clientX, t.clientY] as [number, number]);
  const onStart = (e: TouchEvent) => {
    const p = pts(e);
    const d0 = p.length > 1 ? Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) : 0;
    g.current = { d0, s0: tf.s, p0: p[0], x0: tf.x, y0: tf.y, moved: false };
  };
  const onMove = (e: TouchEvent) => {
    const st = g.current; if (!st) return;
    e.preventDefault();
    const p = pts(e);
    if (p.length > 1 && st.d0) {
      const d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
      setTf((t) => ({ ...t, s: Math.max(1, Math.min(8, (st.s0 * d) / st.d0)) }));
      st.moved = true;
    } else if (p.length === 1) {
      let dx = p[0][0] - st.p0[0], dy = p[0][1] - st.p0[1];
      if (Math.hypot(dx, dy) > 6) st.moved = true;
      if (rotate) [dx, dy] = [dy, -dx];
      setTf((t) => (t.s > 1 ? { ...t, x: st.x0 + dx, y: st.y0 + dy } : t));
    }
  };
  const onEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) {
      if (g.current && !g.current.moved) setTf((t) => (t.s > 1 ? { s: 1, x: 0, y: 0 } : { s: 2.5, x: 0, y: 0 }));
      g.current = null;
    } else onStart(e);
  };

  return (
    <div class="viewer" onTouchStart={onStart as any} onTouchMove={onMove as any} onTouchEnd={onEnd as any}
      onWheel={(e) => setTf((t) => ({ ...t, s: Math.max(1, Math.min(8, t.s * (e.deltaY < 0 ? 1.15 : 0.87))) }))}>
      <div class="stage" style={{
        width: sw + 'px', height: sh + 'px',
        transform: `translate(-50%,-50%) rotate(${rotate ? 90 : 0}deg) scale(${tf.s}) translate(${tf.x / tf.s}px, ${tf.y / tf.s}px)`,
      }}>
        <img src={src} alt="" />
      </div>
      <button class="btn icon close" onClick={onClose} aria-label="닫기">✕</button>
      <div class="vhint">핀치로 확대 · 탭으로 2.5× / 원래대로</div>
    </div>
  );
}

export function Icon({ name }: { name: 'home' | 'folder' | 'clock' | 'menu' | 'cube' | 'doc' | 'more' }) {
  const p: Record<string, string> = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    menu: 'M4 7h16M4 12h16M4 17h16',
    cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
    doc: 'M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h6M9 17h6',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d={p[name]} /></svg>;
}

export const timeAgo = (t: number) => {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 슬라이더 (값 표시 + 탭하면 기본값) */
export function Slider({ label, value, min, max, step, fmt, def, onChange, unit, inputMax }: {
  label: string; value: number; min: number; max: number; step: number; def: number;
  fmt: (v: number) => string; onChange: (v: number) => void;
  /** 단위가 있으면 숫자 직접 입력칸을 보여줌. inputMax = 입력으로는 슬라이더 끝보다 크게도 가능 */
  unit?: string; inputMax?: number;
}) {
  if (unit != null) {
    const hi = inputMax ?? max;
    return (
      <div class="slider">
        <div class="row">
          <label class="grow">{label}</label>
          {value !== def && <button class="chip reset-chip" onClick={() => onChange(def)} aria-label={`${label} 기본값`}>↺</button>}
          <div class="slider-num">
            <NumInput value={value} min={min} aria={label} onChange={(v) => onChange(Math.min(hi, Math.max(min, Math.round(v))))} />
            <span class="unit">{unit}</span>
          </div>
        </div>
        <input type="range" min={min} max={max} step={step} value={Math.min(value, max)}
          onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))} />
      </div>
    );
  }
  return (
    <div class="slider">
      <div class="row">
        <label class="grow">{label}</label>
        <button class={'chip num' + (value !== def ? ' on' : '')} onClick={() => onChange(def)} aria-label={`${label} 기본값`}>{fmt(value)}</button>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onInput={(e) => onChange(parseFloat((e.target as HTMLInputElement).value))} />
    </div>
  );
}

/** LED 명 / 하단 정보 글자 크기·자간·행간 */
export function TypoControls({ typo, onChange }: { typo?: Typography; onChange: (t: Typography) => void }) {
  const t = { ...DEFAULT_TYPO, ...(typo || {}) };
  const set = (k: keyof Typography) => (v: number) => onChange({ ...t, [k]: Math.round(v * 1000) / 1000 });
  const pct = (v: number) => Math.round(v * 100) + '%';
  const em = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);
  const changed = (Object.keys(DEFAULT_TYPO) as (keyof Typography)[]).some((k) => t[k] !== DEFAULT_TYPO[k]);
  return (
    <div class="card">
      <div class="small muted" style="margin-bottom:4px">LED 명</div>
      <Slider label="크기" value={t.nameSize} min={0.4} max={2} step={0.05} def={DEFAULT_TYPO.nameSize} fmt={pct} onChange={set('nameSize')} />
      <Slider label="자간" value={t.nameTracking} min={-0.1} max={0.5} step={0.01} def={DEFAULT_TYPO.nameTracking} fmt={em} onChange={set('nameTracking')} />
      <div class="small muted" style="margin:12px 0 4px">하단 정보</div>
      <Slider label="크기" value={t.infoSize} min={0.4} max={2} step={0.05} def={DEFAULT_TYPO.infoSize} fmt={pct} onChange={set('infoSize')} />
      <Slider label="자간" value={t.infoTracking} min={-0.1} max={0.5} step={0.01} def={DEFAULT_TYPO.infoTracking} fmt={em} onChange={set('infoTracking')} />
      <Slider label="행간" value={t.infoLeading} min={1} max={2.5} step={0.05} def={DEFAULT_TYPO.infoLeading} fmt={(v) => v.toFixed(2)} onChange={set('infoLeading')} />
      {changed && <button class="btn ghost block" style="margin-top:8px" onClick={() => onChange({ ...DEFAULT_TYPO })}>글자 설정 초기화</button>}
      <div class="small muted" style="margin-top:6px">인풋·아웃풋 가이드에 같이 적용됩니다. 값 버튼을 누르면 기본값.</div>
    </div>
  );
}

/** 영상 시간 설정 (빌드업 속도 · 페이드 · 유지 · 루프 길이) */
export function MotionControls({ led }: { led: Led }) {
  const m = motionOf(led);
  const set = (k: keyof MotionCfg) => (v: number) => updateLed(led.id, (x) => { x.motion = { ...m, [k]: Math.round(v * 100) / 100 }; return x; });
  const sec = (v: number) => v.toFixed(1) + '초';
  const changed = (Object.keys(DEFAULT_MOTION) as (keyof MotionCfg)[]).some((k) => m[k] !== DEFAULT_MOTION[k]);
  return (
    <div>
      <div class="small muted" style="margin-bottom:4px">빌드업 · 총 {buildDuration(led).toFixed(1)}초</div>
      <Slider label="픽셀맵 쌓이는 시간 (짧을수록 빠름)" value={m.sweep} min={0.5} max={8} step={0.1} def={DEFAULT_MOTION.sweep} fmt={sec} onChange={set('sweep')} />
      <Slider label="위 요소 페이드인" value={m.fade} min={0.2} max={4} step={0.1} def={DEFAULT_MOTION.fade} fmt={sec} onChange={set('fade')} />
      <Slider label="다 나온 뒤 유지 (링)" value={m.hold} min={0} max={10} step={0.5} def={DEFAULT_MOTION.hold} fmt={sec} onChange={set('hold')} />
      <div class="small muted" style="margin:12px 0 4px">루프</div>
      <Slider label="루프 길이 = 링 한 주기" value={m.loop} min={1} max={12} step={0.5} def={DEFAULT_MOTION.loop} fmt={sec} onChange={set('loop')} />
      {changed && <button class="btn ghost block" style="margin-top:8px" onClick={() => updateLed(led.id, (x) => { delete x.motion; return x; })}>영상 설정 초기화</button>}
    </div>
  );
}

/** 여러 개 선택: 탭/클릭 = 하나 토글, Shift+클릭 = 범위, ⌘/Ctrl+클릭 = 하나 토글.
 *  선택 모드가 아닐 때 Shift/⌘ 클릭하면 자동으로 선택 모드로 들어감 */
export function useSelection(order: string[]) {
  const [mode, setMode] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const anchor = useRef<string | null>(null);
  const live = new Set(order);
  const picked = [...sel].filter((id) => live.has(id));
  /** true 를 돌려주면 클릭을 선택으로 처리한 것 (이동하지 않음) */
  const click = (id: string, e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!mode && !multi) return false;
    if (!mode) setMode(true);
    setSel((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && anchor.current && live.has(anchor.current)) {
        const a = order.indexOf(anchor.current), b = order.indexOf(id);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        for (let i = lo; i <= hi; i++) next.add(order[i]);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!e.shiftKey) anchor.current = id;
    return true;
  };
  const setMany = (ids: string[], on: boolean) => setSel((prev) => { const n = new Set(prev); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; });
  const exit = () => { setMode(false); setSel(new Set()); anchor.current = null; };
  return { mode, setMode, picked, has: (id: string) => sel.has(id), click, setMany, all: () => setSel(new Set(order)), exit };
}
