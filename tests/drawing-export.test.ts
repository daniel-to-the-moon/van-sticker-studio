import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { SceneEngine } from '../components/studio/scene-engine.ts';
import type { Presentation } from '../components/studio/scene-engine.ts';
import { VEHICLE_ASSET_REVISION } from '../lib/vehicle-assets.ts';
import {
  DRAWING_EXPORT_PX,
  DRAWING_EXPORT_VIEWS,
  STUDIO_VIEW_DIRECTIONS,
  drawingExportFilename,
  requestDrawingExport,
} from '../lib/drawing-views.ts';

const BRAND = [/MAXUS/i, /SAIC/i, /大通/, /上汽/, /\bV80\b/];

type Internals = {
  generating: boolean;
  presentation: Presentation;
  environment: 'camp' | 'studio';
  cameraTween: { id: string } | null;
  reduced: boolean;
};

const internals = (engine: SceneEngine) => engine as unknown as Internals;

function viewById(id: string) {
  const view = DRAWING_EXPORT_VIEWS.find((item) => item.id === id);
  assert.ok(view, `missing export view ${id}`);
  return view;
}

void test('drawing export canvas is the single 2048×1536 constant', () => {
  assert.deepEqual(DRAWING_EXPORT_PX, { width: 2048, height: 1536 });
  assert.equal(DRAWING_EXPORT_PX.width / DRAWING_EXPORT_PX.height, 4 / 3);
});

void test('five export views keep distinct directions and the side view is entry only', () => {
  assert.deepEqual(
    DRAWING_EXPORT_VIEWS.map((view) => view.id),
    ['entry', 'front-three-quarter', 'rear-three-quarter', 'front', 'rear'],
  );
  const directions = DRAWING_EXPORT_VIEWS.map((view) =>
    view.direction.join(','),
  );
  assert.equal(new Set(directions).size, DRAWING_EXPORT_VIEWS.length);
  const exportIds: readonly string[] = DRAWING_EXPORT_VIEWS.map(
    (view) => view.id,
  );
  assert.equal(exportIds.includes('driver'), false);
  assert.deepEqual(viewById('entry').direction, STUDIO_VIEW_DIRECTIONS.entry);
  assert.ok(viewById('entry').direction[2] < 0);
});

void test('rear three-quarter is the front three-quarter mirrored front to back on the entry side', () => {
  const front = viewById('front-three-quarter').direction;
  const rear = viewById('rear-three-quarter').direction;
  const entry = viewById('entry').direction;
  assert.deepEqual([...rear], [-front[0], front[1], front[2]]);
  assert.equal(front[2], entry[2]);
  assert.equal(rear[2], entry[2]);
  assert.ok(front[0] < 0);
  assert.ok(rear[0] > 0);
});

void test('existing studio view directions stay on their current vectors', () => {
  assert.deepEqual(STUDIO_VIEW_DIRECTIONS, {
    hero: [-0.83, 0.48, -1],
    entry: [0, 0.22, -1],
    driver: [0, 0.22, 1],
    front: [-1, 0.18, 0],
    rear: [1, 0.22, 0],
  });
});

void test('setView still aims the camera along those studio directions', () => {
  const camera = new THREE.PerspectiveCamera(37, 1200 / 800, 0.08, 160);
  camera.position.set(-7, 4, 6);
  const controls = {
    target: new THREE.Vector3(0.2, 1.4, 0.1),
    update() {},
  };
  const engine = Object.assign(Object.create(SceneEngine.prototype), {
    camera,
    controls,
    host: { clientWidth: 1200, clientHeight: 800 },
    reduced: true,
    cameraTween: null,
    cancelCameraTween() {
      this.cameraTween = null;
    },
  }) as SceneEngine;
  for (const id of ['hero', 'entry', 'driver', 'front', 'rear'] as const) {
    engine.setView(id);
    const offset = camera.position.clone().sub(controls.target).normalize();
    const expected = new THREE.Vector3(
      ...STUDIO_VIEW_DIRECTIONS[id],
    ).normalize();
    assert.ok(
      offset.dot(expected) > 0.999,
      `${id} moved off its preset (${offset.toArray().join(',')} vs ${expected.toArray().join(',')})`,
    );
  }
});

