/* 첫 실행 1회 잠금. 가벼운 접근 차단용 (보안 장치 아님).
 * 해시는 빌드 시 VITE_PASS_HASH 로 주입. 평문은 코드 어디에도 없음. */
import { getMeta, setMeta } from './db';

const HASH = (import.meta.env.VITE_PASS_HASH || '').trim().toLowerCase();
const LS_UNLOCK = 'zuno.unlocked';
const LS_FAILS = 'zuno.lock.fails';
const LS_UNTIL = 'zuno.lock.until';
export const MAX_FAILS = 5;
export const WAIT_MS = 30_000;

export const lockConfigured = () => HASH.length === 64;

function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

/** localStorage 또는 IndexedDB 중 한 곳이라도 해제 기록이 있으면 통과 (업데이트 후에도 유지) */
export async function isUnlocked(): Promise<boolean> {
  if (!lockConfigured()) return true;
  if (lsGet(LS_UNLOCK) === '1') return true;
  try {
    const m = await getMeta<{ at: number }>('unlock');
    if (m?.at) { lsSet(LS_UNLOCK, '1'); return true; }
  } catch { /* ignore */ }
  return false;
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function waitRemaining() {
  const until = Number(lsGet(LS_UNTIL) || 0);
  return Math.max(0, until - Date.now());
}

export async function tryUnlock(pw: string): Promise<'ok' | 'wrong' | 'wait'> {
  if (waitRemaining() > 0) return 'wait';
  if ((await sha256(pw)) === HASH) {
    lsSet(LS_UNLOCK, '1');
    lsSet(LS_FAILS, '0');
    await setMeta('unlock', { at: Date.now() });
    return 'ok';
  }
  const fails = Number(lsGet(LS_FAILS) || 0) + 1;
  if (fails >= MAX_FAILS) {
    lsSet(LS_FAILS, '0');
    lsSet(LS_UNTIL, String(Date.now() + WAIT_MS));
    return 'wait';
  }
  lsSet(LS_FAILS, String(fails));
  return 'wrong';
}

export const failsSoFar = () => Number(lsGet(LS_FAILS) || 0);
