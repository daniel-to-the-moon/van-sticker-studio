import * as THREE from 'three';
import {
  addLayer,
  editLayer,
  emptyProject,
  newLayer,
  type Project,
} from './free-wrap.ts';
import { perimeterCoordinate } from './wrap-layout.ts';
import {
  canonicalFrame,
  designMarks,
  type LabDesign,
  type Vec3,
  type VehicleEnvelope,
  type VehicleModelProfile,
  type VehiclePanel,
} from './vehicle-model-profile.ts';

export const LAB_VEHICLE_IDS = [
  'current-glb',
  'box-trailer',
  'high-roof',
  'step-slide',
] as const;
export type LabVehicleId = (typeof LAB_VEHICLE_IDS)[number];

const BOX_ENVELOPE: VehicleEnvelope = {
  xMin: -2.2,
  length: 6.4,
  width: 2.48,
  height: 2.72,
  centerZ: 0,
};
const BOX_Z = -BOX_ENVELOPE.width / 2;

export const BOX_TRAILER = {
  envelope: BOX_ENVELOPE,
  door: { x0: 0.15, x1: 1.05, y0: 0.45, y1: 2.15, z: BOX_Z },
  hinge: [0.15, 1.3, BOX_Z] as Vec3,
  window: { x0: 2.2, x1: 3.1, y0: 1.35, y1: 1.85 },
};

export const HIGH_ROOF = {
  envelope: {
    xMin: -2.55,
    length: 5.4,
    width: 2.2,
    height: 2.8,
    centerZ: 0,
  } satisfies VehicleEnvelope,
  arc: { springY: 1.7, centerZ: 0, radius: 1.1 },
};

export const STEP_SLIDE = {
  envelope: {
    xMin: -2.7,
    length: 5.6,
    width: 2.3,
    height: 2.55,
    centerZ: 0,
  } satisfies VehicleEnvelope,
  lower: { x: -2.7, y0: 0.5, y1: 1.15, z0: -0.95, z1: 0.95 },
  upper: { x: -2.32, y0: 1.4, y1: 2.45, z0: -0.95, z1: 0.95 },
  slide: { x0: -0.4, x1: 2.2, y0: 0.7, y1: 2.1, z: 1.62 },
};

const GLB_CENTER_Z = -0.047314226627349854;

const paintRefusal = {
  meshes: [
    'RV_Static_Body_Paint',
    'RV_WebRig_Cab_L_Body_Paint',
    'RV_WebRig_Cab_R_Body_Paint',
    'RV_WebRig_EntryDoor_Body_Paint',
  ],
  status: 'unsupported' as const,
  reason: '车身漆面未登记为包覆面，不在可选 profile 里静默扩大',
};

function shell(
  id: string,
  face: 'entry' | 'driver' | 'front' | 'rear',
  meshes: string[],
  motion?: VehiclePanel['motion'],
): VehiclePanel {
  return {
    id,
    class: 'wrap',
    meshes,
    projection: { kind: 'perimeter', face, shell: true },
    motion,
  };
}

function excluded(
  id: string,
  panelClass: VehiclePanel['class'],
  meshes: string[],
): VehiclePanel {
  return { id, class: panelClass, meshes };
}