void test('export filenames carry the view id and asset revision without brand words', () => {
  for (const view of DRAWING_EXPORT_VIEWS) {
    const name = drawingExportFilename(view.id, VEHICLE_ASSET_REVISION);
    assert.equal(name, `drawing-${view.id}-${VEHICLE_ASSET_REVISION}.png`);
    for (const pattern of BRAND)
      assert.equal(pattern.test(name), false, `${name} matched ${pattern}`);
  }
  assert.equal(VEHICLE_ASSET_REVISION.includes(' '), false);
  assert.throws(
    () => drawingExportFilename('driver', VEHICLE_ASSET_REVISION),
    /unknown-drawing-view/,
  );
  assert.throws(
    () => drawingExportFilename('entry', '../not-a-revision'),
    /unsafe-drawing-filename/,
  );
});

type Limits = {
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
};

type ExportGl = {
  isContextLost: () => boolean;
  readPixels: (
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ) => void;
  RGBA: number;
  UNSIGNED_BYTE: number;
};

function exportHarness(options?: {
  captureError?: boolean;
  root?: THREE.Object3D | null;
  generating?: boolean;
  gl?: ExportGl;
  trackFrames?: boolean;
  advanceFrame?: boolean;
  duringDataUrl?: () => void;
}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#edf1ed');
  scene.fog = new THREE.Fog('#edf1ed', 22, 65);
  const original = new THREE.MeshBasicMaterial({ color: '#889988' });
  const paper = new THREE.MeshBasicMaterial({ color: '#f1eee3' });
  const body = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 3), original);
  body.position.set(0, 2, 0);
  const root = new THREE.Group();
  root.add(body);
  root.updateMatrixWorld(true);
  const lines = { visible: false };
  const grid = { visible: false };
  const camp = { visible: true };
  const ground = {
    visible: true,
    material: new THREE.MeshStandardMaterial({ color: '#e2e7dc' }),
  };
  const camera = new THREE.PerspectiveCamera(37, 800 / 600, 0.08, 160);
  camera.position.set(-8, 3, -6);
  const controls = {
    target: new THREE.Vector3(0, 1.5, 0),
    minDistance: 4.8,
    maxDistance: 16,
    minPolarAngle: 0.16,
    maxPolarAngle: Math.PI * 0.49,
    update() {},
  };
  const size = new THREE.Vector2(800, 600);
  let pixelRatio = 1.75;
  const order: string[] = [];
  let during: ReturnType<typeof snapshot> | null = null;
  const frames = { render: { frame: 0 } };
  let dataUrlCalls = 0;
  const renderer = {
    getPixelRatio: () => pixelRatio,
    setPixelRatio: (value: number) => {
      pixelRatio = value;
    },
    getSize: (out: THREE.Vector2) => out.copy(size),
    setSize: (width: number, height: number) => {
      size.set(width, height);
    },
    getDrawingBufferSize: (out: THREE.Vector2) =>
      out.set(size.x * pixelRatio, size.y * pixelRatio),
    getContext: () => options?.gl ?? null,
    ...(options?.trackFrames ? { info: frames } : {}),
    render: () => {
      order.push('scene');
      if (options?.trackFrames && options.advanceFrame !== false)
        frames.render.frame += 1;
      during = snapshot(engine);
    },
    domElement: {
      toDataURL: (type?: string) => {
        dataUrlCalls += 1;
        assert.equal(type, 'image/png');
        if (options?.captureError) throw new Error('capture-boom');
        options?.duringDataUrl?.();
        return 'data:image/png;base64,iVBORw0KGgo=';
      },
    },
  };
  const silhouette = {
    render: () => {
      order.push('silhouette');
    },
  };
  const tween = { id: 'pending-view' };
  const engine = Object.assign(Object.create(SceneEngine.prototype), {
    scene,
    camera,
    controls,
    root: options && 'root' in options ? options.root : root,
    generating: options?.generating ?? false,
    presentation: 'render' as Presentation,
    environment: 'camp' as const,
    drafting: [{ mesh: body, original, paper }],
    drawingLines: [lines],
    drawingGrid: grid,
    camp,
    ground,
    cameraTween: tween,
    host: { clientWidth: 800, clientHeight: 600 },
    renderer,
    silhouette,
    reduced: false,
  }) as SceneEngine;

  function snapshot(current: SceneEngine) {
    const state = internals(current);
    const fog = current.scene.fog;
    const background = current.scene.background;
    return {
      generating: state.generating,
      presentation: state.presentation,
      environment: state.environment,
      cameraTween: state.cameraTween,
      camera: current.camera.position.toArray(),
      quaternion: current.camera.quaternion.toArray(),
      target: controls.target.toArray(),
      aspect: current.camera.aspect,
      near: current.camera.near,
      far: current.camera.far,
      pixelRatio,
      size: size.toArray(),
      grid: grid.visible,
      camp: camp.visible,
      ground: ground.visible,
      line: lines.visible,
      material: body.material,
      fog,
      background:
        background instanceof THREE.Color ? background.getHexString() : null,
      framed: current.root ? boxFits(current.camera, current.root) : false,
      limits: {
        minDistance: controls.minDistance,
        maxDistance: controls.maxDistance,
        minPolarAngle: controls.minPolarAngle,
        maxPolarAngle: controls.maxPolarAngle,
      } satisfies Limits,
    };
  }

  return {
    engine,
    body,
    original,
    paper,
    order,
    snapshot: () => snapshot(engine),
    during: () => during,
    dataUrlCalls: () => dataUrlCalls,
    limits: () => ({
      minDistance: controls.minDistance,
      maxDistance: controls.maxDistance,
      minPolarAngle: controls.minPolarAngle,
      maxPolarAngle: controls.maxPolarAngle,
    }),
  };
}

