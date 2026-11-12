import { parseProject, type Art, type Project } from './free-wrap.ts';

const MAX_CHARACTERS = 8_000_000;
const MAX_ASSETS = 80;
const MAX_IMAGE_CHARACTERS = 2_000_000;
type StoredArt = Omit<Art, 'src'> & { src: string | { asset: number } };

/** Local-only encoding; portable exports continue to use the plain v1 project. */
export function serializeDraft(project: Project): string {
  const validated = parseProject(JSON.stringify(project));
  const assets: string[] = [];
  const indices = new Map<string, number>();
  const storeArt = (art: Art | null): StoredArt | null => {
    if (!art || art.kind !== 'image' || !art.src) return art;
    let index = indices.get(art.src);
    if (index === undefined) {
      index = assets.length;
      indices.set(art.src, index);
      assets.push(art.src);
    }
    return { ...art, src: { asset: index } };
  };
  const encoded = JSON.stringify({
    storageVersion: 1,
    assets,
    project: {
      ...validated,
      layers: validated.layers.map((layer) => ({
        ...layer,
        entry: storeArt(layer.entry),
        driver: storeArt(layer.driver),
      })),
    },
  });
  if (encoded.length > MAX_CHARACTERS) throw new Error('文件超过 8 MB');
  return encoded;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function invalid(): never {
  throw new Error('无法读取这个草稿：版本或内容不受支持');
}

/** Reads both legacy plain v1 drafts and resource-deduplicated local drafts. */
export function parseDraft(json: string): Project {
  if (json.length > MAX_CHARACTERS) throw new Error('文件超过 8 MB');
  const stored: unknown = JSON.parse(json);
  if (!record(stored) || !Object.hasOwn(stored, 'storageVersion'))
    return parseProject(json);
  if (
    stored.storageVersion !== 1 ||
    !Array.isArray(stored.assets) ||
    stored.assets.length > MAX_ASSETS ||
    !record(stored.project) ||
    !Array.isArray(stored.project.layers) ||
    stored.project.layers.length > 40
  )
    return invalid();

  const assets: string[] = [];
  for (const source of stored.assets) {
    if (
      typeof source !== 'string' ||
      source.length > MAX_IMAGE_CHARACTERS ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)
    )
      return invalid();
    assets.push(source);
  }

  // Check the expanded size before serializing repeated large image resources.
  let expandedSize = JSON.stringify(stored.project).length;
  for (const layer of stored.project.layers) {
    if (!record(layer)) return invalid();
    for (const side of ['entry', 'driver']) {
      const art = layer[side];
      if (art === null) continue;
      if (!record(art)) return invalid();
      if (typeof art.src === 'string') continue;
      const reference = art.src;
      if (
        art.kind !== 'image' ||
        !record(reference) ||
        Object.keys(reference).length !== 1 ||
        !Number.isInteger(reference.asset) ||
        typeof reference.asset !== 'number' ||
        reference.asset < 0 ||
        reference.asset >= assets.length
      )
        return invalid();
      const source = assets[reference.asset];
      expandedSize += source.length + 2 - JSON.stringify(reference).length;
      if (expandedSize > MAX_CHARACTERS) throw new Error('文件超过 8 MB');
      art.src = source;
    }
  }
  return parseProject(JSON.stringify(stored.project));
}
