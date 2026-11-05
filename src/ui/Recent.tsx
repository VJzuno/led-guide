import { useEffect, useState } from 'preact/hooks';
import { useStore, getProject, refreshExports, toast, ask } from '../store';
import { getExport, deleteExport } from '../db';
import { deliver } from '../export';
import type { ExportMeta } from '../types';
import { TopBar, Seg, timeAgo } from './common';

export function Recent() {
  const s = useStore();
  const [f, setF] = useState<'ALL' | 'IN' | 'OUT'>('ALL');
  const list = s.exportsMeta.filter((e) => f === 'ALL' || e.kind === f);
  return (
    <div class="screen">
      <TopBar title="최근" sub={`내보낸 PNG ${s.exportsMeta.length}개`} />
      <Seg value={f} onChange={setF} options={[['ALL', '전체'], ['IN', 'INPUT'], ['OUT', 'OUTPUT']]} />
      <div class="card" style="margin-top:12px">
        {list.length === 0 && <div class="empty">기록이 없습니다</div>}
        {list.map((e) => <Item key={e.id} e={e} />)}
      </div>
    </div>
  );
}

function Item({ e }: { e: ExportMeta }) {
  const [thumb, setThumb] = useState<string>('');
  useEffect(() => {
    let url = '';
    if (e.format === 'mp4' || e.format === 'webm') return;
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

  return (
    <div class="list-item">
      {e.format === 'mp4' || e.format === 'webm'
        ? <div class="thumb" style="display:flex;align-items:center;justify-content:center;font-family:var(--f-mono);font-size:10px;color:var(--accent)">{e.variant || 'MP4'}</div>
        : thumb ? <img class="thumb" src={thumb} alt="" /> : <div class="thumb" />}
      <div class="grow" style="min-width:0">
        <div class="mono small" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{e.fileName}</div>
        <div class="small muted">
          <span class="tag" style="margin-right:6px">{e.kind}{e.variant ? ' · ' + e.variant : ''}</span>
          {getProject(e.projectId)?.name || '삭제된 프로젝트'} · <span class="num">{timeAgo(e.createdAt)}</span>
        </div>
      </div>
      <button class="btn" onClick={resave}>저장</button>
      <button class="btn icon ghost" aria-label="기록 삭제" onClick={remove}>✕</button>
    </div>
  );
}
