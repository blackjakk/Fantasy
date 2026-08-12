/**
 * Deterministic seeded RNG (mulberry32). All randomness in every engine flows
 * through an Rng instance so that any simulation, season, or test is exactly
 * reproducible from its seed.
 */
export class Rng {
  private state: number;
  private spareNormal: number | null = null;

  constructor(seed: number) {
    // Mix the seed so that adjacent seeds do not produce correlated streams.
    this.state = hashU32(seed >>> 0);
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) throw new Error(`int(): max ${max} < min ${min}`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Uniform float in [min, max). */
  uniform(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Standard normal via Box-Muller, with the spare value cached. */
  normal(mean = 0, sd = 1): number {
    if (this.spareNormal !== null) {
      const z = this.spareNormal;
      this.spareNormal = null;
      return mean + sd * z;
    }
    let u = 0;
    while (u === 0) u = this.next();
    const v = this.next();
    const r = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    this.spareNormal = r * Math.sin(theta);
    return mean + sd * r * Math.cos(theta);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick(): empty array');
    return arr[this.int(0, arr.length - 1)] as T;
  }

  /** Fisher-Yates shuffle returning a new array. */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /** Sample k distinct elements. */
  sample<T>(arr: readonly T[], k: number): T[] {
    if (k > arr.length) throw new Error(`sample(): k ${k} > length ${arr.length}`);
    return this.shuffle(arr).slice(0, k);
  }

  /**
   * Derive an independent child stream. Children with different labels are
   * decorrelated from each other and from the parent regardless of call order.
   */
  child(label: string): Rng {
    let h = this.state;
    for (let i = 0; i < label.length; i++) {
      h = Math.imul(h ^ label.charCodeAt(i), 0x9e3779b1) >>> 0;
    }
    return new Rng(h);
  }
}

function hashU32(x: number): number {
  let h = x >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
