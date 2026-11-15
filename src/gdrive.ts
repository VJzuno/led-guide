/* 구글 드라이브 동기화
 * - 구글 계정 로그인: Google Identity Services(토큰 방식, 팝업). 권한은 drive.appdata 하나뿐
 *   → 앱 전용 숨김 폴더(appDataFolder)만 읽고 씀. 사용자의 다른 드라이브 파일은 볼 수 없음
 * - 파일 하나(zuno-backup.json)에 LED 프로젝트 + 도구 데이터 전체
 * - 동기화 = 드라이브에서 받아 합치기 → 합친 결과를 다시 올리기 (항목별 최신 우선)
 * - OAuth 클라이언트 ID는 공개값(비밀 아님). 빌드 시 VITE_GOOGLE_CLIENT_ID 또는 앱 설정에서 입력 */
import type { BackupFile } from './types';
import { buildBackup, applyBackup, LS_DRIVE, changedSinceBackup } from './sync';
import { emit, localChange } from './store';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_NAME = 'zuno-backup.json';
const LS_CLIENT = 'zuno.drive.clientId';
const LS_TOKEN = 'zuno.drive.token';
const LS_LINKED = 'zuno.drive.linked';

const lsGet = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k: string, v: string) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ } };

const ENV_CLIENT = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const clientId = () => lsGet(LS_CLIENT) || ENV_CLIENT || '';
export const clientFromBuild = () => !!ENV_CLIENT && !lsGet(LS_CLIENT);
export function setClientId(v: string) { lsSet(LS_CLIENT, v.trim()); emit(); }
export const isLinked = () => lsGet(LS_LINKED) === '1';
export const lastDriveSync = () => Number(lsGet(LS_DRIVE) || 0);
export const validClientId = (v: string) => /^[\w-]+\.apps\.googleusercontent\.com$/.test(v.trim());

/* ---------- 토큰 ----------
 * PC: 팝업(Google Identity Services). 팝업은 "누른 순간"에 바로 열어야 브라우저가 허용하므로,
 *     스크립트 로드·토큰 클라이언트 생성은 미리 해 두고(prepareDrive) 클릭 때 동기적으로 requestAccessToken.
 * 아이폰·아이패드: 홈 화면 앱은 팝업이 막히거나 돌아오지 못함 → 구글 로그인 페이지로 이동했다가
 *     앱 주소로 돌아오는 리디렉션 방식. 돌아오면 #access_token=… 을 읽고(handleDriveRedirect) 이어서 동기화.
 *     구글 클라이언트의 "승인된 리디렉션 URI"에 앱 주소(예: https://vjzuno.github.io/led-guide/)가 있어야 함 */
const LS_STATE = 'zuno.drive.state', LS_PENDING = 'zuno.drive.pending';
export const useRedirect = () => isIOSDevice() || lsGet('zuno.drive.forceRedirect') === '1';
const isIOSDevice = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
/** 리디렉션으로 돌아올 주소 = 앱 첫 화면 (구글 콘솔에 등록하는 값) */
export const redirectUri = () => new URL('.', location.href.split('#')[0]).href;

let gisP: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  gisP ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => { gisP = null; rej(new Error('구글 로그인 스크립트를 불러오지 못했어요. 인터넷 연결을 확인하세요.')); };
    document.head.appendChild(s);
  });
  return gisP;
}

function cachedToken(): string {
  try {
    const t = JSON.parse(lsGet(LS_TOKEN) || 'null');
    if (t && t.exp > Date.now() + 60_000) return t.v;
  } catch { /* ignore */ }
  return '';
}
const saveToken = (v: string, expiresIn: number) => {
  lsSet(LS_TOKEN, JSON.stringify({ v, exp: Date.now() + (expiresIn || 3600) * 1000 }));
  lsSet(LS_LINKED, '1');
};

let tokenClient: any = null, tokenClientFor = '';
let pending: { res: (t: string) => void; rej: (e: Error) => void } | null = null;
/** PC 팝업 준비: 백업 화면이 열릴 때 미리 호출 */
export async function prepareDrive() {
  const id = clientId();
  if (!id || useRedirect() || !navigator.onLine) return;
  await loadGis().catch(() => {});
  const g = (window as any).google;
  if (!g?.accounts?.oauth2 || tokenClientFor === id) return;
  tokenClient = g.accounts.oauth2.initTokenClient({
    client_id: id,
    scope: SCOPE,
    callback: (r: any) => {
      const p = pending; pending = null;
      if (r?.error || !r?.access_token) { p?.rej(new Error(r?.error_description || r?.error || '구글 로그인이 취소됐어요.')); return; }
      saveToken(r.access_token, Number(r.expires_in));
      p?.res(r.access_token);
    },
    error_callback: (e: any) => {
      const p = pending; pending = null;
      if (e?.type === 'popup_failed_to_open') { lsSet('zuno.drive.forceRedirect', '1'); p?.rej(new Error('팝업이 막혔어요. 다시 누르면 구글 로그인 페이지로 이동해서 연결합니다.')); return; }
      p?.rej(new Error(e?.type === 'popup_closed' ? '로그인 창을 닫았어요.' : '구글 로그인에 실패했어요.'));
    },
  });
  tokenClientFor = id;
}

