function noise(x: number, y: number) {
  const value = Math.imul(x ^ 0x5bd1e995, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1);
  return ((value ^ (value >>> 15)) >>> 0) / 0xffffffff;
}

/** Broken pencil lines. Pressure and width ease into each stroke and fall away at its end. */
function pencilHatch(x: number, y: number, slope: number, spacing: number, seed: number) {
  const across = y + x * slope + Math.sin(x / 37 + seed) * 0.68;
  const line = Math.floor(across / spacing);
  const jitter = (noise(line, seed) - 0.5) * spacing * 0.47;
  const distance = Math.abs(across - (line + 0.5) * spacing - jitter);
  if (distance > 1.65) return 0;
  const length = 15 + noise(line, seed + 1) * 44;
  const along = x + noise(line, seed + 2) * length;
  const stroke = Math.floor(along / length);
  const progress = along / length - stroke;
  const end = 0.61 + noise(line, stroke + seed) * 0.36;
  if (progress >= end) return 0;
  const pressure = Math.min(1, progress * 9, (end - progress) * 9);
  const width = (0.38 + noise(line, stroke - seed) * 0.9) * (0.48 + 0.52 * pressure);
  return Math.max(0, Math.min(1, width + 0.42 - distance)) * pressure;
}

/** Use the projection to place graphite in recesses, along lower edges, and at ground contact. */
export function sketchShading(material: Uint8Array, depth: Float64Array, width: number, height: number) {
  const shading = Buffer.alloc(width * height * 4);
  const scale = height / 550;
  const slope = width > height ? 0.68 : 0.53;
  let left = width;
  let right = 0;
  let ground = 0;
  const bottom = new Int32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!material[y * width + x]) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      ground = y;
      bottom[x] = y;
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
  const groundMargin = Math.max(1, (right - left) * 0.045);
  for (let y = reach; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const i = y * width + x;
      const surface = material[i];
      let shade = 0;
      if (surface) {
        const threshold = depth[i] + 0.052;
        for (const { distance, offset, penumbra, strength } of probes) {
          const row = (y - distance) * width;
          const center = x - offset;
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
        shade = Math.max(shade, surface === 3 ? 0.48 : surface === 2 ? 0.24 : lowerBody * 0.29);
      } else if (y > ground - reach * 0.25 && y < ground + reach * 0.7) {
        const edgeDistance = Math.min(x - left + groundMargin, right + groundMargin - x);
        const horizontal = Math.min(1, Math.max(0, edgeDistance / (groundMargin * 1.8)));
        const nearGround = Math.max(0, 1 - Math.abs(y - ground) / (reach * 0.7));
        const contact = Math.max(0, 1 - (ground - bottom[x]) / (reach * 0.58));
        shade = horizontal * nearGround * (0.24 + 0.46 * contact);
      }
      if (shade < 0.075) continue;
      const u = x / scale, v = y / scale;
      const primary = pencilHatch(u, v, slope, 5.6, 23);
      const cross = pencilHatch(u, v, -0.64, 6.9, 71);
      const fine = pencilHatch(u, v, slope + 0.14, 3.8, 42);
      const tooth = noise(x, y);
      const dark = Math.min(1, Math.max(0, (shade - 0.26) * 2.6));
      const alpha = shade * (primary * 235 + dark * (cross * 147 + fine * 86)) *
        (0.41 + tooth * 0.59);
      if (alpha < 3) continue;
      shading.set([49, 48, 46, Math.min(255, Math.round(alpha))], i * 4);
    }
  }
  return shading;
}

/** Render a neutral value study from the projected materials. */
export function sketchBase(guide: Buffer, material: Uint8Array) {
  const drawing = Buffer.alloc(guide.length);
  for (let i = 0; i < material.length; i++) {
    const surface = material[i];
    if (!surface) continue;
    const offset = i * 4;
    const luminance = (guide[offset] * 3 + guide[offset + 1] * 6 + guide[offset + 2]) / 10;
    const value = Math.round(surface === 3 ? 45 + luminance * 0.7 : 104 + luminance * 0.58);
    drawing.set([value, value, value, 255], offset);
  }
  return drawing;
}

/** Use a light second pencil line on the silhouette and a single pass on fine details. */
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
      const opacity = edge ? (edge === 2 ? 192 : 110) * pressure : repeat === 2 ? 34 * pressure : 0;
      if (opacity < 3) continue;
      pixels.set([43, 42, 41, Math.round(opacity)], i * 4);
    }
  }
  return pixels;
}