function currentGlbProfile(): VehicleModelProfile {
  return {
    id: 'current-glb',
    label: '当前车辆资产兼容 profile',
    verification: false,
    frame: canonicalFrame(),
    envelope: {
      xMin: -2.85,
      length: 5.8,
      width: 2.22,
      height: 3.05,
      centerZ: GLB_CENTER_Z,
    },
    panels: [
      shell('glb-entry', 'entry', ['RV_Static_Wrap_Entry']),
      shell('glb-driver', 'driver', ['RV_Static_Wrap_Driver']),
      shell('glb-front', 'front', ['RV_Static_Wrap_Front']),
      shell('glb-rear', 'rear', ['RV_Static_Wrap_Rear']),
      shell('glb-cab-entry', 'entry', ['RV_WebRig_Cab_L_Wrap_Entry'], {
        kind: 'hinge',
        point: [-2.0350000858306885, 1.1292741298675537, -0.9883297085762024],
        axis: [0, 1, 0],
        angle: 0,
      }),
      shell('glb-cab-driver', 'driver', ['RV_WebRig_Cab_R_Wrap_Driver'], {
        kind: 'hinge',
        point: [-2.0350000858306885, 1.1292741298675537, 0.8937582969665527],
        axis: [0, -1, 0],
        angle: 0,
      }),
      shell('glb-entry-door', 'entry', ['RV_WebRig_EntryDoor_Wrap_Entry'], {
        kind: 'hinge',
        point: [0.22169999778270721, 1.4170000553131104, -1.1480000019073486],
        axis: [0, 1, 0],
        angle: 0,
      }),
      excluded('glb-glass', 'glass', [
        'RV_Static_Glass',
        'RV_WebRig_EntryDoor_Glass',
        'RV_WebRig_Slide_L_Glass',
        'RV_WebRig_Slide_R_Glass',
        'RV_WebRig_Rooflight_Glass',
        'RV_WebRig_Window_1_Glass',
        'RV_WebRig_Window_2_Glass',
        'RV_WebRig_Window_3_Glass',
        'RV_WebRig_Window_4_Glass',
        'RV_WebRig_Window_5_Glass',
        'RV_WebRig_Window_6_Glass',
      ]),
      excluded('glb-lamp', 'lamp', [
        'RV_Static_Headlamp_Glass',
        'RV_WebRig_Cab_L_Headlamp_Glass',
        'RV_WebRig_Cab_R_Headlamp_Glass',
        'RV_Static_Lens_Red',
        'RV_Static_Optic',
        'RV_WebRig_Cab_L_Optic',
        'RV_WebRig_Cab_R_Optic',
        'RV_AmberOptics_RV_Static_Optic',
      ]),
      excluded('glb-interior', 'interior', [
        'RV_Static_Ivory_Interior',
        'RV_WebRig_Cab_L_Ivory_Interior',
        'RV_WebRig_Cab_R_Ivory_Interior',
      ]),
      excluded('glb-trim', 'trim', [
        'RV_Static_Chrome',
        'RV_Static_Graphite',
        'RV_Static_Rubber',
        'RV_Static_Trim_Rings',
        'RV_WebRig_EntryDoor_Chrome',
        'RV_WebRig_EntryDoor_Graphite',
        'RV_WebRig_Cab_L_Chrome',
        'RV_WebRig_Cab_L_Graphite',
        'RV_WebRig_Cab_L_Rubber',
        'RV_WebRig_Cab_R_Chrome',
        'RV_WebRig_Cab_R_Graphite',
        'RV_WebRig_Cab_R_Rubber',
        'RV_WebRig_Rooflight_Rubber',
        'RV_WebRig_Wiper_1_Rubber',
        'RV_WebRig_Wiper_2_Rubber',
        'RV_Awning_Fabric',
        'RV_Awning_Frame',
        'RV_BlackBumper_RV_Static_Wrap_Front',
        'RV_BlackBumper_RV_Static_Body_Paint',
        'RV_BlackBumper_RV_Static_Wrap_Entry',
      ]),
    ],
    refusals: [paintRefusal],
  };
}

function boxProfile(): VehicleModelProfile {
  const { envelope, door, hinge, window } = BOX_TRAILER;
  const rearS = perimeterCoordinate(window.x1, door.z, envelope);
  const frontS = perimeterCoordinate(window.x0, door.z, envelope);
  return {
    id: 'box-trailer',
    label: '箱式/拖挂验证模型',
    verification: true,
    frame: canonicalFrame(),
    envelope,
    panels: [
      {
        id: 'trailer-entry',
        class: 'wrap',
        meshes: ['trailer_entry'],
        projection: { kind: 'perimeter', face: 'entry' },
        openings: [
          {
            id: 'window',
            s0: Math.min(rearS, frontS),
            s1: Math.max(rearS, frontS),
            h0: window.y0,
            h1: window.y1,
          },
        ],
      },
      {
        id: 'trailer-door',
        class: 'wrap',
        meshes: ['trailer_door'],
        projection: { kind: 'perimeter', face: 'entry' },
        motion: { kind: 'hinge', point: hinge, axis: [0, 1, 0], angle: 0 },
      },
      {
        id: 'trailer-driver',
        class: 'wrap',
        meshes: ['trailer_driver'],
        projection: { kind: 'perimeter', face: 'driver' },
      },
      {
        id: 'trailer-front',
        class: 'wrap',
        meshes: ['trailer_front'],
        projection: { kind: 'perimeter', face: 'front' },
      },
      {
        id: 'trailer-rear',
        class: 'wrap',
        meshes: ['trailer_rear'],
        projection: { kind: 'perimeter', face: 'rear' },
      },
      {
        id: 'trailer-roof',
        class: 'wrap',
        meshes: ['trailer_roof'],
        projection: { kind: 'unsupported', reason: '平顶不套用侧围矩形' },
      },
      excluded('trailer-glass', 'glass', ['trailer_glass']),
      excluded('trailer-lamp', 'lamp', ['trailer_lamp']),
      excluded('trailer-wheel', 'wheel', ['trailer_wheel']),
      excluded('trailer-interior', 'interior', ['trailer_interior']),
      excluded('trailer-trim', 'trim', ['trailer_hitch']),
    ],
  };
}

