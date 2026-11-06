/* ZUNO 도구 공통 (각 도구 <head>에서 defer 없이 먼저 실행)
   1) 저장값이 실제로 바뀐 시각 기록 → 앱의 백업·구글 드라이브 동기화가 "더 최근에 고친 기기"를 판단
   2) 앱 홈으로 돌아가는 버튼. LED GUIDE 앱 안(/tools/)에서 열렸을 때만 보임. 인쇄·PNG 출력에는 안 나옴 */
(() => {
  const TRACK = ['cuesheet_maker_v1', 'vjWorkLogSimple', 'borderMaker.v3', 'metalLogo.presets.v1', 'metalLogo.last.v1'];
  try {
    const proto = Storage.prototype, origSet = proto.setItem, origGet = proto.getItem;
    proto.setItem = function (k, v) {
      const track = this === window.localStorage && TRACK.includes(k) && origGet.call(this, k) !== String(v);
      origSet.call(this, k, v);
      if (track) origSet.call(this, 'zuno.toolstamp.' + k, String(Date.now()));
    };
  } catch (e) { /* 저장소 차단 환경 */ }
})();
(() => {
  if (!/\/tools\/[^/]*$/.test(location.pathname)) return;
  const css = `
.zuno-home{position:fixed;z-index:2147483000;right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));
  display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 14px;border-radius:999px;
  background:rgba(14,11,29,.92);border:1px solid #5613C8;color:#fff;text-decoration:none;
  font:600 13px/1 'IBM Plex Sans KR',-apple-system,system-ui,sans-serif;letter-spacing:.02em;
  -webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);box-shadow:0 4px 18px rgba(0,0,0,.5)}
.zuno-home:hover{background:#2A1E4D}
.zuno-home:focus-visible{outline:2px solid #8B7CC7;outline-offset:2px}
@media print{.zuno-home{display:none!important}}`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
  const a = document.createElement('a');
  a.className = 'zuno-home';
  a.href = '../';
  a.textContent = '← 홈';
  a.setAttribute('aria-label', 'ZUNO 앱 홈으로');
  const add = () => document.body.appendChild(a);
  document.body ? add() : addEventListener('DOMContentLoaded', add);
})();
