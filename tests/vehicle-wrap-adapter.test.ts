import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Raycaster,
  Triangle,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VehicleWrapEditor } from '../lib/vehicle-wrap-editor.ts';
import { circumference, perimeterCoordinate } from '../lib/wrap-layout.ts';
import {
  adaptPoint,
  adaptTriangle,
  bakeWrapAttributes,
  meshStats,
} from '../lib/vehicle-wrap-adapter.ts';
import {
  BOX_TRAILER,
  HIGH_ROOF,
  STEP_SLIDE,
  buildVerificationBody,
  disposeVerificationBody,
  labProfile,
} from '../lib/vehicle-model-fixtures.ts';
import {
  canonicalFrame,
  designMarks,
  labFeedbackStatus,
  withPanelMotion,
  type SourceFrame,
  type Vec3,
  type VehicleModelProfile,
} from '../lib/vehicle-model-profile.ts';

const BODY = { xMin: -2.85, length: 5.8, width: 2.22, height: 3.05 };

class Canvas extends EventTarget {
  style = { cursor: '' };
  clientWidth = 800;
  clientHeight = 600;
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
  }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
  focus() {}
  closest() {
    return null;
  }
}

function mount(root: Group, profile?: ReturnType<typeof labProfile>) {
  const previousWindow = globalThis.window;
  const previousElement = globalThis.Element;
  Object.assign(globalThis, { window: new EventTarget(), Element: Canvas });
  const canvas = new Canvas();
  const editor = new VehicleWrapEditor({
    root,
    camera: new OrthographicCamera(-4, 4, 3, -3, 0.1, 40),
    controls: { domElement: canvas, enabled: true } as unknown as OrbitControls,
    host: canvas as unknown as HTMLElement,
    body: { ...BODY },
    ...(profile ? { profile } : {}),
    reveal: { value: 1 },
    onChange() {},
    takeCamera() {},
  });
  return {
    editor,
    cleanup() {
      editor.dispose();
      Object.assign(globalThis, {
        window: previousWindow,
        Element: previousElement,
      });
    },
  };
}

void test('a closed door stays continuous and an open door keeps its chart', () => {
  const profile = labProfile('box-trailer');
  const door = [
    (BOX_TRAILER.door.x0 + BOX_TRAILER.door.x1) / 2,
    (BOX_TRAILER.door.y0 + BOX_TRAILER.door.y1) / 2,
    BOX_TRAILER.door.z,
  ] as const;
  const body = [BOX_TRAILER.door.x1 + 0.2, door[1], BOX_TRAILER.door.z] as const;
  const closedDoor = adaptPoint(profile, 'trailer_door', door);
  const closedBody = adaptPoint(profile, 'trailer_entry', body);
  assert.equal(closedDoor.eligible, true);
  assert.equal(closedBody.eligible, true);
  assert.ok(closedDoor.shaderS != null && closedBody.shaderS != null);
  assert.ok(Math.abs(closedDoor.shaderS - closedBody.shaderS) < 1.2);
  assert.ok(closedDoor.shaderS > closedBody.shaderS);
  const open = withPanelMotion(profile, 'trailer-door', {
    kind: 'hinge',
    point: BOX_TRAILER.hinge,
    axis: [0, 1, 0],
    angle: Math.PI / 2,
  });
  const posed: [number, number, number] = [
    BOX_TRAILER.hinge[0],
    door[1],
    BOX_TRAILER.hinge[2] - (door[0] - BOX_TRAILER.hinge[0]),
  ];
  const opened = adaptPoint(open, 'trailer_door', posed);
  assert.ok(Math.abs(posed[2] - door[2]) > 0.3);
  assert.ok(opened.shaderS != null && closedDoor.shaderS != null);
  assert.ok(Math.abs(opened.shaderS - closedDoor.shaderS) < 1e-6);
  const stayed = adaptPoint(open, 'trailer_entry', body);
  assert.ok(Math.abs((stayed.shaderS ?? 0) - (closedBody.shaderS ?? 0)) < 1e-6);
});

void test('openings and inward faces are not wrapped or bridged', () => {
  const profile = labProfile('box-trailer');
  const inside = adaptPoint(profile, 'trailer_entry', [
    (BOX_TRAILER.window.x0 + BOX_TRAILER.window.x1) / 2,
    (BOX_TRAILER.window.y0 + BOX_TRAILER.window.y1) / 2,
    BOX_TRAILER.door.z,
  ]);
  assert.equal(inside.eligible, false);
  assert.match(inside.feedback.reason, /开口/);
  const beside = adaptPoint(profile, 'trailer_entry', [
    BOX_TRAILER.window.x0 - 0.25,
    (BOX_TRAILER.window.y0 + BOX_TRAILER.window.y1) / 2,
    BOX_TRAILER.door.z,
  ]);
  assert.equal(beside.eligible, true);
  const bridge = adaptTriangle(
    profile,
    'trailer_entry',
    [BOX_TRAILER.window.x0 - 0.15, 1.6, BOX_TRAILER.door.z],
    [BOX_TRAILER.window.x1 + 0.15, 1.6, BOX_TRAILER.door.z],
    [BOX_TRAILER.window.x0 + 0.2, BOX_TRAILER.window.y1 + 0.12, BOX_TRAILER.door.z],
  );
  assert.equal(bridge.eligible, false);
  assert.match(bridge.feedback.reason, /开口|空隙/);
  const glass = adaptPoint(profile, 'trailer_glass', [0, 1, 0]);
  const lamp = adaptPoint(profile, 'trailer_lamp', [0, 1, 0]);
  const wheel = adaptPoint(profile, 'trailer_wheel', [0, 1, 0]);
  const interior = adaptPoint(profile, 'trailer_interior', [0, 1, 0]);
  assert.equal(glass.feedback.status, 'excluded');
  assert.equal(lamp.feedback.status, 'excluded');
  assert.equal(wheel.feedback.status, 'excluded');
  assert.equal(interior.feedback.status, 'excluded');
  const inward = adaptTriangle(
    profile,
    'trailer_entry',
    [1.4, 0.8, BOX_TRAILER.door.z],
    [1.8, 0.8, BOX_TRAILER.door.z],
    [1.4, 1.2, BOX_TRAILER.door.z],
  );
  assert.equal(inward.eligible, false);
  assert.match(inward.feedback.reason, /内表面/);
});

