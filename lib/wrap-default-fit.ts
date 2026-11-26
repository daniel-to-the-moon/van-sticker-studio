import {
  circumference,
  constrainDecal,
  type DecalPlacement,
  type WrapBody,
} from './wrap-layout.ts';

/** One eligible triangle in chart space: s0, h0, s1, h1, s2, h2 (metres). */
export type ChartTriangle = ArrayLike<number>;
export type ChartRect = { s0: number; s1: number; h0: number; h1: number };

/**
 * Lattice of chart points that lie on an eligible triangle, with prefix sums of
 * the misses so "is this whole rectangle on wrap film?" is O(1).
 */
export type ChartCoverage = {
  s0: number;
  h0: number;
  step: number;
  cols: number;
  rows: number;
  period: number;
  misses: Int32Array;
};

const DECAL_BASE_WIDTH_M = 3.5;
/** Matches constrainDecal's floor. */
const MIN_DECAL_SCALE = 0.25;
const EPS = 1e-9;

function inside(
  s: number,
  h: number,
  t: ArrayLike<number>,
  shift: number,
): boolean {
  const ax = t[0] + shift,
    ay = t[1],
    bx = t[2] + shift,
    by = t[3],
    cx = t[4] + shift,
    cy = t[5];
  const d1 = (s - bx) * (ay - by) - (ax - bx) * (h - by);
  const d2 = (s - cx) * (by - cy) - (bx - cx) * (h - cy);
  const d3 = (s - ax) * (cy - ay) - (cx - ax) * (h - ay);
  const neg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const pos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(neg && pos);
}

/**
 * Sample which lattice points of `window` sit on eligible film. Triangles are
 * moved by whole periods next to the window, like the boundary clipper does;
 * a triangle still spanning half the chart is a seam artefact and is skipped.
 */
export function measureCoverage(
  triangles: Iterable<ChartTriangle>,
  period: number,
  window: ChartRect,
  step = 0.02,
): ChartCoverage {
  const cols = Math.floor((window.s1 - window.s0) / step + EPS) + 1;
  const rows = Math.floor((window.h1 - window.h0) / step + EPS) + 1;
  const covered = new Uint8Array(cols * rows);
  const middle = (window.s0 + window.s1) / 2;
  for (const t of triangles) {
    const ss = [t[0], t[2], t[4]];
    const hs = [t[1], t[3], t[5]];
    const sMin = Math.min(...ss),
      sMax = Math.max(...ss);
    if (!(sMax - sMin < period / 2)) continue;
    const area = Math.abs(
      (t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1]),
    );
    if (!(area > 1e-12)) continue;
    const shift = Math.round((middle - (sMin + sMax) / 2) / period) * period;
    const i0 = Math.max(0, Math.ceil((sMin + shift - window.s0) / step - EPS));
    const i1 = Math.min(
      cols - 1,
      Math.floor((sMax + shift - window.s0) / step + EPS),
    );
    const j0 = Math.max(
      0,
      Math.ceil((Math.min(...hs) - window.h0) / step - EPS),
    );
    const j1 = Math.min(
      rows - 1,
      Math.floor((Math.max(...hs) - window.h0) / step + EPS),
    );
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        if (covered[k]) continue;
        if (inside(window.s0 + i * step, window.h0 + j * step, t, shift))
          covered[k] = 1;
      }
  }
  const misses = new Int32Array((cols + 1) * (rows + 1));
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      misses[(j + 1) * (cols + 1) + i + 1] =
        (covered[j * cols + i] ? 0 : 1) +
        misses[j * (cols + 1) + i + 1] +
        misses[(j + 1) * (cols + 1) + i] -
        misses[j * (cols + 1) + i];
  return { s0: window.s0, h0: window.h0, step, cols, rows, period, misses };
}

/**
 * Conservative: the lattice ring just outside the rectangle must be covered
 * too, so an edge between two samples cannot hide an uncovered sliver.
 */
