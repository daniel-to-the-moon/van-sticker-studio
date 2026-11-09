import test from 'node:test';
import assert from 'node:assert/strict';
import { perimeterCoordinate } from '../lib/wrap-layout.ts';
import {
  assertRightHanded,
  classifyMesh,
  designCoverage,
  defaultLabDesign,
  parseLabDesign,
  placeDesign,
  serializeLabDesign,
  toCanonical,
  type SourceFrame,
  type VehicleModelProfile,
} from '../lib/vehicle-model-profile.ts';
import { labProfile } from '../lib/vehicle-model-fixtures.ts';

const envelope = {
  xMin: -3,
  length: 6,
  width: 2.2,
  height: 3,
  centerZ: 0,
};

function frame(patch: Partial<SourceFrame> = {}): SourceFrame {
  return {
    unit: 'm',
    rearward: { axis: 'x', sign: 1 },
    up: { axis: 'y', sign: 1 },
    driver: { axis: 'z', sign: 1 },
    origin: [0, 0, 0],
    ...patch,
  };
}

function profile(source: SourceFrame): VehicleModelProfile {
  return {
    id: 'frame-check',
    label: '坐标检查',
    verification: true,
    frame: source,
    envelope,
    panels: [
      {
        id: 'entry',
        class: 'wrap',
        meshes: ['side'],
        projection: { kind: 'perimeter', face: 'entry' },
      },
    ],
  };
}

void test('metres, millimetres, a rotated right-handed frame and a moved origin share one chart', () => {
  const canonical = [-1, 1.2, -1.1] as const;
  const millimetres = frame({ unit: 'mm' });
  const turned = frame({
    rearward: { axis: 'z', sign: 1 },
    up: { axis: 'y', sign: 1 },
    driver: { axis: 'x', sign: -1 },
    origin: [4, -2, 7],
  });
  assertRightHanded(turned);
  const sources = [
    { frame: frame(), point: canonical },
    {
      frame: millimetres,
      point: [canonical[0] * 1000, canonical[1] * 1000, canonical[2] * 1000] as const,
    },
    { frame: turned, point: [5.1, -0.8, 6] as const },
  ];
  const charts = sources.map((sample) => {
    const got = toCanonical(sample.point, sample.frame);
    assert.ok(Math.abs(got[0] + 1) < 1e-9);
    assert.ok(Math.abs(got[1] - 1.2) < 1e-9);
    assert.ok(Math.abs(got[2] + 1.1) < 1e-9);
    const placed = placeDesign(profile(sample.frame), {
      ...defaultLabDesign(),
      x: 0,
      scale: 1,
    });
    return placed;
  });
  assert.deepEqual(charts[1], charts[0]);
  assert.deepEqual(charts[2], charts[0]);
  const expected = perimeterCoordinate(canonical[0], canonical[2], envelope);
  assert.ok(Math.abs(expected - (envelope.length - (canonical[0] - envelope.xMin))) < 1e-9);
});

void test('a left-handed frame is rejected instead of mirroring glyphs', () => {
  assert.throws(
    () =>
      assertRightHanded(
        frame({ driver: { axis: 'z', sign: -1 } }),
      ),
    /左手/,
  );
});

void test('icon stays nose-ward of text on both faces and glyphs are not mirrored', () => {
  const design = { ...defaultLabDesign(), x: 0.1, scale: 1 };
  const marks = placeDesign(labProfile('box-trailer'), design);
  const icon = marks.find((mark) => mark.kind === 'icon');
  const text = marks.find((mark) => mark.text === design.text);
  assert.ok(icon && text);
  assert.ok(icon.editorX < text.editorX);
  assert.ok(icon.noseDistance < text.noseDistance);
  assert.ok(text.noseDistance - icon.noseDistance > 0.2);
  assert.equal(icon.mirrorGlyphs, false);
  assert.equal(text.mirrorGlyphs, false);
  assert.ok(icon.entryS > text.entryS);
  assert.ok(icon.driverS < text.driverS);
  const driverOrder = icon.driverS < text.driverS;
  const entryOrder = icon.entryS > text.entryS;
  assert.equal(driverOrder && entryOrder, true);
});

void test('a lab design round-trips and keeps editor placement on another vehicle', () => {
  const design = {
    ...defaultLabDesign(),
    text: '路边小馆',
    icon: 'badge' as const,
    swatch: '#2f6f62',
    x: 0.18,
    y: 0.3,
    scale: 0.9,
  };
  const restored = parseLabDesign(serializeLabDesign(design));
  assert.deepEqual(restored, design);
  const box = placeDesign(labProfile('box-trailer'), restored);
  const roof = placeDesign(labProfile('high-roof'), restored);
  assert.deepEqual(
    box.map((mark) => mark.editorX),
    roof.map((mark) => mark.editorX),
  );
  assert.notEqual(box[0]?.entryS, roof[0]?.entryS);
});

void test('current asset profile only applies registered wrap meshes', () => {
  const profile = labProfile('current-glb');
  assert.equal(profile.verification, false);
  assert.equal(classifyMesh(profile, 'RV_Static_Wrap_Entry').status, 'applied');
  assert.equal(classifyMesh(profile, 'RV_WebRig_EntryDoor_Wrap_Entry').status, 'applied');
  assert.equal(classifyMesh(profile, 'RV_Static_Glass').status, 'excluded');
  assert.equal(classifyMesh(profile, 'RV_Static_Headlamp_Glass').status, 'excluded');
  assert.equal(classifyMesh(profile, 'RV_Static_Lens_Red').status, 'excluded');
  assert.equal(classifyMesh(profile, 'RV_Static_Ivory_Interior').status, 'excluded');
  assert.equal(classifyMesh(profile, 'RV_WebRig_Cab_L_Ivory_Interior').status, 'excluded');
  assert.equal(classifyMesh(profile, 'RV_Awning_Fabric').status, 'excluded');
  assert.equal(classifyMesh(profile, 'RV_Static_Body_Paint').status, 'unsupported');
  assert.match(classifyMesh(profile, 'RV_Static_Body_Paint').reason, /漆面/);
  assert.equal(classifyMesh(profile, 'not-a-real-mesh').status, 'unsupported');
  assert.match(classifyMesh(profile, 'not-a-real-mesh').reason, /未登记/);
  assert.equal(designCoverage(profile, 'RV_Static_Wrap_Entry').status, 'applied');
  assert.equal(designCoverage(labProfile('high-roof'), 'roof_curve').status, 'excluded');
  assert.match(designCoverage(labProfile('high-roof'), 'roof_curve').reason, /弧长|曲面/);
  assert.equal(designCoverage(labProfile('step-slide'), 'step_lower').status, 'excluded');
  assert.match(designCoverage(labProfile('step-slide'), 'step_lower').reason, /阶梯/);
  assert.equal(designCoverage(labProfile('box-trailer'), 'trailer_front').status, 'excluded');
  for (const id of ['box-trailer', 'high-roof', 'step-slide'] as const) {
    assert.equal(labProfile(id).verification, true);
    assert.match(labProfile(id).label, /验证模型/);
  }
});
