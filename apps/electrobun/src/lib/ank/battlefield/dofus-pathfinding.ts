/**
 * Dofus isometric grid pathfinding (8-direction overworld movement).
 *
 * Faithfully reimplements the original ActionScript pathfinding from
 * ank/battlefield/utils/Pathfinding.as.
 *
 * Direction system:
 *   0 EAST:       +1          (same row, next col)          cost: 1.5
 *   1 SOUTH_EAST: +W          (adjacent row, diagonal)      cost: 1.0
 *   2 SOUTH:      +(2W-1)     (skip row, same col type)     cost: 1.5
 *   3 SOUTH_WEST: +(W-1)      (adjacent row, diagonal)      cost: 1.0
 *   4 WEST:       -1          (same row, prev col)          cost: 1.5
 *   5 NORTH_WEST: -W          (adjacent row, diagonal)      cost: 1.0
 *   6 NORTH:      -(2W-1)     (skip row, same col type)     cost: 1.5
 *   7 NORTH_EAST: -(W-1)      (adjacent row, diagonal)      cost: 1.0
 *
 * Restricted directions (1,3,5,7) move between long/short rows — cost 1.0.
 * Unrestricted directions (0,2,4,6) move within or skip a row — cost 1.5.
 */

/** Movement costs per direction index. */
const DIR_COSTS = [1.5, 1, 1.5, 1, 1.5, 1, 1.5, 1] as const;

/** Penalty added when changing direction from previous step. */
const DIR_CHANGE_PENALTY = 0.5;

/** Maximum path length (in g-cost units). */
const MAX_PATH_LENGTH = 500;

interface PathNode {
  cellId: number;
  /** Actual accumulated distance. */
  g: number;
  /** Virtual cost — includes direction change penalties (used for f-score). */
  v: number;
  /** Heuristic estimate to goal. */
  h: number;
  /** Priority: v + h. */
  f: number;
  /** Direction index (0-7) taken to reach this node, -1 for start. */
  d: number;
  parent: PathNode | null;
}

export class DofusPathfinding {
  private mapWidth: number;
  private totalRows: number;
  private stride: number;
  private dirOffsets: number[];
  private walkableSet: Set<number>;
  private occupiedCells: Set<number> = new Set();

  constructor(mapWidth: number, mapHeight: number, walkableCellIds: number[]) {
    this.mapWidth = mapWidth;
    this.totalRows = 2 * mapHeight - 1;
    this.stride = 2 * mapWidth - 1;
    this.dirOffsets = [
      1, // 0: EAST
      mapWidth, // 1: SOUTH_EAST
      this.stride, // 2: SOUTH
      mapWidth - 1, // 3: SOUTH_WEST
      -1, // 4: WEST
      -mapWidth, // 5: NORTH_WEST
      -this.stride, // 6: NORTH
      -(mapWidth - 1), // 7: NORTH_EAST
    ];
    this.walkableSet = new Set(walkableCellIds);
  }

  get width(): number {
    return this.mapWidth;
  }

  /**
   * Convert cell ID to (row, col) in the alternating grid.
   */
  private cellToRowCol(cellId: number): {
    row: number;
    col: number;
    isLong: boolean;
  } {
    const pair = Math.floor(cellId / this.stride);
    const offset = cellId % this.stride;
    const isLong = offset < this.mapWidth;
    return {
      row: isLong ? 2 * pair : 2 * pair + 1,
      col: isLong ? offset : offset - this.mapWidth,
      isLong,
    };
  }

  /**
   * Convert cell ID to isometric (x, y) coordinates.
   * Based on ank/battlefield/utils/Pathfinding.as#getCaseCoordonnee.
   */
  private cellToCoord(cellId: number): { x: number; y: number } {
    const W = this.mapWidth;
    const line = Math.floor(cellId / this.stride);
    const column = cellId - line * this.stride;
    const offset = column % W;
    const y = line - offset;
    const x = Math.round((cellId - (W - 1) * y) / W);
    return { x, y };
  }

  /**
   * Check if a direction move is valid from a given cell position.
   * Prevents wrap-around at row boundaries (equivalent to the original
   * pixel-x distance check: Math.abs(cells[to].x - cells[from].x) <= 53).
   */
  private isValidDirection(
    row: number,
    col: number,
    isLong: boolean,
    dir: number
  ): boolean {
    const W = this.mapWidth;
    switch (dir) {
      case 0: // EAST — same row, next col
        return col < (isLong ? W - 1 : W - 2);
      case 1: // SE — to adjacent row below
        return isLong
          ? row < this.totalRows - 1 && col < W - 1
          : row < this.totalRows - 1;
      case 2: // SOUTH — skip a row
        return row + 2 < this.totalRows;
      case 3: // SW — to adjacent row below
        return isLong
          ? row < this.totalRows - 1 && col > 0
          : row < this.totalRows - 1;
      case 4: // WEST — same row, prev col
        return col > 0;
      case 5: // NW — to adjacent row above
        return isLong ? row > 0 && col > 0 : row > 0;
      case 6: // NORTH — skip a row
        return row >= 2;
      case 7: // NE — to adjacent row above
        return isLong ? row > 0 && col < W - 1 : row > 0;
      default:
        return false;
    }
  }

