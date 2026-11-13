import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  DEFAULT_BODY_CONFIG,
  type BodyConfig,
} from '../lib/parametric-body.ts';
import { buildMotorhomeBDetail } from '../lib/parametric-body-detail.ts';
import { buildParametricBody } from '../lib/parametric-body-scene.ts';
import {
  MODEL_CATALOG,
  configForEntry,
  configForModelIn,
  isEntryComplete,
  isModelSelectableIn,
  registryStatusOf,
  type RegistryEntry,
} from '../lib/announcement-db.ts';

/**
 * Issue #2 acceptance for the R13 motorhome-b detail generator.
 *
 * Import/fs chain, checked before the whitelist run: this file imports
 * node:test, node:assert/strict, node:fs, three, lib/parametric-body.ts
 * (no further local imports), lib/parametric-body-detail.ts (three and
 * parametric-body), lib/parametric-body-scene.ts (three, parametric-body,
 * parametric-body-detail) and lib/announcement-db.ts (parametric-body
 * only). fs reads lib/announcement-db.json plus the page, scene and
 * body sources as text. It does not import announcement-db-data.ts,
 * app/body-lab/page.tsx, vite.config.ts, or .openai/hosting.json.
 *
 * Registry rows that carry both verified overhangs use the detail
 * generator. Input that omits them stays on the schematic body,
 * including the 0.08 m roof slab. The generator itself throws when
 * those fields are missing.
 */

const shipped = JSON.parse(
  fs.readFileSync(
    new URL('../lib/announcement-db.json', import.meta.url),
    'utf8',
  ),
) as { entries: RegistryEntry[] };

const entries = shipped.entries;

function completeRows(): RegistryEntry[] {
  return entries.filter((entry) => isEntryComplete(entry));
}

function partialRows(): RegistryEntry[] {
  return entries.filter((entry) => !isEntryComplete(entry));
}

/** Same overhang join the body-lab page applies to a complete row. */
function detailConfig(entry: RegistryEntry): BodyConfig {
  const model = MODEL_CATALOG.find((candidate) => candidate.id === entry.id);
  assert.ok(model, `catalog model for ${entry.id}`);
  const config = configForEntry(model, entry);
  assert.ok(config, `config for ${entry.id}`);
  return {
    ...config,
    frontOverhangMm: entry.verified.front_overhang_mm,
    rearOverhangMm: entry.verified.rear_overhang_mm,
  };
}

function meshes(group: THREE.Group): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) found.push(object);
  });
  return found;
}

function byFeature(group: THREE.Group, feature: string): THREE.Mesh[] {
  return meshes(group).filter((mesh) => mesh.userData.feature === feature);
}

