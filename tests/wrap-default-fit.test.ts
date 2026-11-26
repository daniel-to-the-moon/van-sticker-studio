import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decalRect,
  fitDecalOnFilm,
  measureCoverage,
  rectOnFilm,
  type ChartRect,
} from '../lib/wrap-default-fit.ts';
import { constrainDecal } from '../lib/wrap-layout.ts';

const BODY = { xMin: -2.85, length: 5.8, width: 2.22, height: 3.05 };
const PERIOD = 2 * (BODY.length + BODY.width);
const FACE = { s0: BODY.length + BODY.width, s1: 2 * BODY.length + BODY.width };
const WINDOW: ChartRect = { s0: FACE.s0, s1: FACE.s1, h0: 0, h1: BODY.height };

/** Two triangles per axis-aligned rectangle of film. */
function quad(s0: number, s1: number, h0: number, h1: number) {
  return [
    [s0, h0, s1, h0, s1, h1],
    [s0, h0, s1, h1, s0, h1],
  ];
}

/** Film band 0.5–1.55 m on the side face, with a wheel arch cut out. */
function sideWithArch() {
  return [
    ...quad(FACE.s0, 12.5, 0.5, 1.55),
    ...quad(12.5, 13.2, 0.8, 1.55),
    ...quad(13.2, FACE.s1, 0.5, 1.55),
  ];
}

const LEGACY = {
  center: BODY.length + BODY.width + 1 - BODY.xMin,
  height: 1.28,
  scale: 1,
};

void test('coverage accepts a rectangle on film and rejects one crossing its edge', () => {
  const c = measureCoverage(quad(9, 12, 0.5, 1.5), PERIOD, WINDOW);
  assert.equal(rectOnFilm(c, { s0: 9.5, s1: 11.5, h0: 0.6, h1: 1.4 }), true);
  assert.equal(rectOnFilm(c, { s0: 9.5, s1: 11.5, h0: 0.6, h1: 1.6 }), false);
  assert.equal(rectOnFilm(c, { s0: 8.5, s1: 11.5, h0: 0.6, h1: 1.4 }), false);
});

void test('coverage finds a hole between two film pieces', () => {
  const c = measureCoverage(
    [...quad(9, 10.5, 0.5, 1.5), ...quad(10.6, 12, 0.5, 1.5)],
    PERIOD,
    WINDOW,
  );
  assert.equal(rectOnFilm(c, { s0: 9.2, s1: 10.4, h0: 0.6, h1: 1.4 }), true);
  assert.equal(rectOnFilm(c, { s0: 9.2, s1: 11.8, h0: 0.6, h1: 1.4 }), false);
});

void test('coverage brings a triangle stored one period away next to the window', () => {
  const shifted = quad(9, 12, 0.5, 1.5).map((t) =>
    t.map((v, i) => (i % 2 === 0 ? v + PERIOD : v)),
  );
  const c = measureCoverage(shifted, PERIOD, WINDOW);
  assert.equal(rectOnFilm(c, { s0: 9.5, s1: 11.5, h0: 0.6, h1: 1.4 }), true);
});

void test('a rectangle outside the measured window is never on film', () => {
  const c = measureCoverage(quad(9, 12, 0.5, 1.5), PERIOD, {
    s0: 9.5,
    s1: 11.5,
    h0: 0,
    h1: 3,
  });
  assert.equal(rectOnFilm(c, { s0: 9, s1: 11, h0: 0.6, h1: 1.4 }), false);
});

void test('a default that already sits on film is kept exactly', () => {
  const c = measureCoverage(quad(FACE.s0, FACE.s1, 0, 3), PERIOD, WINDOW);
  const aspect = 2.8;
  const fit = fitDecalOnFilm(LEGACY, aspect, BODY, c, FACE);
  assert.equal(fit.fits, true);
  assert.deepEqual(fit.placement, constrainDecal(LEGACY, aspect, BODY));
});

void test('a tall default is refit so the whole image lies on the band and clears the arch', () => {
  const tris = sideWithArch();
  const c = measureCoverage(tris, PERIOD, WINDOW);
  const aspect = 2098 / 749;
  const before = constrainDecal(LEGACY, aspect, BODY);
  assert.equal(
    rectOnFilm(c, decalRect(before, aspect)),
    false,
    'the legacy driver default crosses the top of the band',
  );
  const fit = fitDecalOnFilm(LEGACY, aspect, BODY, c, FACE);
  assert.equal(fit.fits, true);
  const r = decalRect(fit.placement, aspect);
  assert.ok(r.h0 >= 0.5 && r.h1 <= 1.55, `height ${r.h0}–${r.h1}`);
  assert.ok(
    r.s1 <= 12.5 || r.s0 >= 13.2 || r.h0 >= 0.8,
    `image ${r.s0}–${r.s1} must not overlap the arch cut-out`,
  );
  assert.ok(r.s0 >= FACE.s0 && r.s1 <= FACE.s1, 'stays on the driver face');
  assert.ok(fit.placement.scale < 1 && fit.placement.scale >= 0.25);
  assert.deepEqual(
    constrainDecal(fit.placement, aspect, BODY),
    fit.placement,
    'the editor sync must not move the fitted default',
  );
});

void test('nothing one step larger fits anywhere within reach (brute force)', () => {
  const c = measureCoverage(sideWithArch(), PERIOD, WINDOW);
  const aspect = 2.8;
  const fit = fitDecalOnFilm(LEGACY, aspect, BODY, c, FACE);
  assert.equal(fit.fits, true);
  const scale = fit.placement.scale + 0.01;
  for (let dc = -100; dc <= 100; dc++)
    for (let h = 0; h <= 305; h++) {
      const p = { center: LEGACY.center + dc * 0.01, height: h * 0.01, scale };
      const r = decalRect(p, aspect);
      if (r.s0 < FACE.s0 || r.s1 > FACE.s1) continue;
      assert.equal(rectOnFilm(c, r), false, JSON.stringify(p));
    }
  assert.ok(Math.abs(fit.placement.center - LEGACY.center) <= 1 + 1e-9);
});

void test('no film at all keeps the requested default and reports the miss', () => {
  const c = measureCoverage([], PERIOD, WINDOW);
  const aspect = 2.8;
  const fit = fitDecalOnFilm(LEGACY, aspect, BODY, c, FACE);
  assert.equal(fit.fits, false);
  assert.deepEqual(fit.placement, constrainDecal(LEGACY, aspect, BODY));
});

void test('film too thin for the minimum scale reports the miss instead of stretching', () => {
  const c = measureCoverage(quad(FACE.s0, FACE.s1, 1, 1.1), PERIOD, WINDOW);
  const fit = fitDecalOnFilm(LEGACY, 2.8, BODY, c, FACE);
  assert.equal(fit.fits, false);
});