function boxFits(camera: THREE.PerspectiveCamera, root: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(root);
  let maxAbs = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const projected = new THREE.Vector3(x, y, z).project(camera);
        if (!(projected.z > -1 && projected.z < 1)) return false;
        if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return false;
        maxAbs = Math.max(maxAbs, Math.abs(projected.x), Math.abs(projected.y));
      }
    }
  }
  return maxAbs >= 0.7;
}

void test('a successful export forces a clean drawing and then restores the studio', () => {
  const harness = exportHarness();
  const before = harness.snapshot();
  const file = harness.engine.exportDrawing('entry');
  const during = harness.during();
  assert.ok(during);
  assert.equal(during.presentation, 'drawing');
  assert.equal(during.environment, 'studio');
  assert.equal(during.grid, false);
  assert.equal(during.camp, false);
  assert.equal(during.ground, false);
  assert.equal(during.line, true);
  assert.equal(during.material, harness.paper);
  assert.equal(during.fog, null);
  assert.equal(during.background, 'f1eee4');
  assert.equal(during.pixelRatio, 1);
  assert.deepEqual(during.size, [DRAWING_EXPORT_PX.width, DRAWING_EXPORT_PX.height]);
  assert.equal(
    during.aspect,
    DRAWING_EXPORT_PX.width / DRAWING_EXPORT_PX.height,
  );
  const aim = new THREE.Vector3(...during.camera)
    .sub(new THREE.Vector3(...during.target))
    .normalize();
  const expected = new THREE.Vector3(...viewById('entry').direction).normalize();
  assert.ok(aim.dot(expected) > 0.999);
  assert.equal(during.framed, true);
  assert.deepEqual(harness.order, [
    'scene',
    'silhouette',
    'scene',
    'silhouette',
  ]);
  assert.equal(
    file.filename,
    `drawing-entry-${VEHICLE_ASSET_REVISION}.png`,
  );
  assert.match(file.dataUrl, /^data:image\/png/);
  assert.deepEqual(harness.snapshot(), before);
  assert.equal(harness.body.material, harness.original);
});

