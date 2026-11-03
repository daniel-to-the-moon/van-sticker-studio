/**
 * Parametric body configuration for the body-config panel (see
 * ~/workspace/goals/mxgarage/files/参数化车体配置面板方案.md).
 *
 * Slice 3 scope: every vehicle kind in the scheme doc's taxonomy —
 * motorhome A / B / C / T, towable A / B / C / D, camper / bed car,
 * micro-truck C, off-road. The panel's sliders follow a per-kind
 * envelope, and the constraint engine treats blue-plate lines as
 * applying only to blue-plate kinds.
 *
 * Slice 4 scope: scheme doc groups 4 and 5 (finalized parts only) —
 * slide-out compartments (count 0-3, side, depth) checked against the
 * prototype side openings, the exterior accessory library (checkbox +
 * position, instantiated on the schematic), and roof fixtures
 * (skylight / vent / AC) checked against the open pop-up span.
 * Announcement database, interior panel and regional limits are the
 * scheme doc's pending section 7 items and are NOT built here.
 *
 * Slice 5 scope: the registry gate (入库制, scheme doc section 5 as
 * confirmed 2026-10-24). Model selection is driven by
 * lib/announcement-db.json; only rows with every required field
 * verified are selectable, and their core dimensions are fixed to
 * the registry values. The per-kind envelopes below survive only as
 * the demo view's prototype defaults, never as a way to configure an
 * unregistered model.
 *
 * PROTOTYPE ENVELOPES, NOT ANNOUNCEMENT FIGURES: the per-kind ranges
 * below are plausible market/regulation envelopes (road limits
 * width 2550 mm and height 4000 mm; blue-plate lines 6000 mm /
 * 4500 kg), chosen so every slider stays in a reasonable range for its
 * kind. They must be replaced by the announcement database before this
 * panel is used for real quotes. The panel UI carries the same warning.
 * The B-type reference size (5840 x 2220 x 3050) is measured from the
 * shipped van asset (motion_metadata.json).
 */

export type WheelbaseClass = 'short' | 'medium' | 'long';

export type RoofType =
  | 'flat'
  | 'low'
  | 'high'
  | 'semi-high'
  | 'pop-up'
  | 'sloped-pop-up'
  | 'split-pop-up';

/**
 * Vehicle kinds from the scheme doc section 1. Towable kinds have no
 * wheelbase: their wheelbaseMm field stores the hitch-to-axle distance
 * instead, which is what the trailer schematic places its wheels by.
 */
export type VehicleKind =
  | 'motorhome-a'
  | 'motorhome-b'
  | 'motorhome-c'
  | 'motorhome-t'
  | 'towable-a'
  | 'towable-b'
  | 'towable-c'
  | 'towable-d'
  | 'camper'
  | 'micro-c'
  | 'offroad';

export const MOTORHOME_KINDS: readonly VehicleKind[] = [
  'motorhome-a',
  'motorhome-b',
  'motorhome-c',
  'motorhome-t',
];

export const TOWABLE_KINDS: readonly VehicleKind[] = [
  'towable-a',
  'towable-b',
  'towable-c',
  'towable-d',
];

export const OTHER_KINDS: readonly VehicleKind[] = [
  'camper',
  'micro-c',
  'offroad',
];

export function isTowableKind(kind: VehicleKind): boolean {
  return (TOWABLE_KINDS as readonly VehicleKind[]).includes(kind);
}

/** Kinds the blue-plate lines (6000 mm / 4500 kg) apply to. */
export function isBluePlateKind(kind: VehicleKind): boolean {
  return (
    kind === 'motorhome-b' ||
    kind === 'motorhome-c' ||
    kind === 'motorhome-t' ||
    kind === 'camper' ||
    kind === 'micro-c' ||
    kind === 'offroad'
  );
}

export type SlideOutSide = 'left' | 'right' | 'rear';

export interface SlideOut {
  side: SlideOutSide;
  /** Longitudinal center from the vehicle center, mm (rear: unused). */
  centerMm: number;
  /** Length along the vehicle, mm. */
  lengthMm: number;
  /** Extension depth outward from the body face, mm. */
  depthMm: number;
}

export type AccessoryId =
  | 'roof-rack'
  | 'ladder'
  | 'awning'
  | 'bike-rack'
  | 'spare-tire'
  | 'storage-box'
  | 'roof-platform'
  | 'snorkel'
  | 'winch'
  | 'bull-bar';

export interface Accessory {
  id: AccessoryId;
  /**
   * Position parameter, mm: longitudinal from the vehicle center for
   * x-axis mounts, lateral from the center for z-axis mounts.
   */
  positionMm: number;
}

export type RoofFixtureKind = 'skylight' | 'vent' | 'ac';

export interface RoofFixture {
  kind: RoofFixtureKind;
  /** Longitudinal position from the vehicle center, mm. */
  positionMm: number;
}

