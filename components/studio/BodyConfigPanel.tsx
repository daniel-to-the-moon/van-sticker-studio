'use client';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { t, type Lang, type StringKey } from '@/lib/i18n';
import type {
  Accessory,
  AccessoryId,
  BodyConfig,
  ChassisTrio,
  ConstraintLevel,
  ConstraintResult,
  RoofFixtureKind,
  RoofType,
  SlideOut,
  SlideOutSide,
  VehicleKind,
} from '@/lib/parametric-body';
import {
  MODEL_CATALOG,
  announcedChassisPoints,
} from '@/lib/announcement-db';
import {
  REGISTRY_ENTRIES,
  configForRegisteredModel,
  isModelSelectable,
  registryStatus,
} from '@/lib/announcement-db-data';
import {
  ACCESSORY_META,
  DEFAULT_BODY_CONFIG,
  KIND_DEFAULTS,
  MIN_TOTAL_OVERHANG_MM,
  ROOF_CLOSED_HEIGHT_MM,
  SLIDE_OUT_DEPTH_MAX_MM,
  SLIDE_OUT_DEPTH_MIN_MM,
  SLIDE_OUT_END_MARGIN_MM,
  SLIDE_OUT_MAX_COUNT,
  SLIDE_OUT_MAX_LENGTH_MM,
  SLIDE_OUT_MIN_LENGTH_MM,
  TRAILER_HITCH_MM,
  VEHICLE_ENVELOPES,
  accessoryPositionRange,
  clampAccessoryPositions,
  defaultAccessoryPosition,
  isPopUpRoof,
  isTowableKind,
  openHeightMm,
  repairAttachments,
  repairSlideOuts,
  resolveSlideOutCenter,
  snapChassisTrio,
  trioLengthMm,
  trioOf,
} from '@/lib/parametric-body';

const CONSTRAINT_KEY: Record<string, StringKey> = {
  'blue-length-ok': 'bodylab.cBlueOk',
  'blue-length-over': 'bodylab.cBlueOver',
  'mass-ok': 'bodylab.cMassOk',
  'mass-over': 'bodylab.cMassOver',
  'mass-unknown': 'bodylab.cMassUnknown',
  'height-ok': 'bodylab.cHeightOk',
  'height-over': 'bodylab.cHeightOver',
  'wheelbase-ok': 'bodylab.cWheelbaseOk',
  'wheelbase-over': 'bodylab.cWheelbaseOver',
  'travel-ok': 'bodylab.cTravelOk',
  'travel-range': 'bodylab.cTravelRange',
  'angle-ok': 'bodylab.cAngleOk',
  'angle-range': 'bodylab.cAngleRange',
  'width-ok': 'bodylab.cWidthOk',
  'width-over': 'bodylab.cWidthOver',
  'yellow-note': 'bodylab.cYellowNote',
  'towable-note': 'bodylab.cTowableNote',
  'slideout-count-ok': 'bodylab.cSlideCountOk',
  'slideout-count-over': 'bodylab.cSlideCountOver',
  'slideout-depth-ok': 'bodylab.cSlideDepthOk',
  'slideout-depth-range': 'bodylab.cSlideDepthRange',
  'slideout-ok': 'bodylab.cSlideOk',
  'slideout-overlap': 'bodylab.cSlideOverlap',
  'slideout-bounds-ok': 'bodylab.cSlideBoundsOk',
  'slideout-bounds-range': 'bodylab.cSlideBoundsRange',
  'roof-fixture-ok': 'bodylab.cRoofFixtureOk',
  'roof-popup-clash': 'bodylab.cRoofPopupClash',
};

const SIDE_KEY: Record<SlideOutSide, StringKey> = {
  left: 'bodylab.sideLeft',
  right: 'bodylab.sideRight',
  rear: 'bodylab.sideRear',
};

const ACCESSORY_KEY: Record<AccessoryId, StringKey> = {
  'roof-rack': 'bodylab.accRoofRack',
  ladder: 'bodylab.accLadder',
  awning: 'bodylab.accAwning',
  'bike-rack': 'bodylab.accBikeRack',
  'spare-tire': 'bodylab.accSpareTire',
  'storage-box': 'bodylab.accStorageBox',
  'roof-platform': 'bodylab.accRoofPlatform',
  snorkel: 'bodylab.accSnorkel',
  winch: 'bodylab.accWinch',
  'bull-bar': 'bodylab.accBullBar',
};

