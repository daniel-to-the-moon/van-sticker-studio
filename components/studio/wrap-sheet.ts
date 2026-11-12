import {
  addLayer,
  editLayer,
  newLayer,
  removeLayer,
  type Art,
  type Point,
  type Project,
  type Side,
} from '../../lib/free-wrap.ts';

/**
 * Unfolded sheet in metres. Length and height match the wrap chart
 * (5.8 × 3.05). Width is the measured body width. One metre is one
 * viewBox unit, so every panel keeps the vehicle's proportions.
 * There is no underside.
 */
export const SHEET_ENVELOPE = {
  length: 5.8,
  width: 2.22,
  height: 3.05,
} as const;

export type SheetView = 'left' | 'right' | 'front' | 'rear' | 'top';

export type SheetPanel = {
  id: SheetView;
  label: string;
  nose: string;
  /** Match the 3D camera: entry nose is on the right of the screen. */
  flipX: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  side: Side | null;
};

export type VehicleSheet = {
  width: number;
  height: number;
  aspect: number;
  panels: SheetPanel[];
};

const GAP = 0.16;
const LABEL = 0.32;

export function vehicleSheet(
  body: { length: number; width: number; height: number } = SHEET_ENVELOPE,
): VehicleSheet {
  const { length, width, height } = body;
  const rowY = LABEL + width + GAP;
  const leftX = width + GAP;
  const rearX = leftX + length + GAP;
  const rightX = rearX + width + GAP;
  const panels: SheetPanel[] = [
    {
      id: 'top',
      label: '顶面',
      nose: '车头在左',
      flipX: false,
      x: leftX,
      y: LABEL,
      w: length,
      h: width,
      side: null,
    },
    {
      id: 'front',
      label: '正面',
      nose: '',
      flipX: false,
      x: 0,
      y: rowY,
      w: width,
      h: height,
      side: null,
    },
    {
      id: 'left',
      label: '入口门这侧',
      nose: '车头在右',
      flipX: true,
      x: leftX,
      y: rowY,
      w: length,
      h: height,
      side: 'entry',
    },
    {
      id: 'rear',
      label: '后面',
      nose: '',
      flipX: false,
      x: rearX,
      y: rowY,
      w: width,
      h: height,
      side: null,
    },
    {
      id: 'right',
      label: '另一侧',
      nose: '车头在左',
      flipX: false,
      x: rightX,
      y: rowY,
      w: length,
      h: height,
      side: 'driver',
    },
  ];
  const sheetWidth = rightX + length;
  const sheetHeight = rowY + height;
  return {
    width: sheetWidth,
    height: sheetHeight,
    aspect: sheetWidth / sheetHeight,
    panels,
  };
}

export const SHEET = vehicleSheet();

/** Driver windows 3 and 4 sit on body paint, not a wrap shell. Chart is nose-left. */
export const DRIVER_UNPAINTABLE = { x: 0.42, y: 0.24, w: 0.5, h: 0.18 };

export function panelAt(x: number, y: number, sheet = SHEET): SheetPanel | null {
  return (
    sheet.panels.find(
      (panel) =>
        x >= panel.x &&
        x <= panel.x + panel.w &&
        y >= panel.y &&
        y <= panel.y + panel.h,
    ) ?? null
  );
}

export function displayArt(art: Art, flipX: boolean): Art {
  if (!flipX) return art;
  const moved = { ...art, x: 1 - art.x - art.w, rotation: -art.rotation };
  if (art.kind === 'region' || art.kind === 'stroke') {
    moved.points = art.points.map((point) => ({ x: 1 - point.x, y: point.y }));
  }
  return moved;
}

export function panelLocal(panel: SheetPanel, x: number, y: number): Point {
  const displayed = (x - panel.x) / panel.w;
  return {
    x: panel.flipX ? 1 - displayed : displayed,
    y: (y - panel.y) / panel.h,
  };
}

export function chartPoints(art: Art): Point[] {
  return art.points.map((point) => ({
    x: art.x + point.x * art.w,
    y: art.y + point.y * art.h,
  }));
}

export function regionFromChart(
  points: Point[],
): Pick<Art, 'x' | 'y' | 'w' | 'h' | 'points'> {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const w = Math.max(0.04, maxX - minX);
  const h = Math.max(0.04, maxY - minY);
  return {
    x: minX,
    y: minY,
    w,
    h,
    points: points.map((point) => ({
      x: Math.min(1, Math.max(0, (point.x - minX) / w)),
      y: Math.min(1, Math.max(0, (point.y - minY) / h)),
    })),
  };
}

export function moveVertex(
  art: Art,
  index: number,
  chart: Point,
): Pick<Art, 'x' | 'y' | 'w' | 'h' | 'points'> {
  const points = chartPoints(art);
  points[index] = {
    x: Math.min(1, Math.max(0, chart.x)),
    y: Math.min(1, Math.max(0, chart.y)),
  };
  return regionFromChart(points);
}

/** Inserts a vertex on an edge so the block can bend around a window. */
export function pullEdge(
  art: Art,
  edge: number,
  chart: Point,
): {
  patch: Pick<Art, 'x' | 'y' | 'w' | 'h' | 'points'>;
  index: number;
} {
  const points = chartPoints(art);
  const index = edge + 1;
  points.splice(index, 0, {
    x: Math.min(1, Math.max(0, chart.x)),
    y: Math.min(1, Math.max(0, chart.y)),
  });
  return { patch: regionFromChart(points), index };
}

function blockId(project: Project): string {
  const taken = new Set(project.layers.map((layer) => layer.id));
  let n = project.layers.length + 1;
  let id = `block-${n}`;
  while (taken.has(id)) {
    n += 1;
    id = `block-${n}`;
  }
  return id;
}

export function addColorBlock(project: Project, side: Side = 'entry'): Project {
  const id = blockId(project);
  const placed = addLayer(project, newLayer('region', id), side, true);
  const shape = regionFromChart([
    { x: 0.05, y: 0.72 },
    { x: 0.28, y: 0.72 },
    { x: 0.28, y: 0.9 },
    { x: 0.05, y: 0.9 },
  ]);
  const painted = editLayer(placed, id, side, { ...shape, color: '#8aafa1' });
  const block = painted.layers.find((layer) => layer.id === id);
  if (!block) return painted;
  const others = painted.layers.filter((layer) => layer.id !== id);
  const textAt = others.findIndex(
    (layer) => layer.entry?.kind === 'text' || layer.driver?.kind === 'text',
  );
  const layers =
    textAt < 0
      ? painted.layers
      : [...others.slice(0, textAt), block, ...others.slice(textAt)];
  return { ...painted, layers };
}

export function deleteColorBlock(
  project: Project,
  id: string,
  side?: Side,
): Project {
  return removeLayer(project, id, side);
}