export interface BodyConfig {
  /** Logic driver for envelopes, constraints and the schematic. */
  vehicleKind: VehicleKind;
  /** Free chassis label; the panel shows per-kind examples, not this. */
  chassis: string;
  /** Display label (A / B / C / T / towable / camper / ...). */
  bodyType: string;
  wheelbaseClass: WheelbaseClass;
  /** Wheelbase, or hitch-to-axle distance for towable kinds. */
  wheelbaseMm: number;
  /** Front overhang: nose to front axle (B-type trio slider). */
  frontOverhangMm: number;
  /** Rear overhang: rear axle to tail (B-type trio slider). */
  rearOverhangMm: number;
  /** Overall length, or trailer body length for towable kinds. */
  lengthMm: number;
  widthMm: number;
  /** Closed body height (roof down). */
  heightMm: number;
  roofType: RoofType;
  popUpTravelMm: number;
  slopedAngleDeg: number;
  popUpOpen: boolean;
  /** Null when the user has not entered a mass estimate. */
  estimatedMassKg: number | null;
  /** Slide-out compartments, 0-3 (scheme doc group 4). */
  slideOuts: SlideOut[];
  /** Checked exterior accessories with position parameters (group 5). */
  accessories: Accessory[];
  /** Roof fixtures: skylight / vent / AC outdoor unit (group 3). */
  roofFixtures: RoofFixture[];
}

/** Prototype wheelbase presets (mm) for motorhome B. */
export const WHEELBASE_PRESETS_MM: Record<WheelbaseClass, number> = {
  short: 3000,
  medium: 3400,
  long: 3750,
};

/** Closed-height preset (mm) each roof type snaps to when selected. */
export const ROOF_CLOSED_HEIGHT_MM: Record<RoofType, number> = {
  flat: 2500,
  low: 2600,
  'semi-high': 2850,
  high: 3050,
  'pop-up': 2600,
  'sloped-pop-up': 2600,
  'split-pop-up': 2600,
};

export interface VehicleEnvelope {
  lengthMinMm: number;
  lengthMaxMm: number;
  widthMinMm: number;
  widthMaxMm: number;
  heightMinMm: number;
  heightMaxMm: number;
  wheelbaseMinMm: number;
  wheelbaseMaxMm: number;
  massMinKg: number;
  massMaxKg: number;
}

/**
 * Per-kind slider envelopes (prototype, see header). Blue-plate kinds
 * deliberately extend past the 6000 mm / 4500 kg lines so the
 * yellow-plate warning stays visible; road-limit kinds cap at the
 * road limits. Towable wheelbase bounds are hitch-to-axle ranges; the
 * panel additionally caps them at hitch + body length.
 */
export const VEHICLE_ENVELOPES: Record<VehicleKind, VehicleEnvelope> = {
  'motorhome-a': {
    lengthMinMm: 7000,
    lengthMaxMm: 12000,
    widthMinMm: 2200,
    widthMaxMm: 2550,
    heightMinMm: 2800,
    heightMaxMm: 4000,
    wheelbaseMinMm: 3800,
    wheelbaseMaxMm: 6500,
    massMinKg: 5000,
    massMaxKg: 12000,
  },
  'motorhome-b': {
    lengthMinMm: 4000,
    lengthMaxMm: 6500,
    widthMinMm: 1800,
    widthMaxMm: 2550,
    heightMinMm: 2000,
    heightMaxMm: 3500,
    wheelbaseMinMm: 2500,
    wheelbaseMaxMm: 4200,
    massMinKg: 2500,
    massMaxKg: 6000,
  },
  'motorhome-c': {
    lengthMinMm: 5000,
    lengthMaxMm: 7000,
    widthMinMm: 2000,
    widthMaxMm: 2550,
    heightMinMm: 2800,
    heightMaxMm: 3500,
    wheelbaseMinMm: 2800,
    wheelbaseMaxMm: 4200,
    massMinKg: 3500,
    massMaxKg: 7500,
  },
  'motorhome-t': {
    lengthMinMm: 4800,
    lengthMaxMm: 6000,
    widthMinMm: 1800,
    widthMaxMm: 2200,
    heightMinMm: 2400,
    heightMaxMm: 3200,
    wheelbaseMinMm: 2800,
    wheelbaseMaxMm: 3600,
    massMinKg: 2500,
    massMaxKg: 4500,
  },
  'towable-a': {
    lengthMinMm: 6000,
    lengthMaxMm: 10000,
    widthMinMm: 2000,
    widthMaxMm: 2550,
    heightMinMm: 2400,
    heightMaxMm: 3200,
    wheelbaseMinMm: 800,
    wheelbaseMaxMm: 9000,
    massMinKg: 1500,
    massMaxKg: 4500,
  },
  'towable-b': {
    lengthMinMm: 3500,
    lengthMaxMm: 6500,
    widthMinMm: 1800,
    widthMaxMm: 2500,
    heightMinMm: 2000,
    heightMaxMm: 3000,
    wheelbaseMinMm: 800,
    wheelbaseMaxMm: 8000,
    massMinKg: 700,
    massMaxKg: 2500,
  },
  'towable-c': {
    lengthMinMm: 3500,
    lengthMaxMm: 6000,
    widthMinMm: 1800,
    widthMaxMm: 2400,
    heightMinMm: 1600,
    heightMaxMm: 2600,
    wheelbaseMinMm: 800,
    wheelbaseMaxMm: 7500,
    massMinKg: 700,
    massMaxKg: 2000,
  },
  'towable-d': {
    lengthMinMm: 2500,
    lengthMaxMm: 4500,
    widthMinMm: 1500,
    widthMaxMm: 2100,
    heightMinMm: 1600,
    heightMaxMm: 2400,
    wheelbaseMinMm: 800,
    wheelbaseMaxMm: 6000,
    massMinKg: 400,
    massMaxKg: 1200,
  },
  camper: {
    lengthMinMm: 3500,
    lengthMaxMm: 5000,
    widthMinMm: 1600,
    widthMaxMm: 2000,
    heightMinMm: 1700,
    heightMaxMm: 2200,
    wheelbaseMinMm: 2200,
    wheelbaseMaxMm: 3200,
    massMinKg: 1500,
    massMaxKg: 3000,
  },
  'micro-c': {
    lengthMinMm: 3500,
    lengthMaxMm: 4500,
    widthMinMm: 1500,
    widthMaxMm: 1900,
    heightMinMm: 2400,
    heightMaxMm: 2900,
    wheelbaseMinMm: 2000,
    wheelbaseMaxMm: 2800,
    massMinKg: 1500,
    massMaxKg: 3000,
  },
  offroad: {
    lengthMinMm: 4200,
    lengthMaxMm: 5600,
    widthMinMm: 1800,
    widthMaxMm: 2100,
    heightMinMm: 1900,
    heightMaxMm: 2400,
    wheelbaseMinMm: 2400,
    wheelbaseMaxMm: 3200,
    massMinKg: 2000,
    massMaxKg: 3500,
  },
};