/** 구글 로그인 페이지로 이동 (아이폰). 돌아오면 handleDriveRedirect 가 받음 */
function startRedirect(sync: boolean): never {
  const st = Math.random().toString(36).slice(2) + Date.now().toString(36);
  lsSet(LS_STATE, st);
  lsSet(LS_PENDING, sync ? '1' : '');
  const q = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE,
    include_granted_scopes: 'true', state: st, ...(isLinked() ? {} : { prompt: 'consent' }),
  });
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
  throw Object.assign(new Error('구글 로그인 페이지로 이동합니다…'), { redirecting: true });
}

/** 리디렉션 로그인에서 돌아온 직후 백업 화면이 이어서 동기화해야 하는지 */
export let resumeAfterRedirect = false;
export const clearResume = () => { resumeAfterRedirect = false; };

/** 앱 시작 때 가장 먼저: 구글에서 돌아온 #access_token=… 처리. 동기화를 이어서 해야 하면 true */
export function handleDriveRedirect(): boolean {
  const h = location.hash;
  if (!/(^#|&)(access_token|error)=/.test(h)) return false;
  const p = new URLSearchParams(h.slice(1));
  const ok = p.get('state') && p.get('state') === lsGet(LS_STATE);
  lsSet(LS_STATE, '');
  history.replaceState(null, '', location.pathname + location.search + '#/menu/backup');
  if (!ok) return false;
  if (p.get('error')) { lsSet(LS_PENDING, ''); lsSet('zuno.drive.lastError', p.get('error') === 'access_denied' ? '구글 로그인을 취소했어요.' : '구글 로그인에 실패했어요: ' + p.get('error')); return false; }
  const t = p.get('access_token');
  if (t) saveToken(t, Number(p.get('expires_in')));
  const again = lsGet(LS_PENDING) === '1';
  lsSet(LS_PENDING, '');
  resumeAfterRedirect = !!t && again;
  return resumeAfterRedirect;
}
/** 리디렉션 로그인에서 생긴 오류 문구 (한 번만) */
export function takeDriveError() { const e = lsGet('zuno.drive.lastError'); lsSet('zuno.drive.lastError', ''); return e; }

/** 접근 토큰. interactive=false면 저장된 토큰만 사용 (팝업·이동 없음).
 *  interactive=true: 반드시 버튼 클릭 처리 안에서 await 전에 호출할 것 (팝업 허용 조건) */
export function getToken(interactive: boolean): Promise<string> {
  const c = cachedToken();
  if (c) return Promise.resolve(c);
  if (!clientId()) return Promise.reject(new Error('구글 OAuth 클라이언트 ID가 설정되지 않았어요.'));
  if (!interactive) return Promise.reject(Object.assign(new Error('로그인이 필요해요.'), { auth: true }));
  if (useRedirect()) startRedirect(true);
  if (!tokenClient || tokenClientFor !== clientId()) {
    prepareDrive();
    return Promise.reject(new Error('구글 로그인 준비 중이에요. 잠시 후 다시 눌러 주세요.'));
  }
  return new Promise((res, rej) => {
    pending = { res, rej };
    tokenClient.requestAccessToken({ prompt: isLinked() ? '' : 'consent' }); // 클릭과 같은 순간에 팝업
  });
}

/** 연결 해제: 토큰 취소 + 이 기기의 연결 정보 삭제 (드라이브의 백업 파일은 남음) */
export async function unlinkDrive() {
  const t = cachedToken();
  lsSet(LS_TOKEN, ''); lsSet(LS_LINKED, '');
  try { if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }).catch(() => {}); } catch { /* ignore */ }
  tokenClient = null; tokenClientFor = '';
  emit();
}

