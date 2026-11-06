import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  DEFAULT_BODY_CONFIG,
  axlePositionsMm,
  easeOutCubic,
  lerpTrio,
  snapChassisTrio,
  snapToAnnounced,
  trioLengthMm,
  type BodyConfig,
  type ChassisTrio,
} from '../lib/parametric-body.ts';
import {
  MODEL_CATALOG,
  announcedChassisPoints,
  configForEntry,
  type RegistryEntry,
} from '../lib/announcement-db.ts';
import { buildParametricBody } from '../lib/parametric-body-scene.ts';

/** Shipped registry, read the same way node --test can read it. */
const shipped = JSON.parse(
  fs.readFileSync(
    new URL('../lib/announcement-db.json', import.meta.url),
    'utf8',
  ),
) as { version: number; entries: RegistryEntry[] };

const a4db: ChassisTrio = {
  frontOverhangMm: 845,
  wheelbaseMm: 4175,
  rearOverhangMm: 975,
};

void test('trio length is front + wheelbase + rear', () => {
  assert.equal(trioLengthMm(a4db), 5995);
  assert.equal(
    trioLengthMm({
      frontOverhangMm: 1020,
      wheelbaseMm: 3760,
      rearOverhangMm: 1225,
    }),
    6005,
  );
});

void test('default B trio is symmetric and sums to the default length', () => {
  const base: BodyConfig = { ...DEFAULT_BODY_CONFIG };
  assert.equal(base.frontOverhangMm, 1045);
  assert.equal(base.rearOverhangMm, 1045);
  assert.equal(trioLengthMm(base), base.lengthMm);
});

void test('axle positions come from overhangs', () => {
  const pos = axlePositionsMm(5995, a4db);
  assert.equal(pos.frontAxleMm, -2152.5);
  assert.equal(pos.rearAxleMm, 2022.5);
  assert.equal(pos.rearAxleMm - pos.frontAxleMm, 4175);
  const sym = axlePositionsMm(5840, {
    frontOverhangMm: 1045,
    wheelbaseMm: 3750,
    rearOverhangMm: 1045,
  });
  assert.equal(sym.frontAxleMm, -1875);
  assert.equal(sym.rearAxleMm, 1875);
});

void test('snapToAnnounced picks the nearest point, ties go smaller', () => {
  assert.equal(snapToAnnounced(3900, [3760, 4175]), 3760);
  assert.equal(snapToAnnounced(4000, [3760, 4175]), 4175);
  assert.equal(snapToAnnounced(3967.5, [3760, 4175]), 3760);
  assert.equal(snapToAnnounced(100, [3760, 4175]), 3760);
  assert.equal(snapToAnnounced(9999, [3760, 4175]), 4175);
  assert.equal(snapToAnnounced(3900, []), 3900);
});

void test('snapChassisTrio snaps each dimension independently', () => {
  const points = {
    wheelbases: [3760, 4175],
    fronts: [845, 1020],
    rears: [975, 1160, 1225],
  };
  assert.deepEqual(
    snapChassisTrio(
      { frontOverhangMm: 900, wheelbaseMm: 3900, rearOverhangMm: 1100 },
      points,
    ),
    { frontOverhangMm: 845, wheelbaseMm: 3760, rearOverhangMm: 1160 },
  );
  assert.deepEqual(snapChassisTrio(a4db, points), a4db);
});

void test('announced chassis points come from complete rows only', () => {
  const points = announcedChassisPoints(shipped.entries);
  assert.deepEqual(points.wheelbases, [3760, 4175]);
  assert.deepEqual(points.fronts, [845, 1020]);
  assert.deepEqual(points.rears, [975, 1160, 1225]);
  // Partial rows must not leak in: SH5043 rear 1210 and SH5030 rear 1195
  // are partial-only figures and must not become snap points.
  assert.ok(!points.rears.includes(1210));
  assert.ok(!points.rears.includes(1195));
});

void test('every complete B row trio sums to its length', () => {
  for (const entry of shipped.entries) {
    if (entry.status !== 'complete') continue;
    const v = entry.verified as unknown as Record<string, number>;
    assert.equal(
      v.front_overhang_mm + v.wheelbase_mm + v.rear_overhang_mm,
      v.length_mm,
      entry.id,
    );
  }
});

void test('configForEntry maps announced overhangs', () => {
  const entry = shipped.entries.find((e) => e.id === 'sh6601a4db-h2372');
  assert.ok(entry);
  const model = MODEL_CATALOG.find((m) => m.id === 'sh6601a4db-h2372');
  assert.ok(model);
  const config = configForEntry(model, entry);
  assert.ok(config);
  assert.equal(config.frontOverhangMm, 845);
  assert.equal(config.rearOverhangMm, 975);
  assert.equal(config.lengthMm, 5995);
});

void test('easeOutCubic eases 0 to 1 monotonically', () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.equal(easeOutCubic(0.5), 0.875);
  assert.ok(
    easeOutCubic(0.25) < easeOutCubic(0.5) &&
      easeOutCubic(0.5) < easeOutCubic(0.75),
  );
  assert.equal(easeOutCubic(-1), 0);
  assert.equal(easeOutCubic(2), 1);
});

void test('lerpTrio interpolates each dimension', () => {
  assert.deepEqual(
    lerpTrio(
      { frontOverhangMm: 1020, wheelbaseMm: 3760, rearOverhangMm: 1225 },
      a4db,
      0.5,
    ),
    { frontOverhangMm: 932.5, wheelbaseMm: 3967.5, rearOverhangMm: 1100 },
  );
});

void test('van wheels sit at overhang-derived axle positions', () => {
  const config: BodyConfig = {
    ...DEFAULT_BODY_CONFIG,
    lengthMm: 5995,
    widthMm: 1998,
    heightMm: 2372,
    wheelbaseMm: 4175,
    frontOverhangMm: 845,
    rearOverhangMm: 975,
  };
  const group = buildParametricBody(config);
  const xs = new Set<number>();
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    if (geometry?.type === 'CylinderGeometry') {
      xs.add(Number(mesh.position.x.toFixed(4)));
    }
  });
  assert.deepEqual([...xs].sort((a, b) => a - b), [-2.1525, 2.0225]);
});