void test('export is refused while generation is running and changes nothing', () => {
  const harness = exportHarness({ generating: true });
  const before = harness.snapshot();
  assert.throws(
    () => harness.engine.exportDrawing('front'),
    /export-while-generating/,
  );
  assert.deepEqual(harness.snapshot(), before);
  assert.deepEqual(harness.order, []);
});

void test('unknown export views are refused before the studio changes', () => {
  const harness = exportHarness();
  const before = harness.snapshot();
  for (const id of ['driver', 'hero', 'side', '']) {
    assert.throws(
      () => harness.engine.exportDrawing(id),
      /unknown-drawing-view/,
      id,
    );
  }
  assert.deepEqual(harness.snapshot(), before);
  assert.deepEqual(harness.order, []);
});

void test('a capture failure restores the camera, size, pixel ratio, mode and visibility', () => {
  const harness = exportHarness({ captureError: true });
  const before = harness.snapshot();
  assert.throws(() => harness.engine.exportDrawing('rear'), /capture-boom/);
  assert.deepEqual(harness.snapshot(), before);
  assert.deepEqual(harness.limits(), before.limits);
});

void test('the model must be loaded before an export mutates the studio', () => {
  const harness = exportHarness({ root: null });
  const before = harness.snapshot();
  assert.throws(
    () => harness.engine.exportDrawing('entry'),
    /model-not-ready/,
  );
  assert.deepEqual(harness.snapshot(), before);
});

void test('consecutive exports restore the studio after each view', () => {
  const harness = exportHarness();
  const before = harness.snapshot();
  const aims: THREE.Vector3[] = [];
  const renderer = (
    harness.engine as unknown as {
      renderer: { render: () => void };
    }
  ).renderer;
  const originalRender = renderer.render;
  renderer.render = () => {
    originalRender();
    const during = harness.during();
    assert.ok(during);
    aims.push(
      new THREE.Vector3(...during.camera)
        .sub(new THREE.Vector3(...during.target))
        .normalize(),
    );
  };
  const first = harness.engine.exportDrawing('front-three-quarter');
  assert.deepEqual(harness.snapshot(), before);
  const second = harness.engine.exportDrawing('rear-three-quarter');
  assert.deepEqual(harness.snapshot(), before);
  assert.notEqual(first.filename, second.filename);
  assert.equal(aims.length, 4);
  const frontAim = new THREE.Vector3(
    ...viewById('front-three-quarter').direction,
  ).normalize();
  const rearAim = new THREE.Vector3(
    ...viewById('rear-three-quarter').direction,
  ).normalize();
  assert.ok(aims[1].dot(frontAim) > 0.999);
  assert.ok(aims[3].dot(rearAim) > 0.999);
  assert.equal(harness.engine.camera.aspect, before.aspect);
  assert.deepEqual(harness.limits(), before.limits);
});

/** Image-space frame of a mesh's position bounds. Y grows downward, matching PNG rows. */
function projectedBodyFrame(camera: THREE.PerspectiveCamera, mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute('position');
  if (!(position instanceof THREE.BufferAttribute))
    throw new Error('expected a position buffer');
  const world = new THREE.Box3()
    .setFromBufferAttribute(position)
    .applyMatrix4(mesh.matrixWorld);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const x of [world.min.x, world.max.x]) {
    for (const y of [world.min.y, world.max.y]) {
      for (const z of [world.min.z, world.max.z]) {
        const projected = new THREE.Vector3(x, y, z).project(camera);
        assert.ok(
          projected.z > -1 && projected.z < 1,
          `body corner is outside the clip range (${projected.toArray().join(',')})`,
        );
        assert.ok(
          Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1,
          `body corner is cropped (${projected.toArray().join(',')})`,
        );
        minX = Math.min(minX, projected.x);
        minY = Math.min(minY, projected.y);
        maxX = Math.max(maxX, projected.x);
        maxY = Math.max(maxY, projected.y);
      }
    }
  }
  const width = (maxX - minX) / 2;
  const height = (maxY - minY) / 2;
  const ndcCenterX = (minX + maxX) / 2;
  const ndcCenterY = (minY + maxY) / 2;
  return {
    width,
    height,
    long: Math.max(width, height),
    centerX: ndcCenterX / 2 + 0.5,
    centerY: 0.5 - ndcCenterY / 2,
  };
}

