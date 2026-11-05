// 사용법: npm run hash -- "비밀번호"   → SHA-256 hex 출력 (VITE_PASS_HASH 에 넣기)
import { createHash } from 'node:crypto';
const pw = process.argv[2];
if (!pw) { console.error('usage: npm run hash -- "password"'); process.exit(1); }
console.log(createHash('sha256').update(pw, 'utf8').digest('hex'));
