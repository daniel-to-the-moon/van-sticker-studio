/**
 * Announcement registry gate (Slice 5, 入库制) — pure logic.
 *
 * Rule (scheme doc section 5, confirmed 2026-10-24): the panel only
 * opens registered models. Unregistered models show greyed out as
 * pending and cannot be selected; prototype envelopes must no longer
 * let an unregistered model through. Prototype placeholders survive
 * only as the demo view's default state, labelled as non-announcement.
 *
 * The shipped rows live in announcement-db.json (imported by
 * announcement-db-data.ts, which binds them to the helpers below).
 * This module stays JSON-free so it runs under node --test, which
 * rejects bare JSON imports; tests read the JSON file with fs and
 * run the same helpers over it.
 *
 * HOW TO OPEN A NEW MODEL (no panel code change):
 * 1. Add one entry to announcement-db.json with status "complete",
 *    every REQUIRED_REGISTRY_FIELDS present as a number, plus
 *    announcement_model, announcement_batch and source.
 * 2. Add the model to MODEL_CATALOG below with its kind. Catalog
 *    entries carry names only, never figures.
 * The dropdown enables the model automatically. Partial rows stay
 * visible but disabled. A new variant (other wheelbase / roof) is a
 * new entry with its own id; never stretch one row across variants.
 */
import {
  KIND_DEFAULTS,
  type AnnouncedChassisPoints,
  type BodyConfig,
  type VehicleKind,
} from './parametric-body.ts';

export interface RegistryVerified {
  length_mm?: number;
  width_mm?: number;
  height_mm?: number;
  wheelbase_mm?: number;
  front_overhang_mm?: number;
  rear_overhang_mm?: number;
  gross_mass_kg?: number;
}

export interface RegistryEntry {
  id: string;
  name: string;
  announcement_model: string;
  announcement_batch: number;
  chassis_model: string;
  status: 'complete' | 'partial';
  verified: RegistryVerified;
  source: string;
  source_url: string;
  notes: string;
}

/** Every field a row needs before its model becomes selectable. */
export const REQUIRED_REGISTRY_FIELDS: (keyof Required<RegistryVerified>)[] = [
  'length_mm',
  'width_mm',
  'height_mm',
  'wheelbase_mm',
  'front_overhang_mm',
  'rear_overhang_mm',
  'gross_mass_kg',
];

/** A row is selectable only when every required field is verified. */
export function isEntryComplete(entry: RegistryEntry): boolean {
  return REQUIRED_REGISTRY_FIELDS.every(
    (field) =>
      typeof entry.verified[field] === 'number' &&
      Number.isFinite(entry.verified[field]),
  );
}

export interface CatalogModel {
  id: string;
  name: string;
  kind: VehicleKind;
}

/**
 * Model catalog (scheme doc section 5 preset library). Names and
 * kinds only — this table carries no dimensions; dimensions live
 * exclusively in announcement-db.json.
 */
export const MODEL_CATALOG: readonly CatalogModel[] = [
  { id: 'motorhome-b-01', name: 'B 型房车 01', kind: 'motorhome-b' },
  { id: 'motorhome-b-02', name: 'B 型房车 02', kind: 'motorhome-b' },
  { id: 'motorhome-b-03', name: 'B 型房车 03', kind: 'motorhome-b' },
  { id: 'motorhome-b-04', name: 'B 型房车 04', kind: 'motorhome-b' },
  { id: 'motorhome-b-05', name: 'B 型房车 05', kind: 'motorhome-b' },
  { id: 'motorhome-b-06', name: 'B 型房车 06', kind: 'motorhome-b' },
  { id: 'motorhome-b-07', name: 'B 型房车 07', kind: 'motorhome-b' },
  { id: 'motorhome-b-08', name: 'B 型房车 08', kind: 'motorhome-b' },
  { id: 'motorhome-b-09', name: 'B 型房车 09', kind: 'motorhome-b' },
  { id: 'motorhome-c-01', name: 'C 型房车 01', kind: 'motorhome-c' },
  { id: 'motorhome-c-02', name: 'C 型房车 02', kind: 'motorhome-c' },
  { id: 'motorhome-c-03', name: 'C 型房车 03', kind: 'motorhome-c' },
  { id: 'motorhome-c-04', name: 'C 型房车 04', kind: 'motorhome-c' },
  { id: 'motorhome-t-01', name: '皮卡房车 01', kind: 'motorhome-t' },
  { id: 'motorhome-t-02', name: '皮卡房车 02', kind: 'motorhome-t' },
  { id: 'motorhome-t-03', name: '皮卡房车 03', kind: 'motorhome-t' },
  { id: 'motorhome-t-04', name: '皮卡房车 04', kind: 'motorhome-t' },
  { id: 'motorhome-t-05', name: '皮卡房车 05', kind: 'motorhome-t' },
  { id: 'motorhome-t-06', name: '皮卡房车 06', kind: 'motorhome-t' },
  { id: 'motorhome-t-07', name: '皮卡房车 07', kind: 'motorhome-t' },
  { id: 'motorhome-a-01', name: '大客车房车 01', kind: 'motorhome-a' },
  { id: 'motorhome-a-02', name: '大客车房车 02', kind: 'motorhome-a' },
  { id: 'motorhome-a-03', name: '大客车房车 03', kind: 'motorhome-a' },
  { id: 'motorhome-a-04', name: '大客车房车 04', kind: 'motorhome-a' },
  { id: 'micro-c-01', name: '微卡房车 01', kind: 'micro-c' },
  { id: 'micro-c-02', name: '微卡房车 02', kind: 'micro-c' },
  { id: 'offroad-01', name: '越野房车 01', kind: 'offroad' },
  { id: 'offroad-02', name: '越野房车 02', kind: 'offroad' },
  { id: 'offroad-03', name: '越野房车 03', kind: 'offroad' },
  { id: 'offroad-04', name: '越野房车 04', kind: 'offroad' },
  // MIIT v4 complete variant rows (2026-10-25): one entry per height
  // option of the 8 single-length bus announcements. Height is the only
  // multi field for these models, so each row is a genuine variant, not
  // a pairing invented across fields. IDs match announcement-db.json.
  {
    id: 'sh6601h4db-s-h2525',
    name: 'SH6601H4DB-S（高2525mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6601h4db-s-h2740',
    name: 'SH6601H4DB-S（高2740mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6601h4db-s-h2480',
    name: 'SH6601H4DB-S（高2480mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6601h4db-s-h2700',
    name: 'SH6601H4DB-S（高2700mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6591h4db-h2735',
    name: 'SH6591H4DB（高2735mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6591h4db-h2520',
    name: 'SH6591H4DB（高2520mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6592h4db-h2740',
    name: 'SH6592H4DB（高2740mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6592h4db-h2525',
    name: 'SH6592H4DB（高2525mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6601h4db-ns-h2525',
    name: 'SH6601H4DB-NS（高2525mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6601h4db-ns-h2740',
    name: 'SH6601H4DB-NS（高2740mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6601h4db-ns-h2700',
    name: 'SH6601H4DB-NS（高2700mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6601h4db-ns-h2480',
    name: 'SH6601H4DB-NS（高2480mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6591h4db-ns-h2525',
    name: 'SH6591H4DB-NS（高2525mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6591h4db-ns-h2740',
    name: 'SH6591H4DB-NS（高2740mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6591h4db-ns-h2480',
    name: 'SH6591H4DB-NS（高2480mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6591h4db-ns-h2700',
    name: 'SH6591H4DB-NS（高2700mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6591h4db-s-h2525',
    name: 'SH6591H4DB-S（高2525mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6591h4db-s-h2740',
    name: 'SH6591H4DB-S（高2740mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6591h4db-s-h2480',
    name: 'SH6591H4DB-S（高2480mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6591h4db-s-h2700',
    name: 'SH6591H4DB-S（高2700mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6601a4db-h2372',
    name: 'SH6601A4DB（高2372mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6601a4db-h2577',
    name: 'SH6601A4DB（高2577mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6601a4db-n-h2372',
    name: 'SH6601A4DB-N（高2372mm变体）',
    kind: 'motorhome-b',
  },
  {
    id: 'sh6601a4db-n-h2577',
    name: 'SH6601A4DB-N（高2577mm变体）',
    kind: 'motorhome-b',
  },
];

