/* 숫자 칸 수식 계산: 230/2, 128*8+100, (1920-100)/2, 3x128 …
 * eval 을 쓰지 않는 작은 파서. 쓸 수 있는 것: 숫자 . + - * / ( ) 와 × ÷ x X − 전각 기호 */

const norm = (s: string) =>
  s.replace(/[×xX＊]/g, '*').replace(/[÷／]/g, '/').replace(/[−–—]/g, '-').replace(/＋/g, '+')
   .replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/,/g, '.').replace(/\s+/g, '');

/** 계산 결과. 수식이 아니거나 틀리면 null */
export function evalExpr(input: string): number | null {
  const s = norm(input);
  if (!s || /[^0-9.+\-*/()]/.test(s)) return null;
  let i = 0;
  const peek = () => s[i];
  const num = (): number | null => {
    const m = /^\d*\.?\d+|^\d+\.?/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = (): number | null => {
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '-') { i++; const v = factor(); return v === null ? null : -v; }
    if (peek() === '(') {
      i++;
      const v = expr();
      if (v === null || peek() !== ')') return null;
      i++;
      return v;
    }
    return num();
  };
  const term = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = s[i++];
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const expr = (): number | null => {
    let v = term();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = s[i++];
      const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = expr();
  if (v === null || i !== s.length || !Number.isFinite(v)) return null;
  return v;
}

/** 수식처럼 보이는가 (숫자만이 아닌가) */
export const isExpr = (s: string) => /[+\-*/()×÷xX−]/.test(norm(s).replace(/^-/, ''));
