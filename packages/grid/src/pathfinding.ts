import { cellToCoord, cellToRowCol } from "./cell.ts";
import { DIR_CHANGE_PENALTY, DIR_COSTS, getDirOffsets } from "./directions.ts";
import { isValidDirection } from "./neighbors.ts";

const MAX_PATH_LENGTH = 500;

interface PathNode {
  cellId: number;
  g: number;
  v: number;
  h: number;
  f: number;
  d: number;
  parent: PathNode | null;
}

/**
 * Unified A* pathfinding for the Dofus isometric grid.
 *
 * Faithfully replicates the original AS pathfinding:
 * - Diagonal (restricted) moves cost 1.0, cardinal (unrestricted) cost 1.5
 * - Direction changes incur a +0.5 penalty (smoother paths)
 * - Euclidean heuristic in isometric coordinates
 * - Virtual cost (v) used for f-score, actual distance (g) for max-length check
 * - Closed nodes can be reopened if a better virtual cost is found
 */
export class DofusPathfinding {
  private mapWidth: number;
  private totalRows: number;
  private dirOffsets: number[];
  private walkableSet: Set<number>;
  private occupiedCells: Set<number> = new Set();

  constructor(mapWidth: number, mapHeight: number, walkableCellIds: number[]) {
    this.mapWidth = mapWidth;
    this.totalRows = 2 * mapHeight - 1;
    this.dirOffsets = getDirOffsets(mapWidth);
    this.walkableSet = new Set(walkableCellIds);
  }

  get width(): number {
    return this.mapWidth;
  }

  addOccupied(cellId: number): void {
    this.occupiedCells.add(cellId);
  }

  removeOccupied(cellId: number): void {
    this.occupiedCells.delete(cellId);
  }

  findPath(startId: number, goalId: number): number[] | null {
    if (!this.walkableSet.has(startId) || !this.walkableSet.has(goalId)) {
      return null;
    }
    if (startId === goalId) return [startId];

    const openSet = new Map<number, PathNode>();
    const closedSet = new Map<number, number>();

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

      const { row, col, isLong } = cellToRowCol(current.cellId, this.mapWidth);

      for (let dir = 0; dir < 8; dir++) {
        if (
          !isValidDirection(
            row,
            col,
            isLong,
            dir,
            this.mapWidth,
            this.totalRows
          )
        )
          continue;

        const neighborId = current.cellId + this.dirOffsets[dir];
        if (!this.walkableSet.has(neighborId)) continue;
        if (neighborId !== goalId && this.occupiedCells.has(neighborId))
          continue;

        const moveCost = DIR_COSTS[dir];
        const dirChangeCost =
          current.d >= 0 && dir !== current.d ? DIR_CHANGE_PENALTY : 0;
        const tentativeG = current.g + moveCost;
        const tentativeV = current.v + moveCost + dirChangeCost;

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
   * Get valid neighbor cell IDs for a given cell.
   */
  getNeighbors(cellId: number): number[] {
    const { row, col, isLong } = cellToRowCol(cellId, this.mapWidth);
    const neighbors: number[] = [];
    for (let dir = 0; dir < 8; dir++) {
      if (
        isValidDirection(row, col, isLong, dir, this.mapWidth, this.totalRows)
      ) {
        neighbors.push(cellId + this.dirOffsets[dir]);
      }
    }
    return neighbors;
  }

  /**
   * Validate that a path is walkable and connected.
   */
  validatePath(path: number[], currentCellId: number): boolean {
    if (path.length < 2) return false;
    if (path[0] !== currentCellId) return false;

    for (let i = 0; i < path.length; i++) {
      if (!this.walkableSet.has(path[i])) return false;
    }

    for (let i = 0; i < path.length - 1; i++) {
      const neighbors = this.getNeighbors(path[i]);
      if (!neighbors.includes(path[i + 1])) return false;
    }

    return true;
  }

  /**
   * Get direction (0-7) between two cells (instance method).
   */
  getDirection(fromId: number, toId: number): number {
    const diff = toId - fromId;

    for (let dir = 7; dir >= 0; dir--) {
      if (this.dirOffsets[dir] === diff) return dir;
    }

    const from = cellToCoord(fromId, this.mapWidth);
    const to = cellToCoord(toId, this.mapWidth);
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    if (dx === 0) {
      return dy > 0 ? 3 : 7;
    }
    return dx > 0 ? 1 : 5;
  }

  private heuristic(fromId: number, toId: number): number {
    const a = cellToCoord(fromId, this.mapWidth);
    const b = cellToCoord(toId, this.mapWidth);
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
