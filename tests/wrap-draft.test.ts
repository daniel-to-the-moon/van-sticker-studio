import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addLayer,
  editLayer,
  emptyProject,
  newLayer,
  parseProject,
  setLinked,
} from '../lib/free-wrap.ts';
import { parseDraft, serializeDraft } from '../lib/wrap-draft.ts';

const image = 'data:image/png;base64,' + 'A'.repeat(400);
function imageProject(src = image) {
  const layer = newLayer('image', 'logo');
  layer.entry!.src = src;
  return addLayer(emptyProject(), layer, 'entry');
}

void test('reads existing plain version-one drafts without changing their data', () => {
  const p = addLayer({ ...emptyProject(), version: 1 }, newLayer('text', 'sign'), 'driver');
  assert.deepEqual(parseDraft(JSON.stringify(p)), p);
});

void test('stores one copy of an image shared across linked sides and layers', () => {
  const p = addLayer(
    imageProject(),
    {
      ...newLayer('image', 'another'),
      entry: {
        ...newLayer('image', 'another').entry!,
        src: image,
      },
    },
    'driver',
  );
  const original = structuredClone(p);
  const encoded = serializeDraft(p);
  assert.equal(encoded.split(image).length - 1, 1);
  assert.ok(encoded.length < JSON.stringify(p).length);
  assert.deepEqual(parseDraft(encoded), p);
  assert.deepEqual(
    p,
    original,
    'serialization must not alter the editable project',
  );
});

void test('round trips split sides, independent images, null sides, and linked flags', () => {
  let p = setLinked(imageProject(), 'logo', 'entry', false);
  p = editLayer(p, 'logo', 'driver', {
    x: 0.2,
    src: 'data:image/webp;base64,BBBB',
  });
  p = addLayer(p, newLayer('text', 'single'), 'entry', false);
  const read = parseDraft(serializeDraft(p));
  assert.deepEqual(read, p);
  assert.equal(read.layers[0].linked, false);
  assert.equal(read.layers[1].driver, null);
  assert.notEqual(read.layers[0].entry!.src, read.layers[0].driver!.src);
});

void test('local encoding does not change portable plain version-one exports', () => {
  const p = parseDraft(serializeDraft({ ...imageProject(), version: 1 }));
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  assert.equal(p.version, 1);
  assert.equal(p.layers[0].entry!.src, image);
});

void test('validates editable projects before serializing them', () => {
  const p = imageProject();
  p.layers[0].entry!.src = 'https://example.com/logo.png';
  assert.throws(() => serializeDraft(p));
});

function envelope() {
  const p = imageProject();
  return {
    storageVersion: 1,
    assets: [image],
    project: {
      ...p,
      layers: p.layers.map((l) => ({
        ...l,
        entry: { ...l.entry!, src: { asset: 0 } },
        driver: { ...l.driver!, src: { asset: 0 } },
      })),
    },
  };
}

void test('rejects invalid, missing, fractional, negative and extra-field resource references', () => {
  for (const reference of [
    { asset: 1 },
    { asset: -1 },
    { asset: 0.5 },
    { asset: '0' },
    { asset: 0, extra: true },
    {},
    null,
  ]) {
    const e = envelope();
    Object.assign(e.project.layers[0].entry!, { src: reference });
    assert.throws(
      () => parseDraft(JSON.stringify(e)),
      JSON.stringify(reference),
    );
  }
});

void test('rejects unsafe or oversized image resources and too many resources', () => {
  for (const assets of [
    ['https://example.com/logo.png'],
    ['data:image/svg+xml;base64,AAAA'],
    ['data:image/png;base64,not base64'],
    ['data:image/png;base64,' + 'A'.repeat(2_000_000)],
    Array.from({ length: 161 }, () => image),
    [null],
  ]) {
    assert.throws(() => parseDraft(JSON.stringify({ ...envelope(), assets })));
  }
});

void test('rejects unsupported storage formats and encoded payloads beyond the input limit', () => {
  for (const invalid of [
    null,
    [],
    { ...envelope(), storageVersion: 2 },
    { ...envelope(), assets: {} },
    { ...envelope(), project: null },
  ]) {
    assert.throws(() => parseDraft(JSON.stringify(invalid)));
  }
  assert.throws(() => parseDraft(' '.repeat(8_000_001)));
});

void test('compact storage cannot bypass the decoded project size limit', () => {
  const e = envelope();
  e.assets = ['data:image/png;base64,' + 'A'.repeat(1_100_000)];
  e.project.layers = Array.from({ length: 4 }, (_, i) => ({
    ...e.project.layers[0],
    id: `large-${i}`,
  }));
  const encoded = JSON.stringify(e);
  assert.ok(encoded.length < 2_000_000);
  assert.throws(() => parseDraft(encoded), /8 MB/);
});

void test('expanded projects still enforce linked equality and existing geometry validation', () => {
  const unequal = envelope();
  unequal.project.layers[0].driver!.x = 0.7;
  assert.throws(() => parseDraft(JSON.stringify(unequal)));
  const geometry = envelope();
  geometry.project.layers[0].entry!.w = -1;
  geometry.project.layers[0].driver!.w = -1;
  assert.throws(() => parseDraft(JSON.stringify(geometry)));
  const duplicate = envelope();
  duplicate.project.layers.push(duplicate.project.layers[0]);
  assert.throws(() => parseDraft(JSON.stringify(duplicate)));
});

void test('new R13 drafts use a distinct projection from saved perimeter drafts', () => {
  const legacy = { ...imageProject(), version: 1 as const };
  legacy.layers[0].entry!.x = legacy.layers[0].driver!.x = 0.929;
  assert.deepEqual(parseDraft(JSON.stringify(legacy)), legacy);
  assert.deepEqual(parseDraft(serializeDraft(legacy)), legacy);

  const projected = imageProject();
  assert.equal(projected.version, 2);
  assert.deepEqual(parseProject(JSON.stringify(projected)), projected);
  assert.deepEqual(parseDraft(serializeDraft(projected)), projected);
});

void test('front and rear artwork round trips without mirroring to another face', () => {
  const p = addLayer(emptyProject(), newLayer('image', 'front-sign'), 'front');
  assert.equal(p.layers[0].linked, false);
  assert.equal(p.layers[0].entry, null);
  assert.equal(p.layers[0].driver, null);
  assert.equal(p.layers[0].rear, undefined);
  const edit = editLayer(p, 'front-sign', 'front', { src: image });
  const bothEnds = addLayer(edit, newLayer('text', 'rear-sign'), 'rear');
  assert.deepEqual(parseDraft(serializeDraft(bothEnds)), bothEnds);
  assert.equal(bothEnds.layers[1].front, undefined);
  assert.throws(() => parseProject(JSON.stringify({
    ...edit, layers: [{ ...edit.layers[0], linked: true }],
  })));
});

void test('a new driver-side marker uses the supplied drawing, not the template copy', () => {
  const marker = newLayer('stroke', 'driver-marker');
  marker.entry!.points = [{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.5 }];
  const p = addLayer(emptyProject(), marker, 'driver', false);
  assert.deepEqual(p.layers[0].driver?.points, marker.entry!.points);
  assert.equal(p.layers[0].entry, null);
});
