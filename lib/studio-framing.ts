import * as THREE from 'three';
/** Fit actual geometry, preserving a calm 27% margin on every viewport. */
export function fitStudioCamera(
  box: THREE.Box3,
  direction: readonly number[],
  fov: number,
  aspect: number,
) {
  const target = box.getCenter(new THREE.Vector3());
  const back = new THREE.Vector3(...direction).normalize();
  const right = new THREE.Vector3()
    .crossVectors(new THREE.Vector3(0, 1, 0), back)
    .normalize();
  const up = new THREE.Vector3().crossVectors(back, right).normalize();
  const tan = Math.tan(THREE.MathUtils.degToRad(fov) / 2),
    fill = 0.73;
  let distance = 0.1;
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const v = new THREE.Vector3(x, y, z).sub(target);
        distance = Math.max(
          distance,
          v.dot(back) +
            Math.max(
              Math.abs(v.dot(up)) / (tan * fill),
              Math.abs(v.dot(right)) / (tan * Math.max(aspect, 0.1) * fill),
            ),
        );
      }
  return { target, position: target.clone().addScaledVector(back, distance) };
}
