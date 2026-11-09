import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import rasterizer from 'sharp';
const sharp = rasterizer as (input: Buffer) => {
  removeAlpha: () => {
    raw: () => {
      toBuffer: (options: {
        resolveWithObject: true;
      }) => Promise<{
        data: Buffer;
        info: { width: number; channels: number };
      }>;
    };
  };
};
const guides = JSON.parse(fs.readFileSync('lib/wrap-guides.json', 'utf8'));
void test('side guides belong to the same unchanged production model', () => {
  assert.equal(
    guides.sha256,
    crypto
      .createHash('sha256')
      .update(fs.readFileSync('public/model/mxgarage-rv.glb'))
      .digest('hex'),
  );
});
void test('window and entrance-door glass remain outside the generated paint mask', async () => {
  const { data, info } = await sharp(
    Buffer.from(guides.entry.mask.split(',')[1], 'base64'),
  )
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (const [x, y] of [
    [915, 125.2],
    [727.8, 125.2],
    [567.5, 173.2],
  ]) {
    const at =
      (Math.round(y * 2) * info.width + Math.round(x * 2)) * info.channels;
    assert.ok(data[at] < 10, `glass ${x},${y} must stay masked`);
  }
});
