/**
 * Schematic procedural bodies for the body-lab page, one builder per
 * body family (van / bus / C-type / pickup-camper / trailer).
 *
 * These are NOT the shipped van model (public/model/mxgarage-rv.glb) and
 * must never be presented as one: they are boxy schematics whose only
 * job is to make parameter changes visible (kind, wheelbase, roof type,
 * dimensions). Real dimensions and window layouts live in the shipped
 * asset and the announcement database, not here.
 *
 * Conventions match the shipped asset: X is length, front is -X, Y is up,
 * ground is Y 0. Units are metres (config values are millimetres).
 * Trailer kinds use wheelbaseMm as the hitch-to-axle distance and
 * lengthMm as the body length (the hitch bar adds 1.2 m in front).
 */
import * as THREE from 'three';
import type { BodyConfig } from './parametric-body.ts';
import {
  TRAILER_HITCH_MM,
  axlePositionsMm,
  isPopUpRoof,
  isTowableKind,
  trioOf,
} from './parametric-body.ts';

const BODY_CREAM = 0xe9e2d2;
const GLASS_DARK = 0x2b3438;
const RUBBER_DARK = 0x1c1e20;
const CANVAS_BEIGE = 0xd8cdb4;
const WHEEL_DARK = 0x222528;
const SLIDE_OUT_TAN = 0xcbb489;
const FIXTURE_WHITE = 0xf2f0ea;

function box(
  length: number,
  height: number,
  width: number,
  color: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, height, width),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 }),
  );
  mesh.position.set(x, y, z);
  return mesh;
}

function wheel(
  radius: number,
  width: number,
  x: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, width, 24),
    new THREE.MeshStandardMaterial({ color: WHEEL_DARK, roughness: 0.9 }),
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, radius, z);
  return mesh;
}

function roofSlab(
  len: number,
  x: number,
  y: number,
  width: number,
): THREE.Mesh {
  return box(len, 0.08, width * 0.96, BODY_CREAM, x, y, 0);
}

/**
 * Simple roof for the non-van builders: a closed slab, or a canvas +
 * raised slab when a pop-up roof is open. Van roofs keep their own
 * sloped / split variants in buildVanBody.
 */
function addSimpleRoof(
  group: THREE.Group,
  len: number,
  centerX: number,
  width: number,
  height: number,
  config: BodyConfig,
): void {
  const travel = config.popUpTravelMm / 1000;
  const open = isPopUpRoof(config.roofType) && config.popUpOpen;
  if (!open) {
    group.add(roofSlab(len, centerX, height + 0.04, width));
    return;
  }
  group.add(
    box(
      len * 0.6,
      travel,
      width * 0.9,
      CANVAS_BEIGE,
      centerX,
      height + travel / 2,
      0,
    ),
    roofSlab(len, centerX, height + travel + 0.04, width),
  );
}

function sideWindows(
  group: THREE.Group,
  entries: { x: number; y: number; len: number; h: number }[],
  width: number,
): void {
  for (const side of [-1, 1]) {
    const z = side * (width / 2 + 0.01);
    for (const entry of entries) {
      group.add(box(entry.len, entry.h, 0.02, GLASS_DARK, entry.x, entry.y, z));
    }
  }
}

function windshield(
  group: THREE.Group,
  bodyLen: number,
  cabTop: number,
  width: number,
): void {
  // Lean the top rearward (+X) like a real windshield rake. The rake
  // shifts the plane's x-extent by half its height * sin(rake), so the
  // center is compensated to keep the shield inside the body length.
  const rake = 0.35;
  const shieldHalfX = (0.85 / 2) * Math.sin(rake);
  const shield = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 0.8, 0.85),
    new THREE.MeshStandardMaterial({
      color: GLASS_DARK,
      roughness: 0.15,
      metalness: 0.3,
    }),
  );
  shield.position.set(-bodyLen / 2 + 0.06 + shieldHalfX, cabTop - 0.45, 0);
  shield.rotation.y = -Math.PI / 2;
  shield.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), -rake);
  group.add(shield);
}

function wheels(
  group: THREE.Group,
  positions: number[],
  radius: number,
  width: number,
): void {
  for (const x of positions) {
    for (const z of [-(width / 2 - 0.08), width / 2 - 0.08]) {
      group.add(wheel(radius, 0.26, x, z));
    }
  }
}

