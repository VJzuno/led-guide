import { useEffect, useRef, useState } from 'preact/hooks';
import type { Led } from '../types';
import { updateLed, uid, toast } from '../store';
import { MAX_CANVAS_PX } from '../layout';
import {
  detectScreens, estimateCabinet, parseResolumeXml, applyImport, likelyLabel, nonOverlapping, overlap,
  type XmlGroup, type Rect,
} from '../importmap';

interface Row extends Rect { name: string; on: boolean }
interface Draft {
  kind: 'image' | 'xml';
  file: string;
  W: number; H: number;
  rows: Row[];
  /** XML: Screen 목록 */
  groups?: XmlGroup[];
  gi?: number;
  /** 이미지: 추정 캐비닛 / 원본 맵 썸네일 */
  cab?: { w: number; h: number } | null;
  map?: { src: string; w: number; h: number };
  /** 분석용 픽셀 (캐비닛 다시 추정) */
  px?: { D: Uint8ClampedArray; W: number; k: number };
}

const rowsOf = (g: XmlGroup, W: number, H: number): Row[] => {
  const full = (s: Rect) => W > 0 && s.w >= W * 0.95 && s.h >= H * 0.95;
  const keep = new Set(nonOverlapping(g.screens.filter((s) => s.enabled && !full(s))));
  return g.screens.map((s) => ({ ...s, on: keep.has(s) }));
};

async function readImage(f: File, existing: string[]): Promise<Draft> {
  const bmp = await createImageBitmap(f);
  const W = bmp.width, H = bmp.height;
  // 큰 이미지는 축소해서 분석 (아이폰 캔버스 한도) → 좌표는 원본 배율로 되돌림
  const k = Math.min(1, Math.sqrt(MAX_CANVAS_PX / 2 / (W * H)));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(bmp, 0, 0, w, h);
  const D = x.getImageData(0, 0, w, h).data;
  const found = detectScreens(D, w, h);
  const up = (r: Rect): Rect => (k === 1 ? r : { x: Math.round(r.x / k), y: Math.round(r.y / k), w: Math.round(r.w / k), h: Math.round(r.h / k) });
  // 감지 개수가 지금 면 개수와 같으면 이름 그대로 이어받기
  const same = found.filter((r) => !likelyLabel(r, w, h)).length === existing.length;
  let ni = 0;
  const rows: Row[] = found.map((r, i) => {
    const label = likelyLabel(r, w, h);
    const name = !label && same ? existing[ni++] : `SCREEN_${i + 1}`;
    return { ...up(r), name, on: !label };
  });
  const cab0 = estimateCabinet(D, w, found.filter((r) => !likelyLabel(r, w, h)));
  const cab = cab0 && k === 1 ? cab0 : cab0 ? { w: Math.round(cab0.w / k), h: Math.round(cab0.h / k) } : null;
  // 검수용 썸네일 (긴 변 1600px JPEG)
  const s = Math.min(1, 1600 / Math.max(W, H));
  const t = document.createElement('canvas');
  t.width = Math.round(W * s); t.height = Math.round(H * s);
  t.getContext('2d')!.drawImage(bmp, 0, 0, t.width, t.height);
  bmp.close?.();
  return { kind: 'image', file: f.name, W, H, rows, cab, map: { src: t.toDataURL('image/jpeg', 0.8), w: W, h: H }, px: { D, W: w, k } };
}

