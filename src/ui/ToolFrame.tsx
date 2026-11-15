/** 앱 안에서 도구 페이지(public/tools/*.html)를 하단바와 함께 보여줌 (같은 출처라 저장소·동기화 공유) */
export function ToolFrame({ src, title, back }: { src: string; title: string; back?: string }) {
  return (
    <div class={'tool-screen' + (back ? ' with-bar' : '')}>
      {back && (
        <div class="tool-bar">
          <a class="btn icon ghost" href={'#' + back} aria-label="뒤로">‹</a>
          <span class="tool-title">{title}</span>
        </div>
      )}
      <iframe class="tool-frame" src={src} title={title} />
    </div>
  );
}