void test('export framing ignores an inflated morph bounding box and fills the sheet', () => {
  const body = new THREE.Mesh(new THREE.BoxGeometry(5.8, 2.9, 3.4));
  body.position.set(0.05, 1.45, -0.3);
  const wiper = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.02));
  wiper.position.set(-2.1, 1.7, 0.1);
  wiper.geometry.computeBoundingBox();
  // three r180 computeBoundingBox adds every relative morph box onto the box it
  // has already expanded. Ninety-six wiper poses become a tens-of-metres box
  // around a blade that is still parked on the glass.
  wiper.geometry.boundingBox!.min.set(-2.4, 1.4, -0.6);
  wiper.geometry.boundingBox!.max.set(23.5, 26.2, 56.6);
  const root = new THREE.Group();
  root.add(body, wiper);
  root.updateMatrixWorld(true);
  const harness = exportHarness({ root });
  const frames: ReturnType<typeof projectedBodyFrame>[] = [];
  const renderer = (
    harness.engine as unknown as { renderer: { render: () => void } }
  ).renderer;
  const originalRender = renderer.render;
  renderer.render = () => {
    originalRender();
    frames.push(projectedBodyFrame(harness.engine.camera, body));
  };
  for (const id of [
    'entry',
    'front-three-quarter',
    'rear-three-quarter',
    'front',
    'rear',
  ])
    harness.engine.exportDrawing(id);
  assert.equal(frames.length, 10);
  for (const frame of frames) {
    assert.ok(
      frame.long >= 0.7 && frame.long <= 0.9,
      `visible body long edge ${frame.long} is outside 70–90% (${JSON.stringify(frame)})`,
    );
    assert.ok(
      Math.abs(frame.centerX - 0.5) <= 0.05 &&
        Math.abs(frame.centerY - 0.5) <= 0.05,
      `visible body is off center (${JSON.stringify(frame)})`,
    );
  }
});

void test('requestDrawingExport refuses while generation is active before the engine runs', () => {
  let calls = 0;
  const exportDrawing = () => {
    calls += 1;
    return { dataUrl: 'data:image/png;base64,x', filename: 'a.png' };
  };
  assert.throws(
    () =>
      requestDrawingExport('entry', {
        generationActive: true,
        exportDrawing,
      }),
    /export-while-generating/,
  );
  assert.equal(calls, 0);
  const file = requestDrawingExport('entry', {
    generationActive: false,
    exportDrawing,
  });
  assert.equal(calls, 1);
  assert.equal(file.filename, 'a.png');
  assert.throws(
    () =>
      requestDrawingExport('entry', {
        generationActive: false,
        exportDrawing: () => undefined,
      }),
    /model-not-ready/,
  );
});

void test('both page export entries consult the generation ref before the vehicle', () => {
  const source = fs.readFileSync('app/page.tsx', 'utf8');
  const helperStart = source.indexOf('const exportThroughGate');
  const helperEnd = source.indexOf('const downloadDrawing');
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /requestDrawingExport/);
  assert.match(helper, /generationActive:\s*generation\.current\s*!==\s*null/);
  const downloadStart = source.indexOf('const downloadDrawing');
  const downloadEnd = source.indexOf('useEffect', downloadStart);
  const download = source.slice(downloadStart, downloadEnd);
  assert.match(download, /exportThroughGate\(/);
  assert.equal(download.includes('vehicle.current?.exportDrawing'), false);
  const bridgeStart = source.indexOf('host.__drawingExport =');
  const bridgeEnd = source.indexOf('delete host.__drawingExport');
  assert.ok(bridgeStart >= 0 && bridgeEnd > bridgeStart);
  const bridge = source.slice(bridgeStart, bridgeEnd);
  assert.match(bridge, /exportThroughGate\(/);
  assert.equal(bridge.includes('vehicle.current?.exportDrawing'), false);
});

function withExportDocument<T>(run: () => T): T {
  const host = globalThis as { document?: unknown };
  const previous = host.document;
  host.document = {
    createElement() {
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            createImageData(width: number, height: number) {
              return { data: new Uint8ClampedArray(width * height * 4) };
            },
            putImageData() {},
          };
        },
        toDataURL(type?: string) {
          return `data:${type ?? 'image/png'};base64,live`;
        },
      };
    },
  };
  try {
    return run();
  } finally {
    if (previous === undefined) delete host.document;
    else host.document = previous;
  }
}

