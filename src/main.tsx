import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';

import '@fontsource/anton/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/600.css';
import './theme.css';

import { state, set, useStore, applyAccent, answer, createProject, newBorderSet, addBorder, uid, toast } from './store';
import { loadAll, requestPersist } from './db';
import { isUnlocked } from './lock';
import { loadGuideFonts } from './render';
import { restoreSyncMeta, needsBackup } from './sync';
import { startAutoSync, handleDriveRedirect, isLinked } from './gdrive';
import { startCloud, onFirebaseHost } from './cloud';

// 구글 로그인(아이폰 리디렉션)에서 돌아온 경우: 라우터가 주소를 읽기 전에 토큰부터 처리
handleDriveRedirect();
import { createSample } from './sample';
import { Icon, CalcBar } from './ui/common';
import { Lock } from './ui/Lock';
import { Projects, ProjectView } from './ui/Projects';
import { BorderEditor } from './ui/BorderEditor';
import { ToolFrame } from './ui/ToolFrame';
import { InputGuide } from './ui/InputGuide';
import { OutputGuide } from './ui/OutputGuide';
import { Recent } from './ui/Recent';
import { Menu } from './ui/Menu';

/* ---------- 서비스 워커: 새 버전이 있으면 배너 ---------- */
let updateSW: ((reload?: boolean) => Promise<void>) | undefined;
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  updateSW = registerSW({
    onNeedRefresh() { set({ updateReady: true }); },
    onRegisteredSW(_url, reg) {
      // 앱이 열려 있는 동안 1시간마다 업데이트 확인 (온라인일 때만)
      if (reg) setInterval(() => { if (navigator.onLine) reg.update().catch(() => {}); }, 60 * 60 * 1000);
    },
  });
}

addEventListener('online', () => set({ online: true }));
addEventListener('offline', () => set({ online: false }));

