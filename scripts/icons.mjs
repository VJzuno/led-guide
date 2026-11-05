// 앱 아이콘 PNG 생성 (외부 의존성 없음)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };

function png(S, pad) {
  const px = Buffer.alloc(S * S * 4);
  const set = (x, y, [r, g, b]) => { if (x < 0 || y < 0 || x >= S || y >= S) return; const i = (y * S + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255; };
  const rect = (x, y, w, h, c) => { for (let j = Math.round(y); j < Math.round(y + h); j++) for (let i = Math.round(x); i < Math.round(x + w); i++) set(i, j, c); };
  rect(0, 0, S, S, [0, 0, 0]);
  const P = [168, 85, 247], W = [255, 255, 255], G1 = [58, 58, 82], G2 = [42, 30, 77];
  const m = S * pad, inner = S - m * 2, u = inner / 20;
  // 세 개의 LED 면 (가운데 앞 갭)
  const faceY = m + u * 6, faceH = u * 8;
  const faces = [[m + u * 1, 5], [m + u * 7.2, 6], [m + u * 13.6, 5.4]];
  for (const [fx, cols] of faces) {
    const cw = u * cols / 4, ch = faceH / 3;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) rect(fx + c * cw, faceY + r * ch, cw, ch, (r + c) % 2 ? G1 : G2);
    const t = Math.max(1, u * 0.18);
    rect(fx, faceY, u * cols, t, W); rect(fx, faceY + faceH - t, u * cols, t, W);
    rect(fx, faceY, t, faceH, W); rect(fx + u * cols - t, faceY, t, faceH, W);
  }
  // 퍼플 코너 브래킷
  const L = u * 4, T = u * 0.9, a = m, b = S - m;
  rect(a, a, L, T, P); rect(a, a, T, L, P);
  rect(b - L, a, L, T, P); rect(b - T, a, T, L, P);
  rect(a, b - T, L, T, P); rect(a, b - L, T, L, P);
  rect(b - L, b - T, L, T, P); rect(b - T, b - L, T, L, P);
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync('public/icons/apple-touch-icon.png', png(180, 0.1));
writeFileSync('public/icons/icon-192.png', png(192, 0.1));
writeFileSync('public/icons/icon-512.png', png(512, 0.1));
writeFileSync('public/icons/icon-maskable-512.png', png(512, 0.2));
console.log('icons ok');
