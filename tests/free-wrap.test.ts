import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProject,
  addLayer,
  editLayer,
  setLinked,
  removeLayer,
  history,
  commit,
  undo,
  redo,
  parseProject,
  tidy,
  regionPoints,
  svgDocument,
  shortcut,
  newLayer,
} from '../lib/free-wrap.ts';

void test('linked editing, explicit single side, relink and atomic undo', () => {
  let p = addLayer(emptyProject(), newLayer('text', 'a'), 'entry');
  p = editLayer(p, 'a', 'driver', { text: 'Coffee', x: 0.4 });
  assert.deepEqual(p.layers[0].entry, p.layers[0].driver);
  p = setLinked(p, 'a', 'entry', false);
  p = editLayer(p, 'a', 'entry', { x: 0.2 });
  assert.equal(p.layers[0].driver?.x, 0.4);
  const h = commit(history(p), setLinked(p, 'a', 'entry', true));
  assert.equal(h.present.layers[0].driver?.x, 0.2);
  assert.equal(undo(h).present.layers[0].driver?.x, 0.4);
  assert.equal(redo(undo(h)).present.layers[0].driver?.x, 0.2);
});
void test('new single-side objects do not appear on the other side; delete is undoable', () => {
  const p = addLayer(emptyProject(), newLayer('icon', 'cup'), 'driver', false);
  assert.equal(p.layers[0].entry, null);
  assert.equal(
    undo(commit(history(p), removeLayer(p, 'cup'))).present.layers.length,
    1,
  );
});
void test('import roundtrip and unsafe / excessive data rejected', () => {
  const p = addLayer(emptyProject(), newLayer('text', 'a'), 'entry');
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  assert.throws(() => parseProject('{"version":2,"layers":[]}'));
  assert.throws(() =>
    parseProject(JSON.stringify({ ...p, layers: [p.layers[0], p.layers[0]] })),
  );
  const unsafe = structuredClone(p);
  unsafe.layers[0].entry!.x = Infinity;
  assert.throws(() => parseProject(JSON.stringify(unsafe)));
});
void test('boundary cleanup preserves endpoints and corners; ambiguous line is rejected', () => {
  const points = Array.from({ length: 101 }, (_, i) => ({
    x: i / 100,
    y: 0.5 + Math.sin(i) * 0.001,
  }));
  const clean = tidy(points);
  assert.ok(clean.length < 10);
  assert.deepEqual(clean[0], points[0]);
  assert.deepEqual(clean.at(-1), points.at(-1));
  const region = regionPoints(clean, 'below');
  assert.ok(region.some((p) => p.y === 1));
  assert.throws(() =>
    regionPoints(
      [
        { x: 0.4, y: 0.4 },
        { x: 0.41, y: 0.41 },
      ],
      'below',
    ),
  );
  assert.throws(() =>
    regionPoints(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        { x: 0, y: 0 },
      ],
      'closed',
    ),
  );
});
void test('SVG escapes text and never mirrors opposite-side text', () => {
  let p = addLayer(emptyProject(), newLayer('text', 'a'), 'entry');
  p = editLayer(p, 'a', 'entry', { text: '<script>& "Coffee"' });
  const a = svgDocument(p, 'entry'),
    b = svgDocument(p, 'driver');
  assert.equal(a, b);
  assert.ok(a.includes('&lt;script&gt;'));
  assert.ok(!b.includes('scale(-1'));
});
void test('PC shortcuts work on canvas and never consume text-field editing', () => {
  assert.equal(shortcut('z', true, false, false), 'undo');
  assert.equal(shortcut('z', true, true, false), 'redo');
  assert.equal(shortcut('Delete', false, false, false), 'delete');
  assert.equal(shortcut('Escape', false, false, false), 'cancel');
  assert.equal(shortcut('z', true, false, true), null);
  assert.equal(shortcut('Backspace', false, false, true), null);
});

void test('surface entry reflects placement but keeps text glyphs readable', () => {
  let p = addLayer(emptyProject(), newLayer('text', 'a'), 'entry');
  p = editLayer(p, 'a', 'entry', { x: 0.1, w: 0.2, text: 'Readable' });
  const svg = svgDocument(p, 'entry', true);
  assert.ok(svg.includes('translate(700'));
  assert.ok(svg.includes('Readable'));
  assert.ok(!svg.includes('scale(-'));
});

void test('single-side deletion preserves opposite artwork and undo restores both', () => {
  let p = addLayer(emptyProject(), newLayer('icon', 'cup'), 'entry');
  p = setLinked(p, 'cup', 'entry', false);
  const next = removeLayer(p, 'cup', 'entry');
  assert.equal(next.layers[0].entry, null);
  assert.ok(next.layers[0].driver);
  assert.deepEqual(undo(commit(history(p), next)).present, p);
});
void test('locked objects reject transform/content edits but can unlock', () => {
  let p = addLayer(emptyProject(), newLayer('text', 'a'), 'entry');
  p = editLayer(p, 'a', 'entry', { locked: true });
  assert.deepEqual(editLayer(p, 'a', 'entry', { x: 0.8, text: 'changed' }), p);
  assert.equal(
    editLayer(p, 'a', 'entry', { locked: false }).layers[0].driver?.locked,
    false,
  );
});
void test('project resource limit applies before history accepts an unopenable draft', () => {
  const p = emptyProject();
  p.background = 'not-a-color';
  assert.throws(() => commit(history(emptyProject()), p));
});

void test('relink cannot overwrite a locked opposite side', () => {
  let p = addLayer(emptyProject(), newLayer('text', 'a'), 'entry');
  p = setLinked(p, 'a', 'entry', false);
  p = editLayer(p, 'a', 'entry', { locked: true });
  p = editLayer(p, 'a', 'driver', { text: 'Other' });
  assert.deepEqual(setLinked(p, 'a', 'driver', true), p);
});