/** Van family: motorhome B, camper / bed car, off-road (floor/wheel tweaks). */
function buildVanBody(
  config: BodyConfig,
  floorY: number,
  wheelRadius: number,
): THREE.Group {
  const group = new THREE.Group();
  const L = config.lengthMm / 1000;
  const W = config.widthMm / 1000;
  const H = config.heightMm / 1000;
  const axles = axlePositionsMm(config.lengthMm, trioOf(config));

  // Rear body box (full height) and cab box (front, lower top).
  const rearLen = L * 0.62;
  const cabLen = L - rearLen;
  const cabTop = floorY + (H - floorY) * 0.85;
  const rear = box(
    rearLen,
    H - floorY,
    W,
    BODY_CREAM,
    L / 2 - rearLen / 2,
    (H + floorY) / 2,
    0,
  );
  const cab = box(
    cabLen,
    cabTop - floorY,
    W,
    BODY_CREAM,
    -L / 2 + cabLen / 2,
    (cabTop + floorY) / 2,
    0,
  );
  group.add(rear, cab);
  windshield(group, L, cabTop, W);
  sideWindows(
    group,
    [
      { x: -L / 2 + cabLen * 0.55, y: cabTop - 0.4, len: 0.9, h: 0.55 },
      { x: L * 0.12, y: H - 0.55, len: 1.4, h: 0.6 },
    ],
    W,
  );

  // Roof: closed slab, plus pop-up variants when open.
  const slab = (len: number, x: number, y: number): THREE.Mesh =>
    roofSlab(len, x, y, W);
  const travel = config.popUpTravelMm / 1000;
  const open = isPopUpRoof(config.roofType) && config.popUpOpen;
  if (!isPopUpRoof(config.roofType) || !open) {
    group.add(slab(L * 0.98, 0, H + 0.04));
  } else if (config.roofType === 'pop-up') {
    const canvas = box(
      L * 0.6,
      travel,
      W * 0.9,
      CANVAS_BEIGE,
      L * 0.05,
      H + travel / 2,
      0,
    );
    group.add(canvas, slab(L * 0.98, 0, H + travel + 0.04));
  } else if (config.roofType === 'sloped-pop-up') {
    // Hinge at the front edge; the rear rises by the travel.
    const angle = (config.slopedAngleDeg * Math.PI) / 180;
    const pivot = new THREE.Group();
    pivot.position.set(-L * 0.49, H, 0);
    const topSlab = slab(L * 0.98, L * 0.49, 0.04);
    pivot.add(topSlab);
    pivot.rotation.z = angle;
    group.add(pivot);
    const canvas = box(
      L * 0.6,
      travel * 0.6,
      W * 0.9,
      CANVAS_BEIGE,
      L * 0.15,
      H + travel * 0.3,
      0,
    );
    canvas.rotation.z = angle * 0.5;
    group.add(canvas);
  } else {
    // split-pop-up: front half rises, rear half stays.
    const frontLen = L * 0.45;
    const canvas = box(
      frontLen,
      travel,
      W * 0.9,
      CANVAS_BEIGE,
      -L / 2 + frontLen / 2 + L * 0.05,
      H + travel / 2,
      0,
    );
    group.add(
      canvas,
      slab(frontLen, -L / 2 + frontLen / 2 + L * 0.05, H + travel + 0.04),
      slab(
        L * 0.98 - frontLen - L * 0.05,
        L / 2 - (L * 0.98 - frontLen - L * 0.05) / 2,
        H + 0.04,
      ),
    );
  }

  wheels(
    group,
    [axles.frontAxleMm / 1000, axles.rearAxleMm / 1000],
    wheelRadius,
    W,
  );
  const skirt = box(L * 0.9, 0.12, W * 0.98, RUBBER_DARK, 0, floorY - 0.02, 0);
  group.add(skirt);
  return group;
}

