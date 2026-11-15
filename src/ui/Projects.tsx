import { useState } from 'preact/hooks';
import {
  useStore, liveProjects, ledsOf, createProject, updateProject, duplicateProject, trashProject, getProject,
  newLed, addLed, duplicateLed, trashLed, toast, ask, getLed,
  bordersOf, addBorder, newBorderSet, duplicateBorder, trashBorder,
} from '../store';
import { ago, lastBackupAt, changedSinceBackup, needsBackup } from '../sync';
import { isLinked, lastDriveSync } from '../gdrive';
import { inputLayout } from '../layout';
import { exportPngMany } from '../export';
import type { GuideKind, Led } from '../types';
import { TopBar, go, useSelection, timeAgo } from './common';

export function Projects() {
  useStore();
  const list = liveProjects();
  return (
    <div class="screen">
      <div class="brand-row"><span class="brand">Zuno Workspace</span></div>
      <TopBar title="프로젝트" right={<button class="btn primary" onClick={() => { const p = createProject(); go(`/project/${p.id}`); }}>+ 새 프로젝트</button>} />
      <SyncHint />
      {list.length === 0 && <div class="card empty">프로젝트가 없습니다. <b>+ 새 프로젝트</b>로 시작하세요.</div>}
      <div class="proj-grid">
        {list.map((p) => {
          const leds = ledsOf(p.id), bs = bordersOf(p.id);
          const last = Math.max(p.updatedAt, ...leds.map((l) => l.updatedAt), ...bs.map((b) => b.updatedAt));
          return (
            <a key={p.id} class="card proj-card" href={`#/project/${p.id}`}>
              <div class="proj-name">{p.name || '이름 없음'}</div>
              <div class="row wrap" style="gap:6px;margin-top:8px">
                <span class="tag">LED {leds.length}</span>
                <span class="tag">보더 {bs.length}</span>
              </div>
              <div class="small muted num" style="margin-top:8px">{timeAgo(last)}</div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

/** 바뀐 게 있고 오래 동기화 안 했으면 작은 안내 */
function SyncHint() {
  if (!needsBackup()) return null;
  return (
    <a class="card sync-card accent" href="#/menu/backup" style="margin-bottom:12px">
      <span class="sync-ic">☁︎</span>
      <div class="grow"><div style="font-weight:600">백업 · 동기화</div>
        <div class="small muted">{isLinked() ? <>구글 드라이브 {ago(lastDriveSync())}</> : <>마지막 저장 {ago(lastBackupAt())}</>} · 바뀐 항목 <b style="color:var(--accent)">{changedSinceBackup()}</b></div></div>
      <span class="chip on">{isLinked() ? '동기화' : '저장'}</span>
    </a>
  );
}

/** 프로젝트 하나: LED 메이커 + 보더 */
export function ProjectView({ id }: { id: string }) {
  useStore();
  const p = getProject(id);
  const leds = ledsOf(id);
  const order = leds.map((l) => l.id);
  const S = useSelection(order);
  const [busy, setBusy] = useState('');
  const [menu, setMenu] = useState(false);
  if (!p || p.deletedAt) return <div class="screen"><TopBar title="프로젝트 없음" back="/projects" /></div>;

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
    if (!(await ask(`LED ${picked.length}개를 휴지통으로 옮길까요?\n더보기 → 휴지통에서 복구할 수 있습니다.`, '휴지통으로'))) return;
    picked.forEach((l) => trashLed(l.id));
    toast(`${picked.length}개 휴지통으로 이동`);
    S.exit();
  };
  const doDuplicate = () => { picked.forEach((l) => duplicateLed(l.id)); toast(`${picked.length}개 복제`); S.exit(); };
  const borders = bordersOf(id);

  return (
    <div class={'screen' + (S.mode ? ' selecting' : '')}>
      <TopBar title={p.name || '이름 없음'} sub="프로젝트" back="/projects" right={
        S.mode ? <button class="btn" onClick={S.exit}>완료</button>
          : <button class="btn icon ghost" aria-label="프로젝트 메뉴" onClick={() => setMenu(!menu)}>⋯</button>
      } />
      {menu && !S.mode && (
        <div class="card stack" style="margin-bottom:12px">
          <input class="input" value={p.name} aria-label="프로젝트 이름" onInput={(e) => updateProject(id, { name: (e.target as HTMLInputElement).value })} />
          <div class="row wrap">
            <button class="btn" onClick={() => { duplicateProject(id); setMenu(false); toast('프로젝트 복제됨'); }}>복제</button>
            <button class="btn danger" onClick={async () => { if (await ask('프로젝트를 휴지통으로 옮길까요?\n더보기 → 휴지통에서 복구할 수 있습니다.', '휴지통으로')) { trashProject(id); go('/projects'); toast('휴지통으로 이동'); } }}>삭제</button>
            <button class="btn ghost" onClick={() => setMenu(false)}>닫기</button>
          </div>
        </div>
      )}

      <div class="section-title"><span class="step">▦</span> LED 메이커 <span class="muted small">{leds.length}</span>
        <span class="spacer" />{!S.mode && leds.length > 0 && <button class="btn ghost sm-head" onClick={() => S.setMode(true)}>선택</button>}</div>
      {S.mode && <div class="small muted" style="margin:-4px 0 8px">탭해서 선택 · PC에서는 <b>Shift+클릭</b>으로 범위, <b>⌘/Ctrl+클릭</b>으로 하나씩</div>}
      <div class="card">
        {leds.length === 0 && <div class="small muted">아직 LED가 없어요.</div>}
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
        {!S.mode && <button class="btn block" style="margin-top:10px" onClick={() => { const l = addLed(newLed(id)); go(`/led/${l.id}/in`); }}>+ LED 추가</button>}
      </div>

      {!S.mode && <>
        <div class="section-title"><span class="step">▢</span> 보더 <span class="muted small">{borders.length}</span></div>
        <div class="card">
          {borders.length === 0 && <div class="small muted">보더 묶음이 없어요. 묶음 하나에 레이어(보더 PNG)를 여러 장 넣을 수 있어요.</div>}
          {borders.map((b) => (
            <div key={b.id} class="led-row" onClick={() => go(`/border/${b.id}`)}>
              <span class="no">▢</span>
              <div style="min-width:0">
                <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{b.name}</div>
                <div class="small muted num">{b.W}×{b.H} · 레이어 {b.layers.length}</div>
              </div>
              <div class="row" style="gap:4px" onClick={(e) => e.stopPropagation()}><BorderMenu id={b.id} /></div>
            </div>
          ))}
          <button class="btn block" style="margin-top:10px" onClick={() => { const b = addBorder(newBorderSet(id)); go(`/border/${b.id}`); }}>+ 보더 묶음 추가</button>
        </div>
      </>}

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

function BorderMenu({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button class="btn icon ghost" aria-label="보더 메뉴" onClick={() => setOpen(true)}>⋯</button>;
  return (
    <div class="row" style="gap:4px">
      <button class="chip" onClick={() => { duplicateBorder(id); setOpen(false); toast('보더 묶음 복제됨'); }}>복제</button>
      <button class="chip" style="color:var(--danger)" onClick={() => { trashBorder(id); toast('휴지통으로 이동'); }}>삭제</button>
      <button class="chip" onClick={() => setOpen(false)}>✕</button>
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
