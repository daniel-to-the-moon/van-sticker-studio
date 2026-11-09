import * as THREE from 'three';
import { circumference, perimeterCoordinate } from './wrap-layout.ts';
import {
  classifyMesh,
  envelopeBody,
  findPanel,
  toCanonical,
  type PanelFeedback,
  type Vec3,
  type VehicleModelProfile,
  type VehiclePanel,
} from './vehicle-model-profile.ts';

const PLANE_TOLERANCE_M = 0.08;
const DEFAULT_STRETCH = 0.15;

export type AdaptedPoint = {
  canonical: [number, number, number];
  chartS: number | null;
  chartH: number | null;
  shaderS: number | null;
  shaderH: number | null;
  eligible: boolean;
  mirrorGlyphs: false;
  feedback: PanelFeedback;
};

export type AdaptedTriangle = {
  eligible: boolean;
  feedback: PanelFeedback;
  stretch: number | null;
};

export type BakeResult = {
  eligible: boolean;
  copied: boolean;
  replaced: THREE.BufferGeometry | null;
  feedback: PanelFeedback;
};

type Chart = {
  s: number;
  h: number;
  shaderS: number | null;
  shaderH: number | null;
  eligible: boolean;
  feedback: PanelFeedback;
};

const sub = (a: Vec3, b: Vec3): [number, number, number] => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, factor: number): [number, number, number] => [
  a[0] * factor,
  a[1] * factor,
  a[2] * factor,
];
const cross = (a: Vec3, b: Vec3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lengthOf = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

function normalize(axis: Vec3): [number, number, number] {
  const length = lengthOf(axis) || 1;
  return [axis[0] / length, axis[1] / length, axis[2] / length];
}

/** Inverse of the panel motion, so chart coordinates stay on the closed pose. */
export function toClosedPoint(panel: VehiclePanel, world: Vec3): [number, number, number] {
  const motion = panel.motion;
  if (!motion) return [world[0], world[1], world[2]];
  if (motion.kind === 'slide')
    return sub(world, scale(motion.direction, motion.distance));
  return rotateAround(world, motion.point, motion.axis, -motion.angle);
}

function rotateAround(
  point: Vec3,
  origin: Vec3,
  axis: Vec3,
  angle: number,
): [number, number, number] {
  const [nx, ny, nz] = normalize(axis);
  const x = point[0] - origin[0];
  const y = point[1] - origin[1];
  const z = point[2] - origin[2];
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const along = x * nx + y * ny + z * nz;
  const rx = x * cos + (ny * z - nz * y) * sin + nx * along * (1 - cos);
  const ry = y * cos + (nz * x - nx * z) * sin + ny * along * (1 - cos);
  const rz = z * cos + (nx * y - ny * x) * sin + nz * along * (1 - cos);
  return [rx + origin[0], ry + origin[1], rz + origin[2]];
}

function facePlane(profile: VehicleModelProfile, face: 'entry' | 'driver' | 'front' | 'rear') {
  const { xMin, length, width, centerZ } = profile.envelope;
  const midX = xMin + length / 2;
  if (face === 'entry')
    return { point: [midX, 0, centerZ - width / 2] as Vec3, normal: [0, 0, -1] as Vec3 };
  if (face === 'driver')
    return { point: [midX, 0, centerZ + width / 2] as Vec3, normal: [0, 0, 1] as Vec3 };
  if (face === 'front')
    return { point: [xMin, 0, centerZ] as Vec3, normal: [-1, 0, 0] as Vec3 };
  return {
    point: [xMin + length, 0, centerZ] as Vec3,
    normal: [1, 0, 0] as Vec3,
  };
}

function refused(
  mesh: string,
  panelId: string | null,
  status: PanelFeedback['status'],
  reason: string,
): Chart {
  return {
    s: 0,
    h: 0,
    shaderS: null,
    shaderH: null,
    eligible: false,
    feedback: { mesh, panelId, status, reason },
  };
}

function projectPoint(
  profile: VehicleModelProfile,
  panel: VehiclePanel,
  mesh: string,
  point: Vec3,
): Chart {
  const projection = panel.projection;
  if (!projection || projection.kind === 'unsupported')
    return refused(
      mesh,
      panel.id,
      'unsupported',
      projection?.kind === 'unsupported' ? projection.reason : '该包覆面没有可用投影',
    );
  const body = envelopeBody(profile);
  if (projection.kind === 'perimeter') {
    const plane = facePlane(profile, projection.face);
    if (
      !projection.shell &&
      Math.abs(dot(sub(point, plane.point), plane.normal)) > PLANE_TOLERANCE_M
    )
      return refused(
        mesh,
        panel.id,
        'unsupported',
        '点不在声明的周长面上，拒绝拉伸到矩形周长',
      );
    const s = perimeterCoordinate(point[0], point[2], body);
    const h = point[1];
    const side = projection.face === 'entry' || projection.face === 'driver';
    if (!side)
      return {
        s,
        h,
        shaderS: null,
        shaderH: null,
        eligible: false,
        feedback: {
          mesh,
          panelId: panel.id,
          status: 'excluded',
          reason: '端面不套用左右侧围设计',
        },
      };
    return {
      s,
      h,
      shaderS: s,
      shaderH: h,
      eligible: true,
      feedback: { mesh, panelId: panel.id, status: 'applied', reason: '侧围设计坐标' },
    };
  }
  if (projection.kind === 'arc') {
    const angle = Math.atan2(
      point[2] - projection.centerZ,
      point[1] - projection.springY,
    );
    return {
      s: point[0] - profile.envelope.xMin,
      h: projection.radius * (angle + Math.PI / 2),
      shaderS: null,
      shaderH: null,
      eligible: false,
      feedback: {
        mesh,
        panelId: panel.id,
        status: 'excluded',
        reason: '曲面顶按弧长建坐标，不拉伸进侧围矩形',
      },
    };
  }
  const relative = sub(point, projection.origin);
  const s = dot(relative, projection.axisS);
  const h = dot(relative, projection.axisH);
  if (
    Math.abs(dot(relative, projection.outward)) > PLANE_TOLERANCE_M ||
    s < -0.02 ||
    h < -0.02 ||
    s > projection.width + 0.02 ||
    h > projection.height + 0.02
  )
    return refused(
      mesh,
      panel.id,
      'unsupported',
      '点不在声明的局部平面上，拒绝拉伸',
    );
  if (projection.face === 'step' || projection.face === 'roof')
    return {
      s,
      h,
      shaderS: null,
      shaderH: null,
      eligible: false,
      feedback: {
        mesh,
        panelId: panel.id,
        status: 'excluded',
        reason: '阶梯面不并入侧围矩形',
      },
    };
  if (projection.face !== 'entry' && projection.face !== 'driver')
    return {
      s,
      h,
      shaderS: null,
      shaderH: null,
      eligible: false,
      feedback: {
        mesh,
        panelId: panel.id,
        status: 'excluded',
        reason: '局部面不套用左右侧围设计',
      },
    };
  const fraction = projection.width > 1e-6 ? s / projection.width : 0;
  const { length, width } = profile.envelope;
  const shaderS =
    projection.face === 'entry'
      ? length * (1 - fraction)
      : length + width + fraction * length;
  return {
    s,
    h,
    shaderS,
    shaderH: point[1],
    eligible: true,
    feedback: { mesh, panelId: panel.id, status: 'applied', reason: '局部侧围坐标' },
  };
}

function insideOpening(
  panel: VehiclePanel,
  s: number,
  h: number,
): boolean {
  return (panel.openings ?? []).some(
    (opening) =>
      s >= opening.s0 - 1e-6 &&
      s <= opening.s1 + 1e-6 &&
      h >= opening.h0 - 1e-6 &&
      h <= opening.h1 + 1e-6,
  );
}

export function adaptPoint(
  profile: VehicleModelProfile,
  mesh: string,
  world: Vec3,
): AdaptedPoint {
  const canonical = toCanonical(world, profile.frame);
  const classified = classifyMesh(profile, mesh);
  const panel = findPanel(profile, mesh);
  if (!panel || classified.status !== 'applied')
    return {
      canonical,
      chartS: null,
      chartH: null,
      shaderS: null,
      shaderH: null,
      eligible: false,
      mirrorGlyphs: false,
      feedback: classified,
    };
  const chart = projectPoint(profile, panel, mesh, toClosedPoint(panel, canonical));
  if (
    chart.feedback.status !== 'unsupported' &&
    insideOpening(panel, chart.s, chart.h)
  )
    return {
      canonical,
      chartS: chart.s,
      chartH: chart.h,
      shaderS: null,
      shaderH: null,
      eligible: false,
      mirrorGlyphs: false,
      feedback: {
        mesh,
        panelId: panel.id,
        status: 'excluded',
        reason: '开口内不贴',
      },
    };
  return {
    canonical,
    chartS: chart.feedback.status === 'unsupported' ? null : chart.s,
    chartH: chart.feedback.status === 'unsupported' ? null : chart.h,
    shaderS: chart.shaderS,
    shaderH: chart.shaderH,
    eligible: chart.eligible,
    mirrorGlyphs: false,
    feedback: chart.feedback,
  };
}

function segmentHitsAabb(a: Vec3, b: Vec3, min: Vec3, max: Vec3): boolean {
  let enter = 0;
  let exit = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-12) {
      if (a[axis] < min[axis] || a[axis] > max[axis]) return false;
      continue;
    }
    let near = (min[axis] - a[axis]) / delta;
    let far = (max[axis] - a[axis]) / delta;
    if (near > far) [near, far] = [far, near];
    enter = Math.max(enter, near);
    exit = Math.min(exit, far);
    if (enter > exit) return false;
  }
  return true;
}

