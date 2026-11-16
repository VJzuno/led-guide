/* 클라우드 동기화 (Firebase · 커플앱/LiMiNaL과 같은 방식)
 * - 구글 로그인(Firebase Auth): 한 번 로그인하면 계속 유지 (1시간 만료 없음)
 * - Firestore 실시간 리스너: 다른 기기에서 바꾸면 거의 바로 이 기기에 반영
 * - 이 기기에서 바꾸면 1.5초 뒤 바뀐 항목만 올림. 오프라인이면 Firestore가 모아 뒀다가 온라인 되면 보냄
 * - 데이터 위치: users/{uid}/projects|leds|borders|tools/{id}  (규칙: 본인 uid만)
 * - 항목마다 updatedAt 이 더 새로운 쪽이 이김. 휴지통(소프트 삭제)도 updatedAt 으로 전파, 영구 삭제는 문서 삭제 */
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, type User,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc, type Firestore, type Unsubscribe,
} from 'firebase/firestore';
import { firebaseConfig } from './firebase-config';
import { state, emit, localChange, applyRemote, removeRemote } from './store';
import { TOOL_KEYS, collectTools, mergeTools, toolStamp } from './tools';

type Kind = 'projects' | 'leds' | 'borders';
const KINDS: Kind[] = ['projects', 'leds', 'borders'];

/** 이 앱이 Firebase 호스팅(web.app)에서 열렸는지. 같은 주소로 로그인해야 아이폰에서 안정적 */
export const onFirebaseHost = () => /\.(web\.app|firebaseapp\.com)$/.test(location.hostname) || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
export const NEW_URL = 'https://zuno-workspace.web.app/';

/* 로그인 창 주소:
 * - 아이폰(리디렉션): 앱과 같은 주소여야 로그인 정보가 안 사라짐 → web.app
 * - PC(팝업): 앱과 다른 주소(firebaseapp.com)여야 함. 같은 주소면 설치한 앱 창이 팝업을 가로채서 '로그인 중…'에서 멈춤 */
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const cfg = { ...firebaseConfig, authDomain: isIOS() && /\.(web\.app|firebaseapp\.com)$/.test(location.hostname) ? location.hostname : firebaseConfig.authDomain };
const app = initializeApp(cfg);
const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });
let db: Firestore | null = null;
const getDb = () => (db ||= initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }));

/* ---------- 상태 ---------- */
export type CloudStatus = 'off' | 'connecting' | 'synced' | 'syncing' | 'offline' | 'error';
let user: User | null = null;
let status: CloudStatus = 'off';
let lastError = '';
let lastSyncAt = 0;
let authKnown = false; // 저장된 로그인을 다 읽었는지 (앱 시작 직후 잠깐 false)
export const cloudUser = () => user;
/** 저장된 로그인 확인 전이면 true → '로그인' 대신 '연결 중' 표시 */
export const cloudChecking = () => !authKnown;
export const cloudStatus = (): CloudStatus => (user && !navigator.onLine ? 'offline' : status);
export const cloudError = () => lastError;
export const cloudLastSync = () => lastSyncAt;
const setStatus = (s: CloudStatus, err = '') => { status = s; lastError = err; if (s === 'synced') lastSyncAt = Date.now(); emit(); };

/* ---------- 로그인 ---------- */
/** 반드시 버튼 클릭 안에서 호출 (팝업 허용 조건) */
export async function cloudSignIn() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  if (isIOS()) { await signInWithRedirect(auth, p); return; } // 아이폰: 같은 주소에서 이동했다가 돌아옴
  try { await signInWithPopup(auth, p); }
  catch (e: any) {
    if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') { await signInWithRedirect(auth, p); return; }
    if (e?.code === 'auth/popup-closed-by-user' || e?.code === 'auth/cancelled-popup-request') return;
    throw new Error(friendly(e));
  }
}
export async function cloudSignOut() { await signOut(auth); }

function friendly(e: any): string {
  const c = e?.code || '';
  if (c === 'auth/unauthorized-domain') return '이 주소에서는 로그인할 수 없어요. 새 주소(zuno-workspace.web.app)에서 열어 주세요.';
  if (c === 'auth/operation-not-allowed' || c === 'auth/configuration-not-found') return 'Firebase에서 Google 로그인이 아직 켜지지 않았어요.';
  if (c === 'auth/network-request-failed') return '인터넷 연결을 확인해 주세요.';
  return e?.message || '로그인에 실패했어요.';
}

/* ---------- 동기화 ---------- */
let unsubs: Unsubscribe[] = [];
/** 마지막으로 서버와 맞춘 상태: 종류 → id → updatedAt (도구는 at) */
const synced: Record<Kind | 'tools', Map<string, number>> = { projects: new Map(), leds: new Map(), borders: new Map(), tools: new Map() };
const ready = new Set<string>(); // 첫 서버 스냅샷을 받은 컬렉션
let pushTimer: number | undefined;
let pushing = false;

