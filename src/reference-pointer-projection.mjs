// Active Theory ScreenProjection.unproject normalizes a camera ray and advances
// by a fixed radius. Ray.at is Three's existing equivalent. Optical values are
// from CAMERA_Element_1_Homefov and TubePlayer; the universe has its own lens.
export const referenceCursorFov = 30;
export const referenceCursorRadius = 40;
// Home at scrollProgress=0 and visibleV=1: group=[0,40,-10], local
// GazeCamera=[0,4.5,40], lookAt=[0,4.59,0]. Keep these WORLD coordinates:
// ProtonTube's cross(T, next+current) and curlNoise both depend on the origin.
export const referenceCursorPosition = [0, 44.5, 30];
export const referenceCursorTarget = [0, 44.59, -10];
export function projectTubePointer(ray, camera, ndc, target) {
  ray.setFromCamera(ndc, camera);
  return ray.ray.at(referenceCursorRadius, target);
}