void test('a curved roof keeps arc length and rejects a flat perimeter stretch', () => {
  const profile = labProfile('high-roof');
  const arc = HIGH_ROOF.arc;
  const at = (angle: number, x: number): [number, number, number] => [
    x,
    arc.springY + arc.radius * Math.cos(angle),
    arc.centerZ + arc.radius * Math.sin(angle),
  ];
  const crown = at(0, 0);
  const mid = at(Math.PI / 6, 0);
  const side = at(Math.PI / 6, 0.4);
  const curved = adaptTriangle(profile, 'roof_curve', crown, mid, side);
  assert.equal(curved.feedback.status, 'excluded');
  assert.match(curved.feedback.reason, /弧长|曲面/);
  assert.ok(curved.stretch != null && curved.stretch < 0.15);
  const forced = {
    ...profile,
    panels: profile.panels.map((panel) =>
      panel.id === 'roof'
        ? { ...panel, projection: { kind: 'perimeter' as const, face: 'driver' as const } }
        : panel,
    ),
  };
  const rejected = adaptTriangle(forced, 'roof_curve', crown, mid, side);
  assert.equal(rejected.feedback.status, 'unsupported');
  assert.match(rejected.feedback.reason, /拉伸|周长/);
  const wall = adaptPoint(profile, 'roof_entry', [
    0,
    1.2,
    -HIGH_ROOF.envelope.width / 2,
  ]);
  assert.equal(wall.eligible, true);
});

void test('a stepped nose and a slide-out do not bridge their gaps', () => {
  const profile = labProfile('step-slide');
  const lower = adaptPoint(profile, 'step_lower', [
    STEP_SLIDE.lower.x,
    (STEP_SLIDE.lower.y0 + STEP_SLIDE.lower.y1) / 2,
    0,
  ]);
  const upper = adaptPoint(profile, 'step_upper', [
    STEP_SLIDE.upper.x,
    (STEP_SLIDE.upper.y0 + STEP_SLIDE.upper.y1) / 2,
    0,
  ]);
  assert.equal(lower.eligible, false);
  assert.equal(upper.eligible, false);
  assert.match(`${lower.feedback.reason}${upper.feedback.reason}`, /阶梯/);
  const joined = adaptTriangle(
    profile,
    'step_lower',
    [STEP_SLIDE.lower.x, STEP_SLIDE.lower.y1 - 0.05, 0],
    [STEP_SLIDE.upper.x, STEP_SLIDE.upper.y0 + 0.05, 0],
    [STEP_SLIDE.lower.x, STEP_SLIDE.lower.y1 - 0.2, 0.4],
  );
  assert.equal(joined.eligible, false);
  assert.equal(joined.feedback.status, 'unsupported');
  const slide = [
    (STEP_SLIDE.slide.x0 + STEP_SLIDE.slide.x1) / 2,
    (STEP_SLIDE.slide.y0 + STEP_SLIDE.slide.y1) / 2,
    STEP_SLIDE.slide.z,
  ] as const;
  const parked = adaptPoint(profile, 'slide_face', slide);
  assert.equal(parked.eligible, true);
  const extended = withPanelMotion(profile, 'slide-face', {
    kind: 'slide',
    direction: [0, 0, 1],
    distance: 0.35,
  });
  const moved = adaptPoint(extended, 'slide_face', [
    slide[0],
    slide[1],
    slide[2] + 0.35,
  ]);
  assert.ok(parked.shaderS != null && moved.shaderS != null);
  assert.ok(Math.abs(moved.shaderS - parked.shaderS) < 1e-6);
  const gap = adaptTriangle(
    profile,
    'slide_face',
    [slide[0], slide[1], STEP_SLIDE.envelope.width / 2],
    [slide[0], slide[1], STEP_SLIDE.slide.z],
    [slide[0] + 0.4, slide[1], STEP_SLIDE.slide.z],
  );
  assert.equal(gap.eligible, false);
  assert.match(gap.feedback.reason, /空隙/);
});

void test('verification bodies are indexed, have normals, and report draws', () => {
  for (const id of ['box-trailer', 'high-roof', 'step-slide'] as const) {
    const group = buildVerificationBody(id);
    const stats = meshStats(group);
    assert.equal(stats.degenerate, 0, id);
    assert.ok(stats.triangles > 8, id);
    assert.ok(stats.drawCalls >= 4, id);
    group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      assert.ok(object.geometry.index, object.name);
      assert.ok(object.geometry.getAttribute('normal'), object.name);
      const normal = object.geometry.getAttribute('normal');
      const length = Math.hypot(normal.getX(0), normal.getY(0), normal.getZ(0));
      assert.ok(length > 0.9 && length < 1.1, object.name);
    });
    disposeVerificationBody(group);
  }
});