/** Trailer hitch bar length (mm), front of the body to the hitch head. */
export const TRAILER_HITCH_MM = 1200;

function kindConfig(
  vehicleKind: VehicleKind,
  chassis: string,
  bodyType: string,
  wheelbaseMm: number,
  lengthMm: number,
  widthMm: number,
  heightMm: number,
  roofType: RoofType,
): BodyConfig {
  return {
    vehicleKind,
    chassis,
    bodyType,
    wheelbaseClass: 'long',
    wheelbaseMm,
    frontOverhangMm: (lengthMm - wheelbaseMm) / 2,
    rearOverhangMm: (lengthMm - wheelbaseMm) / 2,
    lengthMm,
    widthMm,
    heightMm,
    roofType,
    popUpTravelMm: 450,
    slopedAngleDeg: 12,
    popUpOpen: false,
    estimatedMassKg: null,
    slideOuts: [],
    accessories: [],
    roofFixtures: [],
  };
}

/** One default config per kind; switching kind restores its default. */
export const KIND_DEFAULTS: Record<VehicleKind, BodyConfig> = {
  'motorhome-a': kindConfig(
    'motorhome-a',
    'bus',
    'A',
    5000,
    9000,
    2500,
    3400,
    'high',
  ),
  'motorhome-b': {
    chassis: 'van-b',
    bodyType: 'B',
    vehicleKind: 'motorhome-b',
    wheelbaseClass: 'long',
    wheelbaseMm: WHEELBASE_PRESETS_MM.long,
    frontOverhangMm: 1045,
    rearOverhangMm: 1045,
    lengthMm: 5840,
    widthMm: 2220,
    heightMm: ROOF_CLOSED_HEIGHT_MM.high,
    roofType: 'high',
    popUpTravelMm: 450,
    slopedAngleDeg: 12,
    popUpOpen: false,
    estimatedMassKg: null,
    slideOuts: [],
    accessories: [],
    roofFixtures: [],
  },
  'motorhome-c': kindConfig(
    'motorhome-c',
    'light-truck',
    'C',
    3300,
    5990,
    2300,
    3100,
    'high',
  ),
  'motorhome-t': kindConfig(
    'motorhome-t',
    'pickup',
    'T',
    3200,
    5300,
    2000,
    2800,
    'flat',
  ),
  'towable-a': kindConfig(
    'towable-a',
    'trailer',
    'towable',
    5300,
    7500,
    2400,
    2800,
    'high',
  ),
  'towable-b': kindConfig(
    'towable-b',
    'trailer',
    'towable',
    3700,
    5000,
    2200,
    2600,
    'high',
  ),
  'towable-c': kindConfig(
    'towable-c',
    'trailer',
    'towable',
    3450,
    4500,
    2100,
    2200,
    'pop-up',
  ),
  'towable-d': kindConfig(
    'towable-d',
    'trailer',
    'towable',
    3000,
    3600,
    1900,
    2100,
    'flat',
  ),
  camper: kindConfig('camper', 'car', 'camper', 2700, 4400, 1750, 1950, 'low'),
  'micro-c': kindConfig(
    'micro-c',
    'micro-truck',
    'micro-c',
    2400,
    4000,
    1700,
    2700,
    'high',
  ),
  offroad: kindConfig(
    'offroad',
    'offroad-4x4',
    'offroad',
    2800,
    4800,
    1900,
    2100,
    'flat',
  ),
};