function useRoute() {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => {
    const f = () => { setH(location.hash.slice(1) || '/'); window.scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h;
}

/** 예전 따로 쓰던 Border Maker(tools/border-maker.html) 설정을 프로젝트 안 보더 묶음으로 한 번만 옮김 */
function importOldBorderMaker() {
  try {
    if (localStorage.getItem('zuno.borderImported')) return;
    const raw = localStorage.getItem('borderMaker.v3');
    localStorage.setItem('zuno.borderImported', '1');
    if (!raw) return;
    const o = JSON.parse(raw);
    if (!o || !Array.isArray(o.wins) || !o.wins.length) return;
    const p = createProject('이전 Border Maker');
    const b = newBorderSet(p.id, o.W || 1920, o.H || 1080);
    b.name = '이전 보더';
    b.layers = [{
      id: uid(), name: '레이어 1', visible: true,
      wins: o.wins.map((w: any) => ({ t: w.t === 'block' ? 'block' : 'hole', x: +w.x || 0, y: +w.y || 0, w: +w.w || 1, h: +w.h || 1, b: +w.b || 0, f: +w.f || 0, r: +w.r || 0 })),
      dir: ['center', 'out', 'in'].includes(o.dir) ? o.dir : 'center', curve: ['gauss', 'smooth', 'linear'].includes(o.curve) ? o.curve : 'gauss',
      edgeOpen: o.edgeOpen !== false, mode: o.mode === 'matte' ? 'matte' : 'overlay', color: o.color || '#000000',
      opacity: typeof o.opacity === 'number' ? o.opacity : 100, invert: !!o.invert,
    }];
    addBorder(b);
  } catch { /* 저장소 차단 등 */ }
}

function App() {
  const s = useStore();
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const route = useRoute();

  useEffect(() => { isUnlocked().then(setUnlocked); }, []);

  if (unlocked === null || !s.ready) return null;
  if (!unlocked) return <Lock onUnlock={() => setUnlocked(true)} />;

  const parts = route.split('/').filter(Boolean);
  let page;
  let tab = 'projects';
  if (parts[0] === 'project' && parts[1]) page = <ProjectView id={parts[1]} key={parts[1]} />;
  else if (parts[0] === 'led' && parts[1]) {
    page = parts[2] === 'out' ? <OutputGuide id={parts[1]} key={parts[1] + 'o'} /> : <InputGuide id={parts[1]} key={parts[1] + 'i'} />;
  }
  else if (parts[0] === 'border' && parts[1]) page = <BorderEditor id={parts[1]} key={parts[1]} />;
  else if (parts[0] === 'logo') { page = <ToolFrame src="tools/metal-logo.html" title="3D 로고" />; tab = 'logo'; }
  else if (parts[0] === 'report') { page = <ToolFrame src="tools/worklog.html" title="SPVS 보고서" />; tab = 'report'; }
  else if (parts[0] === 'tool' && parts[1] === 'cuesheet') { page = <ToolFrame src="tools/cuesheet.html" title="큐시트 메이커" back="/menu" />; tab = 'menu'; }
  else if (parts[0] === 'recent') { page = <Recent />; tab = 'menu'; }
  else if (parts[0] === 'menu') { page = <Menu sub={parts[1]} />; tab = 'menu'; }
  else page = <Projects />;

  // 하단바: 프로젝트(LED 메이커·보더) / 3D 로고 / SPVS 보고서 / 더보기
  const tabs: [string, string, 'folder' | 'cube' | 'doc' | 'more', string][] = [
    ['projects', '/projects', 'folder', '프로젝트'], ['logo', '/logo', 'cube', '3D 로고'],
    ['report', '/report', 'doc', 'SPVS 보고서'], ['menu', '/menu', 'more', '더보기'],
  ];

  return (
    <>
      {page}
      <nav class="tabbar">
        {tabs.map(([k, href, ic, label]) => (
          <a key={k} href={'#' + href} class={tab === k ? 'on' : ''}><span class="tab-ic"><Icon name={ic} />{k === 'menu' && !onFirebaseHost() && !isLinked() && needsBackup() && <i class="dot" />}</span>{label}</a>
        ))}
      </nav>
      {s.updateReady && (
        <div class="banner">
          <div class="grow small"><b>업데이트 있음</b><br /><span class="muted">데이터는 그대로 유지됩니다</span></div>
          <button class="btn primary" onClick={() => updateSW?.(true)}>새로고침</button>
          <button class="btn icon ghost" aria-label="닫기" onClick={() => set({ updateReady: false })}>✕</button>
        </div>
      )}
      {s.ask && (
        <div class="modal" onClick={() => answer(false)}>
          <div class="modal-box" onClick={(e) => e.stopPropagation()}>
            <div style="white-space:pre-line">{s.ask.msg}</div>
            <div class="row" style="margin-top:16px">
              {!s.ask.info && <button class="btn grow" onClick={() => answer(false)}>취소</button>}
              <button class={'btn grow ' + (s.ask.info ? 'primary' : 'danger-fill')} onClick={() => answer(true)}>{s.ask.ok}</button>
            </div>
          </div>
        </div>
      )}
      <CalcBar />
      {s.toast && <div class="toast">{s.toast}</div>}
      {s.saveFallback && (
        <div class="fallback">
          <div class="row"><div class="grow small"><b>{s.saveFallback.type.startsWith('video') ? '최근 탭에서 "저장"을 다시 눌러 공유 → "비디오 저장"' : '이미지를 길게 눌러 "사진에 저장"'}</b><br /><span class="mono muted">{s.saveFallback.name}</span></div>
            <button class="btn" onClick={() => { URL.revokeObjectURL(s.saveFallback!.url); set({ saveFallback: null }); }}>닫기</button></div>
          {s.saveFallback.type.startsWith('video')
            ? <video src={s.saveFallback.url} controls playsInline loop muted autoPlay style="flex:1;min-height:0;width:100%" />
            : <img src={s.saveFallback.url} alt={s.saveFallback.name} />}
        </div>
      )}
    </>
  );
}

async function boot() {
  try {
    const d = await loadAll();
    Object.assign(state, { projects: d.projects, leds: d.leds, borders: d.borders, settings: d.settings, exportsMeta: d.exportsMeta });
    applyAccent();
    // 첫 실행: 샘플 프로젝트 1개
    if (d.fresh && d.projects.length === 0) createSample();
    requestPersist();
    await restoreSyncMeta();
    importOldBorderMaker();
  } catch (e) {
    console.error(e);
    alert('저장소를 열 수 없습니다. 개인정보 보호 모드인지 확인하세요.');
  }
  set({ ready: true });
  loadGuideFonts().then(() => set({ fontsReady: state.fontsReady + 1 }));
  // 새 주소(Firebase): 실시간 클라우드 동기화. 예전 주소(GitHub Pages)에선 이전용으로 드라이브 동기화만 유지
  if (onFirebaseHost()) startCloud(); else startAutoSync();
}

render(<App />, document.getElementById('app')!);
boot();