function orient(a: { s: number; h: number }, b: { s: number; h: number }, c: { s: number; h: number }) {
  return (b.s - a.s) * (c.h - a.h) - (b.h - a.h) * (c.s - a.s);
}

function segmentsCross(
  a: { s: number; h: number },
  b: { s: number; h: number },
  c: { s: number; h: number },
  d: { s: number; h: number },
) {
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
}

function hitsOpening(
  panel: VehiclePanel,
  points: { s: number; h: number }[],
): boolean {
  return (panel.openings ?? []).some((opening) => {
    const rect = [
      { s: opening.s0, h: opening.h0 },
      { s: opening.s1, h: opening.h0 },
      { s: opening.s1, h: opening.h1 },
      { s: opening.s0, h: opening.h1 },
    ];
    if (points.some((point) => insideOpening(panel, point.s, point.h))) return true;
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      for (let edge = 0; edge < 4; edge += 1)
        if (segmentsCross(start, end, rect[edge], rect[(edge + 1) % 4])) return true;
    }
    return false;
  });
}

function triangleArea(a: Vec3, b: Vec3, c: Vec3) {
  return lengthOf(cross(sub(b, a), sub(c, a))) * 0.5;
}

export function adaptTriangle(
  profile: VehicleModelProfile,
  mesh: string,
  a: Vec3,
  b: Vec3,
  c: Vec3,
): AdaptedTriangle {
  const empty = (feedback: PanelFeedback, stretch: number | null = null): AdaptedTriangle => ({
    eligible: false,
    feedback,
    stretch,
  });
  if (triangleArea(a, b, c) < 1e-8)
    return empty({
      mesh,
      panelId: findPanel(profile, mesh)?.id ?? null,
      status: 'unsupported',
      reason: '退化面',
    });
  const classified = classifyMesh(profile, mesh);
  const panel = findPanel(profile, mesh);
  if (!panel || classified.status !== 'applied') return empty(classified);
  const closed: [Vec3, Vec3, Vec3] = [
    toClosedPoint(panel, toCanonical(a, profile.frame)),
    toClosedPoint(panel, toCanonical(b, profile.frame)),
    toClosedPoint(panel, toCanonical(c, profile.frame)),
  ];
  for (const gap of profile.voids ?? [])
    for (let index = 0; index < 3; index += 1)
      if (segmentHitsAabb(closed[index], closed[(index + 1) % 3], gap.min, gap.max))
        return empty({
          mesh,
          panelId: panel.id,
          status: 'unsupported',
          reason: gap.reason,
        });
  const projected = closed.map((point) => projectPoint(profile, panel, mesh, point));
  const blocked = projected.find((point) => point.feedback.status === 'unsupported');
  if (blocked) return empty(blocked.feedback);
  const chart = projected.map((point) => ({ s: point.s, h: point.h }));
  if (hitsOpening(panel, chart))
    return empty({
      mesh,
      panelId: panel.id,
      status: 'unsupported',
      reason: '跨开口连成假面',
    });
  const projection = panel.projection;
  const shell = projection?.kind === 'perimeter' && projection.shell === true;
  if (!shell && projection?.kind !== 'arc') {
    const outward =
      projection?.kind === 'local'
        ? projection.outward
        : projection?.kind === 'perimeter'
          ? facePlane(profile, projection.face).normal
          : ([0, 1, 0] as Vec3);
    const normal = cross(sub(closed[1], closed[0]), sub(closed[2], closed[0]));
    if (dot(normal, outward) <= 0)
      return empty({
        mesh,
        panelId: panel.id,
        status: 'excluded',
        reason: '内表面不贴',
      });
  }
  let stretch = 0;
  for (let index = 0; index < 3; index += 1) {
    const world = lengthOf(sub(closed[(index + 1) % 3], closed[index]));
    const chartDistance = Math.hypot(
      chart[(index + 1) % 3].s - chart[index].s,
      chart[(index + 1) % 3].h - chart[index].h,
    );
    stretch = Math.max(stretch, world < 1e-8 ? 0 : Math.abs(chartDistance / world - 1));
  }
  const limit = panel.maxStretch ?? DEFAULT_STRETCH;
  if (!shell && stretch > limit)
    return empty(
      {
        mesh,
        panelId: panel.id,
        status: 'unsupported',
        reason: '拉伸超限，拒绝静默拉伸',
      },
      stretch,
    );
  const feedback = projected.find((point) => !point.eligible)?.feedback ?? projected[0].feedback;
  return {
    eligible: projected.every((point) => point.eligible),
    feedback,
    stretch,
  };
}