function bboxOf(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

void test('24 complete rows satisfy F+WB+R=L and the detail bbox', () => {
  const rows = completeRows();
  assert.equal(rows.length, 24);
  for (const entry of rows) {
    const verified = entry.verified;
    const length = verified.length_mm as number;
    const front = verified.front_overhang_mm as number;
    const rear = verified.rear_overhang_mm as number;
    const wheelbase = verified.wheelbase_mm as number;
    assert.equal(
      front + wheelbase + rear,
      length,
      `${entry.id} F+WB+R must equal L`,
    );
    const config = detailConfig(entry);
    const group = buildParametricBody(config);
    const size = bboxOf(group).getSize(new THREE.Vector3());
    assert.ok(
      Math.abs(size.x - length / 1000) < 0.01,
      `${entry.id} length ${size.x} vs ${length / 1000}`,
    );
    assert.ok(
      Math.abs(size.y - (verified.height_mm as number) / 1000) < 0.02,
      `${entry.id} height ${size.y} vs ${(verified.height_mm as number) / 1000}`,
    );
  }
});

void test('wheels are grounded and axle x matches the 4-anchor overhang', () => {
  for (const entry of completeRows()) {
    const config = detailConfig(entry);
    const lengthM = config.lengthMm / 1000;
    const frontM = (config.frontOverhangMm ?? 0) / 1000;
    const wheelbaseM = config.wheelbaseMm / 1000;
    const frontX = -lengthM / 2 + frontM;
    const rearX = frontX + wheelbaseM;
    const group = buildParametricBody(config);
    const box = bboxOf(group);
    assert.ok(
      Math.abs(box.min.y) < 1e-3,
      `${entry.id} min.y ${box.min.y} should be 0`,
    );
    const tires = byFeature(group, 'wheel-tire');
    assert.equal(tires.length, 4, `${entry.id} tire count`);
    const frontTires = tires.filter((tire) => tire.position.x < 0);
    const rearTires = tires.filter((tire) => tire.position.x > 0);
    assert.equal(frontTires.length, 2);
    assert.equal(rearTires.length, 2);
    for (const tire of frontTires) {
      assert.ok(
        Math.abs(tire.position.x - frontX) < 1e-3,
        `${entry.id} front axle ${tire.position.x} vs ${frontX}`,
      );
      const tireBox = bboxOf(tire);
      assert.ok(Math.abs(tireBox.min.y) < 1e-3, `${entry.id} tire min.y`);
    }
    for (const tire of rearTires) {
      assert.ok(
        Math.abs(tire.position.x - rearX) < 1e-3,
        `${entry.id} rear axle ${tire.position.x} vs ${rearX}`,
      );
    }
    // Centered ±wheelbase/2 is the retired 2-anchor placement.
    assert.ok(
      Math.abs(frontX - -wheelbaseM / 2) > 0.02,
      `${entry.id} overhang must move the front axle off center`,
    );
  }
});

void test('shell width is exact and a taller body does not grow the wheels', () => {
  const entry = completeRows()[0];
  assert.ok(entry);
  const config = detailConfig(entry);
  const group = buildParametricBody(config);
  const shell = byFeature(group, 'shell');
  assert.equal(shell.length, 1);
  const shellBox = bboxOf(shell[0]);
  assert.ok(
    Math.abs(shellBox.max.z - shellBox.min.z - config.widthMm / 1000) < 1e-3,
    `shell width ${shellBox.max.z - shellBox.min.z}`,
  );
  assert.ok(
    Math.abs(shellBox.max.y - config.heightMm / 1000) < 1e-3,
    `shell top ${shellBox.max.y}`,
  );
  const short = buildParametricBody(config);
  const tall = buildParametricBody({
    ...config,
    heightMm: config.heightMm + 400,
  });
  const diameter = (body: THREE.Group) => {
    const tire = byFeature(body, 'wheel-tire')[0];
    assert.ok(tire);
    return bboxOf(tire).getSize(new THREE.Vector3()).y;
  };
  assert.ok(
    Math.abs(diameter(short) - diameter(tall)) < 1e-4,
    'below-floor tire diameter must stay absolute',
  );
  assert.ok(
    Math.abs(bboxOf(byFeature(tall, 'shell')[0]).max.y - (config.heightMm + 400) / 1000) <
      1e-3,
  );
});

void test('feature list is tagged and the R13 brow band is absent', () => {
  const group = buildParametricBody(detailConfig(completeRows()[0]));
  const tags = new Set(
    meshes(group)
      .map((mesh) => mesh.userData.feature)
      .filter((feature): feature is string => typeof feature === 'string'),
  );
  const required = [
    'shell',
    'roof',
    'window-glass-forehead-entry',
    'window-frame-forehead-entry',
    'window-glass-living-front',
    'window-frame-living-front',
    'window-glass-living-rear',
    'window-frame-living-rear',
    'window-glass-entry-door',
    'window-frame-entry-door',
    'window-glass-cab-entry',
    'window-frame-cab-entry',
    'window-glass-forehead-other',
    'window-frame-forehead-other',
    'window-glass-kitchen',
    'window-frame-kitchen',
    'window-glass-bathroom',
    'window-frame-bathroom',
    'window-glass-cab-other',
    'window-frame-cab-other',
    'door-entry',
    'door-entry-frame',
    'door-entry-handle',
    'handle-cab-entry',
    'handle-cab-other',
    'windshield',
    'skylight-forehead',
    'wheel-tire',
    'wheel-rim',
    'wheel-hub',
    'wheel-spoke',
    'bumper-front',
    'bumper-rear',
    'grille',
    'grille-bar',
    'light-front',
    'light-rear',
    'mirror',
  ];
  for (const feature of required) {
    assert.ok(tags.has(feature), `missing feature ${feature}`);
  }
  assert.equal(byFeature(group, 'wheel-spoke').length, 20);
  assert.equal(byFeature(group, 'grille-bar').length, 3);
  assert.equal(byFeature(group, 'light-front').length, 2);
  assert.equal(byFeature(group, 'light-rear').length, 2);
  assert.equal(byFeature(group, 'mirror').length, 2);
  for (const feature of tags) {
    assert.equal(feature.includes('brow'), false, `brow feature ${feature}`);
  }
  const glass = bboxOf(byFeature(group, 'window-glass-kitchen')[0]).getSize(
    new THREE.Vector3(),
  );
  const frame = bboxOf(byFeature(group, 'window-frame-kitchen')[0]).getSize(
    new THREE.Vector3(),
  );
  assert.ok(
    Math.abs(frame.x - glass.x - 0.07) < 0.004,
    `frame border x ${frame.x} vs glass ${glass.x}`,
  );
  assert.ok(
    Math.abs(frame.y - glass.y - 0.07) < 0.004,
    `frame border y ${frame.y} vs glass ${glass.y}`,
  );
});

void test('kitchen and bathroom windows share the V02 center height', () => {
  const group = buildParametricBody(detailConfig(completeRows()[0]));
  const kitchen = bboxOf(byFeature(group, 'window-glass-kitchen')[0]).getCenter(
    new THREE.Vector3(),
  );
  const bathroom = bboxOf(byFeature(group, 'window-glass-bathroom')[0]).getCenter(
    new THREE.Vector3(),
  );
  assert.ok(Math.abs(kitchen.y - bathroom.y) < 1e-3, `${kitchen.y} vs ${bathroom.y}`);
  assert.ok(kitchen.z > 0, 'kitchen is on the non-entry side');
  assert.ok(bathroom.z > 0);
  const living = byFeature(group, 'window-glass-living-front');
  assert.equal(living.length, 1);
  assert.ok(bboxOf(living[0]).getCenter(new THREE.Vector3()).z < 0);
});

void test('windshield sits on the nose and tracks front overhang', () => {
  const entry = completeRows().find((row) => row.id === 'sh6601a4db-h2372');
  assert.ok(entry);
  const base = detailConfig(entry);
  const longerNose: BodyConfig = {
    ...base,
    frontOverhangMm: (base.frontOverhangMm ?? 0) + 200,
    rearOverhangMm: (base.rearOverhangMm ?? 0) - 200,
  };
  const noseX = (config: BodyConfig) => {
    const group = buildParametricBody(config);
    const shield = byFeature(group, 'windshield');
    assert.equal(shield.length, 1);
    const box = bboxOf(shield[0]);
    const front = -config.lengthMm / 1000 / 2;
    assert.ok(box.min.x > front + 0.02, `windshield ahead of the nose ${box.min.x}`);
    return box.getCenter(new THREE.Vector3()).x;
  };
  const short = noseX(base);
  const long = noseX(longerNose);
  // The front face stays at -L/2. A longer front overhang stretches the
  // nose segment, so a feature on that surface moves rearward with it.
  assert.ok(
    long > short + 0.05,
    `windshield stayed off the stretched nose (${short} -> ${long})`,
  );
});

void test('11 partial rows stay visible, unselectable, and emit no config', () => {
  const partial = partialRows();
  assert.equal(partial.length, 11);
  assert.deepEqual(registryStatusOf(entries), { complete: 24, partial: 11 });
  for (const entry of partial) {
    assert.equal(entry.status, 'partial');
    assert.ok(entry.name.length > 0, `${entry.id} has no visible name`);
    assert.equal(isEntryComplete(entry), false);
    assert.equal(isModelSelectableIn(entries, entry.id), false, entry.id);
    assert.equal(configForModelIn(entries, entry.id), null, entry.id);
    const model = MODEL_CATALOG.find((candidate) => candidate.id === entry.id);
    if (model) assert.equal(configForEntry(model, entry), null);
  }
});

void test('detail generator rejects input missing verified overhangs', () => {
  assert.throws(
    () => buildMotorhomeBDetail(DEFAULT_BODY_CONFIG),
    /frontOverhangMm/,
  );
  const row = detailConfig(completeRows()[0]);
  const withoutFront: BodyConfig = { ...row };
  delete withoutFront.frontOverhangMm;
  assert.throws(() => buildMotorhomeBDetail(withoutFront), /frontOverhangMm/);
  const withoutRear: BodyConfig = { ...row };
  delete withoutRear.rearOverhangMm;
  assert.throws(() => buildMotorhomeBDetail(withoutRear), /rearOverhangMm/);
  assert.throws(
    () => buildMotorhomeBDetail({ ...row, vehicleKind: 'camper' }),
    /motorhome-b/,
  );
});

void test('default demo without overhangs keeps the schematic roof slab', () => {
  const group = buildParametricBody(DEFAULT_BODY_CONFIG);
  const size = bboxOf(group).getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.y - 3.13) < 0.02, `height ${size.y}`);
  assert.equal(byFeature(group, 'shell').length, 0);
  assert.equal(byFeature(group, 'wheel-tire').length, 0);
});

