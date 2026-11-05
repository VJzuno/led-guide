import { useStore, getLed, getProject, updateLed } from '../store';
import { outputLayout, coordsText } from '../layout';
import { copyText } from '../export';
import type { Led, OutputPreset, Flow, Align } from '../types';
import { TopBar, NumInput, Seg, Section, OptionToggles, TypoControls, GuidePreview, ExportButtons, LogoPicker, go } from './common';

export function OutputGuide({ id }: { id: string }) {
  useStore();
  const l = getLed(id);
  if (!l || l.deletedAt) return <div class="screen"><TopBar title="LED 없음" back="/projects" /></div>;
  const lay = outputLayout(l);
  const o = l.output;
  const up = (fn: (x: Led) => void) => updateLed(id, (x) => { fn(x); return x; });

  return (
    <div class="screen compact">
      <TopBar title={`${l.number} ${l.name}`} sub={`${getProject(l.projectId)?.name ?? ''} · ② 아웃풋 가이드`} back={`/led/${id}/in`}
        right={<button class="btn" onClick={() => go(`/led/${id}/in`)}>← ① 인풋</button>} />

      {/* 1. 출력 캔버스 크기 먼저 */}
      <div class="canvas-row">
        <span class="lbl">출력 캔버스</span>
        <Seg<OutputPreset> value={o.preset} onChange={(v) => up((x) => { x.output.preset = v; })}
          options={[['UHD', '4K UHD'], ['DCI', 'DCI 4K'], ['FHD', 'FHD'], ['CUSTOM', '직접']]} />
        {o.preset === 'CUSTOM' ? (
          <div class="pair-row grow">
            <NumInput value={o.customW} min={1} aria="W" onChange={(v) => up((x) => { x.output.customW = v; })} />
            <span class="x">×</span>
            <NumInput value={o.customH} min={1} aria="H" onChange={(v) => up((x) => { x.output.customH = v; })} />
          </div>
        ) : <span class="num small muted">{lay.W} × {lay.H}</span>}
      </div>

      {/* 2. 프리뷰 (위치 편집 가능) */}
      <GuidePreview led={l} kind="OUT" motion={false} />
      <div class="meter"><i style={{ width: Math.min(100, lay.usage * 100) + '%' }} /></div>
      <div class="stat">
        <span>사용률 <b>{(lay.usage * 100).toFixed(1)}%</b></span>
        <span>콘텐츠 <b>{lay.contentW}×{lay.contentH}</b></span>
        <span>캔버스 <b>{lay.W}×{lay.H}</b></span>
      </div>
      {lay.overflow && <div class="warn">일부 면이 캔버스를 넘칩니다 (빨간 점선)</div>}

      <ExportButtons led={l} kind="OUT" video={false} onCopy={() => copyText(coordsText(l, lay))} />

      {/* 3. 자동 배치 규칙 */}
      <Section title="자동 배치" sub={o.manual ? '수동 배치 중' : undefined} open>
        <div class="opt-grid">
          <span class="lbl">갭</span>
          <Seg<'rm' | 'keep'> value={o.keepGap ? 'keep' : 'rm'} onChange={(v) => up((x) => { x.output.keepGap = v === 'keep'; })}
            options={[['rm', '제거'], ['keep', '유지']]} />
          <span class="lbl">방향</span>
          <Seg<Flow> value={o.flow} onChange={(v) => up((x) => { x.output.flow = v; })}
            options={[['row-wrap', '가로 → 다음 줄'], ['column-wrap', '세로 → 다음 열']]} />
          <span class="lbl">정렬</span>
          <Seg<Align> value={o.align} onChange={(v) => up((x) => { x.output.align = v; })}
            options={[['top-left', '왼쪽 위'], ['center', '가운데']]} />
        </div>
        {o.manual && <button class="btn block sm-btn" style="margin-top:8px" onClick={() => up((x) => { delete x.output.manual; })}>수동 위치 지우고 자동 배치로</button>}
      </Section>

      {/* 4. 접힌 섹션 */}
      <Section title="표시 옵션" sub="로고 · 원 · 라벨 · 태그">
        <LogoPicker led={l} />
        <OptionToggles opt={o.options} onChange={(op) => up((x) => { x.output.options = op; })} />
      </Section>

      <Section title="텍스트" sub="크기 · 자간 · 행간">
        <TypoControls typo={l.typo} onChange={(t) => up((x) => { x.typo = t; })} />
      </Section>

      <Section title="좌표" sub="인풋 → 아웃풋">
        <div class="table-wrap">
          <table class="coords">
            <thead><tr><th>면</th><th class="r">IN X</th><th></th><th class="r">OUT X,Y</th><th class="r">W×H</th><th class="r">AE</th></tr></thead>
            <tbody>
              {lay.faces.map((f) => (
                <tr key={f.face.id} style={f.overflow ? 'color:var(--danger)' : ''}>
                  <td>{f.face.name}</td><td class="r">{f.inX}</td><td class="muted">→</td>
                  <td class="r">{f.x},{f.y}</td><td class="r">{f.w}×{f.h}</td>
                  <td class="r" style="color:var(--accent)">{f.x + f.w / 2},{f.y + f.h / 2}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
