/**
 * Trace the visible material boundaries after the orthographic depth pass.
 * A second, lighter stroke and ruled passes imitate graphite and marker grain.
 */
export function sketchInk(material: Uint8Array, width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 4);
  const step = Math.max(2, Math.round(height / 440));
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

  for (let y = 4; y < height - 4; y++) {
    for (let x = 4; x < width - 4; x++) {
      const i = y * width + x;
      const edge = trace[i];
      const pigment = Math.sin(x / 31 + y / 23) * 13 + Math.sin(x / 9 - y / 17) * 8;
      const wash = (x * 0.48 + y + 1.4 * Math.sin(y / 39)) % 13;
      const repeat = trace[(y - 3) * width + x - 3];
      const darkSurface = material[i] === 2 || material[i] === 3;
      let opacity = 0;
      if (edge) {
        opacity = (edge === 2 ? 185 : 119) + pigment;
      } else if (repeat && material[i]) {
        opacity = 34 + pigment;
      } else if (material[i] && wash < 1.1) {
        opacity = darkSurface ? 46 + pigment : 17 + pigment * 0.5;
      }
      if (opacity < 2) continue;
      pixels.set([51, 47, 44, Math.round(opacity)], i * 4);
    }
  }
  return pixels;
}
