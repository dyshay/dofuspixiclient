import { decompressSync } from 'fflate';

import { CELL_HEIGHT, CELL_WIDTH, DEFAULT_HEIGHT, DEFAULT_WIDTH, DISPLAY_HEIGHT, DISPLAY_WIDTH } from '@/constants/battlefield';

import type { CellData } from './cell';

export interface MapData {
  id: number;
  width: number;
  height: number;
  backgroundNum?: number;
  cells: CellData[];
  triggerCellIds?: number[];
}

export interface MapScale {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface MapBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function computeMapScale(mapWidth: number, mapHeight: number): MapScale {
  if (mapHeight === DEFAULT_HEIGHT && mapWidth === DEFAULT_WIDTH) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  let scale = 1;
  let actualWidth: number;
  let actualHeight: number;

  if (mapHeight > DEFAULT_HEIGHT && mapWidth > DEFAULT_WIDTH) {
    const totalWidth = (mapWidth - 1) * CELL_WIDTH;
    const totalHeight = (mapHeight - 1) * CELL_HEIGHT;

    scale = mapHeight > mapWidth
      ? DISPLAY_WIDTH / totalWidth
      : DISPLAY_HEIGHT / totalHeight;

    actualWidth = Math.floor(totalWidth * scale);
    actualHeight = Math.floor(totalHeight * scale);
  } else {
    scale = 1;
    actualWidth = (mapWidth - 1) * CELL_WIDTH;
    actualHeight = (mapHeight - 1) * CELL_HEIGHT;
  }

  if (actualWidth === DISPLAY_WIDTH && actualHeight === DISPLAY_HEIGHT) {
    return { scale, offsetX: 0, offsetY: 0 };
  }

  const offsetX = (DISPLAY_WIDTH - actualWidth) / 2;
  const offsetY = (DISPLAY_HEIGHT - actualHeight) / 2;

  return {
    scale,
    offsetX: Math.trunc(offsetX),
    offsetY: Math.trunc(offsetY),
  };
}

export async function loadMapData(mapId: number): Promise<MapData> {
  const response = await fetch(`/assets/maps/${mapId}.json`);
  return response.json();
}

export interface ServerMapDataPayload {
  mapId: number;
  width: number;
  height: number;
  background: number;
  compressed: Uint8Array;
  encoding: 'gzip';
  triggerCellIds?: number[];
}

export function loadMapDataFromServer(payload: ServerMapDataPayload): MapData {
  const compressed = payload.compressed instanceof Uint8Array
    ? payload.compressed
    : new Uint8Array(payload.compressed);
  const decompressed = decompressSync(compressed);
  const json = new TextDecoder().decode(decompressed);
  const cells: CellData[] = JSON.parse(json);

  return {
    id: payload.mapId,
    width: payload.width,
    height: payload.height,
    backgroundNum: payload.background,
    cells,
    triggerCellIds: payload.triggerCellIds,
  };
}
