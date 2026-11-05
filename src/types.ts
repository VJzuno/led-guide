export const SCHEMA_VERSION = 6;

export interface Project {
  id: string;
  name: string;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export interface Face {
  id: string;
  name: string;
  /** 면 크기 (픽셀 기준). 캐비닛 수는 여기서 계산 */
  w: number;
  h: number;
  gapBefore: boolean;
}

export interface GuideOptions {
  panelNumbers: boolean;
  crosshair: boolean;
  diagonals: boolean;
  faceLabels: boolean;
  headerBars: boolean; // 좌하단 헤더 태그
  infoTag: boolean;    // 우하단 정보 태그
  aeCoords: boolean;
  logo: boolean;      // 가운데 원 + 로고
  fitCircle: boolean; // 면에 꽉 맞는 원 (PNG/정지)
  rings: boolean;     // 퍼지는 링 (PNG에는 정지 프레임으로)
}

/** 가이드 글자 설정 (크기는 배율, 자간은 글자 크기 대비 em, 행간은 배수) */
export interface Typography {
  nameSize: number;
  nameTracking: number;
  infoSize: number;
  infoTracking: number;
  infoLeading: number;
}
export const DEFAULT_TYPO: Typography = { nameSize: 1, nameTracking: 0, infoSize: 1, infoTracking: 0, infoLeading: 1.45 };

/** 영상 모션 시간 (초). 빌드업: sweep 동안 캐비닛이 왼쪽 아래부터 가로로 쌓이고 → fade 동안 위 요소가 한 번에 페이드인 → hold 동안 링 */
export interface MotionCfg {
  sweep: number;  // 픽셀맵 쌓이는 시간
  fade: number;   // 위 요소 페이드인 시간
  hold: number;   // 다 나온 뒤 링 유지 시간
  loop: number;   // 루프 영상 길이 = 링 주기
}
export const DEFAULT_MOTION: MotionCfg = { sweep: 2.4, fade: 1.2, hold: 3, loop: 4 };

export type OutputPreset = 'UHD' | 'DCI' | 'FHD' | 'CUSTOM';
export type Flow = 'row-wrap' | 'column-wrap';
export type Align = 'top-left' | 'center';

export interface Led {
  id: string;
  projectId: string;
  order: number;
  number: string;
  name: string;
  header: string;
  pitchModel: string;
  cabinet: { pxW: number; pxH: number; mmW: number; mmH: number };
  /** (v4 이전) 세로 캐비닛 수. v5부터 면별 h 픽셀 사용 */
  rows?: number;
  gapPx: number;
  faces: Face[];
  /** 면 이름·정보 글자 (인풋·아웃풋 공통). 없으면 DEFAULT_TYPO */
  typo?: Typography;
  /** 커스텀 로고 (PNG dataURL). 없으면 기본 ZUNO 로고 */
  logo?: string;
  /** 가운데 로고 원 크기 배율 (1 = 기본, 가장 작은 면의 20%). 인풋·아웃풋 공통 */
  logoScale?: number;
  /** 영상 모션 시간. 없으면 DEFAULT_MOTION */
  motion?: MotionCfg;
  input: {
    options: GuideOptions;
    /** 인풋 캔버스 크기. auto = 면 배치에 맞춤 */
    canvas?: { mode: 'auto' | 'custom'; w: number; h: number };
    /** 면별 수동 위치 (드래그 배치). 값이 있으면 자동 배치보다 우선 */
    manual?: Record<string, { x: number; y: number }>;
    doneAt?: number;
  };
  output: {
    preset: OutputPreset;
    customW: number;
    customH: number;
    keepGap: boolean;
    flow: Flow;
    align: Align;
    /** 면별 수동 위치 (향후 드래그 편집용). 값이 있으면 자동 배치보다 우선 */
    manual?: Record<string, { x: number; y: number }>;
    options: GuideOptions;
    doneAt?: number;
  };
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}

export type GuideKind = 'IN' | 'OUT';

export interface ExportMeta {
  id: string;
  projectId: string;
  ledId: string;
  kind: GuideKind;
  fileName: string;
  w: number;
  h: number;
  createdAt: number;
  format?: 'png' | 'mp4' | 'webm';
  variant?: 'LOOP' | 'BUILD';
}
export interface ExportRecord extends ExportMeta {
  blob: Blob;
}

export interface Settings {
  accent: string;
  defaultPreset: OutputPreset;
  logoTint: 'white' | 'accent';
}

export const DEFAULT_SETTINGS: Settings = { accent: '#5613C8', defaultPreset: 'UHD', logoTint: 'white' };

export const DEFAULT_OPTIONS: GuideOptions = {
  panelNumbers: true,
  crosshair: true,
  diagonals: true,
  faceLabels: true,
  headerBars: true,
  infoTag: true,
  aeCoords: false,
  logo: true,
  fitCircle: true,
  rings: true,
};

export const PRESETS: Record<Exclude<OutputPreset, 'CUSTOM'>, { label: string; w: number; h: number }> = {
  UHD: { label: '4K UHD', w: 3840, h: 2160 },
  DCI: { label: 'DCI 4K', w: 4096, h: 2160 },
  FHD: { label: 'FHD', w: 1920, h: 1080 },
};

export interface BackupFile {
  app: 'zuno-led-guide-maker';
  schemaVersion: number;
  exportedAt: number;
  settings: Settings;
  projects: Project[];
  leds: Led[];
}
