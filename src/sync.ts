/* iCloud 백업 간편화
 * 웹앱은 iCloud 에 직접 접근할 수 없어서, iOS 공유 시트(파일에 저장 → iCloud Drive)와
 * 파일 선택(iCloud Drive 에서 고르기)을 한 번에 이어주는 방식.
 * - 저장: 전체 데이터를 JSON 한 파일로 → 아이폰은 공유 시트, Mac 은 다운로드
 * - 불러오기: 최신 것끼리 합치기 (항목별 updatedAt 이 더 새로운 쪽이 이김, 삭제도 포함)
 * - 마지막 저장 시각 · 그 뒤로 바뀐 항목 수 표시 */
import { SCHEMA_VERSION, type BackupFile, type Project, type Led } from './types';
import { mergeBackup, loadAll, setMeta, getMeta } from './db';
import { state, flush, emit } from './store';
import { isIOS } from './export';
import { collectTools, mergeTools, toolsChangedSince } from './tools';

const LS_LAST = 'zuno.backup.last';
const LS_LOAD = 'zuno.backup.lastLoad';

const lsNum = (k: string) => { try { return Number(localStorage.getItem(k) || 0); } catch { return 0; } };
const lsSet = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } };

export const lastBackupAt = () => lsNum(LS_LAST);
export const lastLoadAt = () => lsNum(LS_LOAD);

/** IndexedDB 에도 기록 (localStorage 가 지워져도 유지) */
export async function restoreSyncMeta() {
  const m = await getMeta<{ last?: number; load?: number }>('sync');
  if (m?.last && m.last > lsNum(LS_LAST)) lsSet(LS_LAST, m.last);
  if (m?.load && m.load > lsNum(LS_LOAD)) lsSet(LS_LOAD, m.load);
}
const saveSyncMeta = () => setMeta('sync', { last: lastBackupAt(), load: lastLoadAt() });

/** 마지막 저장(또는 드라이브 동기화) 뒤로 바뀐 프로젝트·LED·도구 수 */
export function changedSinceBackup() {
  const t = Math.max(lastBackupAt(), lsNum(LS_DRIVE));
  const n = (xs: (Project | Led)[]) => xs.filter((x) => (x.updatedAt || 0) > t).length;
  return n(state.projects) + n(state.leds) + toolsChangedSince(t);
}
/** 구글 드라이브 마지막 동기화 시각 (gdrive.ts 가 기록) */
export const LS_DRIVE = 'zuno.drive.last';
/** 백업을 권할 상태인가: 바뀐 게 있고, 한 번도 안 했거나 6시간 넘게 지남 */
export function needsBackup() {
  const last = Math.max(lastBackupAt(), lsNum(LS_DRIVE));
  return changedSinceBackup() > 0 && (!last || Date.now() - last > 6 * 3600_000);
}

const deviceName = () => (/iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) || isIOS() ? 'iPad' : /Mac/.test(navigator.platform) ? 'Mac' : 'PC');
const stamp = () => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

/** 이 기기의 전체 데이터 (LED 프로젝트 + 도구) */
export async function buildBackup(): Promise<BackupFile> {
  await flush();
  return {
    app: 'zuno-led-guide-maker', schemaVersion: SCHEMA_VERSION, exportedAt: Date.now(),
    settings: state.settings, projects: state.projects, leds: state.leds, tools: collectTools(),
  };
}

/** 받은 백업을 이 기기에 합침: LED 항목별 최신 우선 + 도구 데이터 */
export async function applyBackup(b: BackupFile) {
  await flush();
  const r = await mergeBackup(b);
  const tools = mergeTools(b.tools);
  const d = await loadAll();
  Object.assign(state, { projects: d.projects, leds: d.leds });
  emit();
  return { ...r, tools };
}

/** iCloud에 저장. 저장 창을 닫으면(취소) false */
export async function saveToICloud(): Promise<boolean> {
  const b = await buildBackup();
  const name = `LGM-backup_${stamp()}_${deviceName()}.json`;
  const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  let done = false;
  if (isIOS() && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); done = true; } catch (e: any) { if (e?.name === 'AbortError') return false; }
  }
  if (!done) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  lsSet(LS_LAST, b.exportedAt);
  await saveSyncMeta();
  emit();
  return true;
}

export interface MergeResult { added: number; updated: number; kept: number; tools: string[]; from: string; exportedAt: number }

/** iCloud에서 불러오기: 최신 것끼리 합치기 */
export async function loadFromFile(f: File): Promise<MergeResult> {
  const b = JSON.parse(await f.text()) as BackupFile;
  const r = await applyBackup(b);
  lsSet(LS_LOAD, Date.now());
  await saveSyncMeta();
  emit();
  const from = (f.name.match(/_(iPhone|iPad|Mac|PC)\.json$/) || [])[1] || '';
  return { ...r, from, exportedAt: b.exportedAt };
}

export function ago(t: number) {
  if (!t) return '한 번도 안 함';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
