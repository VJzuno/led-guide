import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  SCHEMA_VERSION, DEFAULT_SETTINGS,
  type Project, type Led, type ExportRecord, type ExportMeta, type Settings, type BackupFile,
} from './types';

interface Schema extends DBSchema {
  meta: { key: string; value: { key: string; [k: string]: unknown } };
  projects: { key: string; value: Project };
  leds: { key: string; value: Led; indexes: { projectId: string } };
  exports: { key: string; value: ExportRecord; indexes: { createdAt: number } };
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB<Schema>('zuno-led', 1, {
      upgrade(d) {
        d.createObjectStore('meta', { keyPath: 'key' });
        d.createObjectStore('projects', { keyPath: 'id' });
        d.createObjectStore('leds', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        d.createObjectStore('exports', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      },
    });
  }
  return dbp;
}

/* ---------- 데이터 마이그레이션 ----------
 * schemaVersion N → N+1 변환 함수를 순서대로 추가.
 * 예) 2: (d) => { d.leds.forEach(l => l.newField ??= 0); }
 * 백업 가져오기에도 동일하게 적용된다. */
type Data = { projects: any[]; leds: any[]; settings: any };
const migrations: Record<number, (d: Data) => void> = {
  // v2: 가운데 로고 원 + 링 모션 옵션 추가
  2: (d) => {
    for (const l of d.leds) {
      for (const o of [l.input?.options, l.output?.options]) if (o) { o.logo ??= true; o.rings ??= true; }
    }
    d.settings.logoTint ??= 'white';
  },
  // v3: 하단 전체 바 → 코너 태그 (헤더 좌하단, 정보 우하단 따로 on/off)
  3: (d) => {
    for (const l of d.leds) {
      for (const o of [l.input?.options, l.output?.options]) if (o) o.infoTag ??= o.headerBars ?? true;
    }
  },
  // v4: PNG용 핏 원 옵션
  4: (d) => {
    for (const l of d.leds) for (const o of [l.input?.options, l.output?.options]) if (o) o.fitCircle ??= true;
  },
  // v5: 면 크기를 캐비닛 수 → 픽셀(W×H) 기준으로
  5: (d) => {
    for (const l of d.leds) {
      const pw = l.cabinet?.pxW || 128, ph = l.cabinet?.pxH || 128, rows = l.rows || 6;
      for (const f of l.faces || []) {
        f.w ??= (f.cols || 1) * pw;
        f.h ??= rows * ph;
        delete f.cols;
      }
    }
  },
};

export function migrate(d: Data, from: number): Data {
  for (let v = from + 1; v <= SCHEMA_VERSION; v++) migrations[v]?.(d);
  return d;
}

export async function loadAll() {
  const d = await db();
  const schema = (await d.get('meta', 'schema')) as { version?: number } | undefined;
  const settingsRec = (await d.get('meta', 'settings')) as Partial<Settings> | undefined;
  let data: Data = {
    projects: await d.getAll('projects'),
    leds: await d.getAll('leds'),
    settings: { ...DEFAULT_SETTINGS, ...(settingsRec || {}) },
  };
  const from = schema?.version ?? SCHEMA_VERSION;
  if (from < SCHEMA_VERSION) {
    data = migrate(data, from);
    const tx = d.transaction(['projects', 'leds', 'meta'], 'readwrite');
    for (const p of data.projects) tx.objectStore('projects').put(p);
    for (const l of data.leds) tx.objectStore('leds').put(l);
    await tx.done;
  }
  if (!schema || from !== SCHEMA_VERSION) await d.put('meta', { key: 'schema', version: SCHEMA_VERSION });
  const exportsMeta = await listExportMeta();
  delete (data.settings as any).key;
  return { projects: data.projects as Project[], leds: data.leds as Led[], settings: data.settings as Settings, exportsMeta, fresh: !schema };
}

export async function putProject(p: Project) { await (await db()).put('projects', p); }
export async function putLed(l: Led) { await (await db()).put('leds', l); }
export async function deleteProjectHard(id: string) { await (await db()).delete('projects', id); }
export async function deleteLedHard(id: string) { await (await db()).delete('leds', id); }
export async function putSettings(s: Settings) { await (await db()).put('meta', { key: 'settings', ...s }); }

export async function getMeta<T = any>(key: string): Promise<T | undefined> {
  return (await (await db()).get('meta', key)) as T | undefined;
}
export async function setMeta(key: string, val: Record<string, unknown>) {
  await (await db()).put('meta', { key, ...val });
}

export async function addExport(r: ExportRecord) { await (await db()).put('exports', r); }
export async function getExport(id: string) { return (await db()).get('exports', id); }
export async function deleteExport(id: string) { await (await db()).delete('exports', id); }
export async function listExportMeta(): Promise<ExportMeta[]> {
  const d = await db();
  const out: ExportMeta[] = [];
  let cur = await d.transaction('exports').store.index('createdAt').openCursor(null, 'prev');
  while (cur) {
    const { blob: _b, ...meta } = cur.value;
    out.push(meta);
    cur = await cur.continue();
  }
  return out;
}

export async function importBackup(b: BackupFile) {
  if (b.app !== 'zuno-led-guide-maker') throw new Error('이 앱의 백업 파일이 아닙니다');
  if (b.schemaVersion > SCHEMA_VERSION) throw new Error('더 새 버전 앱에서 만든 백업입니다. 앱을 업데이트하세요');
  const data = migrate({ projects: b.projects, leds: b.leds, settings: b.settings }, b.schemaVersion);
  const d = await db();
  const tx = d.transaction(['projects', 'leds'], 'readwrite');
  for (const p of data.projects) tx.objectStore('projects').put(p);
  for (const l of data.leds) tx.objectStore('leds').put(l);
  await tx.done;
}

export async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* ignore */ }
}