function highRoofProfile(): VehicleModelProfile {
  const { envelope, arc } = HIGH_ROOF;
  return {
    id: 'high-roof',
    label: '高顶曲面厢车验证模型',
    verification: true,
    frame: canonicalFrame(),
    envelope,
    panels: [
      {
        id: 'roof',
        class: 'wrap',
        meshes: ['roof_curve'],
        projection: { kind: 'arc', ...arc },
      },
      {
        id: 'roof-entry',
        class: 'wrap',
        meshes: ['roof_entry'],
        projection: { kind: 'perimeter', face: 'entry' },
      },
      {
        id: 'roof-driver',
        class: 'wrap',
        meshes: ['roof_driver'],
        projection: { kind: 'perimeter', face: 'driver' },
      },
      excluded('roof-glass', 'glass', ['roof_glass']),
      excluded('roof-lamp', 'lamp', ['roof_lamp']),
      excluded('roof-wheel', 'wheel', ['roof_wheel']),
    ],
  };
}

function stepProfile(): VehicleModelProfile {
  const { envelope, lower, upper, slide } = STEP_SLIDE;
  return {
    id: 'step-slide',
    label: '阶梯额头/拓展舱验证模型',
    verification: true,
    frame: canonicalFrame(),
    envelope,
    voids: [
      {
        id: 'step-gap',
        min: [-2.68, 1.16, -0.9],
        max: [-2.34, 2.42, 0.9],
        reason: '跨空隙连成假面',
      },
      {
        id: 'slide-gap',
        min: [-0.35, 0.65, 1.18],
        max: [2.15, 2.15, 1.5],
        reason: '跨空隙连成假面',
      },
    ],
    panels: [
      {
        id: 'step-lower',
        class: 'wrap',
        meshes: ['step_lower'],
        projection: {
          kind: 'local',
          face: 'step',
          origin: [lower.x, lower.y0, lower.z0],
          axisS: [0, 0, 1],
          axisH: [0, 1, 0],
          width: lower.z1 - lower.z0,
          height: lower.y1 - lower.y0,
          outward: [-1, 0, 0],
        },
      },
      {
        id: 'step-upper',
        class: 'wrap',
        meshes: ['step_upper'],
        projection: {
          kind: 'local',
          face: 'step',
          origin: [upper.x, upper.y0, upper.z0],
          axisS: [0, 0, 1],
          axisH: [0, 1, 0],
          width: upper.z1 - upper.z0,
          height: upper.y1 - upper.y0,
          outward: [-1, 0, 0],
        },
      },
      {
        id: 'slide-face',
        class: 'wrap',
        meshes: ['slide_face'],
        projection: {
          kind: 'local',
          face: 'driver',
          origin: [slide.x0, slide.y0, slide.z],
          axisS: [1, 0, 0],
          axisH: [0, 1, 0],
          width: slide.x1 - slide.x0,
          height: slide.y1 - slide.y0,
          outward: [0, 0, 1],
        },
        motion: { kind: 'slide', direction: [0, 0, 1], distance: 0 },
      },
      {
        id: 'step-entry',
        class: 'wrap',
        meshes: ['step_entry'],
        projection: { kind: 'perimeter', face: 'entry' },
      },
      {
        id: 'step-driver',
        class: 'wrap',
        meshes: ['step_driver'],
        projection: { kind: 'perimeter', face: 'driver' },
      },
      excluded('step-glass', 'glass', ['step_glass']),
      excluded('step-lamp', 'lamp', ['step_lamp']),
      excluded('step-wheel', 'wheel', ['step_wheel']),
      excluded('step-trim', 'trim', ['slide_shell']),
    ],
  };
}