/** Bus family: motorhome A — one tall box, flat front, no separate cab. */
function buildBusBody(config: BodyConfig): THREE.Group {
  const group = new THREE.Group();
  const L = config.lengthMm / 1000;
  const W = config.widthMm / 1000;
  const H = config.heightMm / 1000;
  const floorY = 0.55;
  const wheelbase = config.wheelbaseMm / 1000;
  group.add(box(L, H - floorY, W, BODY_CREAM, 0, (H + floorY) / 2, 0));
  // Flat front windshield: a plane 2 mm proud of the front face, so the
  // body still spans exactly its configured length.
  const frontGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(W * 0.92, 0.8),
    new THREE.MeshStandardMaterial({
      color: GLASS_DARK,
      roughness: 0.15,
      metalness: 0.3,
    }),
  );
  frontGlass.position.set(-L / 2 - 0.002, H - 0.9, 0);
  frontGlass.rotation.y = -Math.PI / 2;
  group.add(frontGlass);
  sideWindows(group, [{ x: 0, y: H - 0.9, len: L * 0.8, h: 0.7 }], W);
  addSimpleRoof(group, L * 0.98, 0, W, H, config);
  wheels(group, [-wheelbase / 2, wheelbase / 2], 0.45, W);
  group.add(box(L * 0.9, 0.12, W * 0.98, RUBBER_DARK, 0, floorY - 0.02, 0));
  return group;
}

/** C family: motorhome C and micro-truck C — cab + rear box + overcab bunk. */
function buildCBody(config: BodyConfig): THREE.Group {
  const group = new THREE.Group();
  const L = config.lengthMm / 1000;
  const W = config.widthMm / 1000;
  const H = config.heightMm / 1000;
  const floorY = 0.55;
  const wheelbase = config.wheelbaseMm / 1000;
  const bunkH = 0.75;
  const cabTop = H - bunkH;
  const cabLen = L * 0.32;
  const rearLen = L - cabLen;
  group.add(
    box(
      rearLen,
      H - floorY,
      W,
      BODY_CREAM,
      L / 2 - rearLen / 2,
      (H + floorY) / 2,
      0,
    ),
    box(
      cabLen,
      cabTop - floorY,
      W,
      BODY_CREAM,
      -L / 2 + cabLen / 2,
      (cabTop + floorY) / 2,
      0,
    ),
    // Overcab bunk: same footprint as the cab, top at the overall height.
    box(
      cabLen,
      bunkH,
      W,
      BODY_CREAM,
      -L / 2 + cabLen / 2,
      cabTop + bunkH / 2,
      0,
    ),
  );
  windshield(group, L, cabTop, W);
  sideWindows(
    group,
    [
      { x: -L / 2 + cabLen * 0.55, y: cabTop - 0.4, len: 0.9, h: 0.55 },
      { x: L * 0.12, y: H - 0.55, len: 1.4, h: 0.6 },
    ],
    W,
  );
  addSimpleRoof(group, L * 0.98, 0, W, H, config);
  wheels(group, [-wheelbase / 2, wheelbase / 2], 0.36, W);
  group.add(box(L * 0.9, 0.12, W * 0.98, RUBBER_DARK, 0, floorY - 0.02, 0));
  return group;
}

/** T family: pickup cab + camper box riding in the bed. */
function buildPickupBody(config: BodyConfig): THREE.Group {
  const group = new THREE.Group();
  const L = config.lengthMm / 1000;
  const W = config.widthMm / 1000;
  const H = config.heightMm / 1000;
  const floorY = 0.55;
  const wheelbase = config.wheelbaseMm / 1000;
  const cabLen = L * 0.38;
  const cabTop = H - 0.3;
  const bedFloor = 0.85;
  // Camper box runs from just behind the cab to the rear bumper, so the
  // schematic spans exactly the configured length.
  const camperLen = L - cabLen - 0.05;
  const camperX = -L / 2 + cabLen + 0.05 + camperLen / 2;
  group.add(
    box(
      cabLen,
      cabTop - floorY,
      W,
      BODY_CREAM,
      -L / 2 + cabLen / 2,
      (cabTop + floorY) / 2,
      0,
    ),
    box(
      camperLen,
      H - bedFloor,
      W * 0.94,
      BODY_CREAM,
      camperX,
      (bedFloor + H) / 2,
      0,
    ),
  );
  windshield(group, L, cabTop, W);
  sideWindows(
    group,
    [
      { x: -L / 2 + cabLen * 0.55, y: cabTop - 0.4, len: 0.9, h: 0.55 },
      { x: camperX, y: H - 0.6, len: 1.0, h: 0.5 },
    ],
    W,
  );
  addSimpleRoof(group, camperLen, camperX, W * 0.94, H, config);
  wheels(group, [-wheelbase / 2, wheelbase / 2], 0.38, W);
  return group;
}

