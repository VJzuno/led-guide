/* 클릭음: 버튼·탭을 누르면 짧고 부드러운 '틱' (Web Audio로 합성, 파일 없음)
 * - 설정에서 끄고 켬. 값은 localStorage 'zuno.click' ('0' = 끔) → 같은 주소의 도구(iframe)도 같이 따름
 * - 아이폰 무음 스위치가 켜져 있으면 소리 안 남 (iOS 규칙) */
const KEY = 'zuno.click';
let ctx: AudioContext | null = null;

export const clickOn = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };
export const setClickOn = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ } };

export function tick() {
  if (!clickOn()) return;
  try {
    ctx ||= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(650, t + 0.035);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + 0.06);
  } catch { /* 오디오 막힘 */ }
}

const TARGET = 'button, a[href], label.btn, .btn, .chip, .seg button, [role="button"], summary, .led-row, .list-item';
/** 앱 시작 때 한 번: 누르는 요소에 클릭음 */
export function startClickSound() {
  document.addEventListener('pointerdown', (e) => {
    const el = (e.target as Element | null)?.closest?.(TARGET);
    if (el && !(el as HTMLButtonElement).disabled) tick();
  }, { capture: true, passive: true });
}