export const DEFAULT_BODY_CONFIG: BodyConfig = KIND_DEFAULTS['motorhome-b'];

const POP_UP_TYPES: readonly RoofType[] = [
  'pop-up',
  'sloped-pop-up',
  'split-pop-up',
];

export function isPopUpRoof(roofType: RoofType): boolean {
  return (POP_UP_TYPES as readonly RoofType[]).includes(roofType);
}

/** Open height (mm): closed height plus pop-up travel when open. */
export function openHeightMm(config: BodyConfig): number {
  if (isPopUpRoof(config.roofType) && config.popUpOpen)
    return config.heightMm + config.popUpTravelMm;
  return config.heightMm;
}

export type ConstraintLevel = 'pass' | 'warn' | 'fail';

export interface ConstraintResult {
  level: ConstraintLevel;
  /** Stable code; the panel maps it to an i18n string. */
  code: string;
}

export const BLUE_PLATE_MAX_LENGTH_MM = 6000;
export const BLUE_PLATE_MAX_MASS_KG = 4500;
export const ROAD_REFERENCE_MAX_HEIGHT_MM = 4000;
export const MAX_BODY_WIDTH_MM = 2550;
export const POP_UP_TRAVEL_MAX_MM = 600;
export const SLOPED_ANGLE_MIN_DEG = 5;
export const SLOPED_ANGLE_MAX_DEG = 25;
export const MIN_TOTAL_OVERHANG_MM = 800;

/** Slice 4: slide-out limits (scheme doc group 4, count 0-3). */
export const SLIDE_OUT_MAX_COUNT = 3;
export const SLIDE_OUT_MIN_LENGTH_MM = 600;
export const SLIDE_OUT_MAX_LENGTH_MM = 2400;
export const SLIDE_OUT_DEPTH_MIN_MM = 200;
export const SLIDE_OUT_DEPTH_MAX_MM = 800;
/** Clear length kept free at each body end for a slide-out. */
export const SLIDE_OUT_END_MARGIN_MM = 200;

/**
 * Prototype side-opening layout the slide-out check runs against
 * (scheme doc group 4: side door + two side windows per side,
 * symmetric, so one interval set serves both sides). Widths scale
 * with body length and cap at realistic values, which keeps the three
 * zones disjoint for every envelope length: the door gap to the front
 * window is at least 0.045 * length, the gap to the rear window at
 * least 0.265 * length. These zones are the constraint reference; the
 * schematic's drawn windows are decorative and may differ.
 * Coordinates are mm from the vehicle center, front negative.
 */
export interface BodyOpening {
  startMm: number;
  endMm: number;
}

export function sideOpenings(config: BodyConfig): BodyOpening[] {
  const L = config.lengthMm;
  const doorW = Math.min(800, 0.12 * L);
  const winW = Math.min(1000, 0.15 * L);
  return [
    { startMm: -0.38 * L - winW / 2, endMm: -0.38 * L + winW / 2 },
    { startMm: -0.2 * L - doorW / 2, endMm: -0.2 * L + doorW / 2 },
    { startMm: 0.2 * L - winW / 2, endMm: 0.2 * L + winW / 2 },
  ];
}

/** Strict interval overlap; touching edges do not count as overlap. */
export function intervalsOverlap(a: BodyOpening, b: BodyOpening): boolean {
  return a.startMm < b.endMm && b.startMm < a.endMm;
}

function slideOutInterval(slideOut: SlideOut): BodyOpening {
  return {
    startMm: slideOut.centerMm - slideOut.lengthMm / 2,
    endMm: slideOut.centerMm + slideOut.lengthMm / 2,
  };
}

/**
 * Nearest legal center for a side slide-out, or null when no placement
 * fits. Candidates are the desired center, the body bounds, and the
 * positions adjacent to every blocker (opening or already-placed
 * sibling on the same side); the nearest fitting candidate wins.
 * Rear slide-outs have no center placement (they extend from the rear
 * face), so this returns null for them — the panel and clampToLegal
 * handle rear slide-outs by the at-most-one rule instead.
 */
