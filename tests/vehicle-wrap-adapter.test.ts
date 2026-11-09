import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Vector3,
} from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VehicleWrapEditor } from '../lib/vehicle-wrap-editor.ts';
import { circumference, perimeterCoordinate } from '../lib/wrap-layout.ts';
import {
  adaptPoint,
  adaptTriangle,
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
import { withPanelMotion } from '../lib/vehicle-model-profile.ts';

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
