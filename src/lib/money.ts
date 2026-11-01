import type { Cents } from './types';

let formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function setCurrency(currency: string) {
  try {
    formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  } catch {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  }
}

export function fmt(cents: Cents): string {
  return formatter.format(cents / 100);
}

/** Parse user input like "12.50", "$1,200", "-4", "(30)" into cents. Returns null if invalid. */
export function parseMoney(input: string): Cents | null {
  let s = input.trim();
  if (s === '') return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$€£¥,\s]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  // Allow simple math like "20+15.5" or "100-30".
  if (/^[0-9.]+([+\-*/][0-9.]+)+$/.test(s)) {
    const value = evalSimple(s);
    if (value === null) return null;
    return Math.round(value * 100) * (negative ? -1 : 1);
  }
  if (!/^\d*\.?\d*$/.test(s) || s === '.') return null;
  const value = Math.round(parseFloat(s) * 100);
  if (Number.isNaN(value)) return null;
  return negative ? -value : value;
}

function evalSimple(expr: string): number | null {
  const tokens = expr.match(/[0-9.]+|[+\-*/]/g);
  if (!tokens) return null;
  // Two passes: * and / first, then + and -.
  const nums: number[] = [];
  const ops: string[] = [];
  for (const t of tokens) {
    if ('+-*/'.includes(t)) ops.push(t);
    else {
      const n = parseFloat(t);
      if (Number.isNaN(n)) return null;
      nums.push(n);
    }
  }
  if (nums.length !== ops.length + 1) return null;
  const n2: number[] = [nums[0]];
  const o2: string[] = [];
  ops.forEach((op, i) => {
    const next = nums[i + 1];
    if (op === '*') n2[n2.length - 1] *= next;
    else if (op === '/') n2[n2.length - 1] = next === 0 ? NaN : n2[n2.length - 1] / next;
    else {
      o2.push(op);
      n2.push(next);
    }
  });
  let result = n2[0];
  o2.forEach((op, i) => (result = op === '+' ? result + n2[i + 1] : result - n2[i + 1]));
  return Number.isFinite(result) ? result : null;
}

/** Plain number string for editing inputs, e.g. 1250 -> "12.50". */
export function toInput(cents: Cents): string {
  if (cents === 0) return '';
  return (cents / 100).toFixed(2);
}
