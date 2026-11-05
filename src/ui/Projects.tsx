import { useState } from 'preact/hooks';
import {
  useStore, liveProjects, ledsOf, createProject, updateProject, duplicateProject, trashProject,
  newLed, addLed, duplicateLed, trashLed, toast, ask, getLed,
} from '../store';
import { inputLayout } from '../layout';
import { exportPngMany } from '../export';
import type { GuideKind, Led } from '../types';
import { TopBar, go, useSelection } from './common';

export function Projects() {
  useStore();
  const list = liveProjects();
  const order = list.flatMap((p) => ledsOf(p.id).map((l) => l.id));
  const S = useSelection(order);
  const [busy, setBusy] = useState('');

  const picked = S.picked.map(getLed).filter(Boolean) as Led[];
  const doExport = async (kinds: GuideKind[]) => {
    if (!picked.length) return;
    try {
      await exportPngMany(picked, kinds, (d, t) => setBusy(`렌더링 ${d}/${t}`));
      toast(`${picked.length * kinds.length}개 PNG 저장`);
    } catch (e: any) { toast(e?.message || '실패'); }
    setBusy('');
  };
  const doDelete = async () => {
    if (!picked.length) return;
    if (!(await ask(`LED ${picked.length}개를 휴지통으로 옮길까요?\n메뉴 → 휴지통에서 복구할 수 있습니다.`, '휴지통으로'))) return;
    picked.forEach((l) => trashLed(l.id));
    toast(`${picked.length}개 휴지통으로 이동`);
    S.exit();
  };
  const doDuplicate = () => { picked.forEach((l) => duplicateLed(l.id)); toast(`${picked.length}개 복제`); S.exit(); };

  return (
    <div class={'screen' + (S.mode ? ' selecting' : '')}>
      <TopBar title="프로젝트" right={
        S.mode
          ? <button class="btn" onClick={S.exit}>완료</button>
          : <div class="row" style="gap:6px">
              {order.length > 0 && <button class="btn ghost" onClick={() => S.setMode(true)}>선택</button>}
              <button class="btn primary" onClick={() => createProject()}>+ 새 프로젝트</button>
            </div>
      } />
      {S.mode && <div class="small muted" style="margin:-4px 0 8px">탭해서 선택 · PC에서는 <b>Shift+클릭</b>으로 범위 선택, <b>⌘/Ctrl+클릭</b>으로 하나씩</div>}
      {list.length === 0 && <div class="card empty">프로젝트가 없습니다</div>}
      {list.map((p) => <ProjectCard key={p.id} id={p.id} name={p.name} S={S} />)}

      {S.mode && (
        <div class="sel-bar">
          <span class="count">{busy || `${picked.length}개 선택`}</span>
          <button class="btn ghost" onClick={() => (picked.length === order.length ? S.setMany(order, false) : S.all())}>{picked.length === order.length ? '전체 해제' : '전체'}</button>
          <button class="btn" disabled={!picked.length || !!busy} onClick={() => doExport(['IN'])}>IN PNG</button>
          <button class="btn" disabled={!picked.length || !!busy} onClick={() => doExport(['OUT'])}>OUT PNG</button>
          <button class="btn primary" disabled={!picked.length || !!busy} onClick={() => doExport(['IN', 'OUT'])}>IN+OUT</button>
          <button class="btn" disabled={!picked.length || !!busy} onClick={doDuplicate}>복제</button>
          <button class="btn danger" disabled={!picked.length || !!busy} onClick={doDelete}>삭제</button>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ id, name, S }: { id: string; name: string; S: ReturnType<typeof useSelection> }) {
  const [edit, setEdit] = useState(false);
  const [menu, setMenu] = useState(false);
  const leds = ledsOf(id);
  const ids = leds.map((l) => l.id);
  const allOn = ids.length > 0 && ids.every(S.has);
  return (
    <div class="card">
      <div class="row">
        {S.mode && ids.length > 0 && (
          <button class={'check' + (allOn ? ' on' : '')} aria-label="이 프로젝트 전체 선택" style="background:none" onClick={() => S.setMany(ids, !allOn)}>
            {allOn ? '✓' : ''}
          </button>
        )}
        {edit ? (
          <input class="input grow" autoFocus value={name}
            onInput={(e) => updateProject(id, { name: (e.target as HTMLInputElement).value })}
            onBlur={() => setEdit(false)} onKeyDown={(e) => e.key === 'Enter' && setEdit(false)} />
        ) : (
          <h3 class="grow" onClick={() => (S.mode ? S.setMany(ids, !allOn) : setEdit(true))}>{name || '이름 없음'}</h3>
        )}
        {!S.mode && <button class="btn icon ghost" aria-label="프로젝트 메뉴" onClick={() => setMenu(!menu)}>⋯</button>}
      </div>
      {menu && !S.mode && (
        <div class="row wrap" style="margin:10px 0">
          <button class="btn" onClick={() => { setEdit(true); setMenu(false); }}>이름 변경</button>
          <button class="btn" onClick={() => { duplicateProject(id); setMenu(false); toast('프로젝트 복제됨'); }}>복제</button>
          <button class="btn danger" onClick={() => { trashProject(id); toast('휴지통으로 이동 · 메뉴에서 복구'); }}>삭제</button>
        </div>
      )}
      <div style="margin-top:8px">
        {leds.map((l) => {
          const lay = inputLayout(l);
          const on = S.has(l.id);
          return (
            <div key={l.id} class={'led-row' + (S.mode ? ' selecting' : '') + (on ? ' sel' : '')}
              onClick={(e) => { if (!S.click(l.id, e)) go(`/led/${l.id}/in`); }}>
              {S.mode && <span class={'check' + (on ? ' on' : '')}>{on ? '✓' : ''}</span>}
              <span class="no">{l.number}</span>
              <div style="min-width:0">
                <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{l.name}</div>
                <div class="small muted num">{lay.W}×{lay.H} · {l.faces.length}면</div>
              </div>
              {!S.mode && (
                <div class="row" style="gap:4px" onClick={(e) => e.stopPropagation()}>
                  <a class={'tag' + (l.input.doneAt ? ' done' : '')} href={`#/led/${l.id}/in`} style="text-decoration:none">IN</a>
                  <a class={'tag' + (l.output.doneAt ? ' done' : '')} href={`#/led/${l.id}/out`} style="text-decoration:none">OUT</a>
                  <LedMenu id={l.id} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!S.mode && <button class="btn block" style="margin-top:10px" onClick={() => { const l = addLed(newLed(id)); go(`/led/${l.id}/in`); }}>+ LED 추가</button>}
    </div>
  );
}

function LedMenu({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button class="btn icon ghost" aria-label="LED 메뉴" onClick={() => setOpen(true)}>⋯</button>;
  return (
    <div class="row" style="gap:4px">
      <button class="chip" onClick={() => { duplicateLed(id); setOpen(false); toast('LED 복제됨'); }}>복제</button>
      <button class="chip" style="color:var(--danger)" onClick={() => { trashLed(id); toast('휴지통으로 이동'); }}>삭제</button>
      <button class="chip" onClick={() => setOpen(false)}>✕</button>
    </div>
  );
}