/** 인풋맵 불러오기 버튼 + 확인 창 */
export function ImportMapButton({ led }: { led: Led }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const onFile = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      if (/\.xml$/i.test(f.name) || /xml/.test(f.type)) {
        const r = parseResolumeXml(await f.text());
        const g = r.groups[r.best];
        setDraft({ kind: 'xml', file: f.name, W: r.W, H: r.H, groups: r.groups, gi: r.best, rows: rowsOf(g, r.W, r.H) });
      } else if (/^image\//.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name)) {
        await new Promise((r) => setTimeout(r, 30)); // "분석 중" 먼저 그리기
        const d = await readImage(f, led.faces.map((x) => x.name));
        if (!d.rows.length) toast('면 경계를 찾지 못했어요. 배경과 면 색이 구분되는 맵인지 확인해 주세요.');
        setDraft(d);
      } else {
        toast('이미지(PNG·JPG) 또는 Resolume Advanced Output .xml 파일만 읽을 수 있어요.');
      }
    } catch (e: any) {
      toast(e?.message || '파일을 읽지 못했어요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button class="btn block import-btn" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? '인풋맵 분석 중…' : '⇪ 인풋맵 불러오기'}<span class="muted small">이미지 · Resolume XML</span>
      </button>
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp,.xml,text/xml,application/xml"
        onChange={(e) => { const el = e.target as HTMLInputElement; onFile(el.files?.[0]); el.value = ''; }} />
      {draft && <ImportDialog led={led} draft={draft} setDraft={setDraft} onClose={() => setDraft(null)} />}
    </>
  );
}

