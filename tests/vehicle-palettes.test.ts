import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VEHICLE_PALETTES } from '../lib/vehicle-palettes.ts';
import { VehicleWrapEditor } from '../lib/vehicle-wrap-editor.ts';
import { t } from '../lib/i18n.ts';
import { SceneEngine } from '../components/studio/scene-engine.ts';

// These literal values come from the approved issue table, not the implementation.
const expectedColors = [
  ['#F3F2EC', '#78A9CC', '#D9DDE1'],
  ['#F2F2EE', '#6F9A86', '#D9DDE1'],
  ['#F1EEE4', '#E0B33A', '#5A4632'],
  ['#EFE7D6', '#A8262E', '#D9D1BD'],
  ['#F4F4F0', '#3EB2AC', '#E9813A'],
  ['#F2F2EE', '#E2702B', '#8E9396'],
  ['#F0EDE4', '#2F5B45', '#C8A24A'],
  ['#F1ECDF', '#C4A47C', '#7A5A3E'],
  ['#F5F3EF', '#E8A3B4', '#9ED6C3'],
  ['#F2F2EE', '#34445A', '#C9CDD1'],
];

// Inspect the original function identity without extracting a callable method.
const readCompileHook = (material: THREE.Material): unknown =>
  Reflect.get(material, 'onBeforeCompile');

void test('the ten selectable palettes retain all approved colors and translated names', () => {
  assert.deepEqual(
    VEHICLE_PALETTES.map(({ white, accent, trim }) => [white, accent, trim]),
    expectedColors,
  );
  assert.equal(new Set(VEHICLE_PALETTES.map((p) => p.id)).size, 10);
  for (const palette of VEHICLE_PALETTES) {
    assert.ok(palette.id.length > 0);
    const en = t('en', palette.nameKey),
      zh = t('zh', palette.nameKey);
    assert.notEqual(en, palette.nameKey);
    assert.notEqual(zh, palette.nameKey);
    assert.notEqual(en, zh);
    assert.match(zh, /[\u4e00-\u9fff]/);
  }
});

function setup() {
  const previousWindow = globalThis.window;
  Object.assign(globalThis, { window: new EventTarget() });
  const canvas = Object.assign(new EventTarget(), {
    style: { cursor: '' },
    focus() {},
  });
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: '#d8d8d2' });
  material.name = 'Wrap_Body';
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(5.8, 3.05, 2.22),
    material,
  );
  panel.name = 'RV_Static_Wrap_Body';
  panel.position.y = 1.525;
  root.add(panel);
  const excluded = ['Reflector', 'LicensePlate', 'Glass', 'Tire'].map(
    (name) => {
      const surface = new THREE.MeshStandardMaterial({ color: '#a8262e' });
      surface.name = name;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.1, 0.1),
        surface,
      );
      mesh.name = `RV_Static_${name}`;
      root.add(mesh);
      return {
        mesh,
        material: surface,
        color: surface.color.clone(),
        hook: readCompileHook(surface),
      };
    },
  );
  const editor = new VehicleWrapEditor({
    root,
    camera: new THREE.PerspectiveCamera(),
    controls: { domElement: canvas, enabled: true } as unknown as OrbitControls,
    host: canvas as unknown as HTMLElement,
    body: { xMin: -2.85, length: 5.8, width: 2.22, height: 3.05 },
    reveal: { value: 1 },
    onChange() {},
    takeCamera() {},
  });
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: '#include <begin_vertex>',
    fragmentShader: '#include <color_fragment>',
  };
  // Invoke the real material hook at its compile boundary; no WebGL or file reads.
  material.onBeforeCompile(
    shader as unknown as Parameters<THREE.Material['onBeforeCompile']>[0],
    null as unknown as THREE.WebGLRenderer,
  );
  return {
    editor,
    material,
    panel,
    excluded,
    shader,
    cleanup: () => {
      editor.dispose();
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          for (const surface of [object.material].flat()) surface.dispose();
        }
      });
      Object.assign(globalThis, { window: previousWindow });
    },
  };
}

void test('palette uniforms start disabled and compose before the existing eligible decal layer', () => {
  const { shader, cleanup } = setup();
  try {
    assert.equal(shader.uniforms.uPaletteEnabled?.value, 0);
    assert.match(
      shader.fragmentShader,
      /uPaletteEnabled > \.5 && vWrapEligible > \.5/,
    );
    assert.ok(
      shader.fragmentShader.indexOf('uPaletteEnabled >') <
        shader.fragmentShader.indexOf('uHasDecal >'),
    );
    assert.match(shader.fragmentShader, /vWrapCoord\.y/);
    assert.match(shader.fragmentShader, /uPaletteAccent/);
    assert.match(shader.fragmentShader, /uPaletteTrim/);
    assert.match(shader.fragmentShader, /uPaletteWhite/);
  } finally {
    cleanup();
  }
});

