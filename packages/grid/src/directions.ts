export const Direction = {
  EAST: 0,
  SOUTH_EAST: 1,
  SOUTH: 2,
  SOUTH_WEST: 3,
  WEST: 4,
  NORTH_WEST: 5,
  NORTH: 6,
  NORTH_EAST: 7,
} as const;

export type DirectionValue = (typeof Direction)[keyof typeof Direction];

export const DIR_COSTS = [1.5, 1, 1.5, 1, 1.5, 1, 1.5, 1] as const;

export const DIR_CHANGE_PENALTY = 0.5;

export function getDirOffsets(mapWidth: number): number[] {
  const stride = 2 * mapWidth - 1;
  return [
    1, // 0: EAST
    mapWidth, // 1: SOUTH_EAST
    stride, // 2: SOUTH
    mapWidth - 1, // 3: SOUTH_WEST
    -1, // 4: WEST
    -mapWidth, // 5: NORTH_WEST
    -stride, // 6: NORTH
    -(mapWidth - 1), // 7: NORTH_EAST
  ];
}

/**
 * Get the direction (0-7) between two cells.
 *
 * For adjacent cells, uses cell ID difference.
 * For non-adjacent cells, falls back to coordinate-based direction.
 */
export function getDirection(
  fromCellId: number,
  toCellId: number,
  mapWidth: number
): number {
  const diff = toCellId - fromCellId;
  const W = mapWidth;
  const stride = 2 * W - 1;
  const offsets = [1, W, stride, W - 1, -1, -W, -stride, -(W - 1)];

  for (let dir = 7; dir >= 0; dir--) {
    if (offsets[dir] === diff) return dir;
  }

  const line1 = Math.floor(fromCellId / stride);
  const col1 = fromCellId - line1 * stride;
  const y1 = line1 - (col1 % W);
  const x1 = Math.round((fromCellId - (W - 1) * y1) / W);

  const line2 = Math.floor(toCellId / stride);
  const col2 = toCellId - line2 * stride;
  const y2 = line2 - (col2 % W);
  const x2 = Math.round((toCellId - (W - 1) * y2) / W);

  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0) {
    return dy > 0 ? 3 : 7;
  }
  return dx > 0 ? 1 : 5;
}