  /**
   * Get the direction (0-7) between two cells.
   *
   * For adjacent cells, uses cell ID difference.
   * For non-adjacent cells, falls back to coordinate-based direction
   * (matching ank/battlefield/utils/Pathfinding.as#getDirection).
   */
  static getDirection(
    fromCellId: number,
    toCellId: number,
    mapWidth: number
  ): number {
    const diff = toCellId - fromCellId;
    const W = mapWidth;
    const stride = 2 * W - 1;
    const offsets = [1, W, stride, W - 1, -1, -W, -stride, -(W - 1)];

    // Check adjacent directions (iterate 7→0 matching original AS code)
    for (let dir = 7; dir >= 0; dir--) {
      if (offsets[dir] === diff) return dir;
    }

    // Fallback: coordinate-based direction for non-adjacent cells
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
      return dy > 0 ? 3 : 7; // SOUTH_WEST or NORTH_EAST
    }
    return dx > 0 ? 1 : 5; // SOUTH_EAST or NORTH_WEST
  }

  /**
   * A* pathfinding with 8 directions and direction-dependent costs.
   *
   * Faithfully replicates the original AS pathfinding:
   * - Diagonal (restricted) moves cost 1.0, cardinal (unrestricted) cost 1.5
   * - Direction changes incur a +0.5 penalty (smoother paths)
   * - Euclidean heuristic in isometric coordinates
   * - Virtual cost (v) used for f-score, actual distance (g) for max-length check
   * - Closed nodes can be reopened if a better virtual cost is found
   */
  findPath(startId: number, goalId: number): number[] | null {
    if (!this.walkableSet.has(startId) || !this.walkableSet.has(goalId)) {
      return null;
    }
    if (startId === goalId) return [startId];

    const openSet = new Map<number, PathNode>();
    const closedSet = new Map<number, number>(); // cellId → v value

    const startNode: PathNode = {
      cellId: startId,
      g: 0,
      v: 0,
      h: this.heuristic(startId, goalId),
      f: 0,
      d: -1,
      parent: null,
    };
    startNode.f = startNode.h;
    openSet.set(startId, startNode);

    while (openSet.size > 0) {
      // Find node with lowest f in open set
      let current: PathNode | null = null;
      let lowestF = Infinity;

      for (const node of openSet.values()) {
        if (node.f < lowestF) {
          lowestF = node.f;
          current = node;
        }
      }

      if (!current) break;

      if (current.cellId === goalId) {
        return this.reconstructPath(current);
      }

      openSet.delete(current.cellId);
      closedSet.set(current.cellId, current.v);

      const { row, col, isLong } = this.cellToRowCol(current.cellId);

      for (let dir = 0; dir < 8; dir++) {
        if (!this.isValidDirection(row, col, isLong, dir)) continue;

        const neighborId = current.cellId + this.dirOffsets[dir];
        if (!this.walkableSet.has(neighborId)) continue;
        if (neighborId !== goalId && this.occupiedCells.has(neighborId))
          continue;

        const moveCost = DIR_COSTS[dir];
        const dirChangeCost =
          current.d >= 0 && dir !== current.d ? DIR_CHANGE_PENALTY : 0;
        const tentativeG = current.g + moveCost;
        const tentativeV = current.v + moveCost + dirChangeCost;

        // Check existing v value in open or closed set
        let existingV: number | null = null;
        const openNode = openSet.get(neighborId);
        if (openNode) {
          existingV = openNode.v;
        } else {
          const closedV = closedSet.get(neighborId);
          if (closedV !== undefined) {
            existingV = closedV;
          }
        }

        if (
          (existingV === null || existingV > tentativeV) &&
          tentativeG <= MAX_PATH_LENGTH
        ) {
          // Reopen from closed set if needed
          closedSet.delete(neighborId);

          const h = this.heuristic(neighborId, goalId);
          const node: PathNode = {
            cellId: neighborId,
            g: tentativeG,
            v: tentativeV,
            h,
            f: tentativeV + h,
            d: dir,
            parent: current,
          };
          openSet.set(neighborId, node);
        }
      }
    }

    return null;
  }

  /**
   * Heuristic: Euclidean distance in isometric coordinates.
   * Matches ank/battlefield/utils/Pathfinding.as#goalDistEstimate.
   */
  private heuristic(fromId: number, toId: number): number {
    const a = this.cellToCoord(fromId);
    const b = this.cellToCoord(toId);
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    return Math.sqrt(dx * dx + dy * dy);
  }

  private reconstructPath(node: PathNode): number[] {
    const path: number[] = [];
    let current: PathNode | null = node;
    while (current) {
      path.unshift(current.cellId);
      current = current.parent;
    }
    return path;
  }
}