function seamCrosses(
  geometry: THREE.BufferGeometry,
  coords: Float32Array,
  period: number,
) {
  const index = geometry.index;
  if (!index) return false;
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const samples = [0, 1, 2].map((corner) => coords[index.getX(triangle + corner) * 2]);
    if (Math.max(...samples) - Math.min(...samples) > period / 2) return true;
  }
  return false;
}

function liftSeam(coords: Float32Array, count: number, period: number) {
  for (let triangle = 0; triangle < count; triangle += 3) {
    const samples = [0, 1, 2].map((corner) => coords[(triangle + corner) * 2]);
    if (Math.max(...samples) - Math.min(...samples) <= period / 2) continue;
    for (let corner = 0; corner < 3; corner += 1)
      if (coords[(triangle + corner) * 2] < period / 2)
        coords[(triangle + corner) * 2] += period;
  }
}

/** Write the chart the existing wrap shader already samples. Copy only seam triangles. */
export function bakeWrapAttributes(
  mesh: THREE.Mesh,
  profile: VehicleModelProfile,
): BakeResult {
  const feedback = classifyMesh(profile, mesh.name);
  if (feedback.status !== 'applied' || !mesh.geometry.getAttribute('position'))
    return { eligible: false, copied: false, replaced: null, feedback };
  mesh.updateWorldMatrix(true, false);
  const source = mesh.geometry;
  const sample = (geometry: THREE.BufferGeometry) => {
    const position = geometry.getAttribute('position');
    const coords = new Float32Array(position.count * 2);
    const eligible = new Float32Array(position.count);
    const world = new THREE.Vector3();
    let any = false;
    for (let index = 0; index < position.count; index += 1) {
      world.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      const adapted = adaptPoint(profile, mesh.name, [world.x, world.y, world.z]);
      if (adapted.eligible && adapted.shaderS != null && adapted.shaderH != null) {
        coords[index * 2] = adapted.shaderS;
        coords[index * 2 + 1] = adapted.shaderH;
        eligible[index] = 1;
        any = true;
      }
    }
    return { coords, eligible, any };
  };
  let geometry = source;
  let replaced: THREE.BufferGeometry | null = null;
  let baked = sample(geometry);
  const period = circumference(envelopeBody(profile));
  if (geometry.index && seamCrosses(geometry, baked.coords, period)) {
    replaced = geometry;
    geometry = geometry.toNonIndexed();
    mesh.geometry = geometry;
    baked = sample(geometry);
    liftSeam(baked.coords, geometry.getAttribute('position').count, period);
  }
  if (!baked.any) {
    if (replaced) {
      mesh.geometry = replaced;
      geometry.dispose();
    }
    return { eligible: false, copied: false, replaced: null, feedback };
  }
  geometry.setAttribute('aWrapCoord', new THREE.BufferAttribute(baked.coords, 2));
  geometry.setAttribute('aWrapEligible', new THREE.BufferAttribute(baked.eligible, 1));
  return { eligible: true, copied: replaced != null, replaced, feedback };
}

export function meshStats(root: THREE.Object3D): {
  triangles: number;
  drawCalls: number;
  degenerate: number;
} {
  let triangles = 0;
  let drawCalls = 0;
  let degenerate = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    drawCalls += 1;
    const index = object.geometry.index;
    const count = index ? index.count : position.count;
    triangles += Math.floor(count / 3);
    for (let triangle = 0; triangle < count; triangle += 3) {
      const ia = index ? index.getX(triangle) : triangle;
      const ib = index ? index.getX(triangle + 1) : triangle + 1;
      const ic = index ? index.getX(triangle + 2) : triangle + 2;
      a.fromBufferAttribute(position, ia);
      b.fromBufferAttribute(position, ib);
      c.fromBufferAttribute(position, ic);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      if (ab.cross(ac).lengthSq() < 1e-16) degenerate += 1;
    }
  });
  return { triangles, drawCalls, degenerate };
}