/** Trailer family: box + hitch bar, wheels placed by hitch-to-axle. */
function buildTrailerBody(config: BodyConfig): THREE.Group {
  const group = new THREE.Group();
  const L = config.lengthMm / 1000;
  const W = config.widthMm / 1000;
  const H = config.heightMm / 1000;
  const floorY = 0.6;
  const hitch = TRAILER_HITCH_MM / 1000;
  const axleX = -L / 2 - hitch + config.wheelbaseMm / 1000;
  group.add(box(L, H - floorY, W, BODY_CREAM, 0, (H + floorY) / 2, 0));
  group.add(
    box(hitch, 0.12, 0.3, RUBBER_DARK, -L / 2 - hitch / 2, 0.55, 0),
    // Hitch head: its front face is the frontmost point, so the total
    // length is exactly body length + hitch length.
    box(0.25, 0.15, 0.25, RUBBER_DARK, -L / 2 - hitch + 0.125, 0.55, 0),
  );
  sideWindows(group, [{ x: 0, y: H - 0.6, len: 1.2, h: 0.5 }], W);
  addSimpleRoof(group, L * 0.98, 0, W, H, config);
  const axlePositions =
    config.vehicleKind === 'towable-a' ? [axleX - 0.6, axleX + 0.6] : [axleX];
  wheels(group, axlePositions, 0.36, W);
  return group;
}

/**
 * Frame the add-on builders share: body dims in metres, the floor the
 * family builder used, and the vertical center side/rear add-ons hang
 * from. Pickup slide-outs hang from the camper box (bed floor to roof)
 * instead of the cab floor. Values mirror the family builders above.
 */
function schematicFrame(config: BodyConfig): {
  L: number;
  W: number;
  H: number;
  floorY: number;
  slideY: number;
} {
  const L = config.lengthMm / 1000;
  const W = config.widthMm / 1000;
  const H = config.heightMm / 1000;
  let floorY = 0.55;
  if (config.vehicleKind === 'camper') floorY = 0.48;
  else if (config.vehicleKind === 'offroad') floorY = 0.62;
  else if (isTowableKind(config.vehicleKind)) floorY = 0.6;
  const slideY =
    config.vehicleKind === 'motorhome-t' ? (0.85 + H) / 2 : (floorY + H) / 2;
  return { L, W, H, floorY, slideY };
}

/** Slice 4: slide-out boxes protruding from the chosen face. */
function addSlideOuts(group: THREE.Group, config: BodyConfig): void {
  const { L, W, slideY } = schematicFrame(config);
  for (const slideOut of config.slideOuts) {
    const len = slideOut.lengthMm / 1000;
    const depth = slideOut.depthMm / 1000;
    if (slideOut.side === 'left') {
      group.add(
        box(
          len,
          1.2,
          depth,
          SLIDE_OUT_TAN,
          slideOut.centerMm / 1000,
          slideY,
          -(W / 2 + depth / 2),
        ),
      );
    } else if (slideOut.side === 'right') {
      group.add(
        box(
          len,
          1.2,
          depth,
          SLIDE_OUT_TAN,
          slideOut.centerMm / 1000,
          slideY,
          W / 2 + depth / 2,
        ),
      );
    } else {
      group.add(
        box(depth, 1.2, W * 0.8, SLIDE_OUT_TAN, L / 2 + depth / 2, slideY, 0),
      );
    }
  }
}

