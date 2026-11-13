/** Editable source in normalized front-to-rear, top-to-bottom side coordinates. */
export type Side = 'entry' | 'driver';
export type Point = { x: number; y: number };
export type Kind = 'region' | 'stroke' | 'text' | 'icon' | 'image';
export type Art = {
  kind: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  color: string;
  text: string;
  font: 'sans' | 'hand';
  icon: 'cup' | 'runner' | 'badge';
  src: string;
  points: Point[];
  thickness: number;
  dashed: boolean;
  visible: boolean;
  locked: boolean;
};
export type Layer = {
  id: string;
  name: string;
  linked: boolean;
  entry: Art | null;
  driver: Art | null;
};
// Version 1 uses perimeter coordinates. Version 2 uses the orthographic side frame.
export type Project = { version: 1 | 2; background: string; layers: Layer[] };
export type History = { past: Project[]; present: Project; future: Project[] };
export const otherSide = (side: Side): Side =>
  side === 'entry' ? 'driver' : 'entry';
export const emptyProject = (): Project => ({
  version: 2,
  background: '#f3eedf',
  layers: [],
});
export const names: Record<Kind, string> = {
  region: '色块',
  stroke: '涂鸦',
  text: '文字',
  icon: '图标',
  image: '图片',
};
export function newLayer(kind: Kind, id: string): Layer {
  const art: Art = {
    kind,
    x: 0.42,
    y: 0.4,
    w: 0.2,
    h: 0.2,
    rotation: 0,
    color: '#17201c',
    text: 'YunQi Coffee',
    font: 'hand',
    icon: 'cup',
    src: '',
    points: [],
    thickness: 0.006,
    dashed: false,
    visible: true,
    locked: false,
  };
  if (kind === 'text') {
    art.w = 0.38;
    art.h = 0.13;
    art.x = 0.32;
    art.y = 0.28;
  }
  if (kind === 'region' || kind === 'stroke') {
    art.x = 0;
    art.y = 0;
    art.w = 1;
    art.h = 1;
  }
  return {
    id,
    name: names[kind],
    linked: true,
    entry: art,
    driver: structuredClone(art),
  };
}
export function addLayer(
  p: Project,
  layer: Layer,
  side: Side,
  linked = true,
): Project {
  if (p.layers.length >= 40)
    throw new Error('最多 40 个图层，请先删除不用的图层');
  const art = structuredClone(layer.entry ?? layer.driver);
  const item: Layer = {
    ...layer,
    linked,
    entry: null,
    driver: null,
    [side]: art,
  };
  if (linked) item[otherSide(side)] = structuredClone(art);
  return { ...p, layers: [...p.layers, item] };
}
export function editLayer(
  p: Project,
  id: string,
  side: Side,
  patch: Partial<Art>,
): Project {
  return {
    ...p,
    layers: p.layers.map((l) => {
      if (l.id !== id || !l[side]) return l;
      if (l[side]!.locked && Object.keys(patch).some((key) => key !== 'locked'))
        return l;
      const art = { ...l[side], ...patch } as Art;
      return {
        ...l,
        [side]: art,
        ...(l.linked ? { [otherSide(side)]: structuredClone(art) } : {}),
      };
    }),
  };
}
export function setLinked(
  p: Project,
  id: string,
  side: Side,
  linked: boolean,
): Project {
  return {
    ...p,
    layers: p.layers.map((l) =>
      l.id !== id ||
      !l[side] ||
      l[side]?.locked ||
      (linked && l[otherSide(side)]?.locked)
        ? l
        : {
            ...l,
            linked,
            ...(linked ? { [otherSide(side)]: structuredClone(l[side]) } : {}),
          },
    ),
  };
}
export function removeLayer(p: Project, id: string, side?: Side): Project {
  return {
    ...p,
    layers: p.layers.flatMap((l) => {
      if (l.id !== id) return [l];
      if (side && !l.linked && l[otherSide(side)])
        return [{ ...l, [side]: null }];
      return [];
    }),
  };
}
export const history = (p: Project): History => ({
  past: [],
  present: p,
  future: [],
});
export function commit(h: History, p: Project): History {
  parseProject(JSON.stringify(p));
  if (JSON.stringify(h.present) === JSON.stringify(p)) return h;
  return { past: [...h.past.slice(-39), h.present], present: p, future: [] };
}
export function undo(h: History): History {
  const p = h.past.at(-1);
  return p
    ? {
        past: h.past.slice(0, -1),
        present: p,
        future: [h.present, ...h.future],
      }
    : h;
}
export function redo(h: History): History {
  const p = h.future[0];
  return p
    ? { past: [...h.past, h.present], present: p, future: h.future.slice(1) }
    : h;
}
const num = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const color = (v: unknown): v is string =>
  typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
