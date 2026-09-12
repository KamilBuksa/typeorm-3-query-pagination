export interface Stats {
  runs: number;
  min: number;
  p50: number;
  p90: number;
  max: number;
  mean: number;
}

export function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return {
    runs: sorted.length,
    min: round(sorted[0]),
    p50: round(percentile(50)),
    // p90 needs n >= 20 to mean anything; below that it collapses onto max
    p90: round(percentile(90)),
    max: round(sorted[sorted.length - 1]),
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export async function measure<T>(
  fn: () => Promise<T>,
): Promise<{ ms: number; result: T }> {
  const started = process.hrtime.bigint();
  const result = await fn();
  return { ms: Number(process.hrtime.bigint() - started) / 1e6, result };
}
