import { useEffect, useState } from 'preact/hooks';
import * as DB from './db';
import {
  DEFAULT_OPTIONS, DEFAULT_SETTINGS,
  type Project, type Led, type ExportMeta, type Settings, type Face, type BorderSet, type Show,
} from './types';
import { newLayer } from './border';
import { inputLayout } from './layout';

export interface State {
  ready: boolean;
  projects: Project[];
  leds: Led[];
  borders: BorderSet[];
  exportsMeta: ExportMeta[];
  settings: Settings;
  online: boolean;
  toast: string | null;
  updateReady: boolean;
  saveFallback: { url: string; name: string; type: string } | null;
  fontsReady: number;
  ask: { msg: string; ok: string; info?: boolean; resolve: (v: boolean) => void } | null;
}

export const state: State = {
  ready: false,
  projects: [],
  leds: [],
  borders: [],
  exportsMeta: [],
  settings: { ...DEFAULT_SETTINGS },
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  toast: null,
  updateReady: false,
  saveFallback: null,
  fontsReady: 0,
  ask: null,
};

const subs = new Set<() => void>();
export function emit() { subs.forEach((f) => f()); }
export function set(patch: Partial<State>) { Object.assign(state, patch); emit(); }

export function useStore(): State {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return state;
}

export const uid = () =>
  (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);

