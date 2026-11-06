import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Vector3,
} from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VehicleWrapEditor } from '../lib/vehicle-wrap-editor.ts';
import {
  circumference,
  constrainDecal,
  perimeterCoordinate,
  type DecalPlacement,
} from '../lib/wrap-layout.ts';

/** Frozen clearance from the accepted #35 behavior contract. Applied once. */
const CLEARANCE_M = 0.05;
const MIN_SCALE = 0.25;
const BASE_WIDTH_M = 3.5;
const BODY = { xMin: -2.85, length: 5.8, width: 2.22, height: 3.05 };
const SAMPLES = ['alpine-club', 'coast-club', 'night-route', 'sun-chaser'] as const;

type DoorSpan = { s0: number; s1: number; h0: number; h1: number };
type EditorState = ReturnType<VehicleWrapEditor['getState']> & {
  entryDoorClear?: boolean;
  entryAdjusted?: boolean;
  entryDoorSpan?: DoorSpan | null;
};

class Canvas extends EventTarget {
  style = { cursor: '' };
  clientWidth = 800;
  clientHeight = 600;
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 600 };
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

function pointer(type: string, x = 400, y = 300, button = 0) {
  return Object.assign(new Event(type, { cancelable: true }), {
    clientX: x,
    clientY: y,
    button,
    buttons: type === 'pointermove' ? 1 : 0,
    pointerId: 1,
    pointerType: 'mouse',
  }) as PointerEvent;
}

function image(width: number, height: number) {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
}

function legacyPlacement(index: 0 | 1): DecalPlacement {
  return index === 0
    ? { center: BODY.length - (1 - BODY.xMin), height: 1.28, scale: 1 }
    : {
        center: BODY.length + BODY.width + 1 - BODY.xMin,
        height: 1.28,
        scale: 1,
      };
}

function pngSize(name: (typeof SAMPLES)[number]) {
  const buf = fs.readFileSync(`public/stickers/${name}.png`);
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(buf.subarray(12, 16).toString('ascii'), 'IHDR');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  assert.ok(width > 0 && height > 0);
  return { width, height, aspect: width / height };
}