const ACCESSORY_IDS: readonly AccessoryId[] = [
  'roof-rack',
  'ladder',
  'awning',
  'bike-rack',
  'spare-tire',
  'storage-box',
  'roof-platform',
  'snorkel',
  'winch',
  'bull-bar',
];

const FIXTURE_KEY: Record<RoofFixtureKind, StringKey> = {
  skylight: 'bodylab.fixtureSkylight',
  vent: 'bodylab.fixtureVent',
  ac: 'bodylab.fixtureAc',
};

const FIXTURE_ADD_KEY: Record<RoofFixtureKind, StringKey> = {
  skylight: 'bodylab.fixtureAddSkylight',
  vent: 'bodylab.fixtureAddVent',
  ac: 'bodylab.fixtureAddAc',
};

const ROOF_KEY: Record<RoofType, StringKey> = {
  flat: 'bodylab.roofFlat',
  low: 'bodylab.roofLow',
  high: 'bodylab.roofHigh',
  'semi-high': 'bodylab.roofSemiHigh',
  'pop-up': 'bodylab.roofPopUp',
  'sloped-pop-up': 'bodylab.roofSlopedPopUp',
  'split-pop-up': 'bodylab.roofSplitPopUp',
};

const KIND_KEY: Record<VehicleKind, StringKey> = {
  'motorhome-a': 'bodylab.kindMotorhomeA',
  'motorhome-b': 'bodylab.kindMotorhomeB',
  'motorhome-c': 'bodylab.kindMotorhomeC',
  'motorhome-t': 'bodylab.kindMotorhomeT',
  'towable-a': 'bodylab.kindTowableA',
  'towable-b': 'bodylab.kindTowableB',
  'towable-c': 'bodylab.kindTowableC',
  'towable-d': 'bodylab.kindTowableD',
  camper: 'bodylab.kindCamper',
  'micro-c': 'bodylab.kindMicroC',
  offroad: 'bodylab.kindOffroad',
};


const LEVEL_ICON: Record<ConstraintLevel, typeof CheckCircle2> = {
  pass: CheckCircle2,
  warn: AlertTriangle,
  fail: XCircle,
};

interface Props {
  lang: Lang;
  config: BodyConfig;
  results: ConstraintResult[];
  onChange: (next: BodyConfig) => void;
  /** Increments every time a slider drag ends; drives the value pop. */
  popKey: number;
  /** Fired when any slider drag ends (pointer or keyboard release). */
  onRelease: () => void;
  /**
   * Fired when a B-type trio slider is released with a snapped value:
   * the page glides the model to it (the plain onRelease bounce still
   * fires separately). Only called when the snapped value differs.
   */
  onSnapRelease: (next: BodyConfig) => void;
  /**
   * Slice 5 registry gate: the selected registered model id, or null
   * for the demo view. Only registered models are selectable; the
   * panel's core dimensions are fixed (demo: prototype defaults,
   * registered: announcement values) and never user-adjustable.
   */
  registeredModelId: string | null;
  onSelectModel: (modelId: string | null) => void;
}

/**
 * Interaction rules (mistake-proofing first, no typed input anywhere):
 * - Every number is a slider whose range comes from the selected kind's
 *   envelope, so out-of-range values cannot be typed or dragged in.
 * - Travel (0-600) and angle (5-25) sliders end exactly at their legal
 *   limits, so those two rules can never fail from this panel.
 * - The wheelbase slider's max follows the length slider, and shrinking
 *   the length auto-clamps the wheelbase, so the wheelbase rule can
 *   never fail from this panel either (towables use hitch-to-axle with
 *   its own dynamic cap instead).
 * - Length / mass sliders for blue-plate kinds deliberately extend past
 *   the blue-plate lines so the warnings stay visible; any fail gets a
 *   one-tap "restore legal values" button.
 * - Switching kind restores that kind's defaults wholesale.
 * - Slice 4: a slide-out edit that would overlap a side door, a window
 *   or a same-side sibling is refused on the spot and snapped to the
 *   nearest legal center; a side change to rear is refused when another
 *   rear slide-out already exists (at most one rear face). Shrinking the
 *   length re-snaps slide-out centers the same way (dropping one only
 *   when no placement fits); roof-fixture clashes are flagged, not
 *   snapped, and the one-tap button repairs them.
 * - Slice 5 (registry gate): the model dropdown is the only selector.
 *   Unregistered models are disabled with a pending label; the kind
 *   buttons follow the selected model and cannot switch kinds. Core
 *   dimensions are never user-adjustable: demo mode shows prototype
 *   defaults, registered mode shows fixed announcement values. The
 *   fix-legal button in registered mode repairs attachments only.
 */