function paperPixels(pixels: Uint8Array) {
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 241;
    pixels[i + 1] = 238;
    pixels[i + 2] = 228;
    pixels[i + 3] = 255;
  }
}

void test('a lost WebGL context is refused before the studio changes', () => {
  const harness = exportHarness({
    gl: {
      isContextLost: () => true,
      readPixels() {},
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
    },
  });
  const before = harness.snapshot();
  assert.throws(
    () => harness.engine.exportDrawing('entry'),
    /export-context-lost/,
  );
  assert.deepEqual(harness.snapshot(), before);
  assert.deepEqual(harness.order, []);
  assert.equal(harness.dataUrlCalls(), 0);
});

void test('context loss during capture is not reported as a blank success', () => {
  let lost = false;
  let reads = 0;
  const harness = exportHarness({
    trackFrames: true,
    gl: {
      isContextLost: () => lost,
      readPixels(_x, _y, _w, _h, _format, _type, pixels) {
        reads += 1;
        lost = true;
        pixels.fill(0);
      },
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
    },
  });
  const before = harness.snapshot();
  withExportDocument(() => {
    assert.throws(
      () => harness.engine.exportDrawing('entry'),
      /export-context-lost/,
    );
  });
  assert.deepEqual(harness.snapshot(), before);
  assert.equal(harness.dataUrlCalls(), 0);
  assert.ok(reads > 0);
});

void test('a render that does not advance the frame is not a successful export', () => {
  const harness = exportHarness({
    trackFrames: true,
    advanceFrame: false,
    gl: {
      isContextLost: () => false,
      readPixels(_x, _y, _w, _h, _format, _type, pixels) {
        pixels.fill(0);
      },
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
    },
  });
  const before = harness.snapshot();
  withExportDocument(() => {
    assert.throws(
      () => harness.engine.exportDrawing('front'),
      /export-render-noop/,
    );
  });
  assert.deepEqual(harness.snapshot(), before);
  assert.equal(harness.dataUrlCalls(), 0);
});

void test('a live context exports through readPixels and checks the context around capture', () => {
  let lostChecks = 0;
  const harness = exportHarness({
    trackFrames: true,
    gl: {
      isContextLost: () => {
        lostChecks += 1;
        return false;
      },
      readPixels(_x, _y, _w, _h, _format, _type, pixels) {
        paperPixels(pixels);
      },
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
    },
  });
  const before = harness.snapshot();
  const file = withExportDocument(() => harness.engine.exportDrawing('entry'));
  assert.match(file.dataUrl, /^data:image\/png/);
  assert.equal(harness.dataUrlCalls(), 0);
  assert.ok(lostChecks >= 2, `context was checked ${lostChecks} times`);
  assert.deepEqual(harness.snapshot(), before);
});

void test('context loss during the toDataURL fallback is not a successful export', () => {
  let lost = false;
  const harness = exportHarness({
    trackFrames: true,
    duringDataUrl: () => {
      lost = true;
    },
    gl: {
      isContextLost: () => lost,
      readPixels() {
        throw new Error('multisample-readback');
      },
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
    },
  });
  const before = harness.snapshot();
  withExportDocument(() => {
    assert.throws(
      () => harness.engine.exportDrawing('rear'),
      /export-context-lost/,
    );
  });
  assert.equal(harness.dataUrlCalls(), 1);
  assert.deepEqual(harness.snapshot(), before);
});