void describe('editor integration', { concurrency: false }, () => {
void test('the editor keeps the legacy chart unless a profile is supplied', () => {
  const legacyRoot = new Group();
  const material = new MeshStandardMaterial();
  material.name = 'Wrap_Entry';
  const legacy = new Mesh(new BoxGeometry(2, 1, 0.2), material);
  legacy.name = 'RV_Static_Wrap_Entry';
  legacy.position.set(0, 1.2, 0);
  legacyRoot.add(legacy);
  const legacyMount = mount(legacyRoot);
  try {
    legacy.updateWorldMatrix(true, false);
    const position = legacy.geometry.getAttribute('position');
    const coord = legacy.geometry.getAttribute('aWrapCoord');
    assert.ok(coord);
    const world = new Vector3();
    const period = circumference(BODY);
    for (let index = 0; index < position.count; index += 1) {
      world.fromBufferAttribute(position, index).applyMatrix4(legacy.matrixWorld);
      const delta = coord.getX(index) - perimeterCoordinate(world.x, world.z, BODY);
      assert.ok(Math.abs(delta) < 1e-5 || Math.abs(delta - period) < 1e-5);
      assert.ok(Math.abs(coord.getY(index) - world.y) < 1e-5);
    }
  } finally {
    legacyMount.cleanup();
  }

  const profile = labProfile('box-trailer');
  const root = new Group();
  const wrapMaterial = new MeshStandardMaterial();
  wrapMaterial.name = 'Wrap_Entry';
  const glassMaterial = new MeshStandardMaterial();
  glassMaterial.name = 'Wrap_Entry';
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([
        1.4, 0.8, BOX_TRAILER.door.z,
        1.2, 0.8, BOX_TRAILER.door.z,
        1.2, 1.1, BOX_TRAILER.door.z,
      ]),
      3,
    ),
  );
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  const wrap = new Mesh(geometry, wrapMaterial);
  wrap.name = 'trailer_entry';
  const glass = new Mesh(new BoxGeometry(0.2, 0.2, 0.02), glassMaterial);
  glass.name = 'trailer_glass';
  glass.position.set(2.6, 1.6, BOX_TRAILER.door.z);
  root.add(wrap, glass);
  const adapted = mount(root, profile);
  try {
    assert.equal(glass.geometry.getAttribute('aWrapCoord'), undefined);
    const coord = wrap.geometry.getAttribute('aWrapCoord');
    const position = wrap.geometry.getAttribute('position');
    assert.ok(coord);
    const world = new Vector3();
    world.fromBufferAttribute(position, 0).applyMatrix4(wrap.matrixWorld);
    const point = adaptPoint(profile, 'trailer_entry', [world.x, world.y, world.z]);
    assert.equal(point.eligible, true);
    assert.ok(Math.abs(coord.getX(0) - (point.shaderS ?? 0)) < 1e-6);
    assert.ok(Math.abs(coord.getY(0) - (point.shaderH ?? 0)) < 1e-6);
  } finally {
    adapted.cleanup();
  }
});

function panelMesh(name: string, triangles: readonly (readonly [Vec3, Vec3, Vec3])[]) {
  const values: number[] = [];
  for (const triangle of triangles) for (const corner of triangle) values.push(...corner);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(values), 3));
  geometry.setIndex(triangles.flatMap((_, index) => [index * 3, index * 3 + 1, index * 3 + 2]));
  geometry.computeVertexNormals();
  const material = new MeshStandardMaterial();
  material.name = 'Wrap_Lab';
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

function triangleMesh(name: string, corners: readonly [Vec3, Vec3, Vec3]) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(corners.flat()), 3),
  );
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  const material = new MeshStandardMaterial();
  material.name = 'Wrap_Lab';
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

function frameProfile(frame: SourceFrame): VehicleModelProfile {
  return {
    id: 'frame-bake',
    label: '坐标烘焙验证模型',
    verification: true,
    frame,
    envelope: { xMin: -3, length: 6, width: 2.2, height: 3, centerZ: 0 },
    panels: [
      {
        id: 'entry',
        class: 'wrap',
        meshes: ['frame_entry'],
        projection: { kind: 'perimeter', face: 'entry' },
      },
    ],
  };
}

function sourceOf(point: Vec3, frame: SourceFrame): Vec3 {
  const toSource = frame.unit === 'mm' ? 1000 : 1;
  const delta = [0, 0, 0];
  const put = (axis: SourceFrame['rearward'], value: number) => {
    delta[axis.axis === 'x' ? 0 : axis.axis === 'y' ? 1 : 2] =
      (value / axis.sign) * toSource;
  };
  put(frame.rearward, point[0]);
  put(frame.up, point[1]);
  put(frame.driver, point[2]);
  return [
    frame.origin[0] + delta[0],
    frame.origin[1] + delta[1],
    frame.origin[2] + delta[2],
  ];
}

