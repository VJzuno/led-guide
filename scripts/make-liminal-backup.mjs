// LiMiNaL 도시별 LED 구성 → 앱 백업 파일 (더보기 → 동기화 → 백업 파일 불러오기)
// 사용: node scripts/make-liminal-backup.mjs <EU 프로젝트 id> [showId] > out.json
// 유럽 5개 도시(EU LED)는 앱에 이미 있어서 이스탄불~트빌리시 6개만. LED만 넣음. 프로젝트 자체는 건드리지 않음 (불러오기는 id 기준 합치기라 기존 데이터는 그대로)
import { randomUUID } from 'node:crypto';

const [projectId, showId] = process.argv.slice(2);
if (!projectId) { console.error('프로젝트 id가 필요해요'); process.exit(1); }

const OPT = { panelNumbers: true, crosshair: true, diagonals: true, faceLabels: true, headerBars: true, infoTag: true, aeCoords: false, logo: true, fitCircle: true, rings: true };
const now = Date.now();
const id = () => randomUUID().replace(/-/g, '').slice(0, 12);
const face = (name, w, h) => ({ id: id(), name, w, h, gapBefore: false });

const SPECS = [
  { name: 'ISTANBUL', header: 'LiMiNaL', pitch: 'P3.9',
    cab: [128, 128, 500, 500], faces: [['IMAG_L', 2816, 1536], ['CENTER', 1536, 1536], ['IMAG_R', 2816, 1536]] },
  { name: 'ŁÓDŹ', header: 'LiMiNaL', pitch: 'P3.9',
    cab: [256, 128, 1000, 500], faces: [['IMAG_L', 2816, 1536], ['CENTER', 1536, 1536], ['IMAG_R', 2816, 1536]] },
  { name: 'HELSINKI', header: 'LiMiNaL', pitch: 'ROE BQ 4.6',
    cab: [108, 216, 500, 1000], faces: [['IMAG_L', 1512, 1296], ['B_L', 864, 1296], ['CENTER', 1296, 1296], ['B_R', 864, 1296], ['IMAG_R', 1512, 1296]] },
  { name: 'MADRID', header: 'LiMiNaL', pitch: '다이컨러 3.9',
    cab: [128, 256, 500, 1000], faces: [['IMAG_L', 1280, 1536], ['B_L', 1024, 1536], ['CENTER', 2048, 1536], ['B_R', 1024, 1536], ['IMAG_R', 1280, 1536]] },
  { name: 'ALMATY', header: 'LiMiNaL', pitch: 'P3.9',
    cab: [128, 128, 500, 500], faces: [['IMAG_L', 2816, 1536], ['CENTER', 1536, 1536], ['IMAG_R', 2816, 1536]] },
  { name: 'TBILISI', header: 'LiMiNaL', pitch: 'P2.6 + P2.8',
    cab: [192, 192, 500, 500], faces: [['IMAG_L', 1536, 2304], ['B_L', 1152, 2304], ['CENTER', 1920, 2304], ['B_R', 1152, 2304], ['IMAG_R', 1536, 2304]] },
];

const leds = SPECS.map((s, i) => ({
  id: id(), projectId, ...(showId ? { showId } : {}), order: now + i,
  number: String(i + 2).padStart(2, '0'), name: s.name, header: s.header, pitchModel: s.pitch,
  cabinet: { pxW: s.cab[0], pxH: s.cab[1], mmW: s.cab[2], mmH: s.cab[3] },
  gapPx: 0, faces: s.faces.map((f) => face(...f)),
  input: { options: { ...OPT } },
  output: { preset: 'UHD', customW: 3840, customH: 2160, keepGap: false, flow: 'row-wrap', align: 'top-left', options: { ...OPT } },
  createdAt: now + i, updatedAt: now + i,
}));

process.stdout.write(JSON.stringify({
  app: 'zuno-led-guide-maker', schemaVersion: 6, exportedAt: now,
  settings: { accent: '#5613C8', defaultPreset: 'UHD', logoTint: 'white' },
  projects: [], leds, borders: [],
}, null, 1));