export function rectOnFilm(c: ChartCoverage, rect: ChartRect): boolean {
  const i0 = Math.floor((rect.s0 - c.s0) / c.step + EPS);
  const i1 = Math.ceil((rect.s1 - c.s0) / c.step - EPS);
  const j0 = Math.floor((rect.h0 - c.h0) / c.step + EPS);
  const j1 = Math.ceil((rect.h1 - c.h0) / c.step - EPS);
  if (i0 < 0 || j0 < 0 || i1 >= c.cols || j1 >= c.rows || i0 > i1 || j0 > j1)
    return false;
  const w = c.cols + 1;
  const sum =
    c.misses[(j1 + 1) * w + i1 + 1] -
    c.misses[j0 * w + i1 + 1] -
    c.misses[(j1 + 1) * w + i0] +
    c.misses[j0 * w + i0];
  return sum === 0;
}

export function decalRect(p: DecalPlacement, aspect: number): ChartRect {
  const halfW = (DECAL_BASE_WIDTH_M * p.scale) / 2;
  const halfH = halfW / aspect;
  return {
    s0: p.center - halfW,
    s1: p.center + halfW,
    h0: p.height - halfH,
    h1: p.height + halfH,
  };
}

export type DefaultFit = { placement: DecalPlacement; fits: boolean };

/**
 * Largest scale (≤ the requested one) whose whole image lies on eligible film
 * and inside `face`; among equal scales, the slot nearest the requested
 * centre and height. Nothing fits → the requested placement, flagged.
 */
export function fitDecalOnFilm(
  requested: DecalPlacement,
  aspect: number,
  body: WrapBody,
  coverage: ChartCoverage,
  face: { s0: number; s1: number },
  options: { centerReach?: number; step?: number } = {},
): DefaultFit {
  const step = options.step ?? 0.01;
  const reach = options.centerReach ?? 1;
  const first = constrainDecal(requested, aspect, body);
  const fitsFace = (r: ChartRect) =>
    r.s0 >= face.s0 - EPS && r.s1 <= face.s1 + EPS;
  const ok = (p: DecalPlacement) => {
    const r = decalRect(p, aspect);
    return fitsFace(r) && rectOnFilm(coverage, r);
  };
  if (ok(first)) return { placement: first, fits: true };
  const period = circumference(body);
  const steps = Math.round(reach / step);
  // Nearest fitting slot at one scale, or null. Allocation-free: this runs
  // on every first apply, image change and reset.
  const slotAt = (scale: number): DecalPlacement | null => {
    const halfW = (DECAL_BASE_WIDTH_M * scale) / 2;
    const halfH = halfW / aspect;
    const lo = halfH + 0.04;
    const hi = body.height - halfH - 0.04;
    if (!(lo <= hi)) return null;
    const rect = { s0: 0, s1: 0, h0: 0, h1: 0 };
    let best: DecalPlacement | null = null;
    let bestCost = Infinity;
    for (let dc = 0; dc <= steps; dc++)
      for (const cs of dc ? [1, -1] : [1]) {
        const center = first.center + cs * dc * step;
        if (dc * step >= bestCost) break;
        if (center < 0 || center >= period) continue;
        rect.s0 = center - halfW;
        rect.s1 = center + halfW;
        if (!fitsFace(rect)) continue;
        for (let dh = 0; dc * step + dh * step < bestCost; dh++) {
          let any = false;
          for (const hs of dh ? [1, -1] : [1]) {
            const height = first.height + hs * dh * step;
            if (height < lo - EPS || height > hi + EPS) continue;
            any = true;
            rect.h0 = height - halfH;
            rect.h1 = height + halfH;
            if (rectOnFilm(coverage, rect)) {
              best = { center, height, scale };
              bestCost = dc * step + dh * step;
              break;
            }
          }
          if (!any && dh * step > body.height) break;
        }
      }
    return best;
  };
  // A smaller image at the same slot is a subset of a larger one, so fitting
  // is monotone in scale: binary-search the largest fitting step.
  let lo = Math.ceil(MIN_DECAL_SCALE / step - EPS);
  let hi = Math.round(first.scale / step);
  let found: DecalPlacement | null = null;
  if (!slotAt(lo * step)) return { placement: first, fits: false };
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const slot = slotAt(mid * step);
    if (slot) {
      found = slot;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (!found) return { placement: first, fits: false };
  // Already inside constrainDecal's bounds; normalise like every placement.
  const placement = constrainDecal(found, aspect, body);
  return ok(placement)
    ? { placement, fits: true }
    : { placement: first, fits: false };
}
