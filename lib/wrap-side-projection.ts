/** Shared orthographic side-view projection for guide generation and 3D editor sampling. Three-free. */
export type SideBody = { xMin: number; length: number; height: number };
export type SideFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** R13 wrap chart spans in public/model/motion_metadata.json. */
export const R13_SIDE_ASPECT = 5.8 / 3.05;
// Closed R13 transverse envelope including the cab mirror housings.
const R13_END_WIDTH = 2.58;
export const R13_END_ASPECT = R13_END_WIDTH / 3.05;

export function createEndProjection(body: { height: number; centerZ?: number }): SideFrame {
  return createSideProjection({
    xMin: (body.centerZ ?? 0) - R13_END_WIDTH / 2,
    length: R13_END_WIDTH,
    height: body.height,
  });
}

/** Orthographic frame with 5% margin on every side; nose stays on the left for both sides. */
export function createSideProjection(body: SideBody): SideFrame {
  return {
    left: body.xMin - body.length * 0.05,
    top: body.height * 1.05,
    width: body.length * 1.1,
    height: body.height * 1.1,
  };
}

/** World X/Y to normalized [0,1] image coordinates, +x right (nose left), +y down. */
export function projectSidePoint(
  frame: SideFrame,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: (x - frame.left) / frame.width,
    y: (frame.top - y) / frame.height,
  };
}

/** Lift a seam-crossing triangle before interpolating its perimeter coordinate. */
export function liftSideChartTriangle(
  values: [number, number, number],
  period: number,
): [number, number, number] {
  if (Math.max(...values) - Math.min(...values) <= period / 2) return values;
  const lift = (s: number) => (s < period / 2 ? s + period : s);
  return [lift(values[0]), lift(values[1]), lift(values[2])];
}
