import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  classify,
  compareDirs,
  decodePng,
  diffImages,
  encodePng,
  renderSummary,
} from '../e2e/compare-shots.mjs';

function gradient(width: number, height: number, shift = 0): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data.set([(x * 17 + shift) & 0xff, (y * 29) & 0xff, (x * y + 7) & 0xff, 255], i);
    }
  return data;
}

void test('PNG round-trips through every row filter', () => {
  const pixels = gradient(13, 9);
  for (const filter of [0, 1, 2, 3, 4]) {
    const decoded = decodePng(encodePng(13, 9, pixels, filter));
    assert.equal(decoded.width, 13);
    assert.equal(decoded.height, 9);
    assert.deepEqual(Array.from(decoded.data), Array.from(pixels), `filter ${filter}`);
  }
});

void test('non-PNG input is rejected', () => {
  assert.throws(() => decodePng(Buffer.from('not an image')), /not a PNG/);
});

void test('diff counts only pixels beyond the tolerance', () => {
  const a = { width: 4, height: 1, data: new Uint8Array([10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255]) };
  const b = { width: 4, height: 1, data: new Uint8Array([10, 10, 10, 255, 30, 10, 10, 255, 200, 10, 10, 255, 10, 10, 10, 255]) };
  const result = diffImages(a, b, 24);
  assert.equal(result.changed, 1);
  assert.equal(result.ratio, 0.25);
  assert.deepEqual(Array.from(result.diff?.subarray(8, 12) ?? []), [255, 0, 0, 255]);
  assert.equal(diffImages(a, { ...b, width: 2, height: 2 }).sizeChanged, true);
});

void test('a directory pair reports same, changed, added and removed views', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vss-shots-'));
  const base = path.join(root, 'base');
  const head = path.join(root, 'head');
  const out = path.join(root, 'out');
  fs.mkdirSync(base);
  fs.mkdirSync(head);
  const png = (shift: number) => encodePng(20, 20, gradient(20, 20, shift), 4);
  fs.writeFileSync(path.join(base, 'home.png'), png(0));
  fs.writeFileSync(path.join(head, 'home.png'), png(0));
  fs.writeFileSync(path.join(base, 'design.png'), png(0));
  fs.writeFileSync(path.join(head, 'design.png'), png(120));
  fs.writeFileSync(path.join(head, 'model-lab.png'), png(0));
  fs.writeFileSync(path.join(base, 'old.png'), png(0));
  const { views } = compareDirs(base, head, out);
  assert.deepEqual(
    views.map((v: { name: string; status: string }) => `${v.name}:${v.status}`),
    ['design:changed', 'home:same', 'model-lab:added', 'old:removed'],
  );
  assert.ok(fs.existsSync(path.join(out, 'design.diff.png')));
  const result = JSON.parse(fs.readFileSync(path.join(out, 'result.json'), 'utf8'));
  assert.equal(result.noVisualChange, false);
  assert.deepEqual(result.changed, ['design', 'model-lab', 'old']);
});

void test('only an all-same set counts as no visual change', () => {
  assert.equal(classify([{ name: 'a', status: 'same', ratio: 0 }]).noVisualChange, true);
  assert.equal(classify([]).noVisualChange, false);
  assert.equal(
    classify([
      { name: 'a', status: 'same', ratio: 0 },
      { name: 'b', status: 'changed', ratio: 0.2 },
    ]).noVisualChange,
    false,
  );
  assert.match(renderSummary([{ name: 'b', status: 'changed', ratio: 0.2 }]), /需体验官看图[\s\S]*20\.00%/);
});
