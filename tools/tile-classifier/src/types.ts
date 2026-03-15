/**
 * Tile behavior types.
 *
 * - static:   single frame, no animation
 * - slope:    ground tile with frames indexed by groundSlope
 * - animated: auto-playing animation loop
 * - random:   one frame picked per cell (cellId % frameCount)
 * - resource: interactive/harvestable object (manually classified)
 */
export type TileBehavior = "static" | "slope" | "animated" | "random" | "resource";

export type TileType = "ground" | "objects";

/** Per-tile classification entry */
export interface TileClassification {
  behavior: TileBehavior;
  fps?: number;
  autoplay?: boolean;
  loop?: boolean;
}

/** The full classifications file */
export interface TileClassifications {
  version: 1;
  generatedAt: string;
  ground: Record<string, TileClassification>;
  objects: Record<string, TileClassification>;
}

/** A single entry from the PHP-generated manifest */
export interface PhpManifestEntry {
  id: number;
  source: string;
  format: string;
  behavior: string;
  frameCount: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  fps?: number;
  autoplay?: boolean;
  loop?: boolean;
  frames?: Array<{ index: number; file: string }>;
}

/** PHP-generated manifest with metadata header + tile-{id} entries */
export interface PhpManifest {
  metadata: {
    generatedAt: string;
    version: string;
    format: string;
    totalTiles: number;
  };
  [key: string]: PhpManifestEntry | PhpManifest["metadata"];
}

/** Manual overrides file (sparse — only entries the user wants to fix) */
export interface TileOverrides {
  ground?: Record<string, Partial<TileClassification>>;
  objects?: Record<string, Partial<TileClassification>>;
}

/** Inventory of a tile directory (frame count from actual SVG files) */
export interface TileInventory {
  id: string;
  type: TileType;
  frameCount: number;
  fileSizes: number[];
}
