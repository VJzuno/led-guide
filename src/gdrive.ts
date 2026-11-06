/* 구글 드라이브 동기화
 * - 구글 계정 로그인: Google Identity Services(토큰 방식, 팝업). 권한은 drive.appdata 하나뿐
 *   → 앱 전용 숨김 폴더(appDataFolder)만 읽고 씀. 사용자의 다른 드라이브 파일은 볼 수 없음
 * - 파일 하나(zuno-backup.json)에 LED 프로젝트 + 도구 데이터 전체
 * - 동기화 = 드라이브에서 받아 합치기 → 합친 결과를 다시 올리기 (항목별 최신 우선)
 * - OAuth 클라이언트 ID는 공개값(비밀 아님). 빌드 시 VITE_GOOGLE_CLIENT_ID 또는 앱 설정에서 입력 */
import type { BackupFile } from './types';
import { buildBackup, applyBackup, LS_DRIVE } from './sync';
import { emit } from './store';

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

/* ---------- 토큰 ---------- */
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

/** 접근 토큰. interactive=false면 이미 허용한 계정으로 조용히 시도 (팝업이 잠깐 뜰 수 있음) */
export async function getToken(interactive: boolean): Promise<string> {
  const c = cachedToken();
  if (c) return c;
  const id = clientId();
  if (!id) throw new Error('구글 OAuth 클라이언트 ID가 설정되지 않았어요.');
  await loadGis();
  const g = (window as any).google;
  return new Promise((res, rej) => {
    const tc = g.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: SCOPE,
      callback: (r: any) => {
        if (r?.error || !r?.access_token) { rej(new Error(r?.error_description || r?.error || '구글 로그인이 취소됐어요.')); return; }
        lsSet(LS_TOKEN, JSON.stringify({ v: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 }));
        lsSet(LS_LINKED, '1');
        res(r.access_token);
      },
      error_callback: (e: any) => rej(new Error(e?.type === 'popup_closed' ? '로그인 창을 닫았어요.' : e?.type === 'popup_failed_to_open' ? '팝업이 막혔어요. 팝업을 허용하고 다시 눌러 주세요.' : '구글 로그인에 실패했어요.')),
    });
    tc.requestAccessToken({ prompt: interactive && !isLinked() ? 'consent' : '' });
  });
}

/** 연결 해제: 토큰 취소 + 이 기기의 연결 정보 삭제 (드라이브의 백업 파일은 남음) */
export async function unlinkDrive() {
  const t = cachedToken();
  lsSet(LS_TOKEN, ''); lsSet(LS_LINKED, '');
  try { if (t) (window as any).google?.accounts?.oauth2?.revoke?.(t, () => {}); } catch { /* ignore */ }
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

async function upload(token: string, b: BackupFile, id?: string) {
  const body = JSON.stringify(b);
  if (id) {
    await api(token, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    });
    return;
  }
  const boundary = 'zuno' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  await api(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
  });
}

export interface DriveResult { added: number; updated: number; kept: number; tools: string[]; first: boolean; remoteAt: number }

/** 앱을 열거나 다시 볼 때: 로그인 토큰이 아직 살아 있으면 조용히 동기화 (팝업 없음, 2분에 한 번) */
let autoAt = 0, autoBusy = false;
export async function autoSync() {
  if (autoBusy || !isLinked() || !clientId() || !navigator.onLine || !cachedToken()) return;
  if (Date.now() - autoAt < 120_000) return;
  autoAt = Date.now(); autoBusy = true;
  try { await syncDrive(false); } catch { /* 다음에 버튼으로 */ } finally { autoBusy = false; }
}

/** 지금 동기화: 받기 → 합치기 → 올리기 */
export async function syncDrive(interactive = true): Promise<DriveResult> {
  if (!navigator.onLine) throw new Error('오프라인이에요. 인터넷에 연결된 뒤 다시 눌러 주세요.');
  let token = await getToken(interactive);
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
    token = await getToken(true); // 만료 → 한 번 다시 로그인 후 재시도
    return run();
  }
}