function ImportDialog({ led, draft: d, setDraft, onClose }: { led: Led; draft: Draft; setDraft: (d: Draft) => void; onClose: () => void }) {
  const [useCab, setUseCab] = useState(!!d.cab && (d.cab.w !== led.cabinet.pxW || d.cab.h !== led.cabinet.pxH));
  const [snap, setSnap] = useState(d.kind === 'image');
  const [keepMap, setKeepMap] = useState(true);
  const cv = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);

  const W = d.W || Math.max(1, ...d.rows.map((r) => r.x + r.w)), H = d.H || Math.max(1, ...d.rows.map((r) => r.y + r.h));
  const on = d.rows.filter((r) => r.on);
  const clash = on.some((a, i) => on.some((b, j) => j > i && overlap(a, b) > 0.05 * Math.min(a.w * a.h, b.w * b.h)));
  const setRows = (rows: Row[]) => setDraft({ ...d, rows });

  // 미리보기: 맵 이미지(있으면) + 사각형
  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const draw = () => {
      const s = Math.min(1, 1200 / W);
      c.width = Math.max(1, Math.round(W * s)); c.height = Math.max(1, Math.round(H * s));
      const x = c.getContext('2d')!;
      x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
      if (img.current?.complete) { x.globalAlpha = 0.55; x.drawImage(img.current, 0, 0, c.width, c.height); x.globalAlpha = 1; }
      x.font = `600 ${Math.max(10, Math.min(18, c.width / 50))}px 'JetBrains Mono', monospace`;
      x.textBaseline = 'top';
      d.rows.forEach((r, i) => {
        const on = r.on;
        x.strokeStyle = on ? '#8B7CC7' : 'rgba(255,255,255,.25)'; x.lineWidth = on ? 2 : 1;
        x.setLineDash(on ? [] : [4, 4]);
        x.fillStyle = on ? 'rgba(86,19,200,.28)' : 'transparent';
        x.fillRect(r.x * s, r.y * s, r.w * s, r.h * s);
        x.strokeRect(r.x * s + 1, r.y * s + 1, r.w * s - 2, r.h * s - 2);
        if (on) { x.fillStyle = '#fff'; x.fillText(`${i + 1} ${r.name}`, r.x * s + 5, r.y * s + 5); }
      });
    };
    if (d.map && !img.current) { const im = new Image(); im.onload = draw; im.src = d.map.src; img.current = im; }
    draw();
  }, [d]);

  const reEstimate = (rows: Row[]) => {
    if (!d.px) return;
    const k = d.px.k, sel = rows.filter((r) => r.on).map((r) => ({ x: Math.round(r.x * k), y: Math.round(r.y * k), w: Math.round(r.w * k), h: Math.round(r.h * k) }));
    const c = sel.length ? estimateCabinet(d.px.D, d.px.W, sel) : null;
    setDraft({ ...d, rows, cab: c ? { w: Math.round(c.w / k), h: Math.round(c.h / k) } : null });
  };

  const apply = () => {
    if (!on.length) return;
    updateLed(led.id, (l) => applyImport(l, {
      W: d.W, H: d.H, screens: on, newId: uid,
      cabinet: useCab ? d.cab : null, snap,
      map: d.kind === 'image' && keepMap ? d.map! : null,
    }));
    toast(`면 ${on.length}개를 불러왔어요`);
    onClose();
  };

  return (
    <div class="modal" onClick={onClose}>
      <div class="modal-box wide import" onClick={(e) => e.stopPropagation()}>
        <div class="row">
          <b class="grow">인풋맵 불러오기</b>
          <button class="btn icon sm ghost" aria-label="닫기" onClick={onClose}>✕</button>
        </div>
        <div class="small muted mono imp-file">{d.file} · {d.kind === 'xml' ? '컴포지션' : '이미지'} {W}×{H}</div>

        {d.kind === 'xml' && d.groups && d.groups.length > 1 && (
          <label class="field" style="margin-top:10px">
            <span class="lbl">Resolume Screen</span>
            <select class="input" value={d.gi} onChange={(e) => {
              const gi = +(e.target as HTMLSelectElement).value;
              setDraft({ ...d, gi, rows: rowsOf(d.groups![gi], d.W, d.H) });
            }}>
              {d.groups.map((g, i) => <option key={i} value={i}>{g.name} · 슬라이스 {g.screens.length}개{g.enabled ? '' : ' (꺼짐)'}</option>)}
            </select>
          </label>
        )}

        <canvas ref={cv} class="imp-preview" />

        {d.rows.length === 0 ? <div class="warn">면을 찾지 못했어요</div> : (
          <div class="imp-list">
            {d.rows.map((r, i) => (
              <div key={i} class={'imp-row' + (r.on ? '' : ' off')}>
                <input type="checkbox" checked={r.on} aria-label={`${r.name} 사용`} onChange={() => {
                  const rows = d.rows.map((x, j) => (j === i ? { ...x, on: !x.on } : x));
                  d.kind === 'image' ? reEstimate(rows) : setRows(rows);
                }} />
                <input class="input" value={r.name} aria-label="면 이름" autoCapitalize="characters"
                  onInput={(e) => setRows(d.rows.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)))} />
                <span class="mono small">{r.x},{r.y}</span>
                <span class="mono small">{r.w}×{r.h}</span>
              </div>
            ))}
          </div>
        )}
        {clash && <div class="warn">선택한 면끼리 겹칩니다. 겹치는 슬라이스를 빼 주세요</div>}

        <div class="imp-opts">
          {d.kind === 'image' && d.cab && (
            <label><input type="checkbox" checked={useCab} onChange={() => setUseCab(!useCab)} />
              캐비닛 px <b class="mono">{d.cab.w}×{d.cab.h}</b>로 바꾸기 <span class="muted">(지금 {led.cabinet.pxW}×{led.cabinet.pxH}, 체커 간격으로 추정)</span></label>
          )}
          <label><input type="checkbox" checked={snap} onChange={() => setSnap(!snap)} />
            크기를 캐비닛 배수로 맞추기 <span class="muted">(6% 이내 차이만)</span></label>
          {d.kind === 'image' && (
            <label><input type="checkbox" checked={keepMap} onChange={() => setKeepMap(!keepMap)} />
              원본 맵 저장 <span class="muted">(프리뷰에 겹쳐 보며 검수, 출력엔 안 들어감)</span></label>
          )}
          <div class="small muted">기존 면 {led.faces.length}개와 위치가 바뀝니다. 캔버스는 {W}×{H}로 맞춥니다.</div>
        </div>

        <div class="row" style="margin-top:14px">
          <button class="btn grow" onClick={onClose}>취소</button>
          <button class="btn primary grow" disabled={!on.length || clash} onClick={apply}>면 {on.length}개 적용</button>
        </div>
      </div>
    </div>
  );
}

/** 프리뷰 위 인풋맵 오버레이 (검수용) */
export function MapOverlay({ led, W, H, opacity }: { led: Led; W: number; H: number; opacity: number }) {
  const m = led.input.map;
  if (!m) return null;
  return <img class="map-overlay" src={m.src} alt="" style={{ width: (m.w / W) * 100 + '%', height: (m.h / H) * 100 + '%', opacity }} />;
}