const PROFILES: Record<LabVehicleId, () => VehicleModelProfile> = {
  'current-glb': currentGlbProfile,
  'box-trailer': boxProfile,
  'high-roof': highRoofProfile,
  'step-slide': stepProfile,
};

export function labProfile(id: LabVehicleId): VehicleModelProfile {
  return PROFILES[id]();
}

export function isLabVehicle(value: string | null): value is LabVehicleId {
  return LAB_VEHICLE_IDS.some((id) => id === value);
}

type Quad = [Vec3, Vec3, Vec3, Vec3];

function addQuads(
  group: THREE.Group,
  name: string,
  material: THREE.Material,
  quads: Quad[],
  outward: Vec3,
) {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const corners of quads) {
    const base = positions.length / 3;
    for (const corner of corners) positions.push(corner[0], corner[1], corner[2]);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  const facing =
    normal.getX(0) * outward[0] +
    normal.getY(0) * outward[1] +
    normal.getZ(0) * outward[2];
  if (facing < 0) {
    for (let index = 0; index < indices.length; index += 3) {
      const swap = indices[index + 1];
      indices[index + 1] = indices[index + 2];
      indices[index + 2] = swap;
    }
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  group.add(mesh);
}

function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3): Quad {
  return [a, b, c, d];
}

function addWheel(
  group: THREE.Group,
  material: THREE.Material,
  name: string,
  x: number,
  z: number,
) {
  const geometry = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 16);
  geometry.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(x, 0.36, z);
  group.add(mesh);
}

function materials() {
  return {
    wrap: new THREE.MeshStandardMaterial({
      color: 0xe7e0d2,
      roughness: 0.55,
      metalness: 0.04,
      name: 'Wrap_Lab',
    }),
    body: new THREE.MeshStandardMaterial({
      color: 0xd9d2c3,
      roughness: 0.62,
      name: 'Body_Lab',
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x243038,
      roughness: 0.12,
      metalness: 0.08,
      name: 'Glass',
    }),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xc4523a,
      roughness: 0.35,
      name: 'Lamp',
    }),
    wheel: new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.9,
      name: 'Wheel',
    }),
    trim: new THREE.MeshStandardMaterial({
      color: 0x3e4348,
      roughness: 0.6,
      name: 'Trim',
    }),
    interior: new THREE.MeshStandardMaterial({
      color: 0x8d8476,
      roughness: 0.8,
      name: 'Interior',
    }),
  };
}