export function resolveSlideOutCenter(
  desiredMm: number,
  lengthMm: number,
  side: SlideOutSide,
  config: BodyConfig,
  siblings: SlideOut[],
): number | null {
  if (side === 'rear') return null;
  const L = config.lengthMm;
  const minC = -L / 2 + lengthMm / 2 + SLIDE_OUT_END_MARGIN_MM;
  const maxC = L / 2 - lengthMm / 2 - SLIDE_OUT_END_MARGIN_MM;
  if (minC > maxC) return null;
  const blockers: BodyOpening[] = [...sideOpenings(config)];
  for (const sibling of siblings) {
    if (sibling.side === side) blockers.push(slideOutInterval(sibling));
  }
  const fits = (center: number): boolean => {
    if (center < minC || center > maxC) return false;
    const interval: BodyOpening = {
      startMm: center - lengthMm / 2,
      endMm: center + lengthMm / 2,
    };
    return blockers.every((blocker) => !intervalsOverlap(interval, blocker));
  };
  if (fits(desiredMm)) return desiredMm;
  const candidates: number[] = [minC, maxC];
  for (const blocker of blockers) {
    candidates.push(
      blocker.startMm - lengthMm / 2,
      blocker.endMm + lengthMm / 2,
    );
  }
  let best: number | null = null;
  for (const candidate of candidates) {
    if (!fits(candidate)) continue;
    if (
      best === null ||
      Math.abs(candidate - desiredMm) < Math.abs(best - desiredMm)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Repair a slide-out list for a config: trim to the count cap, clamp
 * depth and length, snap each side slide-out to its nearest legal
 * center (dropping it when none exists), and keep at most one rear
 * slide-out (rear slide-outs share one face and have no lateral
 * separation in this model).
 */
export function repairSlideOuts(config: BodyConfig): SlideOut[] {
  const maxLen = Math.max(
    SLIDE_OUT_MIN_LENGTH_MM,
    config.lengthMm - 2 * SLIDE_OUT_END_MARGIN_MM,
  );
  const placed: SlideOut[] = [];
  let rearKept = false;
  for (const slideOut of config.slideOuts.slice(0, SLIDE_OUT_MAX_COUNT)) {
    const depthMm = Math.max(
      SLIDE_OUT_DEPTH_MIN_MM,
      Math.min(slideOut.depthMm, SLIDE_OUT_DEPTH_MAX_MM),
    );
    const lengthMm = Math.max(
      SLIDE_OUT_MIN_LENGTH_MM,
      Math.min(slideOut.lengthMm, SLIDE_OUT_MAX_LENGTH_MM, maxLen),
    );
    if (slideOut.side === 'rear') {
      if (rearKept) continue;
      rearKept = true;
      placed.push({ ...slideOut, depthMm, lengthMm });
      continue;
    }
    const centerMm = resolveSlideOutCenter(
      slideOut.centerMm,
      lengthMm,
      slideOut.side,
      config,
      placed,
    );
    if (centerMm === null) continue;
    placed.push({ ...slideOut, depthMm, lengthMm, centerMm });
  }
  return placed;
}

/**
 * Longitudinal span of the moving pop-up section (mm from the center),
 * or null for fixed roofs. Mirrors the schematic builders: the pop-up
 * canvas covers the middle 60% centered slightly rearward, the
 * split-pop-up raises the front 45% from just behind the front face,
 * and the sloped pop-up pivots the whole roof.
 */
export function popUpSpanMm(config: BodyConfig): [number, number] | null {
  if (!isPopUpRoof(config.roofType)) return null;
  const L = config.lengthMm;
  switch (config.roofType) {
    case 'pop-up':
      return [-0.25 * L, 0.35 * L];
    case 'split-pop-up':
      return [-0.45 * L, 0];
    case 'sloped-pop-up':
      return [-0.5 * L, 0.5 * L];
    default:
      return null;
  }
}

/** True when an open pop-up roof's moving section covers a position. */
export function roofFixtureClashes(
  config: BodyConfig,
  positionMm: number,
): boolean {
  const span = popUpSpanMm(config);
  if (!config.popUpOpen || span === null) return false;
  return positionMm >= span[0] && positionMm <= span[1];
}

/**
 * Nearest roof position outside the open pop-up span, or null when
 * the whole body is covered (sloped pop-up over a short body still
 * leaves the 200 mm end margins, so null is rare).
 */
export function resolveRoofFixturePosition(
  desiredMm: number,
  config: BodyConfig,
): number | null {
  const span = popUpSpanMm(config);
  if (!config.popUpOpen || span === null) return desiredMm;
  const L = config.lengthMm;
  const minP = -L / 2 + SLIDE_OUT_END_MARGIN_MM;
  const maxP = L / 2 - SLIDE_OUT_END_MARGIN_MM;
  const candidates = [span[0] - 1, span[1] + 1];
  let best: number | null = null;
  for (const candidate of candidates) {
    if (candidate < minP || candidate > maxP) continue;
    if (roofFixtureClashes(config, candidate)) continue;
    if (
      best === null ||
      Math.abs(candidate - desiredMm) < Math.abs(best - desiredMm)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** Repair roof fixtures for a config: move clashing ones out, drop the rest. */
export function repairRoofFixtures(config: BodyConfig): RoofFixture[] {
  const repaired: RoofFixture[] = [];
  for (const fixture of config.roofFixtures) {
    if (!roofFixtureClashes(config, fixture.positionMm)) {
      repaired.push(fixture);
      continue;
    }
    const positionMm = resolveRoofFixturePosition(fixture.positionMm, config);
    if (positionMm === null) continue;
    repaired.push({ ...fixture, positionMm });
  }
  return repaired;
}

/**
 * Accessory mount table (scheme doc group 5). Axis x means the panel's
 * position slider moves the item along the body; axis z moves it
 * laterally across its face; fixed items (bull bar) span the face and
 * take no position slider.
 */
export interface AccessoryMeta {
  mount: 'roof' | 'side' | 'rear' | 'front';
  axis: 'x' | 'z' | 'fixed';
}

export const ACCESSORY_META: Record<AccessoryId, AccessoryMeta> = {
  'roof-rack': { mount: 'roof', axis: 'x' },
  ladder: { mount: 'rear', axis: 'z' },
  awning: { mount: 'side', axis: 'x' },
  'bike-rack': { mount: 'rear', axis: 'z' },
  'spare-tire': { mount: 'rear', axis: 'z' },
  'storage-box': { mount: 'roof', axis: 'x' },
  'roof-platform': { mount: 'roof', axis: 'x' },
  snorkel: { mount: 'front', axis: 'x' },
  winch: { mount: 'front', axis: 'z' },
  'bull-bar': { mount: 'front', axis: 'fixed' },
};

/** Slider range for an accessory's position, or null for fixed items. */
export function accessoryPositionRange(
  id: AccessoryId,
  config: BodyConfig,
): { minMm: number; maxMm: number } | null {
  const meta = ACCESSORY_META[id];
  if (meta.axis === 'fixed') return null;
  if (meta.axis === 'z') {
    const half = Math.max(0, config.widthMm / 2 - 300);
    return { minMm: -half, maxMm: half };
  }
  if (id === 'snorkel') {
    return {
      minMm: -config.lengthMm / 2,
      maxMm: -config.lengthMm / 2 + 1000,
    };
  }
  const half = Math.max(0, config.lengthMm / 2 - 300);
  return { minMm: -half, maxMm: half };
}

/** Default position for a newly checked accessory (centered, in range). */
export function defaultAccessoryPosition(
  id: AccessoryId,
  config: BodyConfig,
): number {
  if (id === 'snorkel') return -config.lengthMm / 2 + 500;
  return 0;
}

/** Clamp every accessory position into its range (fixed items to 0). */
export function clampAccessoryPositions(config: BodyConfig): Accessory[] {
  return config.accessories.map((accessory) => {
    const range = accessoryPositionRange(accessory.id, config);
    if (range === null) return { ...accessory, positionMm: 0 };
    return {
      ...accessory,
      positionMm: Math.max(
        range.minMm,
        Math.min(accessory.positionMm, range.maxMm),
      ),
    };
  });
}

/**
 * B-type chassis trio: the three sliders the body-lab panel offers for
 * motorhome B (front overhang, wheelbase, rear overhang). Length is
 * always the trio sum for these configs; registered rows satisfy the
 * same identity (verified figures), and kind defaults use the symmetric
 * split so demo geometry is unchanged.
 */
export interface ChassisTrio {
  frontOverhangMm: number;
  wheelbaseMm: number;
  rearOverhangMm: number;
}

/** Sorted unique announced values per trio dimension. */
export interface AnnouncedChassisPoints {
  wheelbases: number[];
  fronts: number[];
  rears: number[];
}

export function trioOf(config: BodyConfig): ChassisTrio {
  return {
    frontOverhangMm: config.frontOverhangMm,
    wheelbaseMm: config.wheelbaseMm,
    rearOverhangMm: config.rearOverhangMm,
  };
}

export function trioLengthMm(trio: ChassisTrio): number {
  return (
    trio.frontOverhangMm + trio.wheelbaseMm + trio.rearOverhangMm
  );
}

/**
 * Axle positions relative to the body centre (front is -X, matching
 * the scene builders). Front axle sits one front overhang behind the
 * nose; rear axle one rear overhang ahead of the tail.
 */
export function axlePositionsMm(
  lengthMm: number,
  trio: ChassisTrio,
): { frontAxleMm: number; rearAxleMm: number } {
  return {
    frontAxleMm: -lengthMm / 2 + trio.frontOverhangMm,
    rearAxleMm: lengthMm / 2 - trio.rearOverhangMm,
  };
}

/**
 * Nearest announced value; ties go to the smaller point so the snap is
 * deterministic. An empty point set leaves the value untouched.
 */
export function snapToAnnounced(
  value: number,
  points: readonly number[],
): number {
  if (points.length === 0) return value;
  const sorted = [...points].sort((a, b) => a - b);
  let best = sorted[0];
  for (const point of sorted) {
    if (Math.abs(point - value) < Math.abs(best - value)) best = point;
  }
  return best;
}

/** Snap each trio dimension to its own announced point set. */
export function snapChassisTrio(
  trio: ChassisTrio,
  points: AnnouncedChassisPoints,
): ChassisTrio {
  return {
    frontOverhangMm: snapToAnnounced(trio.frontOverhangMm, points.fronts),
    wheelbaseMm: snapToAnnounced(trio.wheelbaseMm, points.wheelbases),
    rearOverhangMm: snapToAnnounced(trio.rearOverhangMm, points.rears),
  };
}

/** Interpolate each trio dimension; t is clamped to [0, 1]. */
export function lerpTrio(
  from: ChassisTrio,
  to: ChassisTrio,
  t: number,
): ChassisTrio {
  const k = Math.min(1, Math.max(0, t));
  return {
    frontOverhangMm:
      from.frontOverhangMm + (to.frontOverhangMm - from.frontOverhangMm) * k,
    wheelbaseMm: from.wheelbaseMm + (to.wheelbaseMm - from.wheelbaseMm) * k,
    rearOverhangMm:
      from.rearOverhangMm + (to.rearOverhangMm - from.rearOverhangMm) * k,
  };
}

/** Cubic ease-out for the trio glide (0 -> 0, 1 -> 1, monotonic). */
export function easeOutCubic(t: number): number {
  const k = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - k, 3);
}

/**
 * Constraint engine (doc section 3). Pure function, fully unit-tested.
 * Blue-plate length/mass lines apply only to blue-plate kinds: A-type
 * buses and towables get an informational note instead, since their
 * management lines differ. The wheelbase rule is skipped for towables
 * (hitch-to-axle, not a wheelbase).
 */
export function checkBodyConstraints(config: BodyConfig): ConstraintResult[] {
  const results: ConstraintResult[] = [];
  if (isTowableKind(config.vehicleKind)) {
    results.push({ level: 'warn', code: 'towable-note' });
  } else if (config.vehicleKind === 'motorhome-a') {
    results.push({ level: 'warn', code: 'yellow-note' });
  } else {
    results.push({
      level: config.lengthMm <= BLUE_PLATE_MAX_LENGTH_MM ? 'pass' : 'fail',
      code:
        config.lengthMm <= BLUE_PLATE_MAX_LENGTH_MM
          ? 'blue-length-ok'
          : 'blue-length-over',
    });
    if (config.estimatedMassKg === null) {
      results.push({ level: 'warn', code: 'mass-unknown' });
    } else {
      results.push({
        level:
          config.estimatedMassKg <= BLUE_PLATE_MAX_MASS_KG ? 'pass' : 'fail',
        code:
          config.estimatedMassKg <= BLUE_PLATE_MAX_MASS_KG
            ? 'mass-ok'
            : 'mass-over',
      });
    }
  }
  results.push({
    level:
      openHeightMm(config) <= ROAD_REFERENCE_MAX_HEIGHT_MM ? 'pass' : 'fail',
    code:
      openHeightMm(config) <= ROAD_REFERENCE_MAX_HEIGHT_MM
        ? 'height-ok'
        : 'height-over',
  });
  if (!isTowableKind(config.vehicleKind)) {
    results.push({
      level:
        config.wheelbaseMm <= config.lengthMm - MIN_TOTAL_OVERHANG_MM
          ? 'pass'
          : 'fail',
      code:
        config.wheelbaseMm <= config.lengthMm - MIN_TOTAL_OVERHANG_MM
          ? 'wheelbase-ok'
          : 'wheelbase-over',
    });
  }
  if (isPopUpRoof(config.roofType)) {
    results.push({
      level:
        config.popUpTravelMm >= 0 &&
        config.popUpTravelMm <= POP_UP_TRAVEL_MAX_MM
          ? 'pass'
          : 'fail',
      code:
        config.popUpTravelMm >= 0 &&
        config.popUpTravelMm <= POP_UP_TRAVEL_MAX_MM
          ? 'travel-ok'
          : 'travel-range',
    });
  }
  if (config.roofType === 'sloped-pop-up') {
    results.push({
      level:
        config.slopedAngleDeg >= SLOPED_ANGLE_MIN_DEG &&
        config.slopedAngleDeg <= SLOPED_ANGLE_MAX_DEG
          ? 'pass'
          : 'fail',
      code:
        config.slopedAngleDeg >= SLOPED_ANGLE_MIN_DEG &&
        config.slopedAngleDeg <= SLOPED_ANGLE_MAX_DEG
          ? 'angle-ok'
          : 'angle-range',
    });
  }
  results.push({
    level: config.widthMm <= MAX_BODY_WIDTH_MM ? 'pass' : 'fail',
    code: config.widthMm <= MAX_BODY_WIDTH_MM ? 'width-ok' : 'width-over',
  });
  // Slice 4: slide-out count, depth, overlap with side openings and
  // same-side siblings, plus the at-most-one rear slide-out rule.
  results.push({
    level: config.slideOuts.length <= SLIDE_OUT_MAX_COUNT ? 'pass' : 'fail',
    code:
      config.slideOuts.length <= SLIDE_OUT_MAX_COUNT
        ? 'slideout-count-ok'
        : 'slideout-count-over',
  });
  const depthBad = config.slideOuts.some(
    (slideOut) =>
      slideOut.depthMm < SLIDE_OUT_DEPTH_MIN_MM ||
      slideOut.depthMm > SLIDE_OUT_DEPTH_MAX_MM,
  );
  results.push({
    level: depthBad ? 'fail' : 'pass',
    code: depthBad ? 'slideout-depth-range' : 'slideout-depth-ok',
  });
  let overlap = false;
  const placed: SlideOut[] = [];
  let rearSeen = false;
  for (const slideOut of config.slideOuts) {
    if (slideOut.side === 'rear') {
      if (rearSeen) overlap = true;
      rearSeen = true;
      continue;
    }
    const interval = slideOutInterval(slideOut);
    if (
      sideOpenings(config).some((opening) =>
        intervalsOverlap(interval, opening),
      )
    ) {
      overlap = true;
    }
    if (
      placed.some(
        (other) =>
          other.side === slideOut.side &&
          intervalsOverlap(interval, slideOutInterval(other)),
      )
    ) {
      overlap = true;
    }
    placed.push(slideOut);
  }
  results.push({
    level: overlap ? 'fail' : 'pass',
    code: overlap ? 'slideout-overlap' : 'slideout-ok',
  });
  const boundsBad = config.slideOuts.some((slideOut) => {
    if (slideOut.side === 'rear') return false;
    const interval = slideOutInterval(slideOut);
    return (
      interval.startMm < -config.lengthMm / 2 + SLIDE_OUT_END_MARGIN_MM ||
      interval.endMm > config.lengthMm / 2 - SLIDE_OUT_END_MARGIN_MM
    );
  });
  results.push({
    level: boundsBad ? 'fail' : 'pass',
    code: boundsBad ? 'slideout-bounds-range' : 'slideout-bounds-ok',
  });
  // Slice 4: roof fixtures against the open pop-up span only; closed
  // roofs and fixed roofs never clash (scheme doc group 3).
  const clash = config.roofFixtures.some((fixture) =>
    roofFixtureClashes(config, fixture.positionMm),
  );
  results.push({
    level: clash ? 'fail' : 'pass',
    code: clash ? 'roof-popup-clash' : 'roof-fixture-ok',
  });
  return results;
}

/** True when every constraint passes (warnings allowed). */
export function constraintsAllowBuild(results: ConstraintResult[]): boolean {
  return results.every((result) => result.level !== 'fail');
}

/**
 * One-tap recovery for the panel's "restore legal values" button.
 * Blue-plate kinds get pulled back to the blue lines; A-type and
 * towable kinds keep their length (their lines differ) and only get
 * road-envelope fixes. Mass stays unknown when it was unknown; open
 * height is fixed by trimming travel.
 */
export function clampToLegal(config: BodyConfig): BodyConfig {
  const towable = isTowableKind(config.vehicleKind);
  const next: BodyConfig = {
    ...config,
    lengthMm: isBluePlateKind(config.vehicleKind)
      ? Math.min(config.lengthMm, BLUE_PLATE_MAX_LENGTH_MM)
      : config.lengthMm,
    widthMm: Math.min(config.widthMm, MAX_BODY_WIDTH_MM),
    wheelbaseMm: towable
      ? Math.max(
          800,
          Math.min(config.wheelbaseMm, TRAILER_HITCH_MM + config.lengthMm),
        )
      : Math.min(config.wheelbaseMm, config.lengthMm - MIN_TOTAL_OVERHANG_MM),
    popUpTravelMm: Math.max(
      0,
      Math.min(config.popUpTravelMm, POP_UP_TRAVEL_MAX_MM),
    ),
    slopedAngleDeg: Math.max(
      SLOPED_ANGLE_MIN_DEG,
      Math.min(config.slopedAngleDeg, SLOPED_ANGLE_MAX_DEG),
    ),
    estimatedMassKg:
      config.estimatedMassKg === null || !isBluePlateKind(config.vehicleKind)
        ? config.estimatedMassKg
        : Math.min(config.estimatedMassKg, BLUE_PLATE_MAX_MASS_KG),
  };
  if (isBluePlateKind(config.vehicleKind)) {
    next.wheelbaseMm = Math.min(
      next.wheelbaseMm,
      next.lengthMm - MIN_TOTAL_OVERHANG_MM,
    );
  }
  if (
    isPopUpRoof(next.roofType) &&
    next.popUpOpen &&
    next.heightMm + next.popUpTravelMm > ROAD_REFERENCE_MAX_HEIGHT_MM
  ) {
    next.popUpTravelMm = Math.max(
      0,
      ROAD_REFERENCE_MAX_HEIGHT_MM - next.heightMm,
    );
  }
  // Slice 4: repair slide-outs, accessory positions and roof fixtures
  // against the (possibly just clamped) body dimensions.
  next.slideOuts = repairSlideOuts(next);
  next.accessories = clampAccessoryPositions(next);
  next.roofFixtures = repairRoofFixtures(next);
  return next;
}

/**
 * Slice 5: repair only user additions (slide-outs, accessories, roof
 * fixtures) without touching body dimensions or mass. Registered
 * models use this for the fix-legal button: announcement dimensions
 * must never be "repaired" away, and a blue-plate over-length on a
 * registered model is informative, not something to clamp.
 */
export function repairAttachments(config: BodyConfig): BodyConfig {
  return {
    ...config,
    slideOuts: repairSlideOuts(config),
    accessories: clampAccessoryPositions(config),
    roofFixtures: repairRoofFixtures(config),
  };
}