export function entryForModel(
  entries: readonly RegistryEntry[],
  modelId: string,
): RegistryEntry | undefined {
  return entries.find((entry) => entry.id === modelId);
}

export function isModelSelectableIn(
  entries: readonly RegistryEntry[],
  modelId: string,
): boolean {
  const entry = entryForModel(entries, modelId);
  return entry !== undefined && isEntryComplete(entry);
}

export function registryStatusOf(entries: readonly RegistryEntry[]): {
  complete: number;
  partial: number;
} {
  let complete = 0;
  let partial = 0;
  for (const entry of entries) {
    if (isEntryComplete(entry)) complete += 1;
    else partial += 1;
  }
  return { complete, partial };
}

/**
 * Build a config for a registry row, or null when the row is not
 * complete. Core dimensions and total mass come from the row; roof
 * and wheelbase class fall back to the kind's defaults (schematic
 * defaults, not announcement claims — a row is one variant, other
 * variants need their own rows). Attachments start empty.
 */
export function configForEntry(
  model: CatalogModel,
  entry: RegistryEntry,
): BodyConfig | null {
  if (!isEntryComplete(entry)) return null;
  const verified = entry.verified;
  const base = KIND_DEFAULTS[model.kind];
  return {
    ...base,
    vehicleKind: model.kind,
    chassis: entry.announcement_model,
    lengthMm: verified.length_mm as number,
    widthMm: verified.width_mm as number,
    heightMm: verified.height_mm as number,
    wheelbaseMm: verified.wheelbase_mm as number,
    frontOverhangMm: verified.front_overhang_mm as number,
    rearOverhangMm: verified.rear_overhang_mm as number,
    estimatedMassKg: verified.gross_mass_kg as number,
    slideOuts: [],
    accessories: [],
    roofFixtures: [],
  };
}

export function configForModelIn(
  entries: readonly RegistryEntry[],
  modelId: string,
): BodyConfig | null {
  const model = MODEL_CATALOG.find((candidate) => candidate.id === modelId);
  if (model === undefined) return null;
  const entry = entryForModel(entries, modelId);
  if (entry === undefined) return null;
  return configForEntry(model, entry);
}

/**
 * Announced snap points per trio dimension, from complete rows only.
 * Partial rows never contribute (their figures are unverified), so a
 * new complete row updates the snap sets with no code change.
 */
export function announcedChassisPoints(
  entries: readonly RegistryEntry[],
): AnnouncedChassisPoints {
  const wheelbases = new Set<number>();
  const fronts = new Set<number>();
  const rears = new Set<number>();
  for (const entry of entries) {
    if (!isEntryComplete(entry)) continue;
    wheelbases.add(entry.verified.wheelbase_mm as number);
    fronts.add(entry.verified.front_overhang_mm as number);
    rears.add(entry.verified.rear_overhang_mm as number);
  }
  const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);
  return {
    wheelbases: sorted(wheelbases),
    fronts: sorted(fronts),
    rears: sorted(rears),
  };
}