/** Slice 4: one mesh per checked accessory, on its mount surface. */
function addAccessories(group: THREE.Group, config: BodyConfig): void {
  const { L, W, H, floorY, slideY } = schematicFrame(config);
  const roofY = H + 0.08;
  for (const accessory of config.accessories) {
    const pos = accessory.positionMm / 1000;
    if (accessory.id === 'roof-rack') {
      group.add(box(1.6, 0.08, W * 0.8, RUBBER_DARK, pos, roofY + 0.06, 0));
    } else if (accessory.id === 'roof-platform') {
      group.add(box(2.0, 0.06, W * 0.85, RUBBER_DARK, pos, roofY + 0.05, 0));
    } else if (accessory.id === 'storage-box') {
      group.add(box(1.2, 0.35, W * 0.6, BODY_CREAM, pos, roofY + 0.175, 0));
    } else if (accessory.id === 'awning') {
      group.add(box(2.2, 0.05, 1.0, CANVAS_BEIGE, pos, H - 0.35, W / 2 + 0.5));
    } else if (accessory.id === 'ladder') {
      group.add(box(0.08, 1.6, 0.4, RUBBER_DARK, L / 2 + 0.06, slideY, pos));
    } else if (accessory.id === 'bike-rack') {
      group.add(box(0.5, 0.08, 1.2, RUBBER_DARK, L / 2 + 0.28, slideY, pos));
    } else if (accessory.id === 'spare-tire') {
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.2, 24),
        new THREE.MeshStandardMaterial({ color: WHEEL_DARK, roughness: 0.9 }),
      );
      tire.rotation.z = Math.PI / 2;
      tire.position.set(L / 2 + 0.15, slideY, pos);
      group.add(tire);
    } else if (accessory.id === 'snorkel') {
      group.add(
        box(0.15, 1.2, 0.15, RUBBER_DARK, pos, slideY + 0.3, W / 2 + 0.08),
      );
    } else if (accessory.id === 'winch') {
      group.add(
        box(0.2, 0.25, 0.8, RUBBER_DARK, -L / 2 - 0.12, floorY + 0.25, pos),
      );
    } else if (accessory.id === 'bull-bar') {
      group.add(
        box(0.15, 0.5, W * 0.9, RUBBER_DARK, -L / 2 - 0.15, floorY + 0.35, 0),
      );
    }
  }
}

/** Slice 4: roof fixtures sit on the fixed roof, never the raised slab. */
function addRoofFixtures(group: THREE.Group, config: BodyConfig): void {
  const { H } = schematicFrame(config);
  const roofY = H + 0.08;
  for (const fixture of config.roofFixtures) {
    const pos = fixture.positionMm / 1000;
    if (fixture.kind === 'skylight') {
      group.add(box(0.8, 0.06, 0.6, GLASS_DARK, pos, roofY + 0.03, 0));
    } else if (fixture.kind === 'vent') {
      group.add(box(0.4, 0.12, 0.4, BODY_CREAM, pos, roofY + 0.06, 0));
    } else {
      group.add(box(1.0, 0.25, 0.7, FIXTURE_WHITE, pos, roofY + 0.125, 0));
    }
  }
}

/**
 * Build a schematic body group from a BodyConfig. The caller owns the
 * group and should dispose it (traverse geometry/material dispose) on
 * rebuild/unmount.
 */
export function buildParametricBody(config: BodyConfig): THREE.Group {
  let group: THREE.Group;
  if (isTowableKind(config.vehicleKind)) {
    group = buildTrailerBody(config);
  } else {
    switch (config.vehicleKind) {
      case 'motorhome-a':
        group = buildBusBody(config);
        break;
      case 'motorhome-c':
      case 'micro-c':
        group = buildCBody(config);
        break;
      case 'motorhome-t':
        group = buildPickupBody(config);
        break;
      case 'camper':
        group = buildVanBody(config, 0.48, 0.32);
        break;
      case 'offroad':
        group = buildVanBody(config, 0.62, 0.42);
        break;
      case 'motorhome-b':
      default:
        group = buildVanBody(config, 0.55, 0.36);
        break;
    }
  }
  addSlideOuts(group, config);
  addAccessories(group, config);
  addRoofFixtures(group, config);
  return group;
}

/**
 * "Duang" bounce: a damped squash-and-stretch applied to the schematic
 * body for a short window after a slider drag ends. Pure function so the
 * page loop stays thin and the curve stays unit-tested.
 *
 * At t = 0 the body is squashed (y 0.94, x/z 1.03); it then springs past
 * its rest size once and settles. At or after BOUNCE_DURATION_MS the
 * scale is exactly 1, so the loop can stop applying it.
 */
export const BOUNCE_DURATION_MS = 900;

export function bounceScale(elapsedMs: number): {
  x: number;
  y: number;
  z: number;
} {
  if (elapsedMs <= 0) return { x: 1.03, y: 0.94, z: 1.03 };
  if (elapsedMs >= BOUNCE_DURATION_MS) return { x: 1, y: 1, z: 1 };
  const t = elapsedMs / 1000;
  const y = 1 - 0.06 * Math.exp(-3.5 * t) * Math.cos(16 * t);
  const xz = 1 - (y - 1) * 0.5;
  return { x: xz, y, z: xz };
}

/** Dispose every geometry/material in a built group. */
export function disposeParametricBody(group: THREE.Group): void {
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) material.dispose();
    }
  });
}