/* ---------- 드라이브 파일 ---------- */
async function api(token: string, url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (r.status === 401) { lsSet(LS_TOKEN, ''); throw Object.assign(new Error('구글 로그인이 만료됐어요. 다시 눌러 주세요.'), { auth: true }); }
  if (!r.ok) {
    let msg = `드라이브 요청 실패 (${r.status})`;
    try { const j = await r.json(); if (j?.error?.message) msg += `: ${j.error.message}`; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r;
}

async function findFile(token: string): Promise<{ id: string; modifiedTime: string } | null> {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const r = await api(token, `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc&pageSize=1`);
  const j = await r.json();
  return j.files?.[0] || null;
}

async function download(token: string, id: string): Promise<BackupFile> {
  const r = await api(token, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  return r.json();
}

const LS_REMOTE = 'zuno.drive.remoteMod';
async function upload(token: string, b: BackupFile, id?: string) {
  const body = JSON.stringify(b);
  if (id) {
    const r = await api(token, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,modifiedTime`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    });
    try { lsSet(LS_REMOTE, (await r.json()).modifiedTime || ''); } catch { /* ignore */ }
    return;
  }
  const boundary = 'zuno' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const r = await api(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
  });
  try { lsSet(LS_REMOTE, (await r.json()).modifiedTime || ''); } catch { /* ignore */ }
}

export interface DriveResult { added: number; updated: number; kept: number; tools: string[]; first: boolean; remoteAt: number }

/* ---------- 온라인일 때 자동 동기화 ----------
 * - 이 기기에서 바뀌면(LED·보더·프로젝트·도구) 4초 뒤 올림
 * - 앱이 열려 있고 온라인이면 30초마다 드라이브 파일의 수정 시각만 확인 → 다른 기기가 바꿨으면 받아서 합침
 * - 앱 열 때 · 다시 볼 때 · 온라인 될 때 바로 한 번
 * - 로그인 토큰(약 1시간)이 만료되면 자동으로는 다시 로그인할 수 없음 → driveNeedsLogin() 이 true, 화면에 "다시 연결" */
const canAuto = () => isLinked() && !!clientId() && navigator.onLine && !resumeAfterRedirect;
/** 연결은 돼 있는데 로그인이 만료돼서 자동 동기화가 멈춘 상태 */
export const driveNeedsLogin = () => isLinked() && !!clientId() && navigator.onLine && !cachedToken();
export const driveSyncing = () => !!inflight;

let pushTimer: number | undefined;
function markDirty() {
  if (!canAuto()) return;
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => autoTick(true), 4000);
}

let lastTick = 0;
async function autoTick(push: boolean) {
  if (!canAuto() || inflight) return;
  if (!cachedToken()) { emit(); return; } // "다시 연결" 표시
  if (!push && Date.now() - lastTick < 10_000) return;
  lastTick = Date.now();
  try {
    if (!push) {
      // 확인만: 드라이브 파일이 그대로고 이 기기도 바뀐 게 없으면 아무것도 안 함
      const f = await findFile(cachedToken());
      const remoteChanged = f && f.modifiedTime !== lsGet(LS_REMOTE);
      if (!remoteChanged && !(changedSinceBackup() > 0) && f) return;
    }
    await syncDrive(false);
  } catch { emit(); /* 만료면 다시 연결 표시, 그 밖엔 다음 주기에 */ }
}

let started = false;
/** 앱 시작 때 한 번 호출 */
export function startAutoSync() {
  if (started) return;
  started = true;
  localChange.add(markDirty);
  // 도구 화면(iframe)에서 저장하면 같은 출처라 storage 이벤트가 옴 (hub.js 가 남기는 수정 시각 키)
  addEventListener('storage', (e) => { if (e.key && e.key.startsWith('zuno.toolstamp.')) markDirty(); });
  addEventListener('online', () => autoTick(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) autoTick(false); });
  setInterval(() => { if (!document.hidden) autoTick(false); }, 30_000);
  autoTick(false);
}
/** (예전 이름 유지) */
export const autoSync = () => autoTick(false);

let inflight: Promise<DriveResult> | null = null;
/** 지금 동기화: 받기 → 합치기 → 올리기 */
export async function syncDrive(interactive = true): Promise<DriveResult> {
  if (!navigator.onLine) throw new Error('오프라인이에요. 인터넷에 연결된 뒤 다시 눌러 주세요.');
  const tokenP = getToken(interactive); // await 전에 팝업/이동이 시작됨 (클릭 순간)
  tokenP.catch(() => {}); // 실패는 아래 syncWith 에서 다시 받음
  if (inflight) { await inflight.catch(() => {}); }
  const p = syncWith(tokenP);
  inflight = p;
  emit();
  try { return await p; } finally { if (inflight === p) inflight = null; emit(); }
}

async function syncWith(tokenP: Promise<string>): Promise<DriveResult> {
  const token = await tokenP;
  const run = async () => {
    const f = await findFile(token);
    let res: DriveResult = { added: 0, updated: 0, kept: 0, tools: [], first: !f, remoteAt: 0 };
    if (f) {
      const remote = await download(token, f.id);
      if (remote?.app !== 'zuno-led-guide-maker') throw new Error('드라이브의 백업 파일 형식이 맞지 않아요.');
      const r = await applyBackup(remote);
      res = { ...r, first: false, remoteAt: remote.exportedAt || 0 };
    }
    await upload(token, await buildBackup(), f?.id);
    lsSet(LS_DRIVE, String(Date.now()));
    emit();
    return res;
  };
  try { return await run(); }
  catch (e: any) {
    if (!e?.auth) throw e;
    // 토큰 만료: 팝업·이동은 클릭 순간에만 가능하므로 다시 누르도록 안내
    throw new Error('구글 로그인이 만료됐어요. 한 번 더 눌러 주세요.');
  }
}
