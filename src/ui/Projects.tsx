import { useState } from 'preact/hooks';
import {
  useStore, liveProjects, ledsOf, createProject, updateProject, duplicateProject, trashProject, getProject,
  addLed, duplicateLed, trashLed, toast, ask, getLed,
  bordersOf, addBorder, newBorderSet, duplicateBorder, trashBorder,
  showsOf, ledsOfShow, bordersOfShow, showSize, addShow, updateShow, removeShow, duplicateShow, newLedInShow, syncShowBorders, moveLedToShow,
} from '../store';
import { useEffect } from 'preact/hooks';
import type { Show } from '../types';
import { inputLayout } from '../layout';
import { exportPngMany } from '../export';
import type { GuideKind, Led } from '../types';
import { TopBar, AppHeader, go, useSelection, timeAgo } from './common';
import { onFirebaseHost } from '../cloud';

export function Projects() {
  useStore();
  const list = liveProjects();
  return (
    <div class="screen has-header">
      <AppHeader title="프로젝트" right={<button class="ah-round" aria-label="새 프로젝트" onClick={() => { const p = createProject(); go(`/project/${p.id}`); }}>+</button>} />
      {!onFirebaseHost() && (
        <a class="card sync-card accent" href="#/menu/backup" style="margin:0 0 12px">
          <span class="sync-ic">→</span>
          <div class="grow"><div style="font-weight:600">새 주소로 옮겨 주세요</div><div class="small muted">zuno-workspace.web.app · 실시간 동기화</div></div>
          <span class="chip on">방법</span>
        </a>
      )}
      {list.length === 0 && <div class="card empty">프로젝트가 없습니다. <b>+ 새 프로젝트</b>로 시작하세요.</div>}
      <div class="proj-grid">
        {list.map((p) => {
          const leds = ledsOf(p.id), bs = bordersOf(p.id);
          const last = Math.max(p.updatedAt, ...leds.map((l) => l.updatedAt), ...bs.map((b) => b.updatedAt));
          return (
            <a key={p.id} class="card proj-card" href={`#/project/${p.id}`}>
              <div class="proj-name">{p.name || '이름 없음'}</div>
              <div class="row wrap" style="gap:6px;margin-top:8px">
                <span class="tag">공연 {showsOf(p).length}</span>
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

/** 프로젝트 하나: LED 메이커 + 보더 */
export function ProjectView({ id }: { id: string }) {
  useStore();
  const p = getProject(id);
  const leds = ledsOf(id);
  const order = leds.map((l) => l.id);
  const S = useSelection(order);
  const [busy, setBusy] = useState('');
  const [menu, setMenu] = useState(false);
  useEffect(() => { syncShowBorders(id); });
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
  const shows = showsOf(p);

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

      <div class="section-title"><span class="step">▦</span> 공연 <span class="muted small">{shows.length}</span>
        <span class="spacer" />{!S.mode && leds.length > 0 && <button class="btn ghost sm-head" onClick={() => S.setMode(true)}>선택</button>}</div>
      {S.mode && <div class="small muted" style="margin:-4px 0 8px">탭해서 선택 · PC에서는 <b>Shift+클릭</b>으로 범위, <b>⌘/Ctrl+클릭</b>으로 하나씩</div>}
      {shows.map((s) => <ShowBlock key={s.id} pid={id} show={s} S={S} canDelete={shows.length > 1} />)}
      {!S.mode && <button class="btn block ghost add-show" onClick={() => { addShow(id); toast('공연 추가됨'); }}>+ 공연 추가</button>}

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

/** 공연 하나: 같은 LED 해상도로 묶인 LED 가이드 + 보더 */
function ShowBlock({ pid, show, S, canDelete }: { pid: string; show: Show; S: ReturnType<typeof useSelection>; canDelete: boolean }) {
  const [menu, setMenu] = useState(false);
  const leds = ledsOfShow(pid, show.id);
  const borders = bordersOfShow(pid, show.id);
  const sz = showSize(pid, show.id);
  return (
    <div class="card show-card">
      <div class="show-head">
        <div style="min-width:0">
          <div class="show-name">{show.name || '공연'}</div>
          <div class="small muted num">{sz ? <>LED <b class="show-res">{sz.w}×{sz.h}</b>{sz.ref ? ` · 기준 ${sz.ref.name}` : ' · 직접 지정'}</> : 'LED를 추가하면 해상도가 정해져요'}</div>
        </div>
        {!S.mode && <button class="btn icon ghost" aria-label="공연 메뉴" onClick={() => setMenu(!menu)}>⋯</button>}
      </div>
      {menu && !S.mode && (
        <div class="stack show-menu">
          <input class="input" value={show.name} aria-label="공연 이름" onInput={(e) => updateShow(pid, show.id, { name: (e.target as HTMLInputElement).value })} />
          <div class="row wrap" style="gap:6px">
            <button class="btn" onClick={() => { duplicateShow(pid, show.id); setMenu(false); toast('공연 복제됨'); }}>복제</button>
            {canDelete && <button class="btn danger" onClick={async () => {
              if (await ask(`"${show.name}" 공연을 삭제할까요?\n안의 LED ${leds.length}개 · 보더 ${borders.length}개는 휴지통으로 갑니다.`, '삭제')) { removeShow(pid, show.id); toast('공연 삭제됨'); }
            }}>삭제</button>}
            <button class="btn ghost" onClick={() => setMenu(false)}>닫기</button>
          </div>
        </div>
      )}

      <div class="show-sub">LED 가이드</div>
      {leds.length === 0 && <div class="small muted show-empty">아직 LED가 없어요.</div>}
      {leds.map((l) => {
        const lay = inputLayout(l);
        const on = S.has(l.id);
        const off = sz && (lay.W !== sz.w || lay.H !== sz.h);
        return (
          <div key={l.id} class={'led-row' + (S.mode ? ' selecting' : '') + (on ? ' sel' : '')}
            onClick={(e) => { if (!S.click(l.id, e)) go(`/led/${l.id}/in`); }}>
            {S.mode && <span class={'check' + (on ? ' on' : '')}>{on ? '✓' : ''}</span>}
            <span class="no">{l.number}</span>
            <div style="min-width:0">
              <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{l.name}</div>
              <div class="small muted num">{lay.W}×{lay.H} · {l.faces.length}면{off && <span class="warn"> · 해상도 다름</span>}</div>
            </div>
            {!S.mode && (
              <div class="row" style="gap:4px" onClick={(e) => e.stopPropagation()}>
                <a class={'tag' + (l.input.doneAt ? ' done' : '')} href={`#/led/${l.id}/in`} style="text-decoration:none">IN</a>
                <a class={'tag' + (l.output.doneAt ? ' done' : '')} href={`#/led/${l.id}/out`} style="text-decoration:none">OUT</a>
                <LedMenu id={l.id} pid={pid} sid={show.id} />
              </div>
            )}
          </div>
        );
      })}

      {!S.mode && <>
        <div class="show-sub">보더</div>
        {borders.length === 0 && <div class="small muted show-empty">보더 묶음이 없어요. 공연 LED 해상도로 만들어져요.</div>}
        {borders.map((b) => (
          <div key={b.id} class="led-row" onClick={() => go(`/border/${b.id}`)}>
            <span class="no">▢</span>
            <div style="min-width:0">
              <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{b.name}</div>
              <div class="small muted num">{b.W}×{b.H} · 레이어 {b.layers.length}{b.follow === false && ' · 직접 크기'}</div>
            </div>
            <div class="row" style="gap:4px" onClick={(e) => e.stopPropagation()}><BorderMenu id={b.id} /></div>
          </div>
        ))}
        <div class="show-add">
          <button class="btn" onClick={() => { const l = addLed(newLedInShow(pid, show.id)); go(`/led/${l.id}/in`); }}>+ LED</button>
          <button class="btn" onClick={() => { const b = addBorder(newBorderSet(pid, show.id)); go(`/border/${b.id}`); }}>+ 보더</button>
        </div>
      </>}
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

function LedMenu({ id, pid, sid }: { id: string; pid: string; sid: string }) {
  const [open, setOpen] = useState<false | 'menu' | 'move'>(false);
  if (!open) return <button class="btn icon ghost" aria-label="LED 메뉴" onClick={() => setOpen('menu')}>⋯</button>;
  const p = getProject(pid);
  if (open === 'move') {
    const others = p ? showsOf(p).filter((s) => s.id !== sid) : [];
    const move = (to: string | 'new') => { moveLedToShow(id, to); setOpen(false); toast(to === 'new' ? '새 공연으로 옮김' : '공연 옮김'); };
    return (
      <div class="row" style="gap:4px;flex-wrap:wrap;justify-content:flex-end">
        {others.map((s) => <button key={s.id} class="chip" onClick={() => move(s.id)}>{s.name}</button>)}
        <button class="chip on" onClick={() => move('new')}>+ 새 공연</button>
        <button class="chip" onClick={() => setOpen(false)}>✕</button>
      </div>
    );
  }
  return (
    <div class="row" style="gap:4px">
      <button class="chip" onClick={() => setOpen('move')}>공연 옮기기</button>
      <button class="chip" onClick={() => { duplicateLed(id); setOpen(false); toast('LED 복제됨'); }}>복제</button>
      <button class="chip" style="color:var(--danger)" onClick={() => { trashLed(id); toast('휴지통으로 이동'); }}>삭제</button>
      <button class="chip" onClick={() => setOpen(false)}>✕</button>
    </div>
  );
}
