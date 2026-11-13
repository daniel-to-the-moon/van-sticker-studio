/** UI side guides from the unchanged closed-pose GLB. Not fabrication drawings. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import rasterizer from 'sharp';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { findFrontWrapTransitions } from '../lib/wrap-eligibility.ts';
import { perimeterCoordinate, circumference } from '../lib/wrap-layout.ts';
import { sketchInk, sketchWash } from './wrap-sketch-ink.ts';
import {
  createSideProjection,
  createEndProjection,
  projectSidePoint,
  liftSideChartTriangle,
} from '../lib/wrap-side-projection.ts';

const sharp = rasterizer as (
  input: Buffer,
  options: { raw: { width: number; height: number; channels: 1 | 4 } },
) => { png: (options?: { palette: boolean; colours: number; dither: number }) => { toBuffer: () => Promise<Buffer> } };

const bytes = fs.readFileSync('public/model/mxgarage-rv.glb'),
  meta = JSON.parse(
    fs.readFileSync('public/model/motion_metadata.json', 'utf8'),
  );
const { scene } = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  '',
);
scene.updateMatrixWorld(true);
const meshes: THREE.Mesh[] = [];
scene.traverseVisible((o) => {
  if (o instanceof THREE.Mesh) meshes.push(o);
});
const bounds = new THREE.Box3();
meshes
  .filter((m) => m.name.startsWith('RV_Static_Wrap_'))
  .forEach((m) => bounds.expandByObject(m, true));
const body = {
  xMin: meta.wrap.xMin,
  length: meta.wrap.xSpan,
  width: meta.dimensionsMeters.width,
  height: meta.wrap.zSpan,
  centerZ: (bounds.min.z + bounds.max.z) / 2,
};
const transitions = findFrontWrapTransitions(meshes);
const frame = createSideProjection(body);
const period = circumference(body);
const endFrame = createEndProjection(body);
const wrapS = (n: number) => ((n % period) + period) % period;
const colorFor = (
  eligible: boolean,
  name: string,
): [number, number, number] =>
  eligible
    ? [0xf3, 0xee, 0xdf]
    : /Glass|Optic/.test(name)
      ? [0xda, 0xe1, 0xe5]
      : /Rubber|Tire|Graphite|Black/.test(name)
        ? [0x4d, 0x53, 0x58]
        : /Chrome/.test(name)
          ? [0xab, 0xb0, 0xb4]
          : [0xe3, 0xe4, 0xdf];

const output: Record<string, unknown> = {
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  aspect: body.length / body.height,
};

for (const [face, axis, sign] of [
  ['entry', 'z', -1],
  ['driver', 'z', 1],
  ['front', 'x', -1],
  ['rear', 'x', 1],
] as const) {
  const endView = axis === 'x';
  const view = endView ? endFrame : frame;
  const WIDTH = endView ? 880 : 2000;
  const HEIGHT = Math.round(WIDTH * view.height / view.width);
  const guide = Buffer.alloc(WIDTH * HEIGHT * 4, 0);
  const mask = Buffer.alloc(WIDTH * HEIGHT, 0);
  const material = new Uint8Array(WIDTH * HEIGHT);
  const depth = new Float64Array(WIDTH * HEIGHT).fill(-Infinity);
  const sMin = { entry: 0, front: body.length, driver: body.length + body.width, rear: 2 * body.length + body.width }[face];
  const sMax = sMin + (endView ? body.width : body.length);

  for (const mesh of meshes) {
    const geo = mesh.geometry,
      pos = geo.getAttribute('position'),
      index = geo.index,
      mats = [mesh.material].flat() as THREE.Material[],
      allWrap = mats.every((m) => m.name.startsWith('Wrap_')),
      triMask = transitions.get(mesh),
      total = index ? index.count : pos.count,
      groups =
        geo.groups && geo.groups.length
          ? geo.groups
          : [{ start: 0, count: total, materialIndex: 0 }];
    const winding = mesh.matrixWorld.determinant() < 0 ? -1 : 1;
    for (const group of groups) {
      const mat = mats[Math.min(group.materialIndex ?? 0, mats.length - 1)];
      if (!mat?.visible || /Interior|Fabric/.test(mat.name)) continue;
      const sketchMaterial = /Glass|Optic/.test(mat.name)
        ? 2
        : /Rubber|Tire|Graphite|Black/.test(mat.name)
          ? 3
          : /Chrome/.test(mat.name) ? 4 : 1;
      const end = Math.min(group.start + group.count, total);
      for (let v = group.start; v + 2 < end; v += 3) {
        const ids = index
          ? [index.getX(v), index.getX(v + 1), index.getX(v + 2)]
          : [v, v + 1, v + 2];
        const pts = ids.map((id) =>
          new THREE.Vector3()
            .fromBufferAttribute(pos, id)
            .applyMatrix4(mesh.matrixWorld),
        );
        const eligible = allWrap || Boolean(triMask?.[v / 3]);
        const normal = pts[1]
          .clone()
          .sub(pts[0])
          .cross(pts[2].clone().sub(pts[0]));
        // The live renderer replaces the glass with a double-sided material.
        const frontFacing = normal[axis] * sign * winding > 0;
        if (
          mat.name !== 'Glass' &&
          ((mat.side === THREE.FrontSide && !frontFacing) ||
            (mat.side === THREE.BackSide && frontFacing))
        )
          continue;
        const nLen = normal.length();
        const shade = nLen > 0 ? 0.78 + 0.22 * Math.abs(normal[axis] / nLen) : 1;
        const base = colorFor(eligible, mat.name);
        const r = Math.round(base[0] * shade),
          g = Math.round(base[1] * shade),
          b = Math.round(base[2] * shade);
        const lifted = liftSideChartTriangle(
          pts.map((p) => perimeterCoordinate(p.x, p.z, body)) as [
            number,
            number,
            number,
          ],
          period,
        );
        const px = pts.map((p) => {
          const n = projectSidePoint(view, endView ? p.z : p.x, p.y);
          return { x: (face === 'rear' ? 1 - n.x : n.x) * WIDTH, y: n.y * HEIGHT };
        });
        const area =
          (px[1].x - px[0].x) * (px[2].y - px[0].y) -
          (px[1].y - px[0].y) * (px[2].x - px[0].x);
        if (area === 0) continue;
        const minX = Math.max(
          0,
          Math.floor(Math.min(px[0].x, px[1].x, px[2].x)),
        );
        const maxX = Math.min(
          WIDTH - 1,
          Math.ceil(Math.max(px[0].x, px[1].x, px[2].x)),
        );
        const minY = Math.max(
          0,
          Math.floor(Math.min(px[0].y, px[1].y, px[2].y)),
        );
        const maxY = Math.min(
          HEIGHT - 1,
          Math.ceil(Math.max(px[0].y, px[1].y, px[2].y)),
        );
        if (minX > maxX || minY > maxY) continue;
        for (let y = minY; y <= maxY; y++) {
          const cy = y + 0.5;
          for (let x = minX; x <= maxX; x++) {
            const cx = x + 0.5;
            const w0 =
              (px[2].x - px[1].x) * (cy - px[1].y) -
              (px[2].y - px[1].y) * (cx - px[1].x);
            const w1 =
              (px[0].x - px[2].x) * (cy - px[2].y) -
              (px[0].y - px[2].y) * (cx - px[2].x);
            const w2 = area - w0 - w1;
            if (
              area > 0
                ? w0 < 0 || w1 < 0 || w2 < 0
                : w0 > 0 || w1 > 0 || w2 > 0
            )
              continue;
            const l0 = w0 / area,
              l1 = w1 / area,
              l2 = w2 / area;
            const z = l0 * pts[0][axis] + l1 * pts[1][axis] + l2 * pts[2][axis];
            const score = z * sign;
            const idx = y * WIDTH + x;
            if (score <= depth[idx]) continue;
            depth[idx] = score;
            const o = idx * 4;
            guide[o] = r;
            guide[o + 1] = g;
            guide[o + 2] = b;
            guide[o + 3] = 255;
            material[idx] = sketchMaterial;
            const s = wrapS(
              l0 * lifted[0] + l1 * lifted[1] + l2 * lifted[2],
            );
            mask[idx] = eligible && s >= sMin && s <= sMax ? 255 : 0;
          }
        }
      }
    }
  }

  const sketchPng = async (pixels: Buffer) =>
    'data:image/png;base64,' +
    (await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
      .png({ palette: true, colours: 96, dither: 0 })
      .toBuffer()).toString('base64');
  output[face] = {
    image:
      'data:image/png;base64,' +
      (
        await sharp(guide, {
          raw: { width: WIDTH, height: HEIGHT, channels: 4 },
        })
          .png()
          .toBuffer()
      ).toString('base64'),
    mask:
      'data:image/png;base64,' +
      (
        await sharp(mask, {
          raw: { width: WIDTH, height: HEIGHT, channels: 1 },
        })
          .png()
          .toBuffer()
      ).toString('base64'),
    wash: await sketchPng(sketchWash(material, depth, WIDTH, HEIGHT)),
    ink: await sketchPng(sketchInk(material, WIDTH, HEIGHT)),
  };
}

fs.writeFileSync('lib/wrap-guides.json', JSON.stringify(output));
console.log(
  `Generated ${fs.statSync('lib/wrap-guides.json').size} bytes; same GLB, same chart, depth-tested orthographic projection shared with the editor.`,
);