void test('all palette switches and restore preserve the actual decal, placements, lock, hook and excluded surfaces', () => {
  const { editor, material, panel, excluded, shader, cleanup } = setup();
  try {
    assert.equal(
      typeof editor.setPalette,
      'function',
      'the independent palette setter must exist',
    );
    editor.setImage({
      naturalWidth: 900,
      naturalHeight: 300,
    } as HTMLImageElement);
    editor.nudge(0.2, 0.1);
    editor.scaleBy(0.9);
    editor.setLocked(true);
    const before = editor.getState(),
      texture = shader.uniforms.uDecalMap.value;
    const hook = readCompileHook(material),
      cacheKey = material.customProgramCacheKey();
    const geometry = panel.geometry;
    const chart = Array.from(geometry.getAttribute('aWrapCoord').array);
    const eligibility = Array.from(
      geometry.getAttribute('aWrapEligible').array,
    );
    assert.equal(before.locked, true);
    for (const palette of VEHICLE_PALETTES) {
      editor.setPalette(palette);
      assert.equal(shader.uniforms.uPaletteEnabled.value, 1);
      for (const [uniform, hex] of [
        ['uPaletteWhite', palette.white],
        ['uPaletteAccent', palette.accent],
        ['uPaletteTrim', palette.trim],
      ])
        assert.equal(
          (shader.uniforms[uniform].value as THREE.Color).getHexString(),
          hex.slice(1).toLowerCase(),
        );
      assert.deepEqual(editor.getState(), before);
      assert.equal(shader.uniforms.uDecalMap.value, texture);
      assert.equal(shader.uniforms.uHasDecal.value, 1);
    }
    // A moving panel keeps the closed-pose chart: no palette re-projection.
    panel.rotation.y = 0.7;
    panel.updateMatrixWorld(true);
    editor.setPalette(VEHICLE_PALETTES[0]);
    editor.setPalette(null);
    assert.equal(shader.uniforms.uPaletteEnabled.value, 0);
    assert.equal(shader.uniforms.uDecalMap.value, texture);
    assert.deepEqual(editor.getState(), before);
    assert.equal(readCompileHook(material), hook);
    assert.equal(material.customProgramCacheKey(), cacheKey);
    assert.equal(panel.geometry, geometry);
    assert.deepEqual(
      Array.from(geometry.getAttribute('aWrapCoord').array),
      chart,
    );
    assert.deepEqual(
      Array.from(geometry.getAttribute('aWrapEligible').array),
      eligibility,
    );
    for (const item of excluded) {
      assert.equal(item.mesh.material, item.material);
      assert.ok(item.material.color.equals(item.color));
      assert.equal(readCompileHook(item.material), item.hook);
      assert.equal(item.mesh.geometry.getAttribute('aWrapCoord'), undefined);
    }
  } finally {
    cleanup();
  }
});

void test('the engine retains a pre-load choice, forwards it to the editor and keeps colors when clearing a sticker', async () => {
  const { editor, shader, cleanup } = setup();
  // Keep the real engine methods, omitting only WebGL construction and I/O.
  const engine: SceneEngine = Object.assign(
    Object.create(SceneEngine.prototype),
    {
      root: null,
      values: new Map(),
      camera: new THREE.PerspectiveCamera(),
      controls: { target: new THREE.Vector3() },
      renderer: { info: { render: { calls: 0, triangles: 0 } } },
      drafting: [],
      drawingLines: [],
      drawingGrid: new THREE.Object3D(),
      environment: 'studio',
      presentation: 'drawing',
      wrapEditor: null,
      imageVersion: 0,
      hooks: { onCommit() {} },
    },
  );
  try {
    assert.equal(
      typeof engine.setPalette,
      'function',
      'the engine needs a palette setter',
    );
    engine.setPalette(VEHICLE_PALETTES[0]);
    assert.equal(engine.getState().paletteId, 'powder-blue');
    assert.equal(engine.getState().presentation, 'render');
    assert.equal(engine.getState().ready, false);
    Object.assign(engine, { wrapEditor: editor });
    engine.setPalette(VEHICLE_PALETTES[9]);
    assert.equal(engine.getState().paletteId, 'charcoal-blue');
    assert.equal(shader.uniforms.uPaletteEnabled.value, 1);
    assert.equal(
      (shader.uniforms.uPaletteAccent.value as THREE.Color).getHexString(),
      '34445a',
    );
    await engine.applySticker(null);
    assert.equal(shader.uniforms.uPaletteEnabled.value, 1);
    assert.equal(engine.getState().paletteId, 'charcoal-blue');
    assert.equal(engine.getState().presentation, 'render');
    engine.setPalette(null);
    assert.equal(engine.getState().paletteId, null);
    assert.equal(shader.uniforms.uPaletteEnabled.value, 0);
  } finally {
    cleanup();
  }
});
