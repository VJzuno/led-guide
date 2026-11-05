import { useEffect, useState } from 'preact/hooks';
import * as DB from './db';
import {
  DEFAULT_OPTIONS, DEFAULT_SETTINGS,
  type Project, type Led, type ExportMeta, type Settings, type Face,
} from './types';

export interface State {
  ready: boolean;
  projects: Project[];
  leds: Led[];
  exportsMeta: ExportMeta[];
  settings: Settings;
  online: boolean;
  toast: string | null;
  updateReady: boolean;
  saveFallback: { url: string; name: string; type: string } | null;
  fontsReady: number;
  ask: { msg: string; ok: string; resolve: (v: boolean) => void } | null;
}

export const state: State = {
  ready: false,
  projects: [],
  leds: [],
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
const pending = new Map<string, () => Promise<void>>();
let timer: number | undefined;
function schedule(key: string, fn: () => Promise<void>) {
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
  await DB.deleteProjectHard(id);
  state.leds = state.leds.filter((l) => l.projectId !== id);
  state.projects = state.projects.filter((p) => p.id !== id);
  emit();
}

export function duplicateProject(id: string) {
  const src = getProject(id);
  if (!src) return;
  const p = createProject(src.name + ' 복사본');
  for (const l of ledsOf(id)) duplicateLed(l.id, p.id, false);
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

export function addLed(l: Led) {
  state.leds = [...state.leds, l];
  emit();
  DB.putLed(l);
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
export function answer(v: boolean) {
  const a = state.ask;
  set({ ask: null });
  a?.resolve(v);
}