void test('baked triangles reject bridges, inward faces, voids and stretch', () => {
  const trailer = labProfile('box-trailer');
  const bridge = triangleMesh('trailer_entry', [
    [BOX_TRAILER.window.x0 - 0.15, 1.6, BOX_TRAILER.door.z],
    [BOX_TRAILER.window.x1 + 0.15, 1.6, BOX_TRAILER.door.z],
    [BOX_TRAILER.window.x0 + 0.2, BOX_TRAILER.window.y1 + 0.12, BOX_TRAILER.door.z],
  ]);
  const inward = triangleMesh('trailer_entry', [
    [1.4, 0.8, BOX_TRAILER.door.z],
    [1.8, 0.8, BOX_TRAILER.door.z],
    [1.4, 1.2, BOX_TRAILER.door.z],
  ]);
  const root = new Group();
  root.add(bridge, inward);
  const bridged = mount(root, trailer);
  try {
    for (const mesh of [bridge, inward]) {
      const eligible = mesh.geometry.getAttribute('aWrapEligible');
      assert.ok(!eligible || [...Array(eligible.count)].every((_, i) => eligible.getX(i) < 0.5));
    }
  } finally {
    bridged.cleanup();
  }

  const stepped = labProfile('step-slide');
  const gap = triangleMesh('slide_face', [
    [(STEP_SLIDE.slide.x0 + STEP_SLIDE.slide.x1) / 2, 1.4, STEP_SLIDE.envelope.width / 2],
    [(STEP_SLIDE.slide.x0 + STEP_SLIDE.slide.x1) / 2, 1.4, STEP_SLIDE.slide.z],
    [(STEP_SLIDE.slide.x0 + STEP_SLIDE.slide.x1) / 2 + 0.4, 1.4, STEP_SLIDE.slide.z],
  ]);
  const gapRoot = new Group();
  gapRoot.add(gap);
  const gapMount = mount(gapRoot, stepped);
  try {
    const eligible = gap.geometry.getAttribute('aWrapEligible');
    assert.ok(!eligible || [...Array(eligible.count)].every((_, i) => eligible.getX(i) < 0.5));
  } finally {
    gapMount.cleanup();
  }

  const stretched: VehicleModelProfile = {
    id: 'stretch-bake',
    label: '拉伸验证模型',
    verification: true,
    frame: canonicalFrame(),
    envelope: { xMin: -3, length: 6, width: 2, height: 3, centerZ: 0 },
    panels: [
      {
        id: 'stretched',
        class: 'wrap',
        meshes: ['stretched'],
        maxStretch: 0.15,
        projection: {
          kind: 'local',
          face: 'driver',
          origin: [0, 0, 0],
          axisS: [2, 0, 0],
          axisH: [0, 1, 0],
          width: 10,
          height: 4,
          outward: [0, 0, 1],
        },
      },
    ],
  };
  const squash = triangleMesh('stretched', [
    [0, 0.2, 0],
    [1, 0.2, 0],
    [0, 1.2, 0],
  ]);
  const squashRoot = new Group();
  squashRoot.add(squash);
  const squashMount = mount(squashRoot, stretched);
  try {
    const eligible = squash.geometry.getAttribute('aWrapEligible');
    assert.ok(!eligible || [...Array(eligible.count)].every((_, i) => eligible.getX(i) < 0.5));
  } finally {
    squashMount.cleanup();
  }
});

void test('window-edge wall vertices keep real chart coordinates and glass stays bare', () => {
  const group = buildVerificationBody('box-trailer');
  const entry = group.getObjectByName('trailer_entry');
  const glass = group.getObjectByName('trailer_glass');
  assert.ok(entry instanceof Mesh && glass instanceof Mesh);
  const mounted = mount(group, labProfile('box-trailer'));
  try {
    assert.equal(glass.geometry.getAttribute('aWrapCoord'), undefined);
    const position = entry.geometry.getAttribute('position');
    const coord = entry.geometry.getAttribute('aWrapCoord');
    const eligible = entry.geometry.getAttribute('aWrapEligible');
    assert.ok(coord && eligible);
    entry.updateWorldMatrix(true, false);
    const world = new Vector3();
    let edges = 0;
    for (let index = 0; index < position.count; index += 1) {
      world.fromBufferAttribute(position, index).applyMatrix4(entry.matrixWorld);
      const onEdge =
        (Math.abs(world.x - BOX_TRAILER.window.x0) < 1e-4 ||
          Math.abs(world.x - BOX_TRAILER.window.x1) < 1e-4) &&
        world.y >= BOX_TRAILER.window.y0 - 1e-4 &&
        world.y <= BOX_TRAILER.window.y1 + 1e-4;
      if (!onEdge) continue;
      edges += 1;
      assert.equal(eligible.getX(index), 1, `window edge ${index}`);
      const expected = perimeterCoordinate(
        world.x,
        world.z,
        BOX_TRAILER.envelope,
      );
      assert.ok(Math.abs(coord.getX(index) - expected) < 1e-4);
      assert.ok(Math.abs(coord.getY(index) - world.y) < 1e-4);
      assert.ok(Math.hypot(coord.getX(index), coord.getY(index)) > 0.2);
    }
    assert.ok(edges >= 4);
  } finally {
    mounted.cleanup();
    disposeVerificationBody(group);
  }
});

void test('a slide face keeps world scale and lines up with the wall behind it', () => {
  const profile = labProfile('step-slide');
  const group = buildVerificationBody('step-slide');
  const slide = group.getObjectByName('slide_face');
  const wall = group.getObjectByName('step_driver');
  assert.ok(slide instanceof Mesh && wall instanceof Mesh);
  const x = (STEP_SLIDE.slide.x0 + STEP_SLIDE.slide.x1) / 2;
  const y = (STEP_SLIDE.slide.y0 + STEP_SLIDE.slide.y1) / 2;
  const onSlide = adaptPoint(profile, 'slide_face', [x, y, STEP_SLIDE.slide.z]);
  const beside = adaptPoint(profile, 'slide_face', [x + 1, y, STEP_SLIDE.slide.z]);
  const onWall = adaptPoint(profile, 'step_driver', [
    x,
    y,
    STEP_SLIDE.envelope.width / 2,
  ]);
  assert.equal(onSlide.eligible, true);
  assert.equal(beside.eligible, true);
  assert.ok(onSlide.shaderS != null && beside.shaderS != null && onWall.shaderS != null);
  assert.ok(Math.abs(beside.shaderS - onSlide.shaderS - 1) < 1e-3);
  assert.ok(Math.abs(onSlide.shaderS - onWall.shaderS) < 1e-3);
  const mounted = mount(group, profile);
  try {
    const position = slide.geometry.getAttribute('position');
    const coord = slide.geometry.getAttribute('aWrapCoord');
    const eligible = slide.geometry.getAttribute('aWrapEligible');
    assert.ok(coord && eligible);
    slide.updateWorldMatrix(true, false);
    const world = new Vector3();
    const samples: { x: number; s: number }[] = [];
    for (let index = 0; index < position.count; index += 1) {
      assert.equal(eligible.getX(index), 1);
      world.fromBufferAttribute(position, index).applyMatrix4(slide.matrixWorld);
      samples.push({ x: world.x, s: coord.getX(index) });
    }
    samples.sort((a, b) => a.x - b.x);
    const span = samples[samples.length - 1].x - samples[0].x;
    assert.ok(span > 1);
    assert.ok(
      Math.abs(samples[samples.length - 1].s - samples[0].s - span) < 1e-3,
    );
  } finally {
    mounted.cleanup();
    disposeVerificationBody(group);
  }
});

