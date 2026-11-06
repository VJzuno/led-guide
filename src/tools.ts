/** 같은 앱 안 도구 페이지(public/tools)의 저장 데이터를 백업·동기화에 포함
 *  - 도구들은 각자 localStorage 키에 저장 (같은 출처라 앱에서 읽고 쓸 수 있음)
 *  - tools/hub.js 가 값이 실제로 바뀔 때 `zuno.toolstamp.<키>` 에 시각을 남김 → 어느 기기가 더 최근에 고쳤는지 판단
 *  - 큐시트는 공연 단위로 합침(공연별 updatedAt, 삭제 기록 포함). 나머지는 키 통째로 최신이 이김 */

export interface ToolEntry { value: string; at: number }
export type ToolsData = Record<string, ToolEntry>;

export const TOOL_KEYS: { key: string; name: string }[] = [
  { key: 'cuesheet_maker_v1', name: '큐시트 메이커' },
  { key: 'vjWorkLogSimple', name: 'VJ 근무일지' },
  { key: 'borderMaker.v3', name: 'Border Maker' },
  { key: 'metalLogo.presets.v1', name: '3D 로고 프리셋' },
  { key: 'metalLogo.last.v1', name: '3D 로고 마지막 설정' },
];
const CUESHEET = 'cuesheet_maker_v1';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* 용량 초과 등 */ } };
const stampKey = (k: string) => 'zuno.toolstamp.' + k;
export const toolStamp = (k: string) => Number(get(stampKey(k)) || 0);

export function collectTools(): ToolsData {
  const out: ToolsData = {};
  for (const { key } of TOOL_KEYS) {
    const v = get(key);
    if (v != null) out[key] = { value: v, at: toolStamp(key) };
  }
  return out;
}

/** 마지막 백업 뒤로 바뀐 도구 수 */
export const toolsChangedSince = (t: number) => TOOL_KEYS.filter(({ key }) => toolStamp(key) > t).length;

interface Show { id: string; updatedAt?: number; [k: string]: unknown }
interface CueStore { shows: Show[]; currentId: string | null; deleted?: Record<string, number> }

function parseCue(s: string | null | undefined): CueStore | null {
  try { const v = JSON.parse(s || ''); return v && Array.isArray(v.shows) ? v : null; } catch { return null; }
}

/** 큐시트: 공연 id 별로 더 최근 것을 남기고, 삭제 기록이 더 최근이면 지움 */
function mergeCue(local: CueStore, remote: CueStore): { merged: CueStore; changed: number } {
  const deleted: Record<string, number> = { ...(remote.deleted || {}), ...(local.deleted || {}) };
  for (const [id, t] of Object.entries(remote.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
  const byId = new Map<string, Show>();
  for (const sh of local.shows) byId.set(sh.id, sh);
  for (const sh of remote.shows) {
    const cur = byId.get(sh.id);
    if (!cur || (sh.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(sh.id, sh);
  }
  const shows = [...byId.values()].filter((sh) => { const d = deleted[sh.id]; return !(d && d >= (sh.updatedAt || 0)); });
  // 이 기기 목록과 실제로 달라진 공연 수 (추가·교체·삭제)
  const localIds = new Set(local.shows.map((x) => x.id));
  const changed = shows.filter((sh) => !local.shows.includes(sh)).length + [...localIds].filter((id) => !shows.some((x) => x.id === id)).length;
  const currentId = shows.some((s) => s.id === local.currentId) ? local.currentId : null;
  return { merged: { shows, currentId, deleted }, changed };
}

/** 받은 도구 데이터를 이 기기에 합침. 바뀐 도구 이름 목록을 돌려줌 */
export function mergeTools(remote: ToolsData | undefined): string[] {
  if (!remote) return [];
  const changed: string[] = [];
  for (const { key, name } of TOOL_KEYS) {
    const r = remote[key];
    if (!r || typeof r.value !== 'string') continue;
    const lv = get(key), lt = toolStamp(key);
    if (lv === r.value) continue;
    if (key === CUESHEET) {
      const L = parseCue(lv), R = parseCue(r.value);
      if (R && L) {
        const { merged, changed: n } = mergeCue(L, R);
        if (n > 0) { set(key, JSON.stringify(merged)); set(stampKey(key), String(Math.max(lt, r.at || 0))); changed.push(name); }
        continue;
      }
      if (R && !L) { set(key, r.value); set(stampKey(key), String(r.at || Date.now())); changed.push(name); }
      continue;
    }
    // 이 기기에 없거나, 받은 쪽이 더 최근에 고친 것이면 교체
    if (lv == null || (r.at || 0) > lt) { set(key, r.value); set(stampKey(key), String(r.at || 0)); changed.push(name); }
  }
  return changed;
}
