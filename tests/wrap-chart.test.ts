import test from 'node:test';
import assert from 'node:assert/strict';
import { sidePolygons } from '../lib/wrap-chart.ts';
void test('perimeter seam never creates long polygons across windows', () => {
  const p = sidePolygons(
    [
      { s: 15.9, h: 0.4 },
      { s: 0.1, h: 0.4 },
      { s: 0.1, h: 0.6 },
    ],
    6,
    2,
    'entry',
  );
  assert.equal(p.length, 1);
  assert.ok(p.flat().every((p) => p.x <= 1 && p.x > 0.98));
});
void test('side junction is clipped with an interpolated edge, not discarded', () => {
  const p = sidePolygons(
    [
      { s: 5.9, h: 0.2 },
      { s: 6.1, h: 0.2 },
      { s: 5.9, h: 0.8 },
    ],
    6,
    2,
    'entry',
  );
  assert.ok(p[0].some((p) => p.x === 0));
  assert.ok(p[0].every((p) => p.x >= 0 && p.x <= 1));
});