void test('millimetre and rotated frames reach the same chart through the editor', () => {
  const canonical = [
    [-1, 1.2, -1.1],
    [-1, 1.6, -1.1],
    [-0.6, 1.2, -1.1],
  ] as const;
  const frames: SourceFrame[] = [
    canonicalFrame(),
    { ...canonicalFrame(), unit: 'mm' },
    {
      unit: 'm',
      rearward: { axis: 'z', sign: 1 },
      up: { axis: 'y', sign: 1 },
      driver: { axis: 'x', sign: -1 },
      origin: [4, -2, 7],
    },
  ];
  const charts = frames.map((frame) => {
    const profile = frameProfile(frame);
    const mesh = triangleMesh(
      'frame_entry',
      canonical.map((point) => sourceOf(point, frame)) as [Vec3, Vec3, Vec3],
    );
    const root = new Group();
    root.add(mesh);
    const mounted = mount(root, profile);
    try {
      const coord = mesh.geometry.getAttribute('aWrapCoord');
      const eligible = mesh.geometry.getAttribute('aWrapEligible');
      assert.ok(coord && eligible);
      assert.equal(eligible.getX(0), 1);
      return [coord.getX(0), coord.getY(0)] as const;
    } finally {
      mounted.cleanup();
    }
  });
  const expectedS = perimeterCoordinate(
    canonical[0][0],
    canonical[0][2],
    frameProfile(canonicalFrame()).envelope,
  );
  for (const chart of charts) {
    assert.ok(Math.abs(chart[0] - expectedS) < 1e-4);
    assert.ok(Math.abs(chart[1] - canonical[0][1]) < 1e-4);
  }
  assert.ok(Math.abs(charts[1][0] - charts[0][0]) < 1e-4);
  assert.ok(Math.abs(charts[2][0] - charts[0][0]) < 1e-4);
});

void test('the default editor path keeps eligibility, the front transition, centerZ and the entry door', () => {
  const paintCorners: Vec3[][] = [
    [
      [-2.48, 0.9, -0.8],
      [-2.48, 1, -0.8],
      [-2.48, 0.9, -0.9],
    ],
    [
      [-2.48, 1, -0.8],
      [-2.48, 1, -0.9],
      [-2.48, 0.9, -0.9],
    ],
    [
      [-2.48, 1.2, -0.8],
      [-2.48, 1.3, -0.8],
      [-2.48, 1.2, -0.9],
    ],
  ];
  const paintGeometry = new BufferGeometry();
  paintGeometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(paintCorners.flat(2)), 3),
  );
  const paintMaterial = new MeshStandardMaterial();
  paintMaterial.name = 'Body_Paint';
  const paint = new Mesh(paintGeometry, paintMaterial);
  paint.name = 'RV_Static_Body_Paint';
  const seed = triangleMesh('RV_Static_Wrap_Front', [
    [-2.48, 0.9, -0.8],
    [-2.48, 0.9, -0.7],
    [-2.48, 1, -0.8],
  ]);
  (seed.material as MeshStandardMaterial).name = 'Wrap_Front';
  const chromeMaterial = new MeshStandardMaterial();
  chromeMaterial.name = 'Chrome';
  const chrome = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), chromeMaterial);
  chrome.name = 'RV_Static_Chrome';
  const transitionRoot = new Group();
  transitionRoot.add(seed, paint, chrome);
  const transition = mount(transitionRoot);
  try {
    assert.equal(chrome.geometry.getAttribute('aWrapEligible'), undefined);
    const flags = paint.geometry.getAttribute('aWrapEligible');
    assert.ok(flags);
    assert.equal(flags.getX(0), 1);
    assert.equal(flags.getX(3), 1);
    assert.equal(flags.getX(6), 0);
    const seedFlags = seed.geometry.getAttribute('aWrapEligible');
    assert.ok(seedFlags);
    for (let index = 0; index < seedFlags.count; index += 1)
      assert.equal(seedFlags.getX(index), 1);
  } finally {
    transition.cleanup();
  }

  const offsetRoot = new Group();
  const offsetMaterial = new MeshStandardMaterial();
  offsetMaterial.name = 'Wrap_Entry';
  const offset = new Mesh(new BoxGeometry(1, 0.4, 0.2), offsetMaterial);
  offset.name = 'RV_Static_Wrap_Entry';
  offset.position.set(0, 1, -0.5);
  offsetRoot.add(offset);
  const offsetMount = mount(offsetRoot);
  try {
    offset.updateWorldMatrix(true, false);
    const position = offset.geometry.getAttribute('position');
    const coord = offset.geometry.getAttribute('aWrapCoord');
    assert.ok(coord);
    const world = new Vector3();
    const measured = { ...BODY, centerZ: -0.5 };
    for (let index = 0; index < position.count; index += 1) {
      world.fromBufferAttribute(position, index).applyMatrix4(offset.matrixWorld);
      const expected = perimeterCoordinate(world.x, world.z, measured);
      const ignored = perimeterCoordinate(world.x, world.z, BODY);
      assert.ok(Math.abs(expected - ignored) > 1e-3);
      const delta = coord.getX(index) - expected;
      const period = circumference(measured);
      assert.ok(Math.abs(delta) < 1e-4 || Math.abs(delta - period) < 1e-4);
    }
  } finally {
    offsetMount.cleanup();
  }

  const doorRoot = new Group();
  const doorMaterial = new MeshStandardMaterial();
  doorMaterial.name = 'Wrap_Entry';
  const door = new Mesh(new BoxGeometry(0.7, 1.2, 0.04), doorMaterial);
  door.name = 'RV_WebRig_EntryDoor_Wrap_Entry';
  door.position.set(0.2, 1.1, -1.11);
  doorRoot.add(door);
  const doorMount = mount(doorRoot);
  try {
    const span = doorMount.editor.getState().entryDoorSpan;
    assert.ok(span);
    const xs = [0.2 - 0.35, 0.2 + 0.35];
    const zs = [-1.11 - 0.02, -1.11 + 0.02];
    const samples = xs.flatMap((x) => zs.map((z) => perimeterCoordinate(x, z, BODY)));
    assert.ok(Math.abs(span.s0 - Math.min(...samples)) < 1e-4);
    assert.ok(Math.abs(span.s1 - Math.max(...samples)) < 1e-4);
    assert.ok(Math.abs(span.h0 - 0.5) < 1e-4);
    assert.ok(Math.abs(span.h1 - 1.7) < 1e-4);
  } finally {
    doorMount.cleanup();
  }
});