const clean = (o: any) => JSON.parse(JSON.stringify(o)); // undefined 제거 (Firestore 금지)
/** 큐시트처럼 큰 도구 값: 문서 한도(1MB) 넘으면 표지 이미지 빼고 올림 (표지는 열면 다시 만들어짐) */
function shrinkTool(key: string, value: string) {
  if (value.length < 900_000) return value;
  if (key === 'cuesheet_maker_v1') {
    try { const v = JSON.parse(value); v.shows?.forEach((s: any) => { s.cover = null; }); const out = JSON.stringify(v); if (out.length < 950_000) return out; } catch { /* ignore */ }
  }
  return null; // 너무 커서 못 올림
}

function startSync(u: User) {
  stopSync();
  setStatus('connecting');
  const base = `users/${u.uid}`;
  for (const kind of KINDS) {
    unsubs.push(onSnapshot(collection(getDb(), `${base}/${kind}`), { includeMetadataChanges: false }, (snap) => {
      let changed = false;
      for (const ch of snap.docChanges()) {
        if (ch.doc.metadata.hasPendingWrites) continue; // 내가 방금 보낸 것
        if (ch.type === 'removed') { synced[kind].delete(ch.doc.id); changed = removeRemote(kind, ch.doc.id) || changed; continue; }
        const item = ch.doc.data();
        synced[kind].set(ch.doc.id, item.updatedAt || 0);
        changed = applyRemote(kind, item) || changed;
      }
      if (changed) emit();
      if (!snap.metadata.fromCache) { ready.add(kind); afterReady(); }
    }, (e) => setStatus('error', friendly(e))));
  }
  unsubs.push(onSnapshot(collection(getDb(), `${base}/tools`), (snap) => {
    const incoming: Record<string, { value: string; at: number }> = {};
    for (const ch of snap.docChanges()) {
      if (ch.doc.metadata.hasPendingWrites || ch.type === 'removed') continue;
      const d = ch.doc.data() as { value: string; at: number };
      synced.tools.set(ch.doc.id, d.at || 0);
      incoming[ch.doc.id] = d;
    }
    if (Object.keys(incoming).length && mergeTools(incoming).length) emit();
    if (!snap.metadata.fromCache) { ready.add('tools'); afterReady(); }
  }, (e) => setStatus('error', friendly(e))));
}
function stopSync() { unsubs.forEach((f) => f()); unsubs = []; ready.clear(); KINDS.forEach((k) => synced[k].clear()); synced.tools.clear(); }

/** 네 컬렉션 첫 스냅샷을 다 받으면: 이 기기에만 있거나 더 새로운 것 올리기 */
function afterReady() { if (ready.size >= 4) schedulePush(0); }

function schedulePush(ms = 1500) {
  if (!user) return;
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(push, ms);
}

async function push() {
  if (!user || ready.size < 4) return;
  if (pushing) { schedulePush(800); return; }
  pushing = true;
  const base = `users/${user.uid}`;
  const jobs: Promise<unknown>[] = [];
  try {
    for (const kind of KINDS) {
      const list = state[kind] as any[];
      const ids = new Set(list.map((x) => x.id));
      for (const it of list) {
        const at = it.updatedAt || 0;
        if ((synced[kind].get(it.id) ?? -1) >= at) continue;
        synced[kind].set(it.id, at);
        jobs.push(setDoc(doc(getDb(), `${base}/${kind}/${it.id}`), clean(it)));
      }
      // 이 기기에서 영구 삭제한 것
      for (const id of [...synced[kind].keys()]) if (!ids.has(id)) { synced[kind].delete(id); jobs.push(deleteDoc(doc(getDb(), `${base}/${kind}/${id}`))); }
    }
    const tools = collectTools();
    for (const { key } of TOOL_KEYS) {
      const t = tools[key];
      if (!t) continue;
      const at = t.at || toolStamp(key);
      if ((synced.tools.get(key) ?? -1) >= at) continue;
      const v = shrinkTool(key, t.value);
      if (v == null) continue;
      synced.tools.set(key, at);
      jobs.push(setDoc(doc(getDb(), `${base}/tools/${key}`), { value: v, at }));
    }
    if (jobs.length) {
      setStatus('syncing');
      await Promise.all(jobs); // 오프라인이면 온라인 될 때 끝남
    }
    setStatus('synced');
  } catch (e: any) {
    setStatus('error', friendly(e));
  } finally { pushing = false; }
}

let started = false;
/** 앱 시작 때 한 번 */
export function startCloud() {
  if (started || !onFirebaseHost()) return;
  started = true;
  getRedirectResult(auth).catch((e) => setStatus('error', friendly(e)));
  onAuthStateChanged(auth, (u) => {
    user = u; authKnown = true;
    if (u) startSync(u); else { stopSync(); setStatus('off'); }
  });
  localChange.add(() => schedulePush());
  addEventListener('storage', (e) => { if (e.key && e.key.startsWith('zuno.toolstamp.')) schedulePush(); });
  addEventListener('online', () => { emit(); schedulePush(300); });
  addEventListener('offline', () => emit());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedulePush(300); });
}