function buildBox() {
  const group = new THREE.Group();
  const mat = materials();
  const { envelope, door, window } = BOX_TRAILER;
  const x0 = envelope.xMin;
  const x1 = envelope.xMin + envelope.length;
  const y0 = 0.35;
  const y1 = envelope.height;
  const z = door.z;
  const zd = -z;
  const wall: Quad[] = [
    quad([x0, y0, z], [x1, y0, z], [x1, door.y0, z], [x0, door.y0, z]),
    quad([x0, door.y0, z], [door.x0, door.y0, z], [door.x0, window.y0, z], [x0, window.y0, z]),
    quad([door.x1, door.y0, z], [x1, door.y0, z], [x1, window.y0, z], [door.x1, window.y0, z]),
    quad([x0, window.y0, z], [door.x0, window.y0, z], [door.x0, window.y1, z], [x0, window.y1, z]),
    quad(
      [door.x1, window.y0, z],
      [window.x0, window.y0, z],
      [window.x0, window.y1, z],
      [door.x1, window.y1, z],
    ),
    quad([window.x1, window.y0, z], [x1, window.y0, z], [x1, window.y1, z], [window.x1, window.y1, z]),
    quad([x0, window.y1, z], [door.x0, window.y1, z], [door.x0, door.y1, z], [x0, door.y1, z]),
    quad([door.x1, window.y1, z], [x1, window.y1, z], [x1, door.y1, z], [door.x1, door.y1, z]),
    quad([x0, door.y1, z], [x1, door.y1, z], [x1, y1, z], [x0, y1, z]),
  ];
  addQuads(group, 'trailer_entry', mat.wrap, wall, [0, 0, -1]);
  addQuads(
    group,
    'trailer_door',
    mat.wrap,
    [
      quad(
        [door.x0, door.y0, z],
        [door.x1, door.y0, z],
        [door.x1, door.y1, z],
        [door.x0, door.y1, z],
      ),
    ],
    [0, 0, -1],
  );
  addQuads(
    group,
    'trailer_driver',
    mat.wrap,
    [quad([x0, y0, zd], [x0, y1, zd], [x1, y1, zd], [x1, y0, zd])],
    [0, 0, 1],
  );
  addQuads(
    group,
    'trailer_front',
    mat.body,
    [quad([x0, y0, z], [x0, y1, z], [x0, y1, zd], [x0, y0, zd])],
    [-1, 0, 0],
  );
  addQuads(
    group,
    'trailer_rear',
    mat.body,
    [quad([x1, y0, zd], [x1, y1, zd], [x1, y1, z], [x1, y0, z])],
    [1, 0, 0],
  );
  addQuads(
    group,
    'trailer_roof',
    mat.body,
    [quad([x0, y1, z], [x0, y1, zd], [x1, y1, zd], [x1, y1, z])],
    [0, 1, 0],
  );
  addQuads(
    group,
    'trailer_glass',
    mat.glass,
    [
      quad(
        [window.x0, window.y0, z - 0.01],
        [window.x1, window.y0, z - 0.01],
        [window.x1, window.y1, z - 0.01],
        [window.x0, window.y1, z - 0.01],
      ),
    ],
    [0, 0, -1],
  );
  addQuads(
    group,
    'trailer_interior',
    mat.interior,
    [quad([-1.5, 0.42, -0.8], [2.4, 0.42, -0.8], [2.4, 0.42, 0.8], [-1.5, 0.42, 0.8])],
    [0, 1, 0],
  );
  const hitch = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.12), mat.trim);
  hitch.name = 'trailer_hitch';
  hitch.position.set(x0 - 0.6, 0.55, 0);
  group.add(hitch);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.55), mat.lamp);
  lamp.name = 'trailer_lamp';
  lamp.position.set(x1 + 0.02, 1.1, 0);
  group.add(lamp);
  addWheel(group, mat.wheel, 'trailer_wheel', 0.4, -0.95);
  addWheel(group, mat.wheel, 'trailer_wheel', 0.4, 0.95);
  addWheel(group, mat.wheel, 'trailer_wheel', 2.5, -0.95);
  addWheel(group, mat.wheel, 'trailer_wheel', 2.5, 0.95);
  return group;
}

function buildHighRoof() {
  const group = new THREE.Group();
  const mat = materials();
  const { envelope, arc } = HIGH_ROOF;
  const x0 = envelope.xMin;
  const x1 = envelope.xMin + envelope.length;
  const z = envelope.width / 2;
  const y0 = 0.4;
  addQuads(
    group,
    'roof_entry',
    mat.wrap,
    [quad([x0, y0, -z], [x1, y0, -z], [x1, arc.springY, -z], [x0, arc.springY, -z])],
    [0, 0, -1],
  );
  addQuads(
    group,
    'roof_driver',
    mat.wrap,
    [quad([x0, y0, z], [x0, arc.springY, z], [x1, arc.springY, z], [x1, y0, z])],
    [0, 0, 1],
  );
  const segments = 8;
  const roof: Quad[] = [];
  for (let index = 0; index < segments; index += 1) {
    const a0 = -Math.PI / 2 + (index * Math.PI) / segments;
    const a1 = -Math.PI / 2 + ((index + 1) * Math.PI) / segments;
    const at = (x: number, angle: number): Vec3 => [
      x,
      arc.springY + arc.radius * Math.cos(angle),
      arc.centerZ + arc.radius * Math.sin(angle),
    ];
    roof.push(quad(at(x0, a0), at(x1, a0), at(x1, a1), at(x0, a1)));
  }
  addQuads(group, 'roof_curve', mat.body, roof, [0, 0, -1]);
  addQuads(
    group,
    'roof_glass',
    mat.glass,
    [quad([x0 + 0.02, 0.85, -0.85], [x0 + 0.02, 1.55, -0.85], [x0 + 0.02, 1.55, 0.85], [x0 + 0.02, 0.85, 0.85])],
    [-1, 0, 0],
  );
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.28), mat.lamp);
  lamp.name = 'roof_lamp';
  lamp.position.set(x0 - 0.02, 0.7, -0.7);
  group.add(lamp);
  addWheel(group, mat.wheel, 'roof_wheel', x0 + 1.1, -0.78);
  addWheel(group, mat.wheel, 'roof_wheel', x0 + 1.1, 0.78);
  addWheel(group, mat.wheel, 'roof_wheel', x1 - 1.2, -0.78);
  addWheel(group, mat.wheel, 'roof_wheel', x1 - 1.2, 0.78);
  return group;
}

