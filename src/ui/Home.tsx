import { useStore, createProject, newLed, addLed, getProject } from '../store';
import { inputLayout } from '../layout';
import { go } from './common';
import { ago, lastBackupAt, changedSinceBackup, needsBackup } from '../sync';
import { isLinked, lastDriveSync } from '../gdrive';

/** 같은 앱 안의 개별 도구 페이지 (public/tools). 오프라인 프리캐시됨 */
const TOOLS = [
  { href: 'tools/cuesheet.html', name: '큐시트 메이커', desc: '곡 번호·제목 썸네일 PNG', icon: '#' },
  { href: 'tools/border-maker.html', name: 'Border Maker', desc: '보더 · 매트 PNG', icon: '▢' },
  { href: 'tools/metal-logo.html', name: '3D 로고 루프', desc: '메탈 회전 PNG 시퀀스', icon: '◆' },
  { href: 'tools/worklog.html', name: 'VJ 근무일지', desc: '월별 근무 · PDF', icon: '▦' },
];

export function Home() {
  const s = useStore();
  const recent = s.leds
    .filter((l) => !l.deletedAt && !getProject(l.projectId)?.deletedAt)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);

  const newProject = () => {
    const p = createProject();
    const l = addLed(newLed(p.id));
    go(`/led/${l.id}/in`);
  };

  return (
    <div class="screen">
      <div class="row" style="justify-content:space-between;margin-top:8px">
        <span class={'status' + (s.online ? '' : ' off')}><i />{s.online ? 'ONLINE' : 'OFFLINE · 모든 기능 사용 가능'}</span>
      </div>
      <div class="hero-title">ZUNO'S<br />LED GUIDE<br /><em>MAKER</em></div>
      <p class="muted" style="margin:0 0 20px">LED 인풋 / 아웃풋 가이드 제작</p>

      <button class="btn primary big block" onClick={newProject}>+ 새 프로젝트</button>

      <a class={'card sync-card' + (needsBackup() ? ' accent' : '')} href="#/menu/backup">
        <span class="sync-ic">☁︎</span>
        <div class="grow">
          <div style="font-weight:600">백업 · 동기화</div>
          <div class="small muted">{isLinked() ? <>구글 드라이브 {ago(lastDriveSync())}</> : <>마지막 저장 {ago(lastBackupAt())}</>}{changedSinceBackup() > 0 && <> · 바뀐 항목 <b style="color:var(--accent)">{changedSinceBackup()}</b></>}</div>
        </div>
        {needsBackup() && <span class="chip on">{isLinked() ? "동기화" : "저장"}</span>}
      </a>

      <div class="row" style="margin-top:12px">
        <a class="card grow" href="#/recent" style="text-decoration:none;color:inherit">
          <div class="muted small">최근 내보낸 파일</div>
          <div class="num" style="font-size:32px;font-weight:600">{s.exportsMeta.length}</div>
        </a>
        <a class="card grow" href="#/projects" style="text-decoration:none;color:inherit;margin-top:0">
          <div class="muted small">프로젝트</div>
          <div class="num" style="font-size:32px;font-weight:600">{s.projects.filter((p) => !p.deletedAt).length}</div>
        </a>
      </div>

      <div class="section-title">VJ 도구</div>
      <div class="tool-grid">
        {TOOLS.map((t) => (
          <a key={t.href} class="card tool-card" href={t.href}>
            <span class="tool-ic" aria-hidden="true">{t.icon}</span>
            <span class="tool-name">{t.name}</span>
            <span class="small muted">{t.desc}</span>
          </a>
        ))}
      </div>

      <div class="section-title">이어서 작업</div>
      {recent.length === 0 && <div class="card empty">아직 LED가 없습니다</div>}
      {recent.map((l) => {
        const lay = inputLayout(l);
        return (
          <a key={l.id} class="card list-item" style="display:flex;border-bottom:1px solid var(--line)" href={`#/led/${l.id}/in`}>
            <span class="num" style="color:var(--accent);font-size:18px;width:32px">{l.number}</span>
            <div class="grow">
              <div style="font-weight:600">{l.name}</div>
              <div class="small muted">{getProject(l.projectId)?.name} · <span class="num">{lay.W}×{lay.H}</span></div>
            </div>
            <span class={'tag' + (l.input.doneAt ? ' done' : '')}>IN</span>
            <span class={'tag' + (l.output.doneAt ? ' done' : '')}>OUT</span>
          </a>
        );
      })}
    </div>
  );
}