/* ---------- 자동 저장 (디바운스) ---------- */
/** 이 기기에서 데이터가 바뀔 때 알림 (구글 드라이브 자동 동기화가 구독) */
export const localChange = new Set<() => void>();
const changed = () => localChange.forEach((f) => { try { f(); } catch { /* ignore */ } });
const pending = new Map<string, () => Promise<void>>();
let timer: number | undefined;
function schedule(key: string, fn: () => Promise<void>) {
  changed();
  pending.set(key, fn);
  clearTimeout(timer);
  timer = window.setTimeout(flush, 250);
}
export async function flush() {
  const jobs = [...pending.values()];
  pending.clear();
  await Promise.all(jobs.map((j) => j().catch((e) => console.error(e))));
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => { flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
}

let toastTimer: number | undefined;
export function toast(msg: string) {
  set({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => set({ toast: null }), 2200);
}

/* ---------- 조회 ---------- */
export const liveProjects = () =>
  state.projects.filter((p) => !p.deletedAt).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
export const ledsOf = (projectId: string) =>
  state.leds.filter((l) => l.projectId === projectId && !l.deletedAt).sort((a, b) => a.order - b.order);
export const getLed = (id: string) => state.leds.find((l) => l.id === id);
export const getProject = (id: string) => state.projects.find((p) => p.id === id);
export const bordersOf = (projectId: string) =>
  state.borders.filter((b) => b.projectId === projectId && !b.deletedAt).sort((a, b) => a.order - b.order);
export const getBorder = (id: string) => state.borders.find((b) => b.id === id);

/* ---------- 공연 (프로젝트 안) ---------- */
const defaultShow = (pid: string): Show => ({ id: pid + '-s1', name: '공연 1', order: 0 });
export const showsOf = (p: Project): Show[] => (p.shows?.length ? [...p.shows].sort((a, b) => a.order - b.order) : [defaultShow(p.id)]);
/** 항목이 실제로 속한 공연 id (없거나 지워진 공연이면 첫 공연) */
const showKey = (p: Project, sid?: string) => { const ss = showsOf(p); return sid && ss.some((s) => s.id === sid) ? sid : ss[0].id; };
export const ledsOfShow = (pid: string, sid: string) => { const p = getProject(pid); return p ? ledsOf(pid).filter((l) => showKey(p, l.showId) === sid) : []; };
export const bordersOfShow = (pid: string, sid: string) => { const p = getProject(pid); return p ? bordersOf(pid).filter((b) => showKey(p, b.showId) === sid) : []; };
export const showOf = (pid: string, sid?: string) => { const p = getProject(pid); if (!p) return undefined; const k = showKey(p, sid); return showsOf(p).find((s) => s.id === k); };
/** 공연 LED 해상도: 직접 지정했거나, 기준 LED(첫 LED)의 인풋 크기 */
export function showSize(pid: string, sid?: string): { w: number; h: number; ref?: Led } | null {
  const s = showOf(pid, sid);
  if (!s) return null;
  if (s.size) return s.size;
  const ref = ledsOfShow(pid, s.id)[0];
  if (!ref) return null;
  const lay = inputLayout(ref);
  return { w: lay.W, h: lay.H, ref };
}
function setShows(pid: string, fn: (ss: Show[]) => Show[]) {
  const p = getProject(pid);
  if (p) saveProject({ ...p, shows: fn(showsOf(p).map((s) => ({ ...s }))) });
}
export function addShow(pid: string): Show {
  const p = getProject(pid)!;
  const ss = showsOf(p);
  const s: Show = { id: uid(), name: '공연 ' + (ss.length + 1), order: Math.max(...ss.map((x) => x.order)) + 1 };
  setShows(pid, (l) => [...l, s]);
  return s;
}
export function updateShow(pid: string, sid: string, patch: Partial<Show>) {
  setShows(pid, (l) => l.map((s) => { if (s.id !== sid) return s; const n = { ...s, ...patch }; if ('size' in patch && !patch.size) delete n.size; return n; }));
}
/** 공연 삭제: 안의 LED·보더는 휴지통으로 */
export function removeShow(pid: string, sid: string) {
  ledsOfShow(pid, sid).forEach((l) => trashLed(l.id));
  bordersOfShow(pid, sid).forEach((b) => trashBorder(b.id));
  setShows(pid, (l) => l.filter((s) => s.id !== sid));
}
/** 공연 복제: LED·보더 함께 */
export function duplicateShow(pid: string, sid: string) {
  const src = showOf(pid, sid);
  if (!src) return;
  const p = getProject(pid)!;
  const n: Show = { ...structuredClone(src), id: uid(), name: src.name + ' 복사본', order: Math.max(...showsOf(p).map((x) => x.order)) + 1 };
  setShows(pid, (l) => [...l, n]);
  for (const l of ledsOfShow(pid, src.id)) { const c = duplicateLed(l.id, pid, false); if (c) updateLed(c.id, (x) => ({ ...x, showId: n.id })); }
  for (const b of bordersOfShow(pid, src.id)) { const c = duplicateBorder(b.id, pid, false); if (c) updateBorder(c.id, (x) => { x.showId = n.id; }); }
}
/** 공연 해상도를 따라가는 보더 크기 맞추기 (달라진 것만 저장) */
export function syncShowBorders(pid: string) {
  const p = getProject(pid);
  if (!p) return;
  for (const s of showsOf(p)) {
    const sz = showSize(pid, s.id);
    if (!sz) continue;
    for (const b of bordersOfShow(pid, s.id)) {
      if (b.follow === false || (b.W === sz.w && b.H === sz.h)) continue;
      updateBorder(b.id, (x) => { x.W = sz.w; x.H = sz.h; });
    }
  }
}

/* ---------- 프로젝트 ---------- */
export function saveProject(p: Project) {
  p.updatedAt = Date.now();
  state.projects = state.projects.map((x) => (x.id === p.id ? p : x));
  if (!state.projects.includes(p)) state.projects = [...state.projects, p];
  emit();
  schedule('p:' + p.id, () => DB.putProject(p));
}

export function createProject(name = '새 프로젝트'): Project {
  const now = Date.now();
  const p: Project = { id: uid(), name, order: now, createdAt: now, updatedAt: now };
  state.projects = [...state.projects, p];
  emit();
  DB.putProject(p);
  changed();
  return p;
}

export function updateProject(id: string, patch: Partial<Project>) {
  const p = getProject(id);
  if (p) saveProject({ ...p, ...patch });
}

export function trashProject(id: string) {
  const now = Date.now();
  updateProject(id, { deletedAt: now });
}
export function restoreProject(id: string) {
  const p = getProject(id);
  if (p) { const { deletedAt: _d, ...rest } = p; saveProject(rest as Project); }
}
export async function purgeProject(id: string) {
  for (const l of state.leds.filter((l) => l.projectId === id)) await DB.deleteLedHard(l.id);
  for (const b of state.borders.filter((b) => b.projectId === id)) await DB.deleteBorderHard(b.id);
  state.borders = state.borders.filter((b) => b.projectId !== id);
  await DB.deleteProjectHard(id);
  state.leds = state.leds.filter((l) => l.projectId !== id);
  state.projects = state.projects.filter((p) => p.id !== id);
  emit();
}

export function duplicateProject(id: string) {
  const src = getProject(id);
  if (!src) return;
  const p = createProject(src.name + ' 복사본');
  if (src.shows) updateProject(p.id, { shows: structuredClone(src.shows) });
  for (const l of ledsOf(id)) duplicateLed(l.id, p.id, false);
  for (const b of bordersOf(id)) duplicateBorder(b.id, p.id, false);
}

/* ---------- 보더 묶음 ---------- */
export function newBorderSet(projectId: string, showId?: string): BorderSet {
  const now = Date.now();
  const sz = showSize(projectId, showId);
  const W = sz?.w || 1920, H = sz?.h || 1080;
  const n = (showId ? bordersOfShow(projectId, showId) : bordersOf(projectId)).length + 1;
  return { id: uid(), projectId, showId, follow: true, order: now, name: '보더 ' + n, W, H, layers: [newLayer(uid(), '레이어 1', W, H)], createdAt: now, updatedAt: now };
}
export function addBorder(b: BorderSet) {
  state.borders = [...state.borders, b];
  emit();
  DB.putBorder(b);
  changed();
  return b;
}
export function saveBorder(b: BorderSet) {
  b.updatedAt = Date.now();
  state.borders = state.borders.map((x) => (x.id === b.id ? b : x));
  emit();
  schedule('b:' + b.id, () => DB.putBorder(b));
}
/** 불변 업데이트: updateBorder(id, b => { b.W = 3840; }) */
export function updateBorder(id: string, fn: (b: BorderSet) => void) {
  const b = getBorder(id);
  if (!b) return;
  const c = structuredClone(b);
  fn(c);
  saveBorder(c);
}
export function duplicateBorder(id: string, toProject?: string, rename = true) {
  const src = getBorder(id);
  if (!src) return;
  const now = Date.now();
  const c: BorderSet = structuredClone(src);
  c.id = uid();
  c.projectId = toProject || src.projectId;
  c.order = rename ? src.order + 0.5 : src.order;
  if (rename) c.name = src.name + ' 복사본';
  c.layers = c.layers.map((l) => ({ ...l, id: uid() }));
  delete c.deletedAt;
  c.createdAt = now; c.updatedAt = now;
  return addBorder(c);
}
export function trashBorder(id: string) { updateBorder(id, (b) => { b.deletedAt = Date.now(); }); }
export function restoreBorder(id: string) {
  updateBorder(id, (b) => { delete b.deletedAt; });
  const b = getBorder(id);
  if (b) { const p = getProject(b.projectId); if (p?.deletedAt) restoreProject(p.id); }
}
export async function purgeBorder(id: string) {
  await DB.deleteBorderHard(id);
  state.borders = state.borders.filter((b) => b.id !== id);
  emit();
}

/* ---------- LED ---------- */
export function newLed(projectId: string): Led {
  const now = Date.now();
  const n = ledsOf(projectId).length + 1;
  return {
    id: uid(),
    projectId,
    order: now,
    number: String(n).padStart(2, '0'),
    name: 'LED ' + n,
    header: '',
    pitchModel: '',
    cabinet: { pxW: 128, pxH: 128, mmW: 500, mmH: 500 },
    gapPx: 100,
    faces: [{ id: uid(), name: 'MAIN', w: 1280, h: 768, gapBefore: false }],
    input: { options: { ...DEFAULT_OPTIONS } },
    output: {
      preset: state.settings.defaultPreset,
      customW: 3840,
      customH: 2160,
      keepGap: false,
      flow: 'row-wrap',
      align: 'top-left',
      options: { ...DEFAULT_OPTIONS },
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** 공연에 LED 추가: 공연에 LED가 있으면 마지막 LED 설정(캐비닛·면 = 같은 해상도)을 그대로 이어받음 */
export function newLedInShow(pid: string, sid: string): Led {
  const list = ledsOfShow(pid, sid);
  const t = list[list.length - 1];
  const now = Date.now();
  const n = list.length + 1;
  if (!t) return { ...newLed(pid), showId: sid, number: String(n).padStart(2, '0'), name: 'LED ' + n };
  const c: Led = structuredClone(t);
  c.id = uid(); c.showId = sid; c.order = now; c.createdAt = now; c.updatedAt = now;
  c.number = String(n).padStart(2, '0'); c.name = 'LED ' + n;
  const idMap = new Map<string, string>();
  c.faces = c.faces.map((f) => { const nid = uid(); idMap.set(f.id, nid); return { ...f, id: nid }; });
  if (c.input.manual) c.input.manual = Object.fromEntries(Object.entries(c.input.manual).filter(([k]) => idMap.has(k)).map(([k, v]) => [idMap.get(k)!, v]));
  delete c.output.manual; delete c.input.doneAt; delete c.output.doneAt; delete c.input.map; delete c.deletedAt;
  return c;
}

export function addLed(l: Led) {
  state.leds = [...state.leds, l];
  emit();
  DB.putLed(l);
  changed();
  return l;
}

export function saveLed(l: Led) {
  l.updatedAt = Date.now();
  state.leds = state.leds.map((x) => (x.id === l.id ? l : x));
  emit();
  schedule('l:' + l.id, () => DB.putLed(l));
}

/** 불변 업데이트 헬퍼: updateLed(id, l => { l.gapPx = 50; return l; }) */
export function updateLed(id: string, fn: (l: Led) => Led) {
  const l = getLed(id);
  if (l) saveLed(fn(structuredClone(l)));
}

export function duplicateLed(id: string, toProject?: string, rename = true) {
  const src = getLed(id);
  if (!src) return;
  const now = Date.now();
  const c: Led = structuredClone(src);
  c.id = uid();
  c.projectId = toProject || src.projectId;
  c.order = rename ? src.order + 0.5 : src.order;
  if (rename) c.name = src.name + ' 복사본';
  c.faces = c.faces.map((f: Face) => ({ ...f, id: uid() }));
  delete c.output.manual;
  delete c.input.manual;
  delete c.input.doneAt;
  delete c.output.doneAt;
  delete c.deletedAt;
  c.createdAt = now;
  c.updatedAt = now;
  return addLed(c);
}

export function trashLed(id: string) { updateLed(id, (l) => ({ ...l, deletedAt: Date.now() })); }
export function restoreLed(id: string) {
  updateLed(id, (l) => { delete l.deletedAt; return l; });
  const l = getLed(id);
  if (l) { const p = getProject(l.projectId); if (p?.deletedAt) restoreProject(p.id); }
}
export async function purgeLed(id: string) {
  await DB.deleteLedHard(id);
  state.leds = state.leds.filter((l) => l.id !== id);
  emit();
}

/* ---------- 클라우드에서 받은 변경 (다시 올리지 않음) ---------- */
type Kind = 'projects' | 'leds' | 'borders';
const putFn = { projects: DB.putProject, leds: DB.putLed, borders: DB.putBorder } as Record<Kind, (x: any) => Promise<void>>;
const delFn = { projects: DB.deleteProjectHard, leds: DB.deleteLedHard, borders: DB.deleteBorderHard } as Record<Kind, (id: string) => Promise<void>>;
/** 받은 항목이 이 기기 것보다 새로우면 반영. 반영했으면 true */
export function applyRemote(kind: Kind, item: any): boolean {
  const list = state[kind] as any[];
  const cur = list.find((x) => x.id === item.id);
  if (cur && (cur.updatedAt || 0) >= (item.updatedAt || 0)) return false;
  (state as any)[kind] = cur ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item];
  putFn[kind](item);
  return true;
}
export function removeRemote(kind: Kind, id: string): boolean {
  const list = state[kind] as any[];
  if (!list.some((x) => x.id === id)) return false;
  (state as any)[kind] = list.filter((x) => x.id !== id);
  delFn[kind](id);
  return true;
}

/* ---------- 설정 ---------- */
export function saveSettings(patch: Partial<Settings>) {
  state.settings = { ...state.settings, ...patch };
  applyAccent();
  emit();
  schedule('settings', () => DB.putSettings(state.settings));
}
export function applyAccent() {
  document.documentElement.style.setProperty('--accent', state.settings.accent);
}

export async function refreshExports() {
  state.exportsMeta = await DB.listExportMeta();
  emit();
}

/** 앱 안 확인창 (브라우저 confirm 은 PWA·인앱 브라우저에서 막히는 경우가 있어 사용 안 함) */
export function ask(msg: string, ok = '삭제'): Promise<boolean> {
  return new Promise((resolve) => set({ ask: { msg, ok, resolve } }));
}
/** 버튼 하나짜리 안내창 */
export function notice(msg: string): Promise<boolean> {
  return new Promise((resolve) => set({ ask: { msg, ok: '확인', info: true, resolve } }));
}
export function answer(v: boolean) {
  const a = state.ask;
  set({ ask: null });
  a?.resolve(v);
}