function buildStep() {
  const group = new THREE.Group();
  const mat = materials();
  const { envelope, lower, upper, slide } = STEP_SLIDE;
  const x0 = envelope.xMin;
  const x1 = envelope.xMin + envelope.length;
  const z = envelope.width / 2;
  const y0 = 0.42;
  const y1 = envelope.height;
  addQuads(
    group,
    'step_entry',
    mat.wrap,
    [quad([x0 + 0.45, y0, -z], [x1, y0, -z], [x1, y1, -z], [x0 + 0.45, y1, -z])],
    [0, 0, -1],
  );
  addQuads(
    group,
    'step_driver',
    mat.wrap,
    [quad([x0 + 0.45, y0, z], [x0 + 0.45, y1, z], [x1, y1, z], [x1, y0, z])],
    [0, 0, 1],
  );
  addQuads(
    group,
    'step_lower',
    mat.body,
    [
      quad(
        [lower.x, lower.y0, lower.z0],
        [lower.x, lower.y0, lower.z1],
        [lower.x, lower.y1, lower.z1],
        [lower.x, lower.y1, lower.z0],
      ),
    ],
    [-1, 0, 0],
  );
  addQuads(
    group,
    'step_upper',
    mat.body,
    [
      quad(
        [upper.x, upper.y0, upper.z0],
        [upper.x, upper.y0, upper.z1],
        [upper.x, upper.y1, upper.z1],
        [upper.x, upper.y1, upper.z0],
      ),
    ],
    [-1, 0, 0],
  );
  addQuads(
    group,
    'slide_face',
    mat.wrap,
    [
      quad(
        [slide.x0, slide.y0, slide.z],
        [slide.x1, slide.y0, slide.z],
        [slide.x1, slide.y1, slide.z],
        [slide.x0, slide.y1, slide.z],
      ),
    ],
    [0, 0, 1],
  );
  addQuads(
    group,
    'slide_shell',
    mat.trim,
    [
      quad(
        [slide.x0, slide.y1, z + 0.08],
        [slide.x0, slide.y1, slide.z],
        [slide.x1, slide.y1, slide.z],
        [slide.x1, slide.y1, z + 0.08],
      ),
    ],
    [0, 1, 0],
  );
  addQuads(
    group,
    'step_glass',
    mat.glass,
    [quad([1.1, 1.25, -z - 0.01], [1.7, 1.25, -z - 0.01], [1.7, 1.7, -z - 0.01], [1.1, 1.7, -z - 0.01])],
    [0, 0, -1],
  );
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.24), mat.lamp);
  lamp.name = 'step_lamp';
  lamp.position.set(lower.x - 0.02, 0.72, -0.7);
  group.add(lamp);
  addWheel(group, mat.wheel, 'step_wheel', 0.2, -0.85);
  addWheel(group, mat.wheel, 'step_wheel', 0.2, 0.85);
  addWheel(group, mat.wheel, 'step_wheel', 2.2, -0.85);
  addWheel(group, mat.wheel, 'step_wheel', 2.2, 0.85);
  return group;
}

export function buildVerificationBody(
  id: Exclude<LabVehicleId, 'current-glb'>,
): THREE.Group {
  if (id === 'box-trailer') return buildBox();
  if (id === 'high-roof') return buildHighRoof();
  return buildStep();
}

export function disposeVerificationBody(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of [object.material].flat()) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

export function resolveLabVehicle(input: {
  query: string | null;
  queryApplied: boolean;
  current: LabVehicleId;
  choice: LabVehicleId | null;
}): { vehicle: LabVehicleId; queryApplied: boolean } {
  if (input.choice) return { vehicle: input.choice, queryApplied: true };
  if (!input.queryApplied) {
    return {
      vehicle: isLabVehicle(input.query) ? input.query : 'current-glb',
      queryApplied: true,
    };
  }
  return { vehicle: input.current, queryApplied: true };
}

