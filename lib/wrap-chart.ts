import type { Side } from './free-wrap.ts';
type ChartPoint = { s: number; h: number };
/** Clip a seam-lifted closed-pose triangle to a single perimeter side. */
export function sidePolygons(
  input: ChartPoint[],
  length: number,
  width: number,
  side: Side,
) {
  const period = 2 * (length + width),
    start = side === 'entry' ? 0 : length + width;
  const ss = input.map((p) => p.s),
    lift = Math.max(...ss) - Math.min(...ss) > period / 2;
  const polygon = input.map((p) => ({
    ...p,
    s: lift && p.s < period / 2 ? p.s + period : p.s,
  }));
  const clip = (pts: ChartPoint[], boundary: number, above: boolean) => {
    const result: ChartPoint[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i],
        b = pts[(i + 1) % pts.length],
        insideA = above ? a.s >= boundary : a.s <= boundary,
        insideB = above ? b.s >= boundary : b.s <= boundary;
      if (insideA) result.push(a);
      if (insideA !== insideB) {
        const t = (boundary - a.s) / (b.s - a.s);
        result.push({ s: boundary, h: a.h + t * (b.h - a.h) });
      }
    }
    return result;
  };
  return [0, period]
    .map((offset) =>
      clip(
        clip(polygon, start + offset, true),
        start + length + offset,
        false,
      ).map((p) => ({
        x:
          side === 'entry'
            ? 1 - (p.s - offset) / length
            : (p.s - offset - start) / length,
        y: p.h,
      })),
    )
    .filter((p) => p.length >= 3);
}
