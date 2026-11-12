import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Box3, DoubleSide, Mesh, Raycaster, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clearOccludingWindowFrames } from '../lib/window-wrap-clearance.ts';

async function load() {
  const bytes = fs.readFileSync('public/model/mxgarage-rv.glb');
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of [object.material].flat()) material.side = DoubleSide;
  });
  return scene;
}

function meshes(scene: Mesh['parent']) {
  const found: Mesh[] = [];
  scene?.traverse((object) => {
    if (object instanceof Mesh) found.push(object);
  });
  return found;
}

function firstHit(scene: Mesh['parent'], x: number, y: number, z: number, side: number) {
  const ray = new Raycaster(
    new Vector3(x, y, side * 4),
    new Vector3(0, 0, -side),
  );
  return ray.intersectObjects(meshes(scene), false)[0]?.object.name ?? '';
}

const SIDE_WINDOWS = [1, 2, 3, 4, 5, 6];

void test('every side window and the cab keep a glass hole while frames stop covering the wrap', async () => {
  const scene = await load();
  const rings = scene.getObjectByName('RV_Static_Trim_Rings') as Mesh;
  const vertsBefore = rings.geometry.attributes.position.count;
  const window1 = scene.getObjectByName('RV_WebRig_Window_1_Glass') as Mesh;
  const box1 = new Box3().setFromObject(window1);
  const center1 = box1.getCenter(new Vector3());
  const blocked = firstHit(
    scene,
    center1.x,
    box1.min.y - 0.02,
    center1.z,
    Math.sign(center1.z),
  );
  assert.match(blocked, /Graphite|Trim_Rings/);

  const report = clearOccludingWindowFrames(scene);
  assert.ok(report.apertures.some((name) => name.includes('Window_1')));
  assert.ok(report.apertures.some((name) => name.includes('Window_6')));
  assert.ok(report.apertures.some((name) => name.includes('Slide_L')));
  assert.ok(report.apertures.some((name) => name.includes('Slide_R')));
  assert.ok(report.apertures.some((name) => name.includes('EntryDoor')));
  assert.equal(rings.geometry.attributes.position.count, vertsBefore);
  assert.ok((report.removed['RV_Static_Trim_Rings'] ?? 0) > 0);
  assert.ok((report.removed['RV_Static_Trim_Rings'] ?? 0) < 80);

  for (const id of SIDE_WINDOWS) {
    const glass = scene.getObjectByName(`RV_WebRig_Window_${id}_Glass`) as Mesh;
    const box = new Box3().setFromObject(glass);
    const center = box.getCenter(new Vector3());
    const side = Math.sign(center.z) || -1;
    const opening = firstHit(scene, center.x, center.y, center.z, side);
    assert.equal(
      opening,
      glass.name,
      `window ${id} opening should still be glass`,
    );
    const below = firstHit(scene, center.x, box.min.y - 0.02, center.z, side);
    const above = firstHit(scene, center.x, box.max.y + 0.02, center.z, side);
    for (const [place, name] of [
      ['below', below],
      ['above', above],
    ] as const) {
      assert.doesNotMatch(
        name,
        /Graphite|Trim_Rings/,
        `window ${id} ${place} is still covered by ${name}`,
      );
    }
    if (id === 1 || id === 2 || id === 6)
      assert.match(below, /Wrap_/, `window ${id} sill should reveal the wrap`);
    if (id === 5) assert.match(below, /Wrap_/, 'driver upper sill should reveal the wrap');
  }

  for (const name of ['RV_WebRig_Slide_L_Glass', 'RV_WebRig_Slide_R_Glass']) {
    const glass = scene.getObjectByName(name) as Mesh;
    const box = new Box3().setFromObject(glass);
    const center = box.getCenter(new Vector3());
    const side = Math.sign(center.z) || -1;
    assert.equal(firstHit(scene, center.x, center.y, center.z, side), name);
    const below = firstHit(scene, center.x, box.min.y - 0.02, center.z, side);
    assert.match(below, /Wrap_/, `${name} sill should show the cab wrap`);
    assert.doesNotMatch(below, /Graphite|Trim_Rings/);
  }
});
