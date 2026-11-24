import { useEffect, useRef } from 'preact/hooks';
import { AppHeader } from './common';

/** 앱 안에서 도구 페이지(public/tools/*.html)를 하단바와 함께 보여줌 (같은 출처라 저장소·동기화 공유)
 *  back 이 없으면 메인 탭(3D 로고 · SPVS 보고서): 상단에 ZUNO 헤더
 *  다른 기기에서 도구 데이터가 들어오면 다시 불러옴 (입력 중이면 끝난 뒤에) */
export function ToolFrame({ src, title, back }: { src: string; title: string; back?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let pending = false;
    const typing = () => {
      const d = ref.current?.contentDocument;
      const a = d?.activeElement as HTMLElement | null;
      return document.activeElement === ref.current && !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
    };
    const reload = () => {
      if (typing()) { pending = true; return; }
      pending = false;
      try { ref.current?.contentWindow?.location.reload(); } catch { /* ignore */ }
    };
    const onFocusOut = () => { if (pending) setTimeout(reload, 300); };
    addEventListener('zuno-tools-updated', reload);
    const t = setInterval(() => { if (pending && !typing()) reload(); }, 2000);
    window.addEventListener('focus', onFocusOut);
    return () => { removeEventListener('zuno-tools-updated', reload); clearInterval(t); window.removeEventListener('focus', onFocusOut); };
  }, [src]);
  return (
    <div class={'tool-screen' + (back ? ' with-bar' : '')}>
      {back ? (
        <div class="tool-bar">
          <a class="btn icon ghost" href={'#' + back} aria-label="뒤로">‹</a>
          <span class="tool-title">{title}</span>
        </div>
      ) : <AppHeader title={title} />}
      <iframe ref={ref} class="tool-frame" src={src} title={title} allow="fullscreen" allowFullScreen />
    </div>
  );
}
