import type {
  ActorMovePayload,
  CharacterMovePayload,
} from "../protocol/types.ts";
import type { ClientSession } from "../ws/client-session.ts";
import { db } from "../db/database.ts";
import { updateCharacterPosition } from "../game/character.ts";
import { getMapInstance } from "../game/game-manager.ts";
import { getMap } from "../maps/map-store.ts";
import { getPathfinding } from "../maps/pathfinding.ts";
import { encodeServerMessage } from "../protocol/codec.ts";
import { ServerMessageType } from "../protocol/types.ts";
import { changeMap, getMapTriggers } from "./map.ts";

const WALK_SPEED = 3.5; // cells per second
const RUN_SPEED = 6; // cells per second
const RUN_THRESHOLD = 3; // steps above this = run

/**
 * Calculate how long the client walk/run animation takes for a given number of steps.
 */
function getMoveDurationMs(steps: number): number {
  const speed = steps > RUN_THRESHOLD ? RUN_SPEED : WALK_SPEED;
  return Math.ceil((steps / speed) * 1000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handleMovement(
  session: ClientSession,
  payload: CharacterMovePayload
): Promise<void> {
  if (!session.characterId || session.mapId === null || session.cellId === null)
    return;

  const { path } = payload;
  if (!path || path.length < 2) return;

  const pf = await getPathfinding(session.mapId);
  if (!pf) return;

  // Validate path
  if (!pf.validatePath(path, session.cellId)) {
    console.log(
      `[Movement] REJECTED path: map=${session.mapId} from=${session.cellId} to=${path[path.length - 1]} path=[${path.join(",")}]`
    );
    session.ws.send(
      encodeServerMessage(ServerMessageType.ERROR, { reason: "Invalid path" })
    );
    return;
  }

  console.log(
    `[Movement] OK: map=${session.mapId} cell ${session.cellId} -> ${path[path.length - 1]} (${path.length - 1} steps)`
  );

  // Load all triggers for this map (cached after first load)
  const triggers = await getMapTriggers(session.mapId);

  // Check if path passes through a trigger cell — truncate there if so
  let effectivePath = path;
  let triggerAtEnd: { targetMapId: number; targetCellId: number } | null = null;

  for (let i = 1; i < path.length; i++) {
    const trigger = triggers.get(path[i]);
    if (trigger) {
      effectivePath = path.slice(0, i + 1);
      triggerAtEnd = trigger;
      console.log(
        `[Movement] Path passes through trigger at cell ${path[i]} (step ${i}/${path.length - 1}), truncating`
      );
      break;
    }
  }

  const endCellId = effectivePath[effectivePath.length - 1];
  const direction = pf.getDirection(
    effectivePath[effectivePath.length - 2],
    endCellId
  );

  // Update pathfinding occupancy
  pf.removeOccupied(session.cellId);
  pf.addOccupied(endCellId);

  // Update session state
  session.cellId = endCellId;
  session.direction = direction;

  // Update map instance
  const mapInstance = getMapInstance(session.mapId);
  if (mapInstance) {
    mapInstance.updateActorCell(session.characterId, endCellId, direction);

    // Broadcast ACTOR_MOVE (using the truncated path)
    const movePayload: ActorMovePayload = {
      id: session.characterId,
      path: effectivePath,
    };
    const msg = encodeServerMessage(ServerMessageType.ACTOR_MOVE, movePayload);
    mapInstance.broadcast(msg, session);

    // Also send to self (publish doesn't send to publisher)
    session.ws.send(msg);
  }

  // Persist to DB (fire and forget)
  updateCharacterPosition(
    session.characterId,
    session.mapId,
    endCellId,
    direction
  );

  // Wait for client walk animation to complete before firing triggers or edge transitions
  const steps = effectivePath.length - 1;
  const moveDuration = getMoveDurationMs(steps);

  // Fire trigger if path ended at one
  if (triggerAtEnd) {
    console.log(
      `[Movement] Trigger: map ${session.mapId} cell ${endCellId} -> map ${triggerAtEnd.targetMapId} cell ${triggerAtEnd.targetCellId} (waiting ${moveDuration}ms)`
    );
    await delay(moveDuration);
    await changeMap(
      session,
      triggerAtEnd.targetMapId,
      triggerAtEnd.targetCellId
    );
    return;
  }

  // Check if this is an edge cell for directional map transition
  await delayedEdgeTransition(session, endCellId, moveDuration);
}

/**
 * Wait for walk animation then check edge transition.
 */
async function delayedEdgeTransition(
  session: ClientSession,
  cellId: number,
  moveDurationMs: number
): Promise<void> {
  if (!session.mapId) return;

  const map = await getMap(session.mapId);
  if (!map) return;

  const transition = getEdgeTransitionDir(map, cellId);
  if (!transition) return;

  // Wait for client walk animation to complete before changing map
  await delay(moveDurationMs);
  await executeEdgeTransition(session, map, cellId, transition.dx, transition.dy);
}

/**
 * Check if a cell is on the edge of the map and return the exit direction.
 *
 * Dofus isometric grid edges:
 * - Top row (row 0) → north exit (y-1)
 * - Bottom row (last row) → south exit (y+1)
 * - Left column (col 0, long rows) → west exit (x-1)
 * - Right column (col W-1, long rows) → east exit (x+1)
 */
function getEdgeTransitionDir(
  map: { width: number; height: number },
  cellId: number
): { dx: number; dy: number } | null {
  const W = map.width;
  const H = map.height;
  const stride = 2 * W - 1;
  const totalRows = 2 * H - 1;

  // Determine cell position in the alternating grid
  const pair = Math.floor(cellId / stride);
  const offset = cellId % stride;
  const isLong = offset < W;
  const row = isLong ? 2 * pair : 2 * pair + 1;
  const col = isLong ? offset : offset - W;

  // Determine exit direction based on edge position
  let dx = 0;
  let dy = 0;

  // Top/bottom edge
  if (row <= 1) {
    dy = -1; // top → go to map above (y-1)
  } else if (row >= totalRows - 2) {
    dy = 1; // bottom → go to map below (y+1)
  }

  // Left/right edge
  if (col === 0) {
    dx = -1; // left edge
  } else if ((isLong && col === W - 1) || (!isLong && col === W - 2)) {
    dx = 1; // right edge
  }

  if (dx === 0 && dy === 0) return null;
  return { dx, dy };
}

async function executeEdgeTransition(
  session: ClientSession,
  map: { id: number; x: number; y: number; superarea: number },
  cellId: number,
  dx: number,
  dy: number
): Promise<void> {
  const targetMap = await db
    .selectFrom("maps")
    .select(["id", "walkable_ids", "width", "height"])
    .where("x", "=", map.x + dx)
    .where("y", "=", map.y + dy)
    .where("superarea", "=", map.superarea)
    .executeTakeFirst();

  if (!targetMap) {
    console.log(
      `[Movement] No map at (${map.x + dx}, ${map.y + dy}) for edge transition from map ${map.id} cell ${cellId}`
    );
    return;
  }

  const spawnCellId = findOppositeEdgeCell(
    targetMap.width,
    targetMap.height,
    dx,
    dy,
    targetMap.walkable_ids
  );

  console.log(
    `[Movement] Edge transition: map ${map.id} cell ${cellId} -> map ${targetMap.id} cell ${spawnCellId} (dx=${dx}, dy=${dy})`
  );
  await changeMap(session, targetMap.id, spawnCellId);
}

/**
 * Find a walkable cell on the opposite edge of the target map.
 * If entering from the right (dx=1), spawn on the left edge (col 0).
 * If entering from the top (dy=-1), spawn on the bottom edge (last row).
 */
function findOppositeEdgeCell(
  width: number,
  height: number,
  dx: number,
  dy: number,
  walkableIds: number[]
): number {
  const walkableSet = new Set(walkableIds);
  const stride = 2 * width - 1;
  const totalRows = 2 * height - 1;
  const totalCells = height * width + (height - 1) * (width - 1);

  // Helper: get cell ID from (row, col) in alternating grid
  function rowColToCell(row: number, col: number): number {
    const pair = Math.floor(row / 2);
    if (row % 2 === 0) {
      // Long row
      return pair * stride + col;
    }
    // Short row
    return pair * stride + width + col;
  }

  const candidates: number[] = [];

  if (dx === 1) {
    // Entered from the right → spawn on left edge (col 0)
    for (let r = 0; r < totalRows; r++) {
      const cellId = rowColToCell(r, 0);
      if (cellId < totalCells && walkableSet.has(cellId)) {
        candidates.push(cellId);
      }
    }
  } else if (dx === -1) {
    // Entered from the left → spawn on right edge
    for (let r = 0; r < totalRows; r++) {
      const maxCol = r % 2 === 0 ? width - 1 : width - 2;
      const cellId = rowColToCell(r, maxCol);
      if (cellId < totalCells && walkableSet.has(cellId)) {
        candidates.push(cellId);
      }
    }
  }

  if (dy === 1) {
    // Entered from the bottom → spawn on top edge (first rows)
    for (let col = 0; col < width; col++) {
      const cellId = rowColToCell(0, col);
      if (cellId < totalCells && walkableSet.has(cellId)) {
        candidates.push(cellId);
      }
    }
    // Also check row 1
    for (let col = 0; col < width - 1; col++) {
      const cellId = rowColToCell(1, col);
      if (cellId < totalCells && walkableSet.has(cellId)) {
        candidates.push(cellId);
      }
    }
  } else if (dy === -1) {
    // Entered from the top → spawn on bottom edge (last rows)
    const lastLongRow =
      (totalRows - 1) % 2 === 0 ? totalRows - 1 : totalRows - 2;
    const lastShortRow =
      (totalRows - 1) % 2 === 1 ? totalRows - 1 : totalRows - 2;

    for (let col = 0; col < width; col++) {
      const cellId = rowColToCell(lastLongRow, col);
      if (cellId < totalCells && walkableSet.has(cellId)) {
        candidates.push(cellId);
      }
    }
    for (let col = 0; col < width - 1; col++) {
      const cellId = rowColToCell(lastShortRow, col);
      if (cellId < totalCells && walkableSet.has(cellId)) {
        candidates.push(cellId);
      }
    }
  }

  if (candidates.length > 0) {
    // Pick the middle candidate for a natural spawn position
    return candidates[Math.floor(candidates.length / 2)];
  }

  // Fallback: first walkable cell
  return walkableIds[0] ?? 0;
}
