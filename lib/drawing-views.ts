import type { StringKey } from './i18n.ts';

/**
 * Dot's technical default for issue #3 slice 1.
 * Change this one value before visual acceptance; it is not a final spec.
 */
export const DRAWING_EXPORT_PX = { width: 2048, height: 1536 } as const;

/**
 * Largest NDC half-extent of the fitted visible-vertex bounds.
 * Drawn ink sits inside that box, so its long edge is smaller than this cap.
 */
export const DRAWING_EXPORT_FIT = 0.88;

export const STUDIO_VIEW_DIRECTIONS = {
  hero: [-0.83, 0.48, -1],
  entry: [0, 0.22, -1],
  driver: [0, 0.22, 1],
  front: [-1, 0.18, 0],
  rear: [1, 0.22, 0],
} as const;

export type StudioViewId = keyof typeof STUDIO_VIEW_DIRECTIONS;

const FRONT_THREE_QUARTER = STUDIO_VIEW_DIRECTIONS.hero;
const REAR_THREE_QUARTER = [
  -FRONT_THREE_QUARTER[0],
  FRONT_THREE_QUARTER[1],
  FRONT_THREE_QUARTER[2],
] as const;

export const DRAWING_EXPORT_VIEWS = [
  {
    id: 'entry',
    labelKey: 'export.view.entry',
    direction: STUDIO_VIEW_DIRECTIONS.entry,
  },
  {
    id: 'front-three-quarter',
    labelKey: 'export.view.frontThreeQuarter',
    direction: FRONT_THREE_QUARTER,
  },
  {
    id: 'rear-three-quarter',
    labelKey: 'export.view.rearThreeQuarter',
    direction: REAR_THREE_QUARTER,
  },
  {
    id: 'front',
    labelKey: 'export.view.front',
    direction: STUDIO_VIEW_DIRECTIONS.front,
  },
  {
    id: 'rear',
    labelKey: 'export.view.rear',
    direction: STUDIO_VIEW_DIRECTIONS.rear,
  },
] as const satisfies readonly {
  id: string;
  labelKey: StringKey;
  direction: readonly [number, number, number];
}[];

export type DrawingExportViewId = (typeof DRAWING_EXPORT_VIEWS)[number]['id'];

const SAFE_REVISION = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

export function studioViewDirection(
  view: string,
): readonly [number, number, number] {
  if (Object.hasOwn(STUDIO_VIEW_DIRECTIONS, view))
    return STUDIO_VIEW_DIRECTIONS[view as StudioViewId];
  return STUDIO_VIEW_DIRECTIONS.hero;
}

export function drawingExportView(viewId: string) {
  return DRAWING_EXPORT_VIEWS.find((view) => view.id === viewId);
}

export function drawingExportFilename(viewId: string, revision: string): string {
  const view = drawingExportView(viewId);
  if (!view) throw new Error('unknown-drawing-view');
  if (!SAFE_REVISION.test(revision)) throw new Error('unsafe-drawing-filename');
  return `drawing-${view.id}-${revision}.png`;
}

/** Shared by the hidden control and the preview bridge. */
export function requestDrawingExport(
  viewId: string,
  gate: {
    generationActive: boolean;
    exportDrawing: (
      viewId: string,
    ) => { dataUrl: string; filename: string } | undefined;
  },
) {
  if (gate.generationActive) throw new Error('export-while-generating');
  const file = gate.exportDrawing(viewId);
  if (!file) throw new Error('model-not-ready');
  return file;
}
