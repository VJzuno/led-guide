import { useState } from 'preact/hooks';
import {
  useStore, liveProjects, ledsOf, createProject, updateProject, duplicateProject, trashProject,
  newLed, addLed, duplicateLed, trashLed, toast,
} from '../store';
import { inputLayout } from '../layout';
import { TopBar, go } from './common';

export function Projects() {
  useStore();
  const list = liveProjects();
  return (
    <div class="screen">
      <TopBar title="프로젝트" right={<button class="btn primary" onClick={() => createProject()}>+ 새 프로젝트</button>} />
      {list.length === 0 && <div class="card empty">프로젝트가 없습니다</div>}
      {list.map((p) => <ProjectCard key={p.id} id={p.id} name={p.name} />)}
    </div>
  );
}

function ProjectCard({ id, name }: { id: string; name: string }) {
  const [edit, setEdit] = useState(false);
  const [menu, setMenu] = useState(false);
  const leds = ledsOf(id);
  return (
    <div class="card">
      <div class="row">
        {edit ? (
          <input class="input grow" autoFocus value={name}
            onInput={(e) => updateProject(id, { name: (e.target as HTMLInputElement).value })}
            onBlur={() => setEdit(false)} onKeyDown={(e) => e.key === 'Enter' && setEdit(false)} />
        ) : (
          <h3 class="grow" onClick={() => setEdit(true)}>{name || '이름 없음'}</h3>
        )}
        <button class="btn icon ghost" aria-label="프로젝트 메뉴" onClick={() => setMenu(!menu)}>⋯</button>
      </div>
      {menu && (
        <div class="row wrap" style="margin:10px 0">
          <button class="btn" onClick={() => { setEdit(true); setMenu(false); }}>이름 변경</button>
          <button class="btn" onClick={() => { duplicateProject(id); setMenu(false); toast('프로젝트 복제됨'); }}>복제</button>
          <button class="btn danger" onClick={() => { trashProject(id); toast('휴지통으로 이동 · 메뉴에서 복구'); }}>삭제</button>
        </div>
      )}
      <div style="margin-top:8px">
        {leds.map((l) => {
          const lay = inputLayout(l);
          return (
            <div key={l.id} class="led-row">
              <span class="no" onClick={() => go(`/led/${l.id}/in`)}>{l.number}</span>
              <a href={`#/led/${l.id}/in`} style="text-decoration:none;color:inherit;min-width:0">
                <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{l.name}</div>
                <div class="small muted num">{lay.W}×{lay.H} · {l.faces.length}면</div>
              </a>
              <div class="row" style="gap:4px">
                <a class={'tag' + (l.input.doneAt ? ' done' : '')} href={`#/led/${l.id}/in`} style="text-decoration:none">IN</a>
                <a class={'tag' + (l.output.doneAt ? ' done' : '')} href={`#/led/${l.id}/out`} style="text-decoration:none">OUT</a>
                <LedMenu id={l.id} />
              </div>
            </div>
          );
        })}
      </div>
      <button class="btn block" style="margin-top:10px" onClick={() => { const l = addLed(newLed(id)); go(`/led/${l.id}/in`); }}>+ LED 추가</button>
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
