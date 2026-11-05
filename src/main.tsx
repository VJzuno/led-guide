import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';

import '@fontsource/anton/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '@fontsource/ibm-plex-sans-kr/400.css';
import '@fontsource/ibm-plex-sans-kr/600.css';
import './theme.css';

import { state, set, useStore, applyAccent, answer } from './store';
import { loadAll, requestPersist } from './db';
import { isUnlocked } from './lock';
import { loadGuideFonts } from './render';
import { createSample } from './sample';
import { Icon } from './ui/common';
import { Lock } from './ui/Lock';
import { Home } from './ui/Home';
import { Projects } from './ui/Projects';
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

function App() {
  const s = useStore();
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const route = useRoute();

  useEffect(() => { isUnlocked().then(setUnlocked); }, []);

  if (unlocked === null || !s.ready) return null;
  if (!unlocked) return <Lock onUnlock={() => setUnlocked(true)} />;

  const parts = route.split('/').filter(Boolean);
  let page;
  let tab = 'home';
  if (parts[0] === 'projects') { page = <Projects />; tab = 'projects'; }
  else if (parts[0] === 'led' && parts[1]) {
    page = parts[2] === 'out' ? <OutputGuide id={parts[1]} key={parts[1] + 'o'} /> : <InputGuide id={parts[1]} key={parts[1] + 'i'} />;
    tab = 'projects';
  }
  else if (parts[0] === 'recent') { page = <Recent />; tab = 'recent'; }
  else if (parts[0] === 'menu') { page = <Menu sub={parts[1]} />; tab = 'menu'; }
  else page = <Home />;

  const tabs: [string, string, 'home' | 'folder' | 'clock' | 'menu', string][] = [
    ['home', '/', 'home', '홈'], ['projects', '/projects', 'folder', '프로젝트'],
    ['recent', '/recent', 'clock', '최근'], ['menu', '/menu', 'menu', '메뉴'],
  ];

  return (
    <>
      {page}
      <nav class="tabbar">
        {tabs.map(([k, href, ic, label]) => (
          <a key={k} href={'#' + href} class={tab === k ? 'on' : ''}><Icon name={ic} />{label}</a>
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
              <button class="btn grow" onClick={() => answer(false)}>취소</button>
              <button class="btn grow danger-fill" onClick={() => answer(true)}>{s.ask.ok}</button>
            </div>
          </div>
        </div>
      )}
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
    Object.assign(state, { projects: d.projects, leds: d.leds, settings: d.settings, exportsMeta: d.exportsMeta });
    applyAccent();
    // 첫 실행: 샘플 프로젝트 1개
    if (d.fresh && d.projects.length === 0) createSample();
    requestPersist();
  } catch (e) {
    console.error(e);
    alert('저장소를 열 수 없습니다. 개인정보 보호 모드인지 확인하세요.');
  }
  set({ ready: true });
  loadGuideFonts().then(() => set({ fontsReady: state.fontsReady + 1 }));
}

render(<App />, document.getElementById('app')!);
boot();
