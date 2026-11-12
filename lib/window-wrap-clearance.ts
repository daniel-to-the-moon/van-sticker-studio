import { Box3, Mesh, Object3D, Vector3, type BufferGeometry } from 'three';

/**
 * Window frames, sills and nearby seals sit a few centimetres outside the
 * wrap shell and hide the film. The GLB is not edited. Triangles on the
 * known frame meshes are dropped at runtime when they sit in front of a
 * real window aperture. Glass panes stay, so the opening still reads as a hole.
 */
export const WINDOW_FRAME_MESHES = [
  'RV_Static_Graphite',
  'RV_Static_Trim_Rings',
  'RV_Static_Rubber',
  'RV_WebRig_Cab_L_Graphite',
  'RV_WebRig_Cab_R_Graphite',
  'RV_WebRig_Cab_L_Rubber',
  'RV_WebRig_Cab_R_Rubber',
  'RV_WebRig_EntryDoor_Graphite',
  'RV_WebRig_Rooflight_Rubber',
] as const;

const FRAME_PAD_M = 0.035;
/** Only the lip that sits proud of the glass. A wider cut deletes the black frame. */
const FRAME_INWARD_M = 0.012;
/** Windshield and other thick glass volumes are not side-window apertures. */
const MAX_APERTURE_THICKNESS_M = 0.3;

export type WindowAperture = {
  name: string;
  box: Box3;
  center: Vector3;
  axis: 'x' | 'y' | 'z';
};

export function isWindowApertureName(name: string): boolean {
  return (
    name.endsWith('Glass') &&
    !name.includes('Headlamp') &&
    !name.includes('Optic') &&
    !name.includes('Lens')
  );
}

export function windowApertures(root: Object3D): WindowAperture[] {
  const found: WindowAperture[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh) || !isWindowApertureName(object.name)) return;
    const box = new Box3().setFromObject(object);
    const size = box.getSize(new Vector3());
    const axis = (['x', 'y', 'z'] as const).reduce((thin, key) =>
      size[key] < size[thin] ? key : thin,
    );
    if (size[axis] > MAX_APERTURE_THICKNESS_M) return;
    found.push({
      name: object.name,
      box,
      center: box.getCenter(new Vector3()),
      axis,
    });
  });
  return found;
}

function outwardSign(aperture: WindowAperture): number {
  if (aperture.axis === 'y') return 1;
  const sign = Math.sign(aperture.center[aperture.axis]);
  return sign === 0 ? -1 : sign;
}

export function frameTriangleCoversWrap(
  centroid: Vector3,
  apertures: WindowAperture[],
): boolean {
  return apertures.some((aperture) => {
    const box = aperture.box;
    if (
      centroid.x < box.min.x - FRAME_PAD_M ||
      centroid.x > box.max.x + FRAME_PAD_M ||
      centroid.y < box.min.y - FRAME_PAD_M ||
      centroid.y > box.max.y + FRAME_PAD_M ||
      centroid.z < box.min.z - FRAME_PAD_M ||
      centroid.z > box.max.z + FRAME_PAD_M
    )
      return false;
    const outward = outwardSign(aperture);
    return (
      (centroid[aperture.axis] - aperture.center[aperture.axis]) * outward >=
      -FRAME_INWARD_M
    );
  });
}

function rewriteIndex(geometry: BufferGeometry, keep: number[]) {
  geometry.setIndex(keep);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function clearOccludingWindowFrames(root: Object3D): {
  apertures: string[];
  removed: Record<string, number>;
} {
  const apertures = windowApertures(root);
  const removed: Record<string, number> = {};
  const centroid = new Vector3();
  const vertex = new Vector3();
  root.traverse((object) => {
    if (
      !(object instanceof Mesh) ||
      !WINDOW_FRAME_MESHES.includes(
        object.name as (typeof WINDOW_FRAME_MESHES)[number],
      )
    )
      return;
    const geometry = object.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    const triangles = index ? index.count / 3 : position.count / 3;
    const keep: number[] = [];
    let dropped = 0;
    for (let triangle = 0; triangle < triangles; triangle++) {
      centroid.set(0, 0, 0);
      const corners = [0, 1, 2].map((corner) => {
        const vertexIndex = index
          ? index.getX(triangle * 3 + corner)
          : triangle * 3 + corner;
        vertex.fromBufferAttribute(position, vertexIndex);
        vertex.applyMatrix4(object.matrixWorld);
        centroid.add(vertex);
        return vertexIndex;
      });
      centroid.multiplyScalar(1 / 3);
      if (frameTriangleCoversWrap(centroid, apertures)) {
        dropped += 1;
        continue;
      }
      keep.push(corners[0], corners[1], corners[2]);
    }
    if (dropped > 0) {
      rewriteIndex(geometry, keep);
      removed[object.name] = dropped;
    }
  });
  return { apertures: apertures.map((aperture) => aperture.name), removed };
}