function near(actual: number, expected: number, eps = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${actual} should be within ${eps} of ${expected}`,
  );
}

/** Entry-side classification mirrors perimeterCoordinate without replacing it. */
function projectsOnEntrySide(x: number, z: number, centerZ: number) {
  const zLocal = z - centerZ;
  const half = BODY.length / 2;
  const w = BODY.width / 2;
  const dx = x - (BODY.xMin + half);
  const r = Math.max(Math.abs(dx) / half, Math.abs(zLocal) / w, 1e-6);
  const px = dx / r;
  const pz = zLocal / r;
  const onSide = Math.abs(pz / w) >= Math.abs(px / half) - 1e-8;
  return onSide && pz < 0;
}

function measureDoor(root: Group) {
  root.updateMatrixWorld(true);
  const wrap = new Box3();
  const door = new Box3();
  const names: string[] = [];
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (o.name.startsWith('RV_Static_Wrap_')) wrap.expandByObject(o, true);
    if (o.name.startsWith('RV_WebRig_EntryDoor_')) {
      door.expandByObject(o, true);
      names.push(o.name);
    }
  });
  assert.ok(!wrap.isEmpty(), 'wrap meshes are required to backfill centerZ');
  assert.ok(!door.isEmpty(), 'entry door meshes are required');
  const centerZ = (wrap.min.z + wrap.max.z) / 2;
  const body = { ...BODY, centerZ };
  const samples: { x: number; z: number; s: number; entry: boolean }[] = [];
  for (const x of [door.min.x, door.max.x]) {
    for (const z of [door.min.z, door.max.z]) {
      samples.push({
        x,
        z,
        s: perimeterCoordinate(x, z, body),
        entry: projectsOnEntrySide(x, z, centerZ),
      });
    }
  }
  const span: DoorSpan = {
    s0: Math.min(...samples.map((p) => p.s)),
    s1: Math.max(...samples.map((p) => p.s)),
    h0: door.min.y,
    h1: door.max.y,
  };
  return { names, centerZ, body, samples, span, door };
}

function rectHitsDoor(placement: DecalPlacement, aspect: number, door: DoorSpan) {
  const halfW = (BASE_WIDTH_M * placement.scale) / 2;
  const halfH = halfW / aspect;
  const s0 = placement.center - halfW;
  const s1 = placement.center + halfW;
  const period = circumference(BODY);
  assert.ok(
    s0 >= 0 && s1 <= period,
    `decal s [${s0}, ${s1}] must stay off the rear seam`,
  );
  const sOverlap = s0 < door.s1 && door.s0 < s1;
  const hOverlap =
    placement.height - halfH < door.h1 && door.h0 < placement.height + halfH;
  return sOverlap && hOverlap;
}

function mount(root: Group, camera?: OrthographicCamera) {
  const previousWindow = globalThis.window;
  const previousElement = globalThis.Element;
  const events = new EventTarget();
  Object.assign(globalThis, { window: events, Element: Canvas });
  const view =
    camera ??
    new OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
  if (!camera) {
    view.position.set(1, 1.28, -8);
    view.lookAt(1, 1.28, 0);
    view.updateMatrixWorld(true);
  }
  const canvas = new Canvas();
  const controls = { domElement: canvas, enabled: true };
  const editor = new VehicleWrapEditor({
    root,
    camera: view,
    controls: controls as unknown as OrbitControls,
    host: canvas as unknown as HTMLElement,
    body: { ...BODY },
    reveal: { value: 1 },
    onChange() {},
    takeCamera() {},
  });
  const cleanup = () => {
    editor.dispose();
    Object.assign(globalThis, {
      window: previousWindow,
      Element: previousElement,
    });
  };
  return { editor, canvas, events, view, cleanup };
}

async function loadVehicle() {
  const bytes = fs.readFileSync('public/model/mxgarage-rv.glb');
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  scene.updateMatrixWorld(true);
  const meta = JSON.parse(
    fs.readFileSync('public/model/motion_metadata.json', 'utf8'),
  ) as {
    motions: {
      id: string;
      nodes: { closedPosition: number[]; closedQuaternion: number[] }[];
    }[];
  };
  const node = meta.motions.find((m) => m.id === 'entry-door')?.nodes[0];
  assert.ok(node, 'motion metadata has no entry-door closed pose');
  const rig = scene.getObjectByName('WebRig_EntryDoor');
  assert.ok(rig, 'GLB has no WebRig_EntryDoor');
  const position = rig.position.toArray();
  const quaternion = rig.quaternion.toArray();
  for (let i = 0; i < 3; i++)
    near(position[i], node.closedPosition[i], 1e-5);
  for (let i = 0; i < 4; i++)
    near(quaternion[i], node.closedQuaternion[i], 1e-5);
  assert.deepEqual(node.closedQuaternion, [0, 0, 0, 1]);
  return scene;
}

function observed(editor: VehicleWrapEditor) {
  return editor.getState() as EditorState;
}

function panelBox(name: string, min: Vector3, max: Vector3) {
  const material = new MeshStandardMaterial();
  material.name = name.startsWith('RV_Static_Wrap_') ? 'Wrap_Body' : 'Body_Paint';
  const mesh = new Mesh(
    new BoxGeometry(max.x - min.x, max.y - min.y, max.z - min.z),
    material,
  );
  mesh.name = name;
  mesh.position.set(
    (min.x + max.x) / 2,
    (min.y + max.y) / 2,
    (min.z + max.z) / 2,
  );
  return mesh;
}

function syntheticBody() {
  const root = new Group();
  root.add(
    panelBox(
      'RV_Static_Wrap_Body',
      new Vector3(-2.85, 0, -1.11),
      new Vector3(2.95, 3.05, 1.11),
    ),
  );
  return root;
}

void describe('entry-side default placement avoids the closed entry door', { concurrency: false }, () => {
  void test('four sample PNGs clear the measured door after constrainDecal', async () => {
    const scene = await loadVehicle();
    const measured = measureDoor(scene);
    assert.ok(
      measured.samples.every((p) => p.entry),
      'door bbox must project onto the entry side',
    );
    const period = circumference(BODY);
    assert.ok(
      measured.span.s1 - measured.span.s0 < period / 2 && measured.span.s0 > 0,
      'door s-interval must not cross the rear seam',
    );
    const rearWidth = measured.span.s0 - 2 * CLEARANCE_M;
    assert.ok(rearWidth > MIN_SCALE * BASE_WIDTH_M, 'rear panel must fit a legal decal');
    assert.ok(rearWidth < BASE_WIDTH_M, 'sample expectation fills the rear slot');
    const { editor, cleanup } = mount(scene);
    try {
      const state = observed(editor);
      assert.ok(state.entryDoorSpan, 'door span is cached at init');
      near(state.entryDoorSpan.s0, measured.span.s0);
      near(state.entryDoorSpan.s1, measured.span.s1);
      near(state.entryDoorSpan.h0, measured.span.h0);
      near(state.entryDoorSpan.h1, measured.span.h1);
      const results = [];
      for (const name of SAMPLES) {
        const png = pngSize(name);
        editor.setImage(image(png.width, png.height));
        const next = observed(editor);
        const entry = next.placements[0];
        const driver = next.placements[1];
        assert.equal(next.entryAdjusted, false, name);
        assert.equal(next.entryDoorClear, true, `${name} degraded to the old default`);
        assert.equal(rectHitsDoor(entry, png.aspect, measured.span), false, name);
        near(entry.center - (BASE_WIDTH_M * entry.scale) / 2, CLEARANCE_M);
        near(
          measured.span.s0 - (entry.center + (BASE_WIDTH_M * entry.scale) / 2),
          CLEARANCE_M,
        );
        near(entry.height, 1.28);
        near(entry.scale, rearWidth / BASE_WIDTH_M);
        assert.deepEqual(driver, constrainDecal(legacyPlacement(1), png.aspect, BODY));
        assert.notDeepEqual(
          entry,
          constrainDecal(legacyPlacement(0), png.aspect, BODY),
        );
        results.push({
          name,
          width: png.width,
          height: png.height,
          aspect: png.aspect,
          clear: next.entryDoorClear,
          center: entry.center,
          heightM: entry.height,
          scale: entry.scale,
        });
      }
      assert.ok(results.every((r) => r.clear));
      console.log(
        `ISSUE35 ${JSON.stringify({
          centerZ: measured.centerZ,
          door: measured.span,
          names: measured.names,
          samples: results,
        })}`,
      );
    } finally {
      cleanup();
    }
  });

  void test('image change and reset do not reread an opened door', async () => {
    const scene = await loadVehicle();
    const { editor, cleanup } = mount(scene);
    try {
      const png = pngSize('coast-club');
      editor.setImage(image(png.width, png.height));
      const before = observed(editor);
      assert.equal(before.entryDoorClear, true);
      const rig = scene.getObjectByName('WebRig_EntryDoor');
      assert.ok(rig);
      rig.rotation.y = Math.PI;
      scene.updateMatrixWorld(true);
      editor.setImage(image(png.width, png.height));
      const afterImage = observed(editor);
      assert.deepEqual(afterImage.entryDoorSpan, before.entryDoorSpan);
      assert.deepEqual(afterImage.placements, before.placements);
      editor.nudge(0.2, 0.05);
      assert.equal(observed(editor).entryAdjusted, true);
      editor.reset();
      const afterReset = observed(editor);
      assert.equal(afterReset.entryAdjusted, false);
      assert.equal(afterReset.entryDoorClear, true);
      assert.deepEqual(afterReset.entryDoorSpan, before.entryDoorSpan);
      assert.deepEqual(afterReset.placements[0], before.placements[0]);
      assert.deepEqual(
        afterReset.placements[1],
        constrainDecal(legacyPlacement(1), png.aspect, BODY),
      );
      assert.equal(
        rectHitsDoor(afterReset.placements[0], png.aspect, before.entryDoorSpan!),
        false,
      );
    } finally {
      cleanup();
    }
  });

  void test('clearing the image restores the legacy both-side default', async () => {
    const scene = await loadVehicle();
    const png = pngSize('night-route');
    const { editor, cleanup } = mount(scene);
    try {
      editor.setImage(image(png.width, png.height));
      editor.nudge(0.15, 0);
      editor.setImage(null);
      const state = observed(editor);
      assert.equal(state.entryAdjusted, false);
      assert.equal(state.entryDoorClear, false);
      assert.deepEqual(
        state.placements[0],
        constrainDecal(legacyPlacement(0), png.aspect, BODY),
      );
      assert.deepEqual(
        state.placements[1],
        constrainDecal(legacyPlacement(1), png.aspect, BODY),
      );
    } finally {
      cleanup();
    }
  });

  void test('a door with no legal rear slot degrades explicitly', () => {
    const root = syntheticBody();
    root.add(
      panelBox(
        'RV_WebRig_EntryDoor_Block',
        new Vector3(2.55, 0.4, -1.12),
        new Vector3(2.85, 2.4, -1.08),
      ),
    );
    const measured = measureDoor(root);
    assert.ok(measured.samples.every((p) => p.entry));
    assert.ok(measured.span.s1 - measured.span.s0 < circumference(BODY) / 2);
    assert.ok(measured.span.s0 - 2 * CLEARANCE_M < MIN_SCALE * BASE_WIDTH_M);
    const { editor, cleanup } = mount(root);
    try {
      const png = pngSize('alpine-club');
      editor.setImage(image(png.width, png.height));
      const state = observed(editor);
      assert.ok(state.entryDoorSpan);
      assert.equal(state.entryDoorClear, false);
      assert.equal(state.entryAdjusted, false);
      assert.deepEqual(
        state.placements[0],
        constrainDecal(legacyPlacement(0), png.aspect, BODY),
      );
      assert.deepEqual(
        state.placements[1],
        constrainDecal(legacyPlacement(1), png.aspect, BODY),
      );
      assert.equal(rectHitsDoor(state.placements[0], png.aspect, measured.span), true);
    } finally {
      cleanup();
    }
  });

  void test('a click with no displacement does not mark the entry side dirty', () => {
    const { editor, canvas, events, cleanup } = mount(syntheticBody());
    try {
      editor.setImage(image(900, 300));
      const before = observed(editor).placements.map((p) => ({ ...p }));
      canvas.dispatchEvent(pointer('pointerdown'));
      assert.equal(observed(editor).dragging, true);
      events.dispatchEvent(pointer('pointerup'));
      const after = observed(editor);
      assert.equal(after.dragging, false);
      assert.equal(after.entryAdjusted, false);
      assert.deepEqual(after.placements, before);
      editor.nudge(0.2, 0);
      assert.equal(observed(editor).entryAdjusted, true);
      const moved = observed(editor).placements.map((p) => ({ ...p }));
      canvas.dispatchEvent(pointer('pointerdown'));
      events.dispatchEvent(pointer('pointerup'));
      assert.equal(observed(editor).entryAdjusted, true);
      assert.deepEqual(observed(editor).placements, moved);
    } finally {
      cleanup();
    }
  });

  void test('drag cancel, Escape, and blur restore the start pose and the prior dirty flag', () => {
    for (const mode of ['cancel', 'escape', 'blur'] as const) {
      const { editor, canvas, events, cleanup } = mount(syntheticBody());
      try {
        editor.setImage(image(900, 300));
        editor.nudge(0.2, 0);
        const start = observed(editor).placements.map((p) => ({ ...p }));
        assert.equal(observed(editor).entryAdjusted, true);
        canvas.dispatchEvent(pointer('pointerdown'));
        assert.equal(observed(editor).dragging, true);
        events.dispatchEvent(pointer('pointermove', 460, 270));
        assert.notDeepEqual(observed(editor).placements, start);
        if (mode === 'cancel') events.dispatchEvent(pointer('pointercancel', 460, 270));
        else if (mode === 'escape')
          canvas.dispatchEvent(
            Object.assign(new Event('keydown', { cancelable: true }), {
              key: 'Escape',
            }),
          );
        else events.dispatchEvent(new Event('blur'));
        const restored = observed(editor);
        assert.equal(restored.dragging, false);
        assert.equal(restored.entryAdjusted, true);
        assert.deepEqual(restored.placements, start);
        editor.setImage(image(1200, 300));
        const kept = observed(editor);
        assert.equal(kept.entryAdjusted, true);
        assert.deepEqual(
          kept.placements[0],
          constrainDecal(start[0], 4, BODY),
        );
        assert.notDeepEqual(
          kept.placements[0],
          constrainDecal(legacyPlacement(0), 4, BODY),
        );
      } finally {
        cleanup();
      }
    }
  });

  void test('cancelling a drag from a clean entry side leaves it clean', () => {
    const { editor, canvas, events, cleanup } = mount(syntheticBody());
    try {
      editor.setImage(image(900, 300));
      const start = observed(editor).placements.map((p) => ({ ...p }));
      canvas.dispatchEvent(pointer('pointerdown'));
      events.dispatchEvent(pointer('pointermove', 460, 270));
      events.dispatchEvent(new Event('blur'));
      const state = observed(editor);
      assert.equal(state.entryAdjusted, false);
      assert.deepEqual(state.placements, start);
      editor.setImage(image(1200, 300));
      assert.equal(observed(editor).entryAdjusted, false);
      assert.deepEqual(
        observed(editor).placements[0],
        constrainDecal(legacyPlacement(0), 4, BODY),
      );
    } finally {
      cleanup();
    }
  });

  void test('driver-side edits do not mark the entry side, and reset restores both sides', () => {
    const camera = new OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
    camera.position.set(1, 1.28, 8);
    camera.lookAt(1, 1.28, 0);
    camera.updateMatrixWorld(true);
    const { editor, canvas, events, cleanup } = mount(syntheticBody(), camera);
    try {
      editor.setImage(image(900, 300));
      const before = observed(editor).placements.map((p) => ({ ...p }));
      canvas.dispatchEvent(pointer('pointerdown'));
      assert.equal(observed(editor).dragging, true);
      events.dispatchEvent(pointer('pointermove', 460, 270));
      events.dispatchEvent(pointer('pointerup', 460, 270));
      const moved = observed(editor);
      assert.equal(moved.entryAdjusted, false);
      assert.deepEqual(moved.placements[0], before[0]);
      assert.notDeepEqual(moved.placements[1], before[1]);
      editor.reset();
      const reset = observed(editor);
      assert.equal(reset.entryAdjusted, false);
      assert.equal(reset.entryDoorClear, false);
      assert.deepEqual(reset.placements, before);
    } finally {
      cleanup();
    }
  });
});