export function parseProject(json: string): Project {
  if (json.length > 8_000_000) throw new Error('文件超过 8 MB');
  const p: unknown = JSON.parse(json);
  const fail = (): never => {
    throw new Error('无法读取这个草稿：版本或内容不受支持');
  };
  if (!p || typeof p !== 'object') return fail();
  const o = p as Record<string, unknown>;
  if (
    (o.version !== 1 && o.version !== 2) ||
    !color(o.background) ||
    !Array.isArray(o.layers) ||
    o.layers.length > 40
  )
    return fail();
  const ids = new Set<string>();
  for (const item of o.layers) {
    if (!item || typeof item !== 'object') return fail();
    const l = item as Record<string, unknown>;
    if (
      typeof l.id !== 'string' ||
      l.id.length > 80 ||
      ids.has(l.id) ||
      typeof l.name !== 'string' ||
      l.name.length > 100 ||
      typeof l.linked !== 'boolean'
    )
      return fail();
    ids.add(l.id);
    if (!l.entry && !l.driver) return fail();
    for (const side of ['entry', 'driver']) {
      const value = l[side];
      if (value === null) continue;
      if (!value || typeof value !== 'object') return fail();
      const a = value as Record<string, unknown>;
      if (
        !['region', 'stroke', 'text', 'icon', 'image'].includes(
          String(a.kind),
        ) ||
        !color(a.color) ||
        !num(a.x, -1, 2) ||
        !num(a.y, -1, 2) ||
        !num(a.w, 0.001, 3) ||
        !num(a.h, 0.001, 3) ||
        !num(a.rotation, -360, 360) ||
        !num(a.thickness, 0.001, 0.1) ||
        typeof a.text !== 'string' ||
        a.text.length > 200 ||
        !['sans', 'hand'].includes(String(a.font)) ||
        !['cup', 'runner', 'badge'].includes(String(a.icon)) ||
        typeof a.src !== 'string' ||
        a.src.length > 2_000_000 ||
        (a.src &&
          !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
            a.src,
          )) ||
        typeof a.visible !== 'boolean' ||
        typeof a.locked !== 'boolean' ||
        typeof a.dashed !== 'boolean' ||
        !Array.isArray(a.points) ||
        a.points.length > 512
      )
        return fail();
      for (const point of a.points)
        if (!point || !num(point.x, 0, 1) || !num(point.y, 0, 1)) return fail();
    }
    if (l.linked && JSON.stringify(l.entry) !== JSON.stringify(l.driver))
      return fail();
  }
  return p as Project;
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const segmentDistance = (p: Point, a: Point, b: Point) => {
  const d = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const t = d
    ? Math.max(
        0,
        Math.min(
          1,
          ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / d,
        ),
      )
    : 0;
  return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
};
/** Ramer–Douglas–Peucker removes jitter but retains deliberate corners. */
export function tidy(points: Point[], tolerance = 0.004): Point[] {
  if (points.length < 3) return points;
  let at = 0,
    max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], points[0], points.at(-1)!);
    if (d > max) {
      max = d;
      at = i;
    }
  }
  if (max <= tolerance) return [points[0], points.at(-1)!];
  return [
    ...tidy(points.slice(0, at + 1), tolerance).slice(0, -1),
    ...tidy(points.slice(at), tolerance),
  ];
}
function crosses(a: Point, b: Point, c: Point, d: Point) {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return (
    cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
  );
}
export function regionPoints(
  points: Point[],
  mode: 'above' | 'below' | 'closed',
): Point[] {
  if (
    points.length < 2 ||
    (distance(points[0], points.at(-1)!) < 0.025 && mode !== 'closed')
  )
    throw new Error('线太短，请重新画');
  let p = tidy(points);
  if (mode === 'closed') {
    if (p.length < 4 || distance(p[0], p.at(-1)!) > 0.08)
      throw new Error('请画一个闭合范围，或选择填充上方／下方');
    p = p.slice(0, -1);
  } else {
    if (Math.abs(p[0].x - p.at(-1)!.x) < 0.3)
      throw new Error('请从车头往车尾画出边界，或选择圈选');
    if (p[0].x > p.at(-1)!.x) p = p.toReversed();
    p = [
      { x: 0, y: p[0].y },
      ...p,
      { x: 1, y: p.at(-1)!.y },
      { x: 1, y: mode === 'above' ? 0 : 1 },
      { x: 0, y: mode === 'above' ? 0 : 1 },
    ];
  }
  for (let i = 0; i < p.length; i++)
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      if (crosses(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length]))
        throw new Error('边界交叉了，请撤回后重新画');
    }
  return p;
}
export function shortcut(
  key: string,
  modifier: boolean,
  shift: boolean,
  typing: boolean,
) {
  if (typing) return null;
  if (modifier && key.toLowerCase() === 'z') return shift ? 'redo' : 'undo';
  if (modifier && key.toLowerCase() === 'y') return 'redo';
  if (key === 'Escape') return 'cancel';
  if (key === 'Delete' || key === 'Backspace') return 'delete';
  if (key.startsWith('Arrow')) return key;
  return null;
}
export const escapeXml = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&apos;',
      })[c]!,
  );
