import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import rasterizer from 'sharp';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FRONT_ART_BOX } from '../lib/free-wrap.ts';
import {
  createSideProjection,
  liftSideChartTriangle,
  projectSidePoint,
} from '../lib/wrap-side-projection.ts';

const guides = JSON.parse(fs.readFileSync('lib/wrap-guides.json', 'utf8'));
const metadata = JSON.parse(
  fs.readFileSync('public/model/motion_metadata.json', 'utf8'),
);
const glb = fs.readFileSync('public/model/mxgarage-rv.glb');
const body = {
  xMin: metadata.wrap.xMin,
  length: metadata.wrap.xSpan,
  height: metadata.wrap.zSpan,
};
const frame = createSideProjection(body);
const sides = ['entry', 'driver'] as const;

type Raster = {
  data: Buffer;
  info: { width: number; height: number; channels: number };
};
const sharp = rasterizer as (input: Buffer) => {
  ensureAlpha: () => {
    raw: () => {
      toBuffer: (options: { resolveWithObject: true }) => Promise<Raster>;
    };
  };
};

function decode(uri: string) {
  return sharp(Buffer.from(uri.split(',')[1], 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}

function pixel(raster: Raster, x: number, y: number) {
  const { width, height, channels } = raster.info;
  const offset = (Math.floor(y * height) * width + Math.floor(x * width)) * channels;
  return raster.data.subarray(offset, offset + channels);
}

void test('side guides belong to the same unchanged production model', () => {
  assert.equal(guides.sha256, crypto.createHash('sha256').update(glb).digest('hex'));
  assert.equal(guides.aspect, body.length / body.height);
});

void test('both side images and masks have the R13 physical aspect ratio', async () => {
  for (const side of sides) {
    for (const asset of ['image', 'mask']) {
      const { info: { width, height } } = await decode(guides[side][asset]);
      assert.equal(height, Math.round(width * frame.height / frame.width));
    }
  }
});

void test('R13 front art starts in the paintable strip below the windshield', async () => {
  const mask = await decode(guides.front.mask);
  let paintable = 0;
  for (let j = 0; j < 20; j++) {
    for (let i = 0; i < 20; i++) {
      const { x, y, w, h } = FRONT_ART_BOX;
      if (pixel(mask, x + (i + 0.5) * w / 20, y + (j + 0.5) * h / 20)[0] === 255) paintable++;
    }
  }
  assert.ok(paintable > 320, 'most of the initial frame must be paintable');
  const front = await decode(guides.front.ink);
  const rear = await decode(guides.rear.ink);
  assert.deepEqual(front.info, rear.info);
  assert.ok(Math.abs(front.info.width / front.info.height - 2.22 / 3.05) < .001);
});

void test('both actual R13 side silhouettes have transparent margin on all four edges', async () => {
  for (const side of sides) {
    const { data, info } = await decode(guides[side].image);
    const margin = 12;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (x < margin || y < margin || x >= info.width - margin || y >= info.height - margin)
          assert.equal(data[(y * info.width + x) * info.channels + 3], 0, side + ' has silhouette pixels in the frame margin');
  }
});

void test('closed-pose window and entrance-door glass align with the exclusion mask on both sides', async () => {
  const { scene } = await new GLTFLoader().parseAsync(
    glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
    '',
  );
  scene.updateMatrixWorld(true);
  const glazing = {
    entry: ['EntryDoor', 'Window_1', 'Window_2', 'Window_6'],
    driver: ['Window_3', 'Window_4', 'Window_5'],
  };
  for (const side of sides) {
    const image = await decode(guides[side].image);
    const mask = await decode(guides[side].mask);
    for (const name of glazing[side]) {
      const mesh = scene.getObjectByName('RV_WebRig_' + name + '_Glass');
      assert.ok(mesh, name);
      const center = new Box3().setFromObject(mesh, true).getCenter(new Vector3());
      const { x, y } = projectSidePoint(frame, center.x, center.y);
      const color = pixel(image, x, y);
      assert.equal(color[3], 255, name + ' is visible in the guide');
      assert.ok(color[2] > color[0], name + ' uses the glass color');
      assert.ok(pixel(mask, x, y)[0] < 10, name + ' must stay unpainted');
    }
    const hull = projectSidePoint(frame, 1.4, 1.2);
    assert.ok(pixel(mask, hull.x, hull.y)[0] > 245, side + ' hull must accept film');
  }
});

void test('the R13 projection preserves physical proportions and chart seam lifting', () => {
  const topNose = projectSidePoint(frame, body.xMin, body.height);
  const rearGround = projectSidePoint(frame, body.xMin + body.length, 0);
  assert.ok(topNose.x > 0 && topNose.x < rearGround.x && rearGround.x < 1);
  assert.ok(topNose.y > 0 && topNose.y < rearGround.y && rearGround.y < 1);
  assert.ok(Math.abs(frame.width / frame.height - guides.aspect) < 1e-10);
  assert.deepEqual(liftSideChartTriangle([1, 15, 14], 16), [17, 15, 14]);
  assert.deepEqual(liftSideChartTriangle([4, 5, 6], 16), [4, 5, 6]);
});