const VIEW_DIRECTION: Vec3 = [-0.62, 0.36, -0.7];

function unit(value: Vec3): Vec3 {
  const length = Math.hypot(value[0], value[1], value[2]) || 1;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec(value: Vec3, factor: number): Vec3 {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

function dotVec(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function boundsCorners(min: Vec3, max: Vec3): Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [min[0], max[0]])
    for (const y of [min[1], max[1]])
      for (const z of [min[2], max[2]]) corners.push([x, y, z]);
  return corners;
}

/** Normalized device coordinates. z is depth in front of the camera. */
export function projectVehiclePoint(
  point: Vec3,
  view: { target: Vec3; position: Vec3 },
  aspect: number,
  fovDeg = 38,
) {
  const forward = unit(subVec(view.target, view.position));
  const right = unit(crossVec(forward, [0, 1, 0]));
  const up = crossVec(right, forward);
  const relative = subVec(point, view.position);
  const depth = dotVec(relative, forward);
  const tan = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  return {
    x: dotVec(relative, right) / (depth * tan * aspect),
    y: dotVec(relative, up) / (depth * tan),
    z: depth,
  };
}

/**
 * Front-entry view fitted to the real bounds and the canvas.
 * The body stays inside about 72% of the frame, so the first view is complete
 * and slightly small rather than cropped or enlarged.
 */
export function fitVehicleView(input: {
  min: Vec3;
  max: Vec3;
  aspect: number;
  fovDeg?: number;
}): { target: Vec3; position: Vec3; distance: number } {
  const fov = input.fovDeg ?? 38;
  const aspect = Math.max(input.aspect, 0.2);
  const target: Vec3 = [
    (input.min[0] + input.max[0]) / 2,
    (input.min[1] + input.max[1]) / 2,
    (input.min[2] + input.max[2]) / 2,
  ];
  const corners = boundsCorners(input.min, input.max);
  const radius =
    Math.max(
      ...corners.map((corner) => Math.hypot(...subVec(corner, target))),
    ) || 1;
  const direction = unit(VIEW_DIRECTION);
  const fits = (distance: number) => {
    const position = addVec(target, scaleVec(direction, distance));
    return corners.every((corner) => {
      const projected = projectVehiclePoint(corner, { target, position }, aspect, fov);
      return (
        projected.z > radius * 0.02 &&
        Math.abs(projected.x) <= 0.72 &&
        Math.abs(projected.y) <= 0.72
      );
    });
  };
  let near = radius * 0.2;
  let far = Math.max(radius * 12, near + 1);
  if (!fits(far)) far = radius * 40;
  for (let step = 0; step < 28; step += 1) {
    const mid = (near + far) / 2;
    if (fits(mid)) far = mid;
    else near = mid;
  }
  const distance = far * 1.08;
  return {
    target,
    position: addVec(target, scaleVec(direction, distance)),
    distance,
  };
}

/** Same front-entry three-quarter formula for every profile. */
export function labCamera(profile: VehicleModelProfile): {
  target: Vec3;
  position: Vec3;
} {
  const { xMin, length, width, height, centerZ } = profile.envelope;
  const target: Vec3 = [xMin + length * 0.42, height * 0.45, centerZ];
  return {
    target,
    position: [
      target[0] - length * 0.7,
      target[1] + height * 0.42,
      target[2] - (width * 0.9 + length * 0.22),
    ],
  };
}

export function labDesignToProject(design: LabDesign): Project {
  let project = { ...emptyProject(), background: '#f4efe4' };
  for (const mark of designMarks(design)) {
    const kind = mark.kind === 'swatch' ? 'region' : mark.kind;
    project = addLayer(project, newLayer(kind, mark.kind), 'entry', true);
    project = editLayer(project, mark.kind, 'entry', {
      x: mark.editorX,
      y: mark.editorY,
      w: mark.w,
      h: mark.h,
      color: mark.kind === 'swatch' ? design.swatch : '#1c2430',
      text: design.text,
      icon: design.icon,
      ...(mark.kind === 'swatch'
        ? {
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
              { x: 0, y: 1 },
            ],
          }
        : {}),
    });
  }
  return project;
}
