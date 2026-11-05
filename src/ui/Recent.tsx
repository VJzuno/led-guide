import { useEffect, useState } from 'preact/hooks';
import { useStore, getProject, refreshExports, toast, ask } from '../store';
import { getExport, deleteExport } from '../db';
import { deliver, deliverMany } from '../export';
import type { ExportMeta } from '../types';
import { TopBar, Seg, timeAgo, useSelection } from './common';

export function Recent() {
  const s = useStore();
  const [f, setF] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const [busy, setBusy] = useState(false);
  const list = s.exportsMeta.filter((e) => f === 'ALL' || e.kind === f);
  const order = list.map((e) => e.id);
  const S = useSelection(order);

  const saveSel = async () => {
    setBusy(true);
    try {
      const files: { name: string; blob: Blob }[] = [];
      for (const id of S.picked) { const r = await getExport(id); if (r) files.push({ name: r.fileName, blob: r.blob }); }
      await deliverMany(files);
    } catch (e: any) { toast(e?.message || '저장 실패'); }
    setBusy(false);
  };
  const deleteSel = async () => {
    const n = S.picked.length;
    if (!n || !(await ask(`기록 ${n}개를 삭제할까요?\n저장해 둔 이미지·영상 파일은 그대로입니다.`))) return;
    for (const id of S.picked) await deleteExport(id);
    await refreshExports();
    toast(`${n}개 삭제`);
    S.exit();
  };

  return (
    <div class={'screen' + (S.mode ? ' selecting' : '')}>
      <TopBar title="최근" sub={`내보낸 파일 ${s.exportsMeta.length}개`} right={
        S.mode ? <button class="btn" onClick={S.exit}>완료</button>
          : list.length > 0 && <button class="btn ghost" onClick={() => S.setMode(true)}>선택</button>
      } />
      <Seg value={f} onChange={(v) => { setF(v); S.exit(); }} options={[['ALL', '전체'], ['IN', 'INPUT'], ['OUT', 'OUTPUT']]} />
      {S.mode && <div class="small muted" style="margin-top:8px">탭해서 선택 · PC에서는 <b>Shift+클릭</b>으로 범위 선택</div>}
      <div class="card" style="margin-top:12px">
        {list.length === 0 && <div class="empty">기록이 없습니다</div>}
        {list.map((e) => <Item key={e.id} e={e} S={S} />)}
      </div>

      {S.mode && (
        <div class="sel-bar">
          <span class="count">{busy ? '준비 중…' : `${S.picked.length}개 선택`}</span>
          <button class="btn ghost" onClick={() => (S.picked.length === order.length ? S.setMany(order, false) : S.all())}>{S.picked.length === order.length ? '전체 해제' : '전체'}</button>
          <button class="btn primary" disabled={!S.picked.length || busy} onClick={saveSel}>저장</button>
          <button class="btn danger" disabled={!S.picked.length || busy} onClick={deleteSel}>삭제</button>
        </div>
      )}
    </div>
  );
}

function Item({ e, S }: { e: ExportMeta; S: ReturnType<typeof useSelection> }) {
  const [thumb, setThumb] = useState<string>('');
  const video = e.format === 'mp4' || e.format === 'webm';
  useEffect(() => {
    let url = '';
    if (video) return;
    getExport(e.id).then((r) => { if (r) { url = URL.createObjectURL(r.blob); setThumb(url); } });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [e.id]);

  const resave = async () => {
    const r = await getExport(e.id);
    if (!r) return toast('파일을 찾을 수 없습니다');
    await deliver(r.blob, r.fileName);
  };
  const remove = async () => {
    if (!(await ask('이 기록을 삭제할까요?'))) return;
    await deleteExport(e.id);
    refreshExports();
  };
  const on = S.has(e.id);

  return (
    <div class={'list-item' + (on ? ' sel' : '')} style={S.mode ? 'cursor:pointer' : ''} onClick={(ev) => S.click(e.id, ev)}>
      {S.mode && <span class={'check' + (on ? ' on' : '')}>{on ? '✓' : ''}</span>}
      {video
        ? <div class="thumb" style="display:flex;align-items:center;justify-content:center;font-family:var(--f-mono);font-size:10px;color:var(--accent)">{e.variant || 'MP4'}</div>
        : thumb ? <img class="thumb" src={thumb} alt="" /> : <div class="thumb" />}
      <div class="grow" style="min-width:0">
        <div class="mono small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{e.fileName}</div>
        <div class="small muted">
          <span class="tag" style="margin-right:6px">{e.kind}{e.variant ? ' · ' + e.variant : ''}</span>
          {getProject(e.projectId)?.name || '삭제된 프로젝트'} · <span class="num">{timeAgo(e.createdAt)}</span>
        </div>
      </div>
      {!S.mode && <>
        <button class="btn" onClick={(ev) => { ev.stopPropagation(); resave(); }}>저장</button>
        <button class="btn icon ghost" aria-label="기록 삭제" onClick={(ev) => { ev.stopPropagation(); remove(); }}>✕</button>
      </>}
    </div>
  );
}