export default function BodyConfigPanel({
  lang,
  config,
  results,
  onChange,
  popKey,
  onRelease,
  onSnapRelease,
  registeredModelId,
  onSelectModel,
}: Props) {
  const env = VEHICLE_ENVELOPES[config.vehicleKind];
  const towable = isTowableKind(config.vehicleKind);
  const set = (patch: Partial<BodyConfig>) =>
    onChange({ ...config, ...patch });
  const setKind = (vehicleKind: VehicleKind) =>
    onChange({ ...KIND_DEFAULTS[vehicleKind] });
  const setRoof = (roofType: RoofType) =>
    set({
      roofType,
      heightMm: Math.min(
        Math.max(ROOF_CLOSED_HEIGHT_MM[roofType], env.heightMinMm),
        env.heightMaxMm,
      ),
    });
  const setLength = (lengthMm: number) => {
    const next: BodyConfig = {
      ...config,
      lengthMm,
      wheelbaseMm: towable
        ? Math.max(
            800,
            Math.min(config.wheelbaseMm, TRAILER_HITCH_MM + lengthMm),
          )
        : Math.min(
            config.wheelbaseMm,
            lengthMm - MIN_TOTAL_OVERHANG_MM,
          ),
    };
    // Shrinking the body re-snaps slide-out centers; one that fits
    // nowhere is dropped rather than left hanging past the body ends.
    next.slideOuts = repairSlideOuts(next);
    onChange(next);
  };
  const setWidth = (widthMm: number) => {
    const next: BodyConfig = { ...config, widthMm };
    next.accessories = clampAccessoryPositions(next);
    onChange(next);
  };
  const setSlideOut = (index: number, patch: Partial<SlideOut>) => {
    const current = config.slideOuts[index];
    if (!current) return;
    const next: SlideOut = { ...current, ...patch };
    const siblings = config.slideOuts.filter((_, i) => i !== index);
    if (next.side === 'rear') {
      // At most one rear slide-out: refuse a second rear face.
      if (siblings.some((sibling) => sibling.side === 'rear')) return;
      set({
        slideOuts: config.slideOuts.map((s, i) => (i === index ? next : s)),
      });
      return;
    }
    const centerMm = resolveSlideOutCenter(
      next.centerMm,
      next.lengthMm,
      next.side,
      config,
      siblings,
    );
    // No legal placement: refuse the edit, keep the previous value.
    if (centerMm === null) return;
    next.centerMm = centerMm;
    set({
      slideOuts: config.slideOuts.map((s, i) => (i === index ? next : s)),
    });
  };
  const addSlideOut = () => {
    if (config.slideOuts.length >= SLIDE_OUT_MAX_COUNT) return;
    const slideOut: SlideOut = {
      side: 'left',
      centerMm: 0,
      lengthMm: 1200,
      depthMm: 500,
    };
    const centerMm = resolveSlideOutCenter(
      slideOut.centerMm,
      slideOut.lengthMm,
      slideOut.side,
      config,
      config.slideOuts,
    );
    if (centerMm !== null) slideOut.centerMm = centerMm;
    set({ slideOuts: [...config.slideOuts, slideOut] });
  };
  const toggleAccessory = (id: AccessoryId) => {
    const existing = config.accessories.find((a) => a.id === id);
    if (existing) {
      set({
        accessories: config.accessories.filter((a) => a.id !== id),
      });
      return;
    }
    const accessory: Accessory = {
      id,
      positionMm: defaultAccessoryPosition(id, config),
    };
    set({ accessories: [...config.accessories, accessory] });
  };
  const setAccessoryPosition = (id: AccessoryId, positionMm: number) =>
    set({
      accessories: config.accessories.map((a) =>
        a.id === id ? { ...a, positionMm } : a,
      ),
    });
  const popUp = isPopUpRoof(config.roofType);
  const wheelbaseMin = towable ? 800 : env.wheelbaseMinMm;
  const wheelbaseMax = towable
    ? TRAILER_HITCH_MM + config.lengthMm
    : Math.min(env.wheelbaseMaxMm, config.lengthMm - MIN_TOTAL_OVERHANG_MM);
  const registered = registeredModelId !== null;
  const status = registryStatus();
  const points = useMemo(
    () => announcedChassisPoints(REGISTRY_ENTRIES),
    [],
  );
  const tabKinds = useMemo(() => {
    const kinds: VehicleKind[] = [];
    for (const model of MODEL_CATALOG) {
      if (!kinds.includes(model.kind)) kinds.push(model.kind);
    }
    return kinds;
  }, []);
  const [tabKind, setTabKind] = useState<VehicleKind>(config.vehicleKind);
  const isB = config.vehicleKind === 'motorhome-b';
  const trio = trioOf(config);
  const trioRange = (values: readonly number[], current: number) => ({
    min: Math.min(values[0] ?? current, current),
    max: Math.max(values[values.length - 1] ?? current, current),
  });
  const wheelbaseRange = trioRange(points.wheelbases, trio.wheelbaseMm);
  const frontRange = trioRange(points.fronts, trio.frontOverhangMm);
  const rearRange = trioRange(points.rears, trio.rearOverhangMm);
  const setTrio = (patch: Partial<ChassisTrio>) => {
    const next = { ...trio, ...patch };
    onChange({ ...config, ...next, lengthMm: trioLengthMm(next) });
  };
  const handleTrioRelease = (dimension: keyof ChassisTrio) => {
    const snapped = snapChassisTrio(trio, points);
    const value = snapped[dimension];
    if (value !== trio[dimension]) {
      const next = { ...trio, [dimension]: value };
      onSnapRelease({ ...config, ...next, lengthMm: trioLengthMm(next) });
    }
    onRelease();
  };
  /**
   * Core dimensions are fixed in registered mode (announcement
   * values) and shown as prototype defaults in demo mode; either way
   * the core fieldset below is disabled, so no slider can move them.
   * The ranges themselves read the registry values when registered.
   */
  const coreWheelbase = registered
    ? { min: config.wheelbaseMm, max: config.wheelbaseMm }
    : { min: wheelbaseMin, max: wheelbaseMax };
  const coreLength = registered
    ? { min: config.lengthMm, max: config.lengthMm }
    : { min: env.lengthMinMm, max: env.lengthMaxMm };
  const coreWidth = registered
    ? { min: config.widthMm, max: config.widthMm }
    : { min: env.widthMinMm, max: env.widthMaxMm };
  const coreHeight = registered
    ? { min: config.heightMm, max: config.heightMm }
    : { min: env.heightMinMm, max: env.heightMaxMm };
  /** Only attachment fails get a fix button in registered mode:
   * announcement dimensions must never be "repaired" away. */
  const attachmentFail = results.some(
    (result) =>
      result.level === 'fail' &&
      (result.code.startsWith('slideout-') ||
        result.code === 'roof-popup-clash'),
  );

  return (
    <article className="insight-card" aria-label={t(lang, 'bodylab.title')}>
      <div className="insight-card-head">
        <h3>{t(lang, 'bodylab.title')}</h3>
      </div>
      <p style={{ fontSize: 13, margin: '0 0 12px' }}>
        {t(lang, 'bodylab.subtitle')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <section>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>
            {t(lang, 'bodylab.model')}
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {tabKinds.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={tabKind === kind}
                onClick={() => {
                  if (registeredModelId !== null) {
                    setTabKind(kind);
                  } else {
                    setTabKind(kind);
                    setKind(kind);
                  }
                }}
                style={toggleStyle(tabKind === kind)}
              >
                {t(lang, KIND_KEY[kind])}
              </button>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              marginTop: 8,
            }}
          >
            <button
              type="button"
              aria-pressed={registeredModelId === null}
              onClick={() => onSelectModel(null)}
              style={toggleStyle(registeredModelId === null)}
            >
              {t(lang, 'bodylab.modelDemo')}
            </button>
            {MODEL_CATALOG.filter((model) => model.kind === tabKind).map(
              (model) => {
                const selectable = isModelSelectable(model.id);
                return (
                  <button
                    key={model.id}
                    type="button"
                    aria-pressed={registeredModelId === model.id}
                    disabled={!selectable}
                    onClick={() => {
                      setTabKind(model.kind);
                      onSelectModel(model.id);
                    }}
                    style={toggleStyle(registeredModelId === model.id)}
                  >
                    {model.name} ·{' '}
                    {t(
                      lang,
                      selectable
                        ? 'bodylab.modelRegistered'
                        : 'bodylab.modelPending',
                    )}
                  </button>
                );
              },
            )}
          </div>
          <p style={{ fontSize: 12, margin: '6px 0 0', opacity: 0.75 }}>
            {t(lang, 'bodylab.registryStatus', {
              complete: status.complete,
              partial: status.partial,
            })}
          </p>
          <p style={{ fontSize: 12, margin: '6px 0 0', opacity: 0.75 }}>
            {t(
              lang,
              registered ? 'bodylab.registeredNote' : 'bodylab.demoNote',
            )}
          </p>
        </section>
        {isB && (
          <section>
            <Slider
              label={t(lang, 'bodylab.wheelbaseMm')}
              value={trio.wheelbaseMm}
              min={wheelbaseRange.min}
              max={wheelbaseRange.max}
              step={5}
              unit="mm"
              popKey={popKey}
              onRelease={() => handleTrioRelease('wheelbaseMm')}
              onPick={(wheelbaseMm) => setTrio({ wheelbaseMm })}
            />
            <Slider
              label={t(lang, 'bodylab.frontOverhang')}
              value={trio.frontOverhangMm}
              min={frontRange.min}
              max={frontRange.max}
              step={5}
              unit="mm"
              popKey={popKey}
              onRelease={() => handleTrioRelease('frontOverhangMm')}
              onPick={(frontOverhangMm) => setTrio({ frontOverhangMm })}
            />
            <Slider
              label={t(lang, 'bodylab.rearOverhang')}
              value={trio.rearOverhangMm}
              min={rearRange.min}
              max={rearRange.max}
              step={5}
              unit="mm"
              popKey={popKey}
              onRelease={() => handleTrioRelease('rearOverhangMm')}
              onPick={(rearOverhangMm) => setTrio({ rearOverhangMm })}
            />
            <p style={{ fontSize: 13, margin: '6px 0 0' }}>
              {t(lang, 'bodylab.lengthDerived', { value: config.lengthMm })}
            </p>
            <p style={{ fontSize: 12, margin: '6px 0 0', opacity: 0.75 }}>
              {t(lang, 'bodylab.snapNote')}
            </p>
          </section>
        )}
        <fieldset
          disabled
          aria-label={t(lang, 'bodylab.fixedCore')}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
        {!isB && (
          <>
        <Slider
          label={
            towable
              ? t(lang, 'bodylab.hitchAxle')
              : t(lang, 'bodylab.wheelbaseMm')
          }
          value={config.wheelbaseMm}
          min={coreWheelbase.min}
          max={coreWheelbase.max}
          step={10}
          unit="mm"
          popKey={popKey}
          onRelease={onRelease}
          onPick={(wheelbaseMm) => set({ wheelbaseMm })}
        />
        <Slider
          label={
            towable ? t(lang, 'bodylab.trailerLength') : t(lang, 'bodylab.length')
          }
          value={config.lengthMm}
          min={coreLength.min}
          max={coreLength.max}
          step={10}
          unit="mm"
          popKey={popKey}
          onRelease={onRelease}
          onPick={setLength}
        />
          </>
        )}
        <Slider
          label={t(lang, 'bodylab.width')}
          value={config.widthMm}
          min={coreWidth.min}
          max={coreWidth.max}
          step={10}
          unit="mm"
          popKey={popKey}
          onRelease={onRelease}
          onPick={setWidth}
        />
        <Slider
          label={t(lang, 'bodylab.height')}
          value={config.heightMm}
          min={coreHeight.min}
          max={coreHeight.max}
          step={10}
          unit="mm"
          popKey={popKey}
          onRelease={onRelease}
          onPick={(heightMm) => set({ heightMm })}
        />
        <section>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>
            {t(lang, 'bodylab.roof')}
          </p>
          <Segmented<RoofType>
            options={(Object.keys(ROOF_KEY) as RoofType[]).map((key) => ({
              value: key,
              label: t(lang, ROOF_KEY[key]),
            }))}
            active={config.roofType}
            onPick={setRoof}
          />
        </section>
        </fieldset>
        <fieldset
          disabled={registeredModelId === null}
          aria-label={t(lang, 'bodylab.travel')}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
        {popUp && (
          <>
            <Slider
              label={t(lang, 'bodylab.travel')}
              value={config.popUpTravelMm}
              min={0}
              max={600}
              step={10}
              unit="mm"
              popKey={popKey}
              onRelease={onRelease}
              onPick={(popUpTravelMm) => set({ popUpTravelMm })}
            />
            <button
              type="button"
              aria-pressed={config.popUpOpen}
              onClick={() => set({ popUpOpen: !config.popUpOpen })}
              style={toggleStyle(config.popUpOpen)}
            >
              {config.popUpOpen
                ? t(lang, 'bodylab.popUpOpen')
                : t(lang, 'bodylab.popUpClosed')}
            </button>
          </>
        )}
        {config.roofType === 'sloped-pop-up' && (
          <Slider
            label={t(lang, 'bodylab.angle')}
            value={config.slopedAngleDeg}
            min={5}
            max={25}
            step={1}
            unit="°"
            popKey={popKey}
            onRelease={onRelease}
            onPick={(slopedAngleDeg) => set({ slopedAngleDeg })}
          />
        )}
        </fieldset>
        <fieldset
          disabled
          aria-label={t(lang, 'bodylab.mass')}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
        <section>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>
            {t(lang, 'bodylab.mass')}
          </p>
          <button
            type="button"
            aria-pressed={config.estimatedMassKg === null}
            onClick={() =>
              set({
                estimatedMassKg:
                  config.estimatedMassKg === null ? 3500 : null,
              })
            }
            style={toggleStyle(config.estimatedMassKg === null)}
          >
            {t(lang, 'bodylab.massUnknown')}
          </button>
          {config.estimatedMassKg !== null && (
            <div style={{ marginTop: 8 }}>
              <Slider
                label=""
                value={config.estimatedMassKg}
                min={env.massMinKg}
                max={env.massMaxKg}
                step={50}
                unit="kg"
                popKey={popKey}
                onRelease={onRelease}
                onPick={(estimatedMassKg) => set({ estimatedMassKg })}
              />
            </div>
          )}
        </section>
        </fieldset>
        <fieldset
          disabled={registeredModelId === null}
          aria-label={t(lang, 'bodylab.slideOuts')}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
        <section>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>
            {t(lang, 'bodylab.slideOuts')} ({config.slideOuts.length}/
            {SLIDE_OUT_MAX_COUNT})
          </p>
          <button
            type="button"
            disabled={config.slideOuts.length >= SLIDE_OUT_MAX_COUNT}
            onClick={addSlideOut}
            style={toggleStyle(false)}
          >
            {t(lang, 'bodylab.slideOutAdd')}
          </button>
          {config.slideOuts.map((slideOut, index) => {
            const centerMin =
              -config.lengthMm / 2 +
              slideOut.lengthMm / 2 +
              SLIDE_OUT_END_MARGIN_MM;
            const centerMax =
              config.lengthMm / 2 -
              slideOut.lengthMm / 2 -
              SLIDE_OUT_END_MARGIN_MM;
            const lengthMax = Math.max(
              SLIDE_OUT_MIN_LENGTH_MM,
              Math.min(
                SLIDE_OUT_MAX_LENGTH_MM,
                config.lengthMm - 2 * SLIDE_OUT_END_MARGIN_MM,
              ),
            );
            return (
              <div
                key={index}
                style={{
                  marginTop: 10,
                  padding: 10,
                  border: '1px solid #c9bba6',
                  borderRadius: 10,
                }}
              >
                <p style={{ fontSize: 13, margin: '0 0 6px' }}>
                  {t(lang, 'bodylab.slideOutSide')}
                </p>
                <Segmented<SlideOutSide>
                  options={(Object.keys(SIDE_KEY) as SlideOutSide[]).map(
                    (key) => ({ value: key, label: t(lang, SIDE_KEY[key]) }),
                  )}
                  active={slideOut.side}
                  onPick={(side) => setSlideOut(index, { side })}
                />
                {slideOut.side !== 'rear' && (
                  <Slider
                    label={t(lang, 'bodylab.slideOutCenter')}
                    value={slideOut.centerMm}
                    min={Math.min(centerMin, centerMax)}
                    max={Math.max(centerMin, centerMax)}
                    step={10}
                    unit="mm"
                    popKey={popKey}
                    onRelease={onRelease}
                    onPick={(centerMm) =>
                      setSlideOut(index, { centerMm })
                    }
                  />
                )}
                <Slider
                  label={t(lang, 'bodylab.slideOutLength')}
                  value={slideOut.lengthMm}
                  min={SLIDE_OUT_MIN_LENGTH_MM}
                  max={lengthMax}
                  step={10}
                  unit="mm"
                  popKey={popKey}
                  onRelease={onRelease}
                  onPick={(lengthMm) => setSlideOut(index, { lengthMm })}
                />
                <Slider
                  label={t(lang, 'bodylab.slideOutDepth')}
                  value={slideOut.depthMm}
                  min={SLIDE_OUT_DEPTH_MIN_MM}
                  max={SLIDE_OUT_DEPTH_MAX_MM}
                  step={10}
                  unit="mm"
                  popKey={popKey}
                  onRelease={onRelease}
                  onPick={(depthMm) => setSlideOut(index, { depthMm })}
                />
                <button
                  type="button"
                  onClick={() =>
                    set({
                      slideOuts: config.slideOuts.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                  style={{ ...toggleStyle(false), marginTop: 8 }}
                >
                  {t(lang, 'bodylab.slideOutRemove')}
                </button>
              </div>
            );
          })}
        </section>
        <section>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>
            {t(lang, 'bodylab.accessories')}
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {ACCESSORY_IDS.map((id) => {
              const active = config.accessories.some((a) => a.id === id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleAccessory(id)}
                  style={toggleStyle(active)}
                >
                  {t(lang, ACCESSORY_KEY[id])}
                </button>
              );
            })}
          </div>
          {config.accessories.map((accessory) => {
            const range = accessoryPositionRange(accessory.id, config);
            if (range === null) return null;
            const lateral = ACCESSORY_META[accessory.id].axis === 'z';
            return (
              <div key={accessory.id} style={{ marginTop: 8 }}>
                <Slider
                  label={`${t(lang, ACCESSORY_KEY[accessory.id])} · ${t(lang, lateral ? 'bodylab.accLateral' : 'bodylab.accPosition')}`}
                  value={accessory.positionMm}
                  min={range.minMm}
                  max={range.maxMm}
                  step={10}
                  unit="mm"
                  popKey={popKey}
                  onRelease={onRelease}
                  onPick={(positionMm) =>
                    setAccessoryPosition(accessory.id, positionMm)
                  }
                />
              </div>
            );
          })}
        </section>
        <section>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>
            {t(lang, 'bodylab.roofFixtures')}
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(Object.keys(FIXTURE_ADD_KEY) as RoofFixtureKind[]).map(
              (kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() =>
                    set({
                      roofFixtures: [
                        ...config.roofFixtures,
                        { kind, positionMm: 0 },
                      ],
                    })
                  }
                  style={toggleStyle(false)}
                >
                  {t(lang, FIXTURE_ADD_KEY[kind])}
                </button>
              ),
            )}
          </div>
          {config.roofFixtures.map((fixture, index) => (
            <div key={index} style={{ marginTop: 8 }}>
              <Slider
                label={`${t(lang, FIXTURE_KEY[fixture.kind])} · ${t(lang, 'bodylab.fixturePosition')}`}
                value={fixture.positionMm}
                min={-config.lengthMm / 2 + SLIDE_OUT_END_MARGIN_MM}
                max={config.lengthMm / 2 - SLIDE_OUT_END_MARGIN_MM}
                step={10}
                unit="mm"
                popKey={popKey}
                onRelease={onRelease}
                onPick={(positionMm) =>
                  set({
                    roofFixtures: config.roofFixtures.map((f, i) =>
                      i === index ? { ...f, positionMm } : f,
                    ),
                  })
                }
              />
              <button
                type="button"
                onClick={() =>
                  set({
                    roofFixtures: config.roofFixtures.filter(
                      (_, i) => i !== index,
                    ),
                  })
                }
                style={{ ...toggleStyle(false), marginTop: 4 }}
              >
                {t(lang, 'bodylab.fixtureRemove')}
              </button>
            </div>
          ))}
        </section>
        </fieldset>
        <p style={{ fontSize: 12, margin: 0, opacity: 0.75 }}>
          {t(lang, 'bodylab.protoNote')}
        </p>
        <p style={{ fontSize: 13, margin: 0 }}>
          {t(lang, 'bodylab.openHeight', {
            value: openHeightMm(config),
          })}
        </p>
        <section aria-label={t(lang, 'bodylab.constraints')}>
          <h4 style={{ margin: '4px 0 8px', fontSize: 14 }}>
            {t(lang, 'bodylab.constraints')}
          </h4>
          <ul
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              margin: 0,
              padding: 0,
              listStyle: 'none',
            }}
          >
            {results.map((result) => {
              const Icon = LEVEL_ICON[result.level];
              return (
                <li
                  key={result.code}
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'flex-start',
                    fontSize: 13,
                  }}
                >
                  <Icon size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{t(lang, CONSTRAINT_KEY[result.code])}</span>
                </li>
              );
            })}
          </ul>
        </section>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {registered && attachmentFail && (
            <button
              type="button"
              onClick={() => onChange(repairAttachments(config))}
              style={{
                padding: '8px 14px',
                borderRadius: 999,
                border: 'none',
                background: '#9e4b4b',
                color: '#fff',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              {t(lang, 'bodylab.fixLegal')}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              onChange(
                registeredModelId !== null
                  ? (configForRegisteredModel(registeredModelId) ?? {
                      ...DEFAULT_BODY_CONFIG,
                    })
                  : { ...DEFAULT_BODY_CONFIG },
              )
            }
            style={{
              padding: '8px 14px',
              borderRadius: 999,
              border: '1px solid #c9bba6',
              background: 'transparent',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {t(lang, 'bodylab.resetDefaults')}
          </button>
        </div>
        <p style={{ fontSize: 12, margin: 0, opacity: 0.75 }}>
          {t(lang, 'bodylab.note')}
        </p>
      </div>
    </article>
  );
}

function toggleStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 999,
    border: active ? 'none' : '1px solid #c9bba6',
    background: active ? '#9e4b4b' : 'transparent',
    color: active ? '#fff' : 'inherit',
    fontSize: 13,
    cursor: 'pointer',
  };
}

function Segmented<T extends string>({
  options,
  active,
  onPick,
}: {
  options: { value: T; label: string }[];
  active: T;
  onPick: (value: T) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === active}
          onClick={() => onPick(option.value)}
          style={toggleStyle(option.value === active)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  popKey,
  onRelease,
  onPick,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  popKey: number;
  onRelease: () => void;
  onPick: (value: number) => void;
}) {
  const safeMax = min === max ? max : Math.max(max, min + step);
  const safeValue = Math.min(Math.max(value, min), safeMax);
  return (
    <section>
      <p
        style={{
          fontSize: 13,
          margin: '0 0 4px',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>{label}</span>
        <strong key={popKey} className="bodylab-pop">
          {safeValue} {unit}
        </strong>
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{min}</span>
        <input
          type="range"
          aria-label={label}
          min={min}
          max={safeMax}
          step={step}
          value={safeValue}
          onChange={(event) => onPick(Number(event.target.value))}
          onPointerUp={onRelease}
          onKeyUp={onRelease}
          style={{ flex: 1, accentColor: '#9e4b4b' }}
        />
        <span style={{ fontSize: 12, opacity: 0.6 }}>{safeMax}</span>
      </div>
    </section>
  );
}