void test('a triangle that fully contains an opening or a void is rejected', () => {
  const envelope = { xMin: -3, length: 6, width: 2.2, height: 3, centerZ: 0 };
  const corners = [
    [-2, 0, -1.1],
    [0, 3, -1.1],
    [2, 0, -1.1],
  ] as [Vec3, Vec3, Vec3];
  const opening: VehicleModelProfile = {
    id: 'contain-opening',
    label: '开口包含验证模型',
    verification: true,
    frame: canonicalFrame(),
    envelope,
    panels: [
      {
        id: 'entry',
        class: 'wrap',
        meshes: ['cover'],
        projection: { kind: 'perimeter', face: 'entry' },
        openings: [{ id: 'hole', s0: 2.8, s1: 3.2, h0: 1.4, h1: 1.6 }],
      },
    ],
  };
  const covered = adaptTriangle(opening, 'cover', corners[0], corners[1], corners[2]);
  assert.equal(covered.eligible, false);
  assert.match(covered.feedback.reason, /开口/);
  const mesh = triangleMesh('cover', corners);
  const baked = bakeWrapAttributes(mesh, opening);
  assert.notEqual(baked.feedback.status, 'applied');
  assert.notEqual(labFeedbackStatus(baked.feedback), 'applied');
  const root = new Group();
  root.add(mesh);
  const mounted = mount(root, opening);
  try {
    const listed = mounted.editor.getProfileFeedback().find((item) => item.mesh === 'cover');
    assert.ok(listed);
    assert.notEqual(listed.status, 'applied');
    assert.notEqual(labFeedbackStatus(listed), 'applied');
    const flags = mesh.geometry.getAttribute('aWrapEligible');
    assert.ok(!flags || [...Array(flags.count)].every((_, index) => flags.getX(index) < 0.5));
  } finally {
    mounted.cleanup();
  }

  const pocket: VehicleModelProfile = {
    ...opening,
    id: 'contain-void',
    panels: [
      {
        id: 'entry',
        class: 'wrap',
        meshes: ['cover'],
        projection: { kind: 'perimeter', face: 'entry' },
      },
    ],
    voids: [
      {
        id: 'pocket',
        min: [-0.05, 0.95, -1.15],
        max: [0.05, 1.05, -1.05],
        reason: '跨空隙连成假面',
      },
    ],
  };
  const buried = adaptTriangle(pocket, 'cover', corners[0], corners[1], corners[2]);
  assert.equal(buried.eligible, false);
  assert.match(buried.feedback.reason, /空隙/);
});

void test('a fully rejected mesh is never reported as applied', () => {
  const profile: VehicleModelProfile = {
    id: 'reject-feedback',
    label: '拒绝反馈验证模型',
    verification: true,
    frame: canonicalFrame(),
    envelope: { xMin: -3, length: 6, width: 2.2, height: 3, centerZ: 0 },
    panels: [
      {
        id: 'entry',
        class: 'wrap',
        meshes: ['cover'],
        projection: { kind: 'perimeter', face: 'entry' },
        openings: [{ id: 'hole', s0: 2.8, s1: 3.2, h0: 1.4, h1: 1.6 }],
      },
    ],
  };
  const mesh = triangleMesh('cover', [
    [-2, 0, -1.1],
    [0, 3, -1.1],
    [2, 0, -1.1],
  ]);
  const root = new Group();
  root.add(mesh);
  const mounted = mount(root, profile);
  try {
    for (const item of mounted.editor.getProfileFeedback()) {
      if (item.coverage === 'none' || item.coverage === 'partial')
        assert.notEqual(labFeedbackStatus(item), 'applied', item.mesh);
    }
    const cover = mounted.editor.getProfileFeedback().find((item) => item.mesh === 'cover');
    assert.ok(cover);
    assert.equal(cover.coverage, 'none');
    assert.match(cover.reason, /开口/);
    assert.notEqual(cover.status, 'applied');
  } finally {
    mounted.cleanup();
  }
});