export const pathData = (points: Point[], closed = false) =>
  points
    .map(
      (p, i) =>
        `${i ? 'L' : 'M'}${(p.x * 1000).toFixed(2)},${(p.y * 400).toFixed(2)}`,
    )
    .join(' ') + (closed ? ' Z' : '');
/** Original simple vector icons; no external image or reference-photo dependency. */
export const iconPaths = {
  cup: 'M28 22H72L67 90H33Z M24 15H76V23H24Z M32 8H68L73 15H27Z M30 43H70 M32 69H68 M43 36Q55 45 43 54T47 67',
  runner:
    'M60 10a9 9 0 1 0 1 0 M51 29L32 48L12 44L9 54L34 61L49 51L47 64L27 81L34 91L58 71L68 91L80 87L64 54L66 39L82 48L91 42L69 27Z',
  badge:
    'M22 57L40 21H60L78 57Z M12 65Q22 52 36 61Q43 65 50 57Q57 65 64 61Q78 52 88 65Q81 82 64 75L50 69L36 75Q19 82 12 65Z',
};
export function artMarkup(a: Art): string {
  let ink = '';
  const c = escapeXml(a.color);
  if (a.kind === 'region')
    ink = `<path d="${pathData(a.points, true)}" fill="${c}"/>`;
  if (a.kind === 'stroke')
    ink = `<path d="${pathData(a.points)}" fill="none" stroke="${c}" stroke-width="${a.thickness * 400}" stroke-linecap="round" stroke-linejoin="round" ${a.dashed ? `stroke-dasharray="${a.thickness * 1100} ${a.thickness * 1200}"` : ''}/>`;
  if (a.kind === 'text')
    ink = `<text x="0" y="310" font-size="300" textLength="1000" lengthAdjust="spacingAndGlyphs" fill="${c}" font-family="${a.font === 'hand' ? 'Brush Script MT, cursive' : 'Arial, sans-serif'}">${escapeXml(a.text)}</text>`;
  if (a.kind === 'icon')
    ink = `<svg viewBox="0 0 100 100" width="1000" height="400"><path d="${iconPaths[a.icon]}" fill="${a.icon === 'cup' ? 'none' : c}" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  if (a.kind === 'image' && a.src)
    ink = `<image href="${escapeXml(a.src)}" width="1000" height="400" preserveAspectRatio="xMidYMid meet"/>`;
  return `<g transform="translate(${a.x * 1000} ${a.y * 400}) rotate(${a.rotation} ${a.w * 500} ${a.h * 200}) scale(${a.w} ${a.h})">${ink}</g>`;
}
export function svgDocument(p: Project, side: Side, surface = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="800" viewBox="0 0 1000 400"><rect width="1000" height="400" fill="${p.background}"/>${p.layers.map((l) => (l[side]?.visible ? artMarkup(surface && side === 'entry' ? { ...l[side]!, x: 1 - l[side]!.x - l[side]!.w, rotation: -l[side]!.rotation, points: l[side]!.points.map((q) => ({ x: 1 - q.x, y: q.y })) } : l[side]!) : '')).join('')}</svg>`;
}
