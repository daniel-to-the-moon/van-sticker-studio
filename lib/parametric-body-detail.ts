/**
 * Motorhome-B detail body for /body-lab, measured from the R13 GLB
 * (public/model/mxgarage-rv.glb, sha256 78bc638b…19f13).
 *
 * This is a paradigm generator: one measured van shape is warped onto
 * each registered row. It is not a copy of the GLB and it is not
 * factory geometry. Camper, off-road, bus, C, pickup and towable
 * bodies stay on the schematic builders.
 *
 * Longitudinal placement is a 4-anchor piecewise map (front face,
 * front axle, rear axle, rear face). The R13 overhangs are unequal,
 * so a 2-anchor symmetric warp is not used.
 *
 * Vertical placement is floor-relative. The floor datum stays at
 * 0.55 m. Geometry at or above the floor scales so the shell peak
 * lands on the configured height. Geometry below the floor, including
 * the tires, keeps its measured size.
 */
import * as THREE from 'three';
import {
  isPopUpRoof,
  type BodyConfig,
} from './parametric-body.ts';

/** Metres, R13 world space. Methods are recorded in docs/reviews/issue-2/. */
export const R13_PARADIGM = {
  frontFaceX: -2.8714,
  rearFaceX: 2.9643,
  lengthM: 5.8357,
  bodyWidthM: 2.1765,
  shellTopM: 2.9322,
  floorM: 0.55,
  rockerM: 0.5,
  tireRadiusM: 0.3544,
  tireDiameterM: 0.7088,
  frontAxleX: -2.0564,
  rearAxleX: 1.7958,
  archTopM: 0.7895,
  archRadiusM: 0.4351,
  /** Plan-view nose half-width / body half-width at the front face. */
  noseTipScale: 0.42,
} as const;

const PARADIGM_X = [
  R13_PARADIGM.frontFaceX,
  R13_PARADIGM.frontAxleX,
  R13_PARADIGM.rearAxleX,
  R13_PARADIGM.rearFaceX,
] as const;

/**
 * Centerline forehead stations (smoothed min-x of forward-facing
 * paint/wrap verts). Same values pinned by tests/r13-forehead-smooth.test.ts.
 * The side silhouette follows this dome; it is not the retired R10
 * two-chord clamp.
 */
const FOREHEAD_DOME: ReadonlyArray<readonly [number, number]> = [
  [-1.9785, 2.05],
  [-1.976, 2.1],
  [-1.9679, 2.15],
  [-1.9534, 2.2],
  [-1.9338, 2.25],
  [-1.9043, 2.3],
  [-1.8708, 2.35],
  [-1.8271, 2.4],
  [-1.784, 2.45],
  [-1.7349, 2.5],
  [-1.6868, 2.55],
  [-1.6299, 2.6],
  [-1.5745, 2.65],
  [-1.5082, 2.7],
  [-1.4316, 2.75],
  [-1.3945, 2.8],
  [-1.3538, 2.85],
];

const FRAME_M = 0.035;

const CREAM = 0xe9e2d2;
const GLASS = 0x2b3438;
const GRAPHITE = 0x2a2e31;
const TIRE = 0x222528;
const RIM = 0xb7bcc2;
const HUB = 0x8d9399;
const SPOKE = 0xd5d8dc;
const CANVAS = 0xd8cdb4;
const LIGHT_FRONT = 0xf2e2b8;
const LIGHT_REAR = 0x8e2a2a;

interface ProfilePoint {
  x: number;
  y: number;
  zScale: number;
}

export interface DetailLayout {
  lengthM: number;
  widthM: number;
  heightM: number;
  frontOverhangM: number;
  rearOverhangM: number;
  wheelbaseM: number;
  /** Front face, front axle, rear axle, rear face. */
  target: [number, number, number, number];
  frontAxleX: number;
  rearAxleX: number;
}

interface Opening {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  side: -1 | 1;
  glass: string;
  frame: string;
}

