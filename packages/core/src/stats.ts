/** Small statistics helpers used by the simulator's metric battery. */

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0
    ? ((s[mid - 1] as number) + (s[mid] as number)) / 2
    : (s[mid] as number);
}

export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)));
  return s[idx] as number;
}

/** Pearson correlation. Returns 0 when either side has no variance. */
export function correlation(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = (xs[i] as number) - mx;
    const b = (ys[i] as number) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return 0;
  return num / Math.sqrt(dx * dy);
}

/** Spearman rank correlation. */
export function rankCorrelation(xs: readonly number[], ys: readonly number[]): number {
  return correlation(ranks(xs), ranks(ys));
}

/** 1-based ranks, average rank for ties, highest value = rank 1. */
export function ranks(xs: readonly number[]): number[] {
  const indexed = xs.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => b.v - a.v);
  const out = new Array<number>(xs.length).fill(0);
  let pos = 0;
  while (pos < indexed.length) {
    let end = pos;
    while (
      end + 1 < indexed.length &&
      (indexed[end + 1] as { v: number }).v === (indexed[pos] as { v: number }).v
    ) {
      end++;
    }
    const avgRank = (pos + end) / 2 + 1;
    for (let k = pos; k <= end; k++) {
      out[(indexed[k] as { i: number }).i] = avgRank;
    }
    pos = end + 1;
  }
  return out;
}
