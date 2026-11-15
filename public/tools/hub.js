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
/* 3) 파일 저장 공통: window.zunoSave(파일들)
   - 아이폰·아이패드: 공유 시트로 (→ "이미지 저장" = 사진 앱 / "파일에 저장" = iCloud Drive). 여러 장도 한 번에
     Safari는 "누른 직후"에만 공유 시트를 허용 → 렌더링이 길어 막히면 [저장하기] 버튼을 띄워 한 번 더 누르게 함
   - 그 외(PC): 일반 다운로드
   files: [{ blob, name }] 또는 (blob, name). 결과: 'shared' | 'downloaded' | 'cancelled' */
(() => {
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const download = async (list) => {
    for (const f of list) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(f.blob); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      const u = a.href; setTimeout(() => URL.revokeObjectURL(u), 4000);
      if (list.length > 1) await new Promise((r) => setTimeout(r, 250));
    }
    return 'downloaded';
  };
  const askTap = (list, files) => new Promise((resolve) => {
    const st = document.createElement('style');
    st.textContent = `.zs-back{position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:24px}
.zs-card{width:100%;max-width:340px;background:#0E0B1D;border:1px solid #3A3A52;border-radius:16px;padding:18px;color:#fff;font:15px/1.45 'IBM Plex Sans KR',-apple-system,system-ui,sans-serif}
.zs-card b{display:block;margin-bottom:4px}.zs-card p{margin:0 0 14px;color:#8B7CC7;font-size:13px;word-break:break-all}
.zs-card button{width:100%;min-height:48px;border-radius:12px;border:1px solid #3A3A52;background:transparent;color:#fff;font:inherit;font-weight:600}
.zs-card button.go{background:#5613C8;border-color:#5613C8;margin-bottom:8px}`;
    const back = document.createElement('div'); back.className = 'zs-back';
    back.innerHTML = `<div class="zs-card"><b>${list.length > 1 ? list.length + '개 파일 준비됨' : '파일 준비됨'}</b><p></p><button class="go">사진 · 파일에 저장</button><button class="no">닫기</button></div>`;
    back.querySelector('p').textContent = list.map((f) => f.name).join(', ');
    const close = (v) => { back.remove(); st.remove(); resolve(v); };
    back.querySelector('.go').onclick = async () => {
      try { await navigator.share({ files }); close('shared'); }
      catch (e) { if (e && e.name === 'AbortError') close('cancelled'); else { close(await download(list)); } }
    };
    back.querySelector('.no').onclick = () => close('cancelled');
    document.head.appendChild(st); document.body.appendChild(back);
  });
  window.zunoSave = async (a, name) => {
    const list = a instanceof Blob ? [{ blob: a, name }] : a;
    if (!list || !list.length) return 'cancelled';
    if (isIOS() && navigator.canShare) {
      const files = list.map((f) => new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' }));
      if (navigator.canShare({ files })) {
        try { await navigator.share({ files }); return 'shared'; }
        catch (e) {
          if (e && e.name === 'AbortError') return 'cancelled';
          return askTap(list, files); // 누른 직후가 지나서 막힘 → 버튼으로 한 번 더
        }
      }
    }
    return download(list);
  };
})();
(() => {
  if (!/\/tools\/[^/]*$/.test(location.pathname)) return;
  // 앱 화면 안(하단바가 있는 iframe)에서는 홈 버튼이 필요 없음
  try { if (window.self !== window.top) return; } catch (e) { return; }
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
