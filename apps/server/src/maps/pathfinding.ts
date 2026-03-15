import { DofusPathfinding } from "@dofus/grid";

import { getMap, getWalkableIds } from "./map-store.ts";

export { DofusPathfinding as MapPathfinding };

const pathfindingCache = new Map<number, DofusPathfinding>();

export async function getPathfinding(
  mapId: number
): Promise<DofusPathfinding | null> {
  const cached = pathfindingCache.get(mapId);
  if (cached) return cached;

  const map = await getMap(mapId);
  const walkableIds = await getWalkableIds(mapId);
  if (!map || !walkableIds) return null;

  const pf = new DofusPathfinding(map.width, map.height, walkableIds);
  pathfindingCache.set(mapId, pf);
  return pf;
}