/** Paradigm-space openings. Kitchen and bathroom share the V02 y span. */
const OPENINGS: readonly Opening[] = [
  {
    x0: -1.17,
    x1: -0.6926,
    y0: 2.4042,
    y1: 2.6548,
    side: -1,
    glass: 'window-glass-forehead-entry',
    frame: 'window-frame-forehead-entry',
  },
  {
    x0: 0.9,
    x1: 1.6,
    y0: 1.82,
    y1: 2.26,
    side: -1,
    glass: 'window-glass-living-front',
    frame: 'window-frame-living-front',
  },
  {
    x0: 1.9,
    x1: 2.55,
    y0: 1.82,
    y1: 2.26,
    side: -1,
    glass: 'window-glass-living-rear',
    frame: 'window-frame-living-rear',
  },
  {
    x0: 0.2982,
    x1: 0.5852,
    y0: 1.32,
    y1: 2.1394,
    side: -1,
    glass: 'window-glass-entry-door',
    frame: 'window-frame-entry-door',
  },
  {
    x0: -1.7484,
    x1: -0.8236,
    y0: 1.478,
    y1: 2.019,
    side: -1,
    glass: 'window-glass-cab-entry',
    frame: 'window-frame-cab-entry',
  },
  {
    x0: -1.17,
    x1: -0.6926,
    y0: 2.4042,
    y1: 2.6548,
    side: 1,
    glass: 'window-glass-forehead-other',
    frame: 'window-frame-forehead-other',
  },
  {
    x0: 1.147,
    x1: 1.595,
    y0: 1.8837,
    y1: 2.3067,
    side: 1,
    glass: 'window-glass-kitchen',
    frame: 'window-frame-kitchen',
  },
  {
    x0: 2.2329,
    x1: 2.6809,
    y0: 1.8837,
    y1: 2.3067,
    side: 1,
    glass: 'window-glass-bathroom',
    frame: 'window-frame-bathroom',
  },
  {
    x0: -1.7484,
    x1: -0.8236,
    y0: 1.478,
    y1: 2.019,
    side: 1,
    glass: 'window-glass-cab-other',
    frame: 'window-frame-cab-other',
  },
];

/**
 * The detail generator only accepts a motorhome-b config that already
 * carries both verified overhangs. Missing fields are not filled from
 * the paradigm ratio.
 */
export function requireVerifiedOverhangs(config: BodyConfig): {
  frontOverhangMm: number;
  rearOverhangMm: number;
} {
  if (config.vehicleKind !== 'motorhome-b') {
    throw new Error(
      'detail generator requires motorhome-b with verified overhangs',
    );
  }
  const front = config.frontOverhangMm;
  const rear = config.rearOverhangMm;
  if (typeof front !== 'number' || !Number.isFinite(front)) {
    throw new Error('detail generator requires frontOverhangMm');
  }
  if (typeof rear !== 'number' || !Number.isFinite(rear)) {
    throw new Error('detail generator requires rearOverhangMm');
  }
  return { frontOverhangMm: front, rearOverhangMm: rear };
}

export function detailLayout(config: BodyConfig): DetailLayout {
  const verified = requireVerifiedOverhangs(config);
  const lengthM = config.lengthMm / 1000;
  const widthM = config.widthMm / 1000;
  const heightM = config.heightMm / 1000;
  const wheelbaseM = config.wheelbaseMm / 1000;
  const frontOverhangM = verified.frontOverhangMm / 1000;
  const rearOverhangM = verified.rearOverhangMm / 1000;
  const frontFace = -lengthM / 2;
  const frontAxleX = frontFace + frontOverhangM;
  const rearAxleX = frontAxleX + wheelbaseM;
  return {
    lengthM,
    widthM,
    heightM,
    frontOverhangM,
    rearOverhangM,
    wheelbaseM,
    target: [frontFace, frontAxleX, rearAxleX, frontFace + lengthM],
    frontAxleX,
    rearAxleX,
  };
}