void test('clearing overhangs restores the schematic body', () => {
  const detailed = detailConfig(completeRows()[0]);
  const restored: BodyConfig = { ...detailed };
  delete restored.frontOverhangMm;
  delete restored.rearOverhangMm;
  const group = buildParametricBody(restored);
  assert.equal(byFeature(group, 'shell').length, 0);
  const size = bboxOf(group).getSize(new THREE.Vector3());
  assert.ok(
    Math.abs(size.y - (restored.heightMm / 1000 + 0.08)) < 0.02,
    `restored height ${size.y}`,
  );
});

void test('body-lab wires overhang from the registry row and motorhome-b calls the detail generator', () => {
  const page = fs.readFileSync(
    new URL('../app/body-lab/page.tsx', import.meta.url),
    'utf8',
  );
  const scene = fs.readFileSync(
    new URL('../lib/parametric-body-scene.ts', import.meta.url),
    'utf8',
  );
  const body = fs.readFileSync(
    new URL('../lib/parametric-body.ts', import.meta.url),
    'utf8',
  );
  assert.match(page, /front_overhang_mm/);
  assert.match(page, /rear_overhang_mm/);
  assert.match(page, /registryEntryForModel/);
  assert.match(page, /setConfig\(\{ \.\.\.DEFAULT_BODY_CONFIG \}\)/);
  assert.match(scene, /verifiedMotorhomeBOverhangs/);
  assert.match(scene, /buildMotorhomeBDetail/);
  assert.match(scene, /buildVanBody\(config, 0\.55, 0\.36\)/);
  assert.match(body, /frontOverhangMm\?/);
  assert.match(body, /rearOverhangMm\?/);
});
