import * as fs from "node:fs";
import * as path from "node:path";

import type {
  PhpManifest,
  PhpManifestEntry,
  TileBehavior,
  TileClassification,
  TileClassifications,
  TileInventory,
  TileOverrides,
  TileType,
} from "./types.ts";

/**
 * Scan a tile type directory and inventory all tiles with their frame counts.
 */
export function inventoryTiles(
  tilesDir: string,
  type: TileType
): TileInventory[] {
  const typeDir = path.join(tilesDir, type);

  if (!fs.existsSync(typeDir)) {
    return [];
  }

  const entries = fs
    .readdirSync(typeDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .sort((a, b) => parseInt(a.name, 10) - parseInt(b.name, 10));

  const inventory: TileInventory[] = [];

  for (const entry of entries) {
    const tileDir = path.join(typeDir, entry.name);
    const svgFiles = fs
      .readdirSync(tileDir)
      .filter((f) => f.endsWith(".svg"))
      .sort();

    if (svgFiles.length === 0) continue;

    const fileSizes = svgFiles.map(
      (f) => fs.statSync(path.join(tileDir, f)).size
    );

    inventory.push({
      id: entry.name,
      type,
      frameCount: svgFiles.length,
      fileSizes,
    });
  }

  return inventory;
}

/**
 * Load the PHP-generated manifest for a tile type.
 * Returns a map of tileId -> PhpManifestEntry.
 */
export function loadPhpManifest(
  manifestPath: string
): Map<string, PhpManifestEntry> {
  const entries = new Map<string, PhpManifestEntry>();

  if (!fs.existsSync(manifestPath)) {
    return entries;
  }

  const data: PhpManifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  for (const [key, value] of Object.entries(data)) {
    if (key === "metadata") continue;

    const entry = value as PhpManifestEntry;
    if (entry.id !== undefined) {
      entries.set(String(entry.id), entry);
    }
  }

  return entries;
}

/**
 * Load manual overrides file.
 */
export function loadOverrides(overridesPath: string): TileOverrides {
  if (!fs.existsSync(overridesPath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(overridesPath, "utf-8"));
}

/**
 * Load existing classifications file (for incremental updates).
 */
export function loadExistingClassifications(
  classPath: string
): TileClassifications | null {
  if (!fs.existsSync(classPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(classPath, "utf-8"));
}

/**
 * Normalize a behavior string from the PHP manifest into our TileBehavior type.
 * Unknown values fall through to heuristic classification.
 */
function normalizePhpBehavior(behavior: string): TileBehavior | null {
  switch (behavior) {
    case "static":
      return "static";
    case "slope":
      return "slope";
    case "animated":
      return "animated";
    case "random":
      return "random";
    case "resource":
      return "resource";
    default:
      return null;
  }
}

/**
 * Apply heuristic classification for a tile based on its inventory data.
 * This is the fallback when no PHP manifest or overrides data is available.
 *
 * Heuristic rules:
 * - 1 frame → static
 * - Ground + multi-frame → slope
 * - Object + multi-frame → random (safe default — avoids flicker)
 */
function classifyByHeuristic(tile: TileInventory): TileClassification {
  if (tile.frameCount <= 1) {
    return { behavior: "static" };
  }

  if (tile.type === "ground") {
    return { behavior: "slope" };
  }

  // For objects with multiple frames, default to "random" as the safe choice.
  // Wrongly classifying as "animated" causes flicker (cycling through all frames).
  // Wrongly classifying as "random" just shows a static variant (no flicker).
  return { behavior: "random" };
}

/**
 * Classify a single tile by merging data from inventory, PHP manifest, and overrides.
 *
 * Priority: overrides > PHP manifest > heuristic
 */
function classifyTile(
  tile: TileInventory,
  phpEntry: PhpManifestEntry | undefined,
  override: Partial<TileClassification> | undefined
): TileClassification {
  // Start with heuristic baseline
  let classification = classifyByHeuristic(tile);

  // Layer on PHP manifest data if available
  if (phpEntry) {
    const phpBehavior = normalizePhpBehavior(phpEntry.behavior);

    if (phpBehavior) {
      classification.behavior = phpBehavior;
    }

    if (phpEntry.fps !== undefined) {
      classification.fps = phpEntry.fps;
    }
    if (phpEntry.autoplay !== undefined) {
      classification.autoplay = phpEntry.autoplay;
    }
    if (phpEntry.loop !== undefined) {
      classification.loop = phpEntry.loop;
    }
  }

  // Layer on manual overrides (highest priority)
  if (override) {
    if (override.behavior) {
      classification.behavior = override.behavior;
    }
    if (override.fps !== undefined) {
      classification.fps = override.fps;
    }
    if (override.autoplay !== undefined) {
      classification.autoplay = override.autoplay;
    }
    if (override.loop !== undefined) {
      classification.loop = override.loop;
    }
  }

  // Static tiles shouldn't have animation properties
  if (classification.behavior === "static") {
    delete classification.fps;
    delete classification.autoplay;
    delete classification.loop;
  }

  // Only animated tiles need fps/autoplay/loop
  if (
    classification.behavior !== "animated" &&
    classification.behavior !== "resource"
  ) {
    delete classification.fps;
    delete classification.autoplay;
    delete classification.loop;
  }

  return classification;
}

export interface ClassifyOptions {
  tilesDir: string;
  phpManifestDir?: string;
  overridesPath?: string;
  existingPath?: string;
}

export interface ClassifyResult {
  classifications: TileClassifications;
  stats: {
    ground: Record<TileBehavior, number>;
    objects: Record<TileBehavior, number>;
    total: number;
    fromPhp: number;
    fromOverrides: number;
    fromHeuristic: number;
  };
}

/**
 * Run the full classification pipeline.
 */
export function classify(options: ClassifyOptions): ClassifyResult {
  const { tilesDir, phpManifestDir, overridesPath } = options;

  // 1. Inventory all tiles from SVG directories
  const groundInventory = inventoryTiles(tilesDir, "ground");
  const objectsInventory = inventoryTiles(tilesDir, "objects");

  // 2. Load PHP manifests if available
  const groundPhp = phpManifestDir
    ? loadPhpManifest(path.join(phpManifestDir, "ground", "manifest.json"))
    : new Map<string, PhpManifestEntry>();

  const objectsPhp = phpManifestDir
    ? loadPhpManifest(path.join(phpManifestDir, "objects", "manifest.json"))
    : new Map<string, PhpManifestEntry>();

  // 3. Load overrides if available
  const overrides = overridesPath ? loadOverrides(overridesPath) : {};

  // 4. Classify each tile
  const stats = {
    ground: { static: 0, slope: 0, animated: 0, random: 0, resource: 0 },
    objects: { static: 0, slope: 0, animated: 0, random: 0, resource: 0 },
    total: 0,
    fromPhp: 0,
    fromOverrides: 0,
    fromHeuristic: 0,
  };

  const groundClassifications: Record<string, TileClassification> = {};

  for (const tile of groundInventory) {
    const phpEntry = groundPhp.get(tile.id);
    const override = overrides.ground?.[tile.id];

    const classification = classifyTile(tile, phpEntry, override);
    groundClassifications[tile.id] = classification;

    stats.ground[classification.behavior]++;
    stats.total++;

    if (override?.behavior) {
      stats.fromOverrides++;
    } else if (phpEntry) {
      stats.fromPhp++;
    } else {
      stats.fromHeuristic++;
    }
  }

  const objectsClassifications: Record<string, TileClassification> = {};

  for (const tile of objectsInventory) {
    const phpEntry = objectsPhp.get(tile.id);
    const override = overrides.objects?.[tile.id];

    const classification = classifyTile(tile, phpEntry, override);
    objectsClassifications[tile.id] = classification;

    stats.objects[classification.behavior]++;
    stats.total++;

    if (override?.behavior) {
      stats.fromOverrides++;
    } else if (phpEntry) {
      stats.fromPhp++;
    } else {
      stats.fromHeuristic++;
    }
  }

  const classifications: TileClassifications = {
    version: 1,
    generatedAt: new Date().toISOString(),
    ground: groundClassifications,
    objects: objectsClassifications,
  };

  return { classifications, stats };
}