function warpX(
  x: number,
  target: readonly [number, number, number, number],
): number {
  if (x <= PARADIGM_X[0]) return target[0];
  if (x >= PARADIGM_X[3]) return target[3];
  for (let i = 0; i < 3; i += 1) {
    const next = PARADIGM_X[i + 1];
    if (x <= next) {
      const span = next - PARADIGM_X[i];
      const u = span === 0 ? 0 : (x - PARADIGM_X[i]) / span;
      return target[i] + u * (target[i + 1] - target[i]);
    }
  }
  return target[3];
}

function scaleY(y: number, heightM: number): number {
  if (y < R13_PARADIGM.floorM) return y;
  const source = R13_PARADIGM.shellTopM - R13_PARADIGM.floorM;
  const target = Math.max(heightM - R13_PARADIGM.floorM, 0);
  return R13_PARADIGM.floorM + ((y - R13_PARADIGM.floorM) * target) / source;
}

function noseScale(
  x: number,
  target: readonly [number, number, number, number],
): number {
  const front = target[0];
  const axle = target[1];
  if (!(axle > front) || x >= axle) return 1;
  const u = Math.min(1, Math.max(0, (x - front) / (axle - front)));
  const smooth = u * u * (3 - 2 * u);
  return (
    R13_PARADIGM.noseTipScale + (1 - R13_PARADIGM.noseTipScale) * smooth
  );
}

function featureMesh(
  geometry: THREE.BufferGeometry,
  color: number,
  feature: string,
  opts?: { roughness?: number; metalness?: number; side?: THREE.Side },
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      roughness: opts?.roughness ?? 0.7,
      metalness: opts?.metalness ?? 0.05,
      side: opts?.side ?? THREE.FrontSide,
    }),
  );
  mesh.userData.feature = feature;
  return mesh;
}

function featureBox(
  size: [number, number, number],
  position: [number, number, number],
  color: number,
  feature: string,
  opts?: { roughness?: number; metalness?: number },
): THREE.Mesh {
  const mesh = featureMesh(new THREE.BoxGeometry(...size), color, feature, opts);
  mesh.position.set(position[0], position[1], position[2]);
  return mesh;
}

function upperParadigm(): Array<readonly [number, number]> {
  return [
    [R13_PARADIGM.frontFaceX, R13_PARADIGM.rockerM],
    [-2.8116, 1.2],
    ...FOREHEAD_DOME,
    [-1.1, 2.891],
    [1.045, R13_PARADIGM.shellTopM],
    [R13_PARADIGM.rearFaceX, R13_PARADIGM.shellTopM],
    [R13_PARADIGM.rearFaceX, R13_PARADIGM.rockerM],
  ];
}

function mapUpper(layout: DetailLayout): ProfilePoint[] {
  return upperParadigm().map(([x, y]) => {
    const wx = warpX(x, layout.target);
    return {
      x: wx,
      y: scaleY(y, layout.heightM),
      zScale: noseScale(wx, layout.target),
    };
  });
}

function archLip(centerX: number, layout: DetailLayout): ProfilePoint[] {
  const radius = R13_PARADIGM.archRadiusM;
  const cy = R13_PARADIGM.tireRadiusM;
  const y0 = R13_PARADIGM.rockerM;
  const dy = y0 - cy;
  const dx = Math.sqrt(Math.max(radius * radius - dy * dy, 0));
  const a0 = Math.atan2(dy, dx);
  const a1 = Math.atan2(dy, -dx);
  const steps = 8;
  const front = layout.target[0] + 0.02;
  const rear = layout.target[3] - 0.02;
  const points: ProfilePoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = a0 + ((a1 - a0) * i) / steps;
    const x = Math.min(
      rear,
      Math.max(front, centerX + radius * Math.cos(angle)),
    );
    points.push({
      x,
      y: cy + radius * Math.sin(angle),
      zScale: noseScale(x, layout.target),
    });
  }
  return points;
}

function shellPoints(layout: DetailLayout): ProfilePoint[] {
  const upper = mapUpper(layout);
  const rearArch = archLip(layout.rearAxleX, layout);
  const frontArch = archLip(layout.frontAxleX, layout);
  return [...upper, ...rearArch, ...frontArch];
}