void test('zero-area triangles do not mark a wrapped panel unsupported', () => {
  const profile = labProfile('box-trailer');
  const z = BOX_TRAILER.door.z;
  const degenerate: [Vec3, Vec3, Vec3] = [
    [1.5, 0.9, z],
    [1.5, 0.9, z],
    [1.5, 0.9, z],
  ];
  const good: [Vec3, Vec3, Vec3] = [
    [1.4, 0.8, z],
    [1.2, 0.8, z],
    [1.2, 1.1, z],
  ];
  const inward: [Vec3, Vec3, Vec3] = [
    [1.4, 0.8, z],
    [1.8, 0.8, z],
    [1.4, 1.2, z],
  ];
  const opening: [Vec3, Vec3, Vec3] = [
    [BOX_TRAILER.window.x0 - 0.15, 1.6, z],
    [BOX_TRAILER.window.x1 + 0.15, 1.6, z],
    [BOX_TRAILER.window.x0 + 0.2, BOX_TRAILER.window.y1 + 0.12, z],
  ];
  const collapsed = adaptTriangle(profile, 'trailer_entry', ...degenerate);
  assert.equal(collapsed.eligible, false);
  assert.equal(collapsed.feedback.reason, '退化面');

  const wrapped = panelMesh('trailer_entry', [degenerate, good]);
  const wrappedRoot = new Group();
  wrappedRoot.add(wrapped);
  const wrappedMount = mount(wrappedRoot, profile);
  try {
    const item = wrappedMount.editor
      .getProfileFeedback()
      .find((entry) => entry.mesh === 'trailer_entry');
    assert.ok(item);
    assert.equal(item.coverage, 'full');
    assert.equal(item.status, 'applied');
    assert.equal(labFeedbackStatus(item), 'applied');
    assert.doesNotMatch(item.reason, /退化/);
    const flags = wrapped.geometry.getAttribute('aWrapEligible');
    assert.ok(flags);
    assert.ok([...Array(flags.count)].some((_, index) => flags.getX(index) >= 0.5));
  } finally {
    wrappedMount.cleanup();
  }

  const mixed = panelMesh('trailer_entry', [degenerate, good, inward]);
  const mixedRoot = new Group();
  mixedRoot.add(mixed);
  const mixedMount = mount(mixedRoot, profile);
  try {
    const item = mixedMount.editor
      .getProfileFeedback()
      .find((entry) => entry.mesh === 'trailer_entry');
    assert.ok(item);
    assert.equal(item.coverage, 'partial');
    assert.equal(labFeedbackStatus(item), 'unsupported');
    assert.match(item.reason, /内表面/);
    assert.doesNotMatch(item.reason, /退化/);
  } finally {
    mixedMount.cleanup();
  }

  const blocked = panelMesh('trailer_entry', [degenerate, opening]);
  const blockedRoot = new Group();
  blockedRoot.add(blocked);
  const blockedMount = mount(blockedRoot, profile);
  try {
    const item = blockedMount.editor
      .getProfileFeedback()
      .find((entry) => entry.mesh === 'trailer_entry');
    assert.ok(item);
    assert.equal(item.coverage, 'none');
    assert.notEqual(item.status, 'applied');
    assert.equal(labFeedbackStatus(item), 'unsupported');
    assert.match(item.reason, /开口/);
    assert.doesNotMatch(item.reason, /退化/);
  } finally {
    blockedMount.cleanup();
  }

  const onlyDegenerate = panelMesh('trailer_entry', [degenerate]);
  const onlyRoot = new Group();
  onlyRoot.add(onlyDegenerate);
  const onlyMount = mount(onlyRoot, profile);
  try {
    const item = onlyMount.editor
      .getProfileFeedback()
      .find((entry) => entry.mesh === 'trailer_entry');
    assert.ok(item);
    assert.equal(item.coverage, 'none');
    assert.notEqual(labFeedbackStatus(item), 'applied');
    assert.match(item.reason, /退化/);
  } finally {
    onlyMount.cleanup();
  }
});

void test('the original driver panel is not unsupported when only degenerates are rejected', async () => {
  const bytes = fs.readFileSync('public/model/mxgarage-rv.glb');
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  scene.updateMatrixWorld(true);
  const profile = labProfile('current-glb');
  const found = scene.getObjectByName('RV_Static_Wrap_Driver');
  assert.ok(found instanceof Mesh);
  const driver = found;
  const position = driver.geometry.getAttribute('position');
  const index = driver.geometry.index;
  assert.ok(position && index);
  const before = new Vector3()
    .fromBufferAttribute(position, index.getX(0))
    .applyMatrix4(driver.matrixWorld);
  const held = driver.matrixWorld.clone();
  const root = new Group();
  root.add(driver);
  driver.matrix.copy(held);
  driver.matrix.decompose(driver.position, driver.quaternion, driver.scale);
  root.updateMatrixWorld(true);
  const after = new Vector3()
    .fromBufferAttribute(position, index.getX(0))
    .applyMatrix4(driver.matrixWorld);
  assert.ok(after.distanceTo(before) < 1e-6);
  const worldPoint = new Vector3();
  const cornerAt = (corner: number): Vec3 => {
    worldPoint.fromBufferAttribute(position, index.getX(corner)).applyMatrix4(driver.matrixWorld);
    return [worldPoint.x, worldPoint.y, worldPoint.z];
  };
  let degenerate = 0;
  let eligible = 0;
  let rejected = 0;
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const decision = adaptTriangle(
      profile,
      driver.name,
      cornerAt(triangle),
      cornerAt(triangle + 1),
      cornerAt(triangle + 2),
    );
    if (!decision.eligible && decision.feedback.reason === '退化面') degenerate += 1;
    else if (decision.eligible) eligible += 1;
    else rejected += 1;
  }
  assert.ok(degenerate > 0);
  assert.equal(rejected, 0);
  assert.ok(eligible > degenerate);

  const mounted = mount(root, profile);
  try {
    const item = mounted.editor
      .getProfileFeedback()
      .find((entry) => entry.mesh === 'RV_Static_Wrap_Driver');
    assert.ok(item);
    assert.equal(item.coverage, 'full');
    assert.equal(item.status, 'applied');
    assert.equal(labFeedbackStatus(item), 'applied');
    assert.doesNotMatch(item.reason, /退化/);
    const flags = driver.geometry.getAttribute('aWrapEligible');
    assert.ok(flags);
    let inked = 0;
    for (let vertex = 0; vertex < flags.count; vertex += 1)
      if (flags.getX(vertex) >= 0.5) inked += 1;
    assert.ok(inked > 0);
  } finally {
    mounted.cleanup();
  }
});
});

