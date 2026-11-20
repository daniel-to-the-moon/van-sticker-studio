#!/usr/bin/env node
/**
 * Before/after screenshot comparison without dependencies.
 *
 *   node e2e/compare-shots.mjs <baseDir> <headDir> <outDir>
 *
 * For every <name>.png in either directory, decodes both PNGs, counts pixels
 * whose largest channel difference exceeds TOLERANCE, writes
 * <outDir>/<name>.diff.png (head in grey, changed pixels in red), and writes
 * <outDir>/summary.md and <outDir>/result.json. Always exits 0 unless the
 * inputs are unreadable: a visual change is evidence for review, not a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

export const TOLERANCE = 24;
export const SAME_RATIO = 0.001;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode an 8-bit, non-interlaced PNG (grey, grey+alpha, RGB or RGBA) to RGBA.
 * @param {Buffer} buffer
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      const depth = chunk[8];
      colorType = chunk[9];
      if (depth !== 8 || chunk[12] !== 0) throw new Error('only 8-bit non-interlaced PNG');
    } else if (type === 'IDAT') idat.push(chunk);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? pixels[row + x - channels] : 0;
      const b = y > 0 ? pixels[row - stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[row - stride + x - channels] : 0;
      const predictor =
        filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
      if (filter > 4) throw new Error(`bad filter ${filter}`);
      pixels[row + x] = (line[x] + predictor) & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    const grey = channels <= 2;
    data[i * 4] = pixels[s];
    data[i * 4 + 1] = grey ? pixels[s] : pixels[s + 1];
    data[i * 4 + 2] = grey ? pixels[s] : pixels[s + 2];
    data[i * 4 + 3] = channels === 4 ? pixels[s + 3] : channels === 2 ? pixels[s + 1] : 255;
  }
  return { width, height, data };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/**
 * Encode RGBA pixels as PNG, applying one filter type (0–4) to every row.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} rgba
 * @param {number} [filter]
 */
export function encodePng(width, height, rgba, filter = 0) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x += 1) {
      const v = rgba[y * stride + x];
      const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      const predictor =
        filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
      raw[y * (stride + 1) + 1 + x] = (v - predictor) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * @param {{ width: number, height: number, data: Uint8Array }} a
 * @param {{ width: number, height: number, data: Uint8Array }} b
 * @param {number} [tolerance]
 */
export function diffImages(a, b, tolerance = TOLERANCE) {
  if (a.width !== b.width || a.height !== b.height)
    return { changed: a.width * a.height, ratio: 1, sizeChanged: true, diff: null };
  const diff = new Uint8Array(b.data.length);
  let changed = 0;
  for (let i = 0; i < b.data.length; i += 4) {
    const delta = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
      Math.abs(a.data[i + 3] - b.data[i + 3]),
    );
    if (delta > tolerance) {
      changed += 1;
      diff.set([255, 0, 0, 255], i);
    } else {
      const grey = (b.data[i] * 0.3 + b.data[i + 1] * 0.59 + b.data[i + 2] * 0.11) * 0.35 + 160;
      diff.set([grey, grey, grey, 255], i);
    }
  }
  return { changed, ratio: changed / (b.width * b.height), sizeChanged: false, diff };
}

/** @param {{ name: string, status: string, ratio: number }[]} views */
export function classify(views) {
  const visual = views.filter((v) => v.status !== 'same');
  return { noVisualChange: views.length > 0 && visual.length === 0, changed: visual.map((v) => v.name) };
}

/** @param {{ name: string, status: string, ratio: number }[]} views */
export function renderSummary(views) {
  const { noVisualChange } = classify(views);
  const pct = (r) => `${(r * 100).toFixed(2)}%`;
  return [
    `### 前后截图对比：${noVisualChange ? '无可见变化' : '有可见变化，需体验官看图'}`,
    '',
    '| 视图 | 结果 | 变化像素 |',
    '| --- | --- | --- |',
    ...views.map((v) => `| ${v.name} | ${{ same: '相同', changed: '有变化', added: '新增', removed: '消失', 'size-changed': '尺寸变化' }[v.status]} | ${pct(v.ratio)} |`),
    '',
    `> 阈值：单像素通道差 > ${TOLERANCE} 记为变化；整图变化 ≤ ${pct(SAME_RATIO)} 记为相同。前后图与差异图在 artifact 里。`,
  ].join('\n');
}

export function compareDirs(baseDir, headDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const list = (dir) =>
    fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png') && !f.endsWith('.diff.png')) : [];
  const names = [...new Set([...list(baseDir), ...list(headDir)])].sort();
  const views = [];
  for (const file of names) {
    const name = file.replace(/\.png$/, '');
    const basePath = path.join(baseDir, file);
    const headPath = path.join(headDir, file);
    if (!fs.existsSync(basePath)) {
      views.push({ name, status: 'added', ratio: 1 });
      continue;
    }
    if (!fs.existsSync(headPath)) {
      views.push({ name, status: 'removed', ratio: 1 });
      continue;
    }
    const before = decodePng(fs.readFileSync(basePath));
    const after = decodePng(fs.readFileSync(headPath));
    const result = diffImages(before, after);
    if (result.diff) fs.writeFileSync(path.join(outDir, `${name}.diff.png`), encodePng(after.width, after.height, result.diff));
    views.push({
      name,
      status: result.sizeChanged ? 'size-changed' : result.ratio <= SAME_RATIO ? 'same' : 'changed',
      ratio: result.ratio,
    });
  }
  const summary = renderSummary(views);
  fs.writeFileSync(path.join(outDir, 'summary.md'), `${summary}\n`);
  fs.writeFileSync(path.join(outDir, 'result.json'), `${JSON.stringify({ views, ...classify(views) }, null, 2)}\n`);
  return { views, summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [baseDir, headDir, outDir] = process.argv.slice(2);
  if (!baseDir || !headDir || !outDir) {
    console.error('usage: compare-shots.mjs <baseDir> <headDir> <outDir>');
    process.exit(2);
  }
  console.log(compareDirs(baseDir, headDir, outDir).summary);
}