function buildShellGeometry(
  points: ProfilePoint[],
  halfW: number,
): THREE.BufferGeometry {
  const count = points.length;
  const positions = new Float32Array(count * 2 * 3);
  for (let i = 0; i < count; i += 1) {
    const point = points[i];
    const hz = halfW * point.zScale;
    positions[i * 6] = point.x;
    positions[i * 6 + 1] = point.y;
    positions[i * 6 + 2] = -hz;
    positions[i * 6 + 3] = point.x;
    positions[i * 6 + 4] = point.y;
    positions[i * 6 + 5] = hz;
  }
  const contour = points.map((point) => new THREE.Vector2(point.x, point.y));
  const faces = THREE.ShapeUtils.triangulateShape(contour, []);
  const index: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    const a = i * 2;
    const b = i * 2 + 1;
    const c = j * 2;
    const d = j * 2 + 1;
    index.push(a, c, b, b, c, d);
  }
  for (const face of faces) {
    const [i, j, k] = face;
    index.push(i * 2, k * 2, j * 2);
    index.push(i * 2 + 1, j * 2 + 1, k * 2 + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

function surfaceXAtY(points: ProfilePoint[], y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const yMin = Math.min(a.y, b.y);
    const yMax = Math.max(a.y, b.y);
    if (y < yMin || y > yMax) continue;
    if (a.y === b.y) {
      best = Math.min(best, a.x, b.x);
      continue;
    }
    const u = (y - a.y) / (b.y - a.y);
    const x = a.x + u * (b.x - a.x);
    if (x < best) best = x;
  }
  return best;
}

function placeSpan(
  layout: DetailLayout,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): { x: number; y: number; w: number; h: number } {
  const ax = warpX(x0, layout.target);
  const bx = warpX(x1, layout.target);
  const ay = scaleY(y0, layout.heightM);
  const by = scaleY(y1, layout.heightM);
  return {
    x: (ax + bx) / 2,
    y: (ay + by) / 2,
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

function addFrame(
  group: THREE.Group,
  placed: { x: number; y: number; w: number; h: number },
  side: -1 | 1,
  halfW: number,
  feature: string,
): void {
  const outerW = placed.w + FRAME_M * 2;
  const outerH = placed.h + FRAME_M * 2;
  const shape = new THREE.Shape();
  shape.moveTo(-outerW / 2, -outerH / 2);
  shape.lineTo(outerW / 2, -outerH / 2);
  shape.lineTo(outerW / 2, outerH / 2);
  shape.lineTo(-outerW / 2, outerH / 2);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-placed.w / 2, -placed.h / 2);
  hole.lineTo(-placed.w / 2, placed.h / 2);
  hole.lineTo(placed.w / 2, placed.h / 2);
  hole.lineTo(placed.w / 2, -placed.h / 2);
  hole.closePath();
  shape.holes.push(hole);
  const mesh = featureMesh(new THREE.ShapeGeometry(shape), GRAPHITE, feature, {
    side: THREE.DoubleSide,
  });
  mesh.position.set(placed.x, placed.y, side * (halfW + 0.004));
  if (side < 0) mesh.rotation.y = Math.PI;
  group.add(mesh);
}

function addOpening(group: THREE.Group, layout: DetailLayout, opening: Opening): void {
  const placed = placeSpan(layout, opening.x0, opening.x1, opening.y0, opening.y1);
  const halfW = layout.widthM / 2;
  const depth = 0.006;
  group.add(
    featureBox(
      [placed.w, placed.h, depth],
      [placed.x, placed.y, opening.side * (halfW + depth / 2)],
      GLASS,
      opening.glass,
      { roughness: 0.15, metalness: 0.3 },
    ),
  );
  addFrame(group, placed, opening.side, halfW, opening.frame);
}

function addDoor(group: THREE.Group, layout: DetailLayout): void {
  const placed = placeSpan(layout, 0.2346, 0.8341, 0.525, 2.3092);
  const halfW = layout.widthM / 2;
  group.add(
    featureBox(
      [placed.w, placed.h, 0.012],
      [placed.x, placed.y, -(halfW + 0.006)],
      CREAM,
      'door-entry',
    ),
  );
  addFrame(group, placed, -1, halfW, 'door-entry-frame');
  const handle = placeSpan(layout, 0.6929, 0.7109, 1.3173, 1.3353);
  group.add(
    featureBox(
      [Math.max(handle.w, 0.04), Math.max(handle.h, 0.08), 0.012],
      [handle.x, handle.y, -(halfW + 0.016)],
      GRAPHITE,
      'door-entry-handle',
    ),
  );
}

function addCabHandles(group: THREE.Group, layout: DetailLayout): void {
  const placed = placeSpan(layout, -1.46, -1.34, 1.08, 1.2);
  const halfW = layout.widthM / 2;
  group.add(
    featureBox(
      [placed.w, placed.h, 0.014],
      [placed.x, placed.y, -(halfW + 0.008)],
      GRAPHITE,
      'handle-cab-entry',
    ),
  );
  group.add(
    featureBox(
      [placed.w, placed.h, 0.014],
      [placed.x, placed.y, halfW + 0.008],
      GRAPHITE,
      'handle-cab-other',
    ),
  );
}

function addWindshield(
  group: THREE.Group,
  layout: DetailLayout,
  upper: ProfilePoint[],
): void {
  const y0 = scaleY(1.55, layout.heightM);
  const y1 = scaleY(2.05, layout.heightM);
  const steps = 6;
  const positions: number[] = [];
  const index: number[] = [];
  const half = layout.widthM / 2;
  for (let i = 0; i <= steps; i += 1) {
    const y = y0 + ((y1 - y0) * i) / steps;
    const x = surfaceXAtY(upper, y) - 0.004;
    const local = half * noseScale(x, layout.target) * 0.82;
    positions.push(x, y, -local, x, y, local);
  }
  for (let i = 0; i < steps; i += 1) {
    const a = i * 2;
    const b = i * 2 + 1;
    const c = (i + 1) * 2;
    const d = (i + 1) * 2 + 1;
    index.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  group.add(
    featureMesh(geometry, GLASS, 'windshield', {
      roughness: 0.15,
      metalness: 0.3,
      side: THREE.DoubleSide,
    }),
  );
}

function addGrille(
  group: THREE.Group,
  layout: DetailLayout,
  upper: ProfilePoint[],
): void {
  const y0 = scaleY(0.72, layout.heightM);
  const y1 = scaleY(1.12, layout.heightM);
  const midY = (y0 + y1) / 2;
  const x = surfaceXAtY(upper, midY) + 0.008;
  const width = layout.widthM * noseScale(x, layout.target) * 0.62;
  group.add(
    featureBox(
      [0.012, y1 - y0, width],
      [x, midY, 0],
      GRAPHITE,
      'grille',
    ),
  );
  for (let i = 0; i < 3; i += 1) {
    const y = y0 + ((y1 - y0) * (i + 1)) / 4;
    const barX = surfaceXAtY(upper, y) + 0.012;
    group.add(
      featureBox(
        [0.01, 0.018, width * 0.92],
        [barX, y, 0],
        RIM,
        'grille-bar',
        { metalness: 0.4, roughness: 0.4 },
      ),
    );
  }
}

function addLights(
  group: THREE.Group,
  layout: DetailLayout,
  upper: ProfilePoint[],
): void {
  const y = scaleY(1.03, layout.heightM);
  const x = surfaceXAtY(upper, y) + 0.014;
  const z = layout.widthM * noseScale(x, layout.target) * 0.28;
  for (const side of [-1, 1] as const) {
    group.add(
      featureBox(
        [0.04, 0.1, 0.16],
        [x, y, side * z],
        LIGHT_FRONT,
        'light-front',
        { roughness: 0.2, metalness: 0.15 },
      ),
    );
  }
  const rearX = layout.target[3] - 0.012;
  const rearZ = layout.widthM * 0.32;
  const rearY = scaleY(1.05, layout.heightM);
  for (const side of [-1, 1] as const) {
    group.add(
      featureBox(
        [0.02, 0.12, 0.2],
        [rearX, rearY, side * rearZ],
        LIGHT_REAR,
        'light-rear',
        { roughness: 0.25, metalness: 0.1 },
      ),
    );
  }
}

function addBumpers(
  group: THREE.Group,
  layout: DetailLayout,
  upper: ProfilePoint[],
): void {
  const y = 0.64;
  const frontX = surfaceXAtY(upper, y) + 0.02;
  const frontW = layout.widthM * noseScale(frontX, layout.target) * 0.92;
  group.add(
    featureBox([0.04, 0.2, frontW], [frontX, y, 0], GRAPHITE, 'bumper-front'),
  );
  group.add(
    featureBox(
      [0.04, 0.18, layout.widthM * 0.9],
      [layout.target[3] - 0.02, y, 0],
      GRAPHITE,
      'bumper-rear',
    ),
  );
}

function addMirrors(group: THREE.Group, layout: DetailLayout): void {
  const placed = placeSpan(layout, -1.78, -1.58, 1.45, 1.62);
  const halfW = layout.widthM / 2;
  for (const side of [-1, 1] as const) {
    group.add(
      featureBox(
        [placed.w, placed.h, 0.02],
        [placed.x, placed.y, side * (halfW + 0.012)],
        CREAM,
        'mirror',
      ),
    );
  }
}

function addSkylight(group: THREE.Group, layout: DetailLayout): void {
  const placed = placeSpan(layout, -1.56, -1.1492, 2.7, 2.85);
  const thickness = 0.016;
  const centerY = Math.min(placed.y, layout.heightM - thickness / 2);
  group.add(
    featureBox(
      [placed.w, thickness, layout.widthM * 0.34],
      [placed.x, centerY, 0],
      GLASS,
      'skylight-forehead',
      { roughness: 0.15, metalness: 0.2 },
    ),
  );
}

function addRoof(group: THREE.Group, layout: DetailLayout): void {
  const start = warpX(1.045, layout.target);
  const end = layout.target[3];
  const length = Math.max(end - start, 0.2);
  group.add(
    featureBox(
      [length, 0.012, layout.widthM * 0.96],
      [start + length / 2, layout.heightM - 0.006, 0],
      CREAM,
      'roof',
    ),
  );
}

function addPopUpRoof(group: THREE.Group, config: BodyConfig, layout: DetailLayout): void {
  if (!isPopUpRoof(config.roofType) || !config.popUpOpen) return;
  const travel = Math.max(config.popUpTravelMm, 0) / 1000;
  const { lengthM, widthM, heightM } = layout;
  const feature =
    config.roofType === 'sloped-pop-up'
      ? 'roof-sloped-popup'
      : config.roofType === 'split-pop-up'
        ? 'roof-split-popup'
        : 'roof-popup';
  if (config.roofType === 'sloped-pop-up') {
    const pivot = new THREE.Group();
    pivot.position.set(-lengthM * 0.49, heightM, 0);
    const slab = featureBox(
      [lengthM * 0.98, 0.04, widthM * 0.96],
      [lengthM * 0.49, 0.02, 0],
      CREAM,
      feature,
    );
    pivot.add(slab);
    pivot.rotation.z = (config.slopedAngleDeg * Math.PI) / 180;
    group.add(pivot);
    group.add(
      featureBox(
        [lengthM * 0.6, Math.max(travel * 0.6, 0.02), widthM * 0.9],
        [lengthM * 0.15, heightM + travel * 0.3, 0],
        CANVAS,
        feature,
      ),
    );
    return;
  }
  if (config.roofType === 'split-pop-up') {
    const frontLen = lengthM * 0.45;
    const x = -lengthM / 2 + frontLen / 2 + lengthM * 0.05;
    group.add(
      featureBox(
        [frontLen, Math.max(travel, 0.02), widthM * 0.9],
        [x, heightM + travel / 2, 0],
        CANVAS,
        feature,
      ),
    );
    group.add(
      featureBox(
        [frontLen, 0.04, widthM * 0.96],
        [x, heightM + travel + 0.02, 0],
        CREAM,
        feature,
      ),
    );
    return;
  }
  group.add(
    featureBox(
      [lengthM * 0.6, Math.max(travel, 0.02), widthM * 0.9],
      [lengthM * 0.05, heightM + travel / 2, 0],
      CANVAS,
      feature,
    ),
  );
  group.add(
    featureBox(
      [lengthM * 0.98, 0.04, widthM * 0.96],
      [0, heightM + travel + 0.02, 0],
      CREAM,
      feature,
    ),
  );
}

function addWheels(group: THREE.Group, layout: DetailLayout): void {
  const radius = R13_PARADIGM.tireRadiusM;
  const halfW = layout.widthM / 2;
  const track = halfW * 0.72;
  const tireWidth = 0.22;
  for (const x of [layout.frontAxleX, layout.rearAxleX]) {
    for (const side of [-1, 1] as const) {
      const z = side * track;
      const tire = featureMesh(
        new THREE.CylinderGeometry(radius, radius, tireWidth, 24),
        TIRE,
        'wheel-tire',
        { roughness: 0.9 },
      );
      tire.rotation.x = Math.PI / 2;
      tire.position.set(x, radius, z);
      group.add(tire);
      const rimRadius = radius * 0.65;
      const rim = featureMesh(
        new THREE.CylinderGeometry(rimRadius, rimRadius, tireWidth + 0.01, 20),
        RIM,
        'wheel-rim',
        { metalness: 0.55, roughness: 0.35 },
      );
      rim.rotation.x = Math.PI / 2;
      rim.position.set(x, radius, z);
      group.add(rim);
      const hubRadius = radius * 0.18;
      const hub = featureMesh(
        new THREE.CylinderGeometry(hubRadius, hubRadius, tireWidth + 0.02, 16),
        HUB,
        'wheel-hub',
        { metalness: 0.6, roughness: 0.3 },
      );
      hub.rotation.x = Math.PI / 2;
      hub.position.set(x, radius, z);
      group.add(hub);
      const spokeLen = rimRadius - hubRadius;
      for (let spoke = 0; spoke < 5; spoke += 1) {
        const angle = (spoke / 5) * Math.PI * 2;
        const mesh = featureBox(
          [spokeLen, 0.018, 0.018],
          [
            x + Math.cos(angle) * (hubRadius + spokeLen / 2),
            radius + Math.sin(angle) * (hubRadius + spokeLen / 2),
            z,
          ],
          SPOKE,
          'wheel-spoke',
          { metalness: 0.45, roughness: 0.35 },
        );
        mesh.rotation.z = angle;
        group.add(mesh);
      }
    }
  }
}

/**
 * Detail body for motorhome-b. The caller still attaches slide-outs,
 * accessories and roof fixtures.
 */
export function buildMotorhomeBDetail(config: BodyConfig): THREE.Group {
  const layout = detailLayout(config);
  const group = new THREE.Group();
  group.name = 'motorhome-b-detail';
  const upper = mapUpper(layout);
  const shell = featureMesh(
    buildShellGeometry(shellPoints(layout), layout.widthM / 2),
    CREAM,
    'shell',
    { side: THREE.DoubleSide },
  );
  group.add(shell);
  addRoof(group, layout);
  addPopUpRoof(group, config, layout);
  for (const opening of OPENINGS) addOpening(group, layout, opening);
  addDoor(group, layout);
  addCabHandles(group, layout);
  addWindshield(group, layout, upper);
  addGrille(group, layout, upper);
  addLights(group, layout, upper);
  addBumpers(group, layout, upper);
  addMirrors(group, layout);
  addSkylight(group, layout);
  addWheels(group, layout);
  return group;
}
