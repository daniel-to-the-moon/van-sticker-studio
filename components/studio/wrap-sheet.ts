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
    { id: 'top', label: '顶面', x: leftX, y: LABEL, w: length, h: width, side: null },
    { id: 'front', label: '正面', x: 0, y: rowY, w: width, h: height, side: null },
    {
      id: 'left',
      label: '左侧',
      x: leftX,
      y: rowY,
      w: length,
      h: height,
      side: 'entry',
    },
    { id: 'rear', label: '后面', x: rearX, y: rowY, w: width, h: height, side: null },
    {
      id: 'right',
      label: '右侧',
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

export function panelLocal(panel: SheetPanel, x: number, y: number): Point {
  return { x: (x - panel.x) / panel.w, y: (y - panel.y) / panel.h };
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
    { x: 0.22, y: 0.4 },
    { x: 0.58, y: 0.4 },
    { x: 0.58, y: 0.68 },
    { x: 0.22, y: 0.68 },
  ]);
  return editLayer(placed, id, side, { ...shape, color: '#c4553a' });
}

export function deleteColorBlock(
  project: Project,
  id: string,
  side?: Side,
): Project {
  return removeLayer(project, id, side);
}
