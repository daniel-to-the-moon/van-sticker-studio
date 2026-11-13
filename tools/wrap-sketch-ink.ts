function noise(x: number, y: number) {
  const value = Math.imul(x ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  return ((value ^ (value >>> 15)) >>> 0) / 0xffffffff;
}

/** A pass of a broad nib: uneven spacing, dry edges, and tapered ends. */
function markerPass(x: number, y: number, slope: number, spacing: number, seed: number) {
  const across = y + x * slope + Math.sin(x / 39 + seed) * 1.4;
  const row = Math.floor(across / spacing);
  const offset = across - row * spacing;
  const edge = (noise(row, seed) - 0.5) * 3.5;
  const distance = Math.abs(offset - spacing / 2 - edge);
  const radius = spacing * (0.31 + noise(row, seed + 1) * 0.16);
  const run = 94 + noise(row, seed + 2) * 127;
  const along = x + noise(row, seed + 3) * run;
  const segment = Math.floor(along / run);
  const progress = along / run - segment;
  const taper = Math.min(1, progress * 9, (1 - progress) * 9);
  const tooth = noise(Math.floor(x * 1.6), Math.floor(y * 1.6));
  if (distance > radius * (0.7 + 0.3 * taper) + (tooth - 0.5) * 1.6) return 0;
  const rim = distance > radius * 0.73 ? 0.19 : 0;
  return (0.36 + noise(row, segment + seed) * 0.54 + rim) *
    (0.48 + 0.52 * taper) * (0.55 + 0.45 * tooth);
}

/** Wash the lower edges and recesses of the visible projection, with dry paper between passes. */
export function sketchWash(material: Uint8Array, depth: Float64Array, width: number, height: number) {
  const wash = Buffer.alloc(width * height * 4);
  const scale = height / 550;
  const sideView = width > height;
  let left = width, right = 0, ground = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!material[y * width + x]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      ground = y;
    }
  }
  const reach = Math.ceil(46 * scale);
  const probes = [4, 9, 17, 29, 44].map((n) => {
    const distance = Math.ceil(n * scale);
    return {
      distance,
      offset: Math.round(distance * 0.25),
      penumbra: Math.ceil(distance * 0.4),
      strength: 1 - distance / reach,
    };
  });
  const side = Math.max(1, (right - left) * 0.045);
  for (let y = reach; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      const surface = material[i];
      let shade = 0;
      if (surface) {
        for (const { distance, offset, penumbra, strength } of probes) {
          const row = (y - distance) * width;
          const center = x - offset;
          const threshold = depth[i] + 0.052;
          const coverage =
            Number(center - penumbra >= 0 && depth[row + center - penumbra] > threshold) +
            Number(center >= 0 && depth[row + center] > threshold) +
            Number(center + penumbra >= 0 && center + penumbra < width && depth[row + center + penumbra] > threshold);
          shade = Math.max(shade, 0.86 * coverage / 3 * strength);
          const below = material[(y + distance) * width + x];
          if (surface === 1 && (below === 0 || below === 3))
            shade = Math.max(shade, 0.78 * strength);
        }
        const lowerBody = Math.max(0, (y / ground - 0.53) / 0.47);
        shade = Math.max(shade, surface === 3 ? 0.45 : surface === 2 ? 0.15 : lowerBody * 0.34);
      } else if (y > ground - reach * 0.25 && y < ground + reach * 0.7) {
        const horizontal = Math.min(1, Math.max(0, Math.min(x - left + side, right + side - x) / (side * 1.8)));
        const nearGround = Math.max(0, 1 - Math.abs(y - ground) / (reach * 0.7));
        shade = horizontal * nearGround * 0.56;
      }
      if (shade < 0.075) continue;
      const u = x / scale, v = y / scale;
      const main = markerPass(u, v, sideView ? 0.21 : -0.12, 11, 23);
      const cross = shade > 0.31 ? markerPass(u, v, -0.35, 13, 71) : 0;
      const tooth = noise(x, y);
      const alpha = shade * (10 + main * 145 + cross * 72) * (0.68 + tooth * 0.32);
      if (alpha < 3) continue;
      const tone = Math.min(1, cross * 0.6 + (surface === 2 ? 0.47 : 0));
      wash.set([Math.round(116 - tone * 34), Math.round(88 - tone * 10), Math.round(63 + tone * 37), Math.round(alpha)], i * 4);
    }
  }
  return wash;
}

/** Keep the shape legible with a soft retraced outline and paper grain. */
export function sketchInk(material: Uint8Array, width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 4);
  const step = Math.max(2, Math.round(height / 430));
  const trace = new Uint8Array(material.length);
  for (let y = step; y < height - step; y++) {
    for (let x = step; x < width - step; x++) {
      const i = y * width + x;
      const center = material[i];
      if (!center) continue;
      const near = [material[i - step], material[i + step], material[i - step * width], material[i + step * width]];
      trace[i] = near.includes(0) ? 2 : near.some((mark) => mark !== center) ? 1 : 0;
    }
  }

  for (let y = step + 4; y < height - step - 4; y++) {
    for (let x = step + 4; x < width - step - 4; x++) {
      const i = y * width + x;
      const edge = trace[i];
      const grain = noise(x, y);
      const wobble = Math.round(Math.sin(x / 32 + y / 39) * 2);
      const repeat = trace[(y - step - wobble) * width + x - step];
      const pressure = 0.8 + 0.16 * Math.sin(x / 41 - y / 51) + grain * 0.18;
      const opacity = edge ? (edge === 2 ? 189 : 117) * pressure : repeat ? 43 * pressure : 0;
      if (opacity < 3) continue;
      pixels.set([49, 43, 40, Math.round(opacity)], i * 4);
    }
  }
  return pixels;
}
