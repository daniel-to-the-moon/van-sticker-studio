import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fitStudioCamera } from '../lib/studio-framing.ts';
import { STUDIO_VIEW_DIRECTIONS } from '../lib/drawing-views.ts';
void test('side views are truly level and lateral', () => {
  assert.deepEqual(STUDIO_VIEW_DIRECTIONS.entry, [0, 0, -1]);
  assert.deepEqual(STUDIO_VIEW_DIRECTIONS.driver, [0, 0, 1]);
});
void test('responsive framing fits full vehicle on portrait and landscape canvas', () => {
  const box = new THREE.Box3(
    new THREE.Vector3(-3, 0, -1.2),
    new THREE.Vector3(3, 3, 1.2),
  );
  for (const aspect of [0.55, 1, 2.2])
    for (const direction of [
      [0, 0, 1],
      [-0.83, 0.48, -1],
    ] as const) {
      const { target, position } = fitStudioCamera(box, direction, 37, aspect);
      const camera = new THREE.PerspectiveCamera(37, aspect, 0.08, 160);
      camera.position.copy(position);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      let maximum = 0;
      for (const x of [-3, 3])
        for (const y of [0, 3])
          for (const z of [-1.2, 1.2]) {
            const p = new THREE.Vector3(x, y, z).project(camera);
            maximum = Math.max(maximum, Math.abs(p.x), Math.abs(p.y));
          }
      assert.ok(
        maximum <= 0.521 && maximum >= 0.48,
        `framing ${aspect}: ${maximum}`,
      );
    }
});
