/** UI side guides from the unchanged closed-pose GLB. Not fabrication drawings. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import rasterizer from 'sharp';
const sharp = rasterizer as (input: Buffer) => {
  png: () => { toBuffer: () => Promise<Buffer> };
};
if (typeof sharp !== 'function')
  throw new Error('Installed image renderer is unavailable');
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { findFrontWrapTransitions } from '../lib/wrap-eligibility.ts';
import { perimeterCoordinate } from '../lib/wrap-layout.ts';
import { sidePolygons } from '../lib/wrap-chart.ts';
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
scene.traverse((o) => {
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
const output: Record<string, unknown> = {
  sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  aspect: body.length / body.height,
};
for (const [side, sign] of [
  ['entry', -1],
  ['driver', 1],
] as const) {
  const faces: { z: number; path: string; color: string; eligible: boolean }[] =
    [];
  for (const mesh of meshes) {
    const mats = [mesh.material].flat(),
      mat = mats[0];
    if (/Interior|Fabric/.test(mat.name)) continue;
    const wrap = mats.every((m) => m.name.startsWith('Wrap_')),
      mask = transitions.get(mesh),
      geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry,
      pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i += 3) {
      const pts = [0, 1, 2].map((j) =>
        new THREE.Vector3()
          .fromBufferAttribute(pos, i + j)
          .applyMatrix4(mesh.matrixWorld),
      );
      const n = pts[1]
        .clone()
        .sub(pts[0])
        .cross(pts[2].clone().sub(pts[0]))
        .normalize();
      if (n.z * sign < 0.15) continue;
      const z = pts.reduce((v, p) => v + p.z, 0) / 3;
      if ((z - body.centerZ) * sign < -0.05) continue;
      const eligible = wrap || Boolean(mask?.[i / 3]);
      const color = eligible
        ? '#f3eedf'
        : /Glass|Optic/.test(mat.name)
          ? '#dae1e5'
          : /Rubber|Tire|Graphite|Black/.test(mat.name)
            ? '#4d5358'
            : /Chrome/.test(mat.name)
              ? '#abb0b4'
              : '#e3e4df';
      for (const polygon of sidePolygons(
        pts.map((p) => ({
          s: perimeterCoordinate(p.x, p.z, body),
          h: 1 - p.y / body.height,
        })),
        body.length,
        body.width,
        side,
      )) {
        const path =
          'M' +
          polygon
            .map((p) => `${(p.x * 1000).toFixed(2)},${(p.y * 400).toFixed(2)}`)
            .join('L') +
          'Z';
        faces.push({ z, path, color, eligible });
      }
    }
    if (geo !== mesh.geometry) geo.dispose();
  }
  faces.sort((a, b) => sign * (a.z - b.z));
  const svg = (mask: boolean) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="800" viewBox="0 0 1000 400">${mask ? '<rect width="1000" height="400" fill="black"/>' : ''}${faces.map((f) => `<path d="${f.path}" fill="${mask ? (f.eligible ? 'white' : 'black') : f.color}"/>`).join('')}</svg>`;
  output[side] = {
    image:
      'data:image/png;base64,' +
      (
        await sharp(Buffer.from(svg(false)))
          .png()
          .toBuffer()
      ).toString('base64'),
    mask:
      'data:image/png;base64,' +
      (
        await sharp(Buffer.from(svg(true)))
          .png()
          .toBuffer()
      ).toString('base64'),
  };
}
fs.writeFileSync('lib/wrap-guides.json', JSON.stringify(output));
console.log(
  `Generated ${fs.statSync('lib/wrap-guides.json').size} bytes; same GLB, same chart, seam-clipped and occlusion-aware.`,
);