void test('the original entry seam stays continuous for the reported decal', async () => {
  const bytes = fs.readFileSync('public/model/mxgarage-rv.glb');
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  scene.updateMatrixWorld(true);
  const profile = labProfile('current-glb');
  const entry = scene.getObjectByName('RV_Static_Wrap_Entry');
  const driver = scene.getObjectByName('RV_Static_Wrap_Driver');
  const door = scene.getObjectByName('RV_WebRig_EntryDoor_Wrap_Entry');
  assert.ok(entry instanceof Mesh && driver instanceof Mesh && door instanceof Mesh);
  for (const mesh of [entry, driver, door]) bakeWrapAttributes(mesh, profile);
  const design = {
    version: 1 as const,
    text: 'MXGARAGE',
    icon: 'cup' as const,
    swatch: '#c4553a',
    x: 0.45,
    y: 0.44,
    scale: 0.81,
  };
  const swatch = designMarks(design).find((mark) => mark.kind === 'swatch');
  assert.ok(swatch);
  const length = profile.envelope.length;
  const boundaryS = (1 - swatch.editorX - swatch.w) * length;
  assert.ok(Math.abs(boundaryS - 0.46516) < 0.001);
  const ray = new Raycaster();
  const sample = (mesh: Mesh, x: number, y: number, fromPositiveZ: boolean) => {
    const origin = new Vector3(x, y, fromPositiveZ ? 3 : -3);
    const direction = new Vector3(0, 0, fromPositiveZ ? -1 : 1);
    ray.set(origin, direction);
    const hit = ray.intersectObject(mesh, false)[0];
    if (!hit?.face) return null;
    const position = mesh.geometry.getAttribute('position');
    const coord = mesh.geometry.getAttribute('aWrapCoord');
    const ids = [hit.face.a, hit.face.b, hit.face.c];
    const points = ids.map((id) =>
      new Vector3().fromBufferAttribute(position, id).applyMatrix4(mesh.matrixWorld),
    );
    const bary = new Triangle(points[0], points[1], points[2]).getBarycoord(
      hit.point,
      new Vector3(),
    );
    if (!bary) return null;
    const s =
      coord.getX(ids[0]) * bary.x +
      coord.getX(ids[1]) * bary.y +
      coord.getX(ids[2]) * bary.z;
    return { s: ((s % 16.04) + 16.04) % 16.04, point: hit.point };
  };
  const jump = (mesh: Mesh, x: number, y: number, positive: boolean) => {
    const below = sample(mesh, x, y - 0.00001, positive);
    const above = sample(mesh, x, y + 0.00001, positive);
    assert.ok(below && above, `${mesh.name} ${x} ${y}`);
    return Math.abs(above.s - below.s);
  };
  for (const x of [1.0, 1.5, 2.0])
    assert.ok(jump(entry, x, 1.25, false) < 0.001, `entry x=${x}`);
  for (const [place, scale] of [
    [0.2, 1],
    [0.45, 0.81],
    [0.3, 0.6],
  ] as const) {
    const mark = designMarks({ ...design, x: place, scale }).find(
      (item) => item.kind === 'swatch',
    );
    assert.ok(mark);
    const edge = (1 - place - mark.w) * length;
    assert.ok(edge > 0.05 && edge < length - 0.05, `${place} ${scale}`);
    const xAt = (y: number) => {
      let best = 0;
      let bestDelta = Infinity;
      for (let x = 0.2; x <= 2.8; x += 0.02) {
        const hit = sample(entry, x, y, false);
        if (!hit) continue;
        const delta = Math.abs(hit.s - edge);
        if (delta < bestDelta) {
          best = x;
          bestDelta = delta;
        }
      }
      assert.ok(bestDelta < 0.05, `scale ${scale} y ${y}`);
      return best;
    };
    assert.ok(Math.abs(xAt(1.24999) - xAt(1.25001)) < 0.002, `scale ${scale}`);
  }
  for (const x of [0.2, 1.2, 2.2])
    for (const y of [0.9, 1.1, 1.25])
      assert.ok(jump(driver, x, y, true) < 0.001, `driver ${x} ${y}`);
  const doorVertex = new Vector3().fromBufferAttribute(
    door.geometry.getAttribute('position'),
    0,
  );
  const closed = doorVertex.clone().applyMatrix4(door.matrixWorld);
  const doorS = door.geometry.getAttribute('aWrapCoord').getX(0);
  const rig = scene.getObjectByName('WebRig_EntryDoor');
  assert.ok(rig);
  rig.rotateY(0.9);
  rig.updateMatrixWorld(true);
  const opened = doorVertex.clone().applyMatrix4(door.matrixWorld);
  assert.ok(opened.distanceTo(closed) > 0.05);
  assert.equal(door.geometry.getAttribute('aWrapCoord').getX(0), doorS);
  const nearby = sample(entry, closed.x, Math.min(closed.y, 2.2), false);
  assert.ok(nearby);
  assert.ok(Math.abs(nearby.s - (((doorS % 16.04) + 16.04) % 16.04)) < 0.05);
});
