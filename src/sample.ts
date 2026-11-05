import { createProject, newLed, addLed, uid } from './store';

/** 샘플: LED 1개, 면 3개 (B_L 1024×768 / CENTER_A 1280×768 앞 갭 / B_R 1024×768), 캐비닛 128px · 500mm, 갭 100px */
export function createSample() {
  const p = createProject('SAMPLE SHOW');
  const l = newLed(p.id);
  l.number = '01';
  l.name = 'MAIN STAGE';
  l.header = 'SAMPLE SHOW';
  l.pitchModel = 'P3.9';
  l.cabinet = { pxW: 128, pxH: 128, mmW: 500, mmH: 500 };
  l.gapPx = 100;
  l.faces = [
    { id: uid(), name: 'B_L', w: 1024, h: 768, gapBefore: false },
    { id: uid(), name: 'CENTER_A', w: 1280, h: 768, gapBefore: true },
    { id: uid(), name: 'B_R', w: 1024, h: 768, gapBefore: false },
  ];
  addLed(l);
  return { project: p, led: l };
}
