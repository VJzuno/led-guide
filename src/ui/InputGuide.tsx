import { useStore, getLed, getProject, updateLed, uid, ask } from '../store';
import { inputLayout, coordsText, totalCabinets, cabCount, fmtCab, meters } from '../layout';
import { copyText } from '../export';
import type { Led } from '../types';
import {
  TopBar, NumField, NumInput, PairField, TextField, Seg, Section, OptionToggles, TypoControls,
  GuidePreview, ExportButtons, LogoPicker, MotionControls, go,
} from './common';

export function InputGuide({ id }: { id: string }) {
  useStore();
  const l = getLed(id);
  if (!l || l.deletedAt) return <div class="screen"><TopBar title="LED 없음" back="/projects" /></div>;
  const lay = inputLayout(l);
  const up = (fn: (x: Led) => void) => updateLed(id, (x) => { fn(x); return x; });
  const cv = l.input.canvas || { mode: 'auto' as const, w: lay.contentW, h: lay.contentH };
  const mW = lay.faces.reduce((s, f) => s + meters(l, f).w, 0);
  const mH = Math.max(0, ...lay.faces.map((f) => meters(l, f).h));

  return (
    <div class="screen compact">
      <TopBar title={`${l.number} ${l.name}`} sub={`${getProject(l.projectId)?.name ?? ''} · ① 인풋 가이드`} back="/projects"
        right={<button class="btn" onClick={() => go(`/led/${id}/out`)}>② 아웃풋 →</button>} />

      {/* 1. 인풋 캔버스 크기 먼저 (Resolume 컴포지션처럼) */}
      <div class="canvas-row">
        <span class="lbl">인풋 캔버스</span>
        <Seg<'auto' | 'custom'> value={cv.mode} onChange={(m) => up((x) => { x.input.canvas = { mode: m, w: cv.w || lay.contentW, h: cv.h || lay.contentH }; })}
          options={[['auto', '자동 맞춤'], ['custom', '직접 입력']]} />
        {cv.mode === 'custom' ? (
          <div class="pair-row grow">
            <NumInput value={cv.w} min={1} aria="캔버스 W" onChange={(v) => up((x) => { x.input.canvas = { ...cv, mode: 'custom', w: v }; })} />
            <span class="x">×</span>
            <NumInput value={cv.h} min={1} aria="캔버스 H" onChange={(v) => up((x) => { x.input.canvas = { ...cv, mode: 'custom', h: v }; })} />
          </div>
        ) : <span class="num small muted">{lay.W} × {lay.H}</span>}
      </div>

      {/* 2. 프리뷰 (위치 편집 가능) */}
      <GuidePreview led={l} kind="IN" />
      <div class="stat">
        <span>캔버스 <b>{lay.W}×{lay.H}</b></span>
        <span>캐비닛 <b>{fmtCab(totalCabinets(l))}</b></span>
        <span><b>{mW.toFixed(2)}×{mH.toFixed(2)}m</b></span>
        {cv.mode === 'custom' && <span>사용률 <b>{(lay.usage * 100).toFixed(1)}%</b></span>}
      </div>
      {lay.overflow && <div class="warn">일부 면이 캔버스를 벗어났습니다</div>}

      <ExportButtons led={l} kind="IN" onCopy={() => copyText(coordsText(l, lay))} />

      {/* 3. 입력 */}
      <Section title="LED 정보 · 캐비닛" open>
        <div class="fields auto">
          <TextField label="번호" value={l.number} onChange={(v) => up((x) => { x.number = v; })} />
          <TextField label="LED 이름" value={l.name} onChange={(v) => up((x) => { x.name = v; })} />
          <TextField label="헤더 문구" value={l.header} placeholder="공연명" onChange={(v) => up((x) => { x.header = v; })} />
          <TextField label="피치 / 모델" value={l.pitchModel} placeholder="P3.9" onChange={(v) => up((x) => { x.pitchModel = v; })} />
          <PairField label="캐비닛" unit="PX" a={l.cabinet.pxW} b={l.cabinet.pxH}
            onA={(v) => up((x) => { x.cabinet.pxW = v; })} onB={(v) => up((x) => { x.cabinet.pxH = v; })} />
          <PairField label="캐비닛" unit="MM" a={l.cabinet.mmW} b={l.cabinet.mmH} int={false}
            onA={(v) => up((x) => { x.cabinet.mmW = v; })} onB={(v) => up((x) => { x.cabinet.mmH = v; })} />
          <NumField label="갭 PX" value={l.gapPx} min={0} onChange={(v) => up((x) => { x.gapPx = v; })} />
        </div>
      </Section>

      <Section title="LED 면" sub={`${l.faces.length}개 · 픽셀 기준 · 왼쪽 → 오른쪽`} open>
        <div class="face-head"><span>#</span><span>LED 명</span><span>W × H (PX)</span><span>앞 갭</span><span /></div>
        {l.faces.map((f, i) => {
          const cc = cabCount(l, f);
          return (
            <div class="face-row" key={f.id}>
              <span class="idx">{i + 1}</span>
              <input class="input fname" value={f.name} autoCapitalize="characters" aria-label="LED 명"
                onInput={(e) => up((x) => { x.faces[i].name = (e.target as HTMLInputElement).value; })} />
              <div class="fsize">
                <div class="pair-row">
                  <NumInput value={f.w} min={1} aria="W 픽셀" onChange={(v) => up((x) => { x.faces[i].w = v; })} />
                  <span class="x">×</span>
                  <NumInput value={f.h} min={1} aria="H 픽셀" onChange={(v) => up((x) => { x.faces[i].h = v; })} />
                </div>
                <span class="cab">{fmtCab(cc.c)}×{fmtCab(cc.r)} CAB</span>
              </div>
              <button class={'chip fgap' + (f.gapBefore && i > 0 ? ' on' : '')} disabled={i === 0}
                onClick={() => up((x) => { x.faces[i].gapBefore = !x.faces[i].gapBefore; })}>{f.gapBefore && i > 0 ? '갭 ON' : '갭 OFF'}</button>
              <div class="row fbtn" style="gap:2px">
                <button class="btn icon sm ghost" aria-label="왼쪽으로" disabled={i === 0}
                  onClick={() => up((x) => { [x.faces[i - 1], x.faces[i]] = [x.faces[i], x.faces[i - 1]]; })}>↑</button>
                <button class="btn icon sm ghost" aria-label="오른쪽으로" disabled={i === l.faces.length - 1}
                  onClick={() => up((x) => { [x.faces[i + 1], x.faces[i]] = [x.faces[i], x.faces[i + 1]]; })}>↓</button>
                <button class="btn icon sm ghost" aria-label="삭제" style="color:var(--danger)" disabled={l.faces.length === 1}
                  onClick={async () => { if (await ask(`"${f.name}" 면을 삭제할까요?`)) up((x) => { x.faces = x.faces.filter((ff) => ff.id !== f.id); if (x.input.manual) delete x.input.manual[f.id]; if (x.output.manual) delete x.output.manual[f.id]; }); }}>✕</button>
              </div>
            </div>
          );
        })}
        <button class="btn block sm-btn" onClick={() => up((x) => {
          const last = x.faces[x.faces.length - 1];
          x.faces.push({ id: uid(), name: 'FACE_' + (x.faces.length + 1), w: last?.w || 1280, h: last?.h || 768, gapBefore: false });
        })}>+ 면 추가</button>
      </Section>

      {/* 4. 접힌 섹션 */}
      <Section title="표시 옵션" sub="로고 · 원 · 라벨 · 태그">
        <LogoPicker led={l} />
        <OptionToggles opt={l.input.options} onChange={(o) => up((x) => { x.input.options = o; })} />
      </Section>

      <Section title="영상 설정" sub="빌드업 속도 · 페이드 · 루프 길이">
        <MotionControls led={l} />
      </Section>

      <Section title="텍스트" sub="크기 · 자간 · 행간">
        <TypoControls typo={l.typo} onChange={(t) => up((x) => { x.typo = t; })} />
      </Section>

      <Section title="좌표" sub="X · Y · W · H · AE">
        <div class="table-wrap">
          <table class="coords">
            <thead><tr><th>면</th><th class="r">X</th><th class="r">Y</th><th class="r">W</th><th class="r">H</th><th class="r">AE</th></tr></thead>
            <tbody>
              {lay.faces.map((f) => (
                <tr key={f.face.id} style={f.overflow ? 'color:var(--danger)' : ''}><td>{f.face.name}</td><td class="r">{f.x}</td><td class="r">{f.y}</td><td class="r">{f.w}</td><td class="r">{f.h}</td>
                  <td class="r" style="color:var(--accent)">{f.x + f.w / 2},{f.y + f.h / 2}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <button class="btn big block" style="margin-top:12px;border-color:var(--accent)" onClick={() => go(`/led/${id}/out`)}>
        ② 아웃풋 가이드 만들기 →
      </button>
    </div>
  );
}
