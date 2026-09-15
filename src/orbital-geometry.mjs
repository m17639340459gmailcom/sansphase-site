import { IcosahedronGeometry } from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export function orbitalGeometry() {
  const source = new IcosahedronGeometry(1, 1);
  // Reuse identical vertices, including their normals and UV seams. Triangle
  // count, size and shading stay the same; this is indexing, not simplification.
  const indexed = mergeVertices(source, 1e-7);
  source.dispose();
  return indexed;
}
