/** Six thin sheets from the original 5f9c1a2 particle field, fitted to any count. */
export function buildLattice(count: number) {
  const positions = new Float32Array(count * 3);
  const layers = 6;
  const extent = 2.8;
  const scale = 0.78;
  const yaw = 0.6;
  const pitch = 0.35;
  let index = 0;

  // Retain the original tiny grid jitter; the shader supplies coherent motion.
  const hash = (i: number, salt: number) => {
    const value = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  };

  for (let layer = 0; layer < layers; layer++) {
    const budget = Math.floor(count / layers) + (layer < count % layers ? 1 : 0);
    const side = Math.ceil(Math.sqrt(budget));
    for (let i = 0; i < budget; i++, index++) {
      const cell = Math.floor(((i + 0.5) * side * side) / budget);
      const row = Math.floor(cell / side);
      const col = cell % side;
      const x = (side > 1 ? (col / (side - 1) - 0.5) * extent : 0)
        + (hash(index, 13) - 0.5) * 0.006;
      const y = -1.25 + layer * 0.5 + (hash(index, 14) - 0.5) * 0.006;
      const z = (side > 1 ? (row / (side - 1) - 0.5) * extent : 0)
        + (hash(index, 15) - 0.5) * 0.006;
      const turnedX = x * Math.cos(yaw) + z * Math.sin(yaw);
      const turnedZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
      positions.set([
        turnedX * scale,
        (y * Math.cos(pitch) - turnedZ * Math.sin(pitch)) * scale,
        (y * Math.sin(pitch) + turnedZ * Math.cos(pitch)) * scale,
      ], index * 3);
    }
  }
  return { positions };
}
