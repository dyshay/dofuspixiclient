import * as fs from "node:fs";
import * as path from "node:path";

import type { TileBehavior, TileClassifications, TileType } from "./types.ts";
import { inventoryTiles, loadExistingClassifications } from "./analyzer.ts";

interface ServerOptions {
  tilesDir: string;
  classificationsPath: string;
  port: number;
}

interface TileEntry {
  id: string;
  type: TileType;
  frameCount: number;
  behavior: TileBehavior;
  fps?: number;
  autoplay?: boolean;
  loop?: boolean;
  svgPaths: string[];
}

export function startServer(options: ServerOptions) {
  const { tilesDir, classificationsPath, port } = options;

  // Load or create classifications
  let classifications: TileClassifications = loadExistingClassifications(
    classificationsPath
  ) ?? {
    version: 1,
    generatedAt: new Date().toISOString(),
    ground: {},
    objects: {},
  };

  // Build tile inventory (multi-frame only for review)
  const groundInv = inventoryTiles(tilesDir, "ground");
  const objectsInv = inventoryTiles(tilesDir, "objects");

  const allTiles: TileEntry[] = [];

  for (const tile of groundInv) {
    const cls = classifications.ground[tile.id];
    const svgPaths = Array.from({ length: tile.frameCount }, (_, i) =>
      `/tiles/ground/${tile.id}/tile_${i}.svg`
    );

    allTiles.push({
      id: tile.id,
      type: "ground",
      frameCount: tile.frameCount,
      behavior: cls?.behavior ?? (tile.frameCount > 1 ? "slope" : "static"),
      fps: cls?.fps,
      autoplay: cls?.autoplay,
      loop: cls?.loop,
      svgPaths,
    });
  }

  for (const tile of objectsInv) {
    const cls = classifications.objects[tile.id];
    const svgPaths = Array.from({ length: tile.frameCount }, (_, i) =>
      `/tiles/objects/${tile.id}/tile_${i}.svg`
    );

    allTiles.push({
      id: tile.id,
      type: "objects",
      frameCount: tile.frameCount,
      behavior: cls?.behavior ?? (tile.frameCount > 1 ? "random" : "static"),
      fps: cls?.fps,
      autoplay: cls?.autoplay,
      loop: cls?.loop,
      svgPaths,
    });
  }

  // Sort: multi-frame first, then by type, then by id
  allTiles.sort((a, b) => {
    if (a.frameCount > 1 && b.frameCount <= 1) return -1;
    if (a.frameCount <= 1 && b.frameCount > 1) return 1;
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return parseInt(a.id, 10) - parseInt(b.id, 10);
  });

  function saveClassifications() {
    classifications.generatedAt = new Date().toISOString();
    fs.writeFileSync(classificationsPath, JSON.stringify(classifications, null, 2));
  }

  const multiFrameCount = allTiles.filter((t) => t.frameCount > 1).length;
  const totalCount = allTiles.length;

  console.log(
    `Serving ${totalCount} tiles (${multiFrameCount} multi-frame) on http://localhost:${port}`
  );

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // API: get all tiles
      if (url.pathname === "/api/tiles") {
        const filter = url.searchParams.get("filter"); // "multi" | "all"
        const typeFilter = url.searchParams.get("type"); // "ground" | "objects" | null
        const behaviorFilter = url.searchParams.get("behavior");

        let filtered = allTiles;

        if (filter === "multi") {
          filtered = filtered.filter((t) => t.frameCount > 1);
        }
        if (typeFilter) {
          filtered = filtered.filter((t) => t.type === typeFilter);
        }
        if (behaviorFilter) {
          filtered = filtered.filter((t) => t.behavior === behaviorFilter);
        }

        return Response.json(filtered);
      }

      // API: classify a single tile
      if (req.method === "PUT" && url.pathname.startsWith("/api/classify/")) {
        const parts = url.pathname.split("/");
        const type = parts[3] as TileType;
        const id = parts[4];

        if (!type || !id || (type !== "ground" && type !== "objects")) {
          return new Response("Bad request", { status: 400 });
        }

        const body = await req.json() as {
          behavior: TileBehavior;
          fps?: number;
          autoplay?: boolean;
          loop?: boolean;
        };

        const entry: { behavior: TileBehavior; fps?: number; autoplay?: boolean; loop?: boolean } = {
          behavior: body.behavior,
        };

        if (body.behavior === "animated" || body.behavior === "resource") {
          if (body.fps !== undefined) entry.fps = body.fps;
          if (body.autoplay !== undefined) entry.autoplay = body.autoplay;
          if (body.loop !== undefined) entry.loop = body.loop;
        }

        classifications[type][id] = entry;
        saveClassifications();

        // Update in-memory tile entry
        const tile = allTiles.find((t) => t.type === type && t.id === id);
        if (tile) {
          tile.behavior = body.behavior;
          tile.fps = body.fps;
          tile.autoplay = body.autoplay;
          tile.loop = body.loop;
        }

        return Response.json({ ok: true });
      }

      // API: stats
      if (url.pathname === "/api/stats") {
        const stats: Record<string, Record<string, number>> = {
          ground: {},
          objects: {},
        };

        for (const tile of allTiles) {
          stats[tile.type][tile.behavior] =
            (stats[tile.type][tile.behavior] ?? 0) + 1;
        }

        return Response.json(stats);
      }

      // Serve SVG files from tiles directory
      if (url.pathname.startsWith("/tiles/")) {
        const filePath = path.join(tilesDir, url.pathname.replace("/tiles/", ""));

        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath);
          return new Response(content, {
            headers: { "Content-Type": "image/svg+xml" },
          });
        }

        return new Response("Not found", { status: 404 });
      }

      // Serve HTML gallery
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(galleryHtml(multiFrameCount, totalCount), {
          headers: { "Content-Type": "text/html" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });
}

function galleryHtml(multiFrameCount: number, totalCount: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Tile Classifier</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #eee; padding: 16px; }

  .toolbar {
    position: sticky; top: 0; z-index: 100;
    background: #16213e; padding: 12px 16px; border-radius: 8px;
    display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
    margin-bottom: 16px; box-shadow: 0 4px 12px rgba(0,0,0,.4);
  }
  .toolbar label { font-size: 13px; color: #aaa; }
  .toolbar select, .toolbar input {
    background: #0f3460; color: #eee; border: 1px solid #444;
    padding: 4px 8px; border-radius: 4px; font-size: 13px;
  }
  .toolbar .stats { margin-left: auto; font-size: 13px; color: #7ec8e3; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }

  .tile-card {
    background: #16213e; border-radius: 8px; padding: 12px;
    border: 2px solid transparent; transition: border-color .15s;
  }
  .tile-card:hover { border-color: #0f3460; }
  .tile-card.classified { border-color: #1a936f33; }
  .tile-card.unclassified { border-color: #e7305b33; }

  .tile-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 8px;
  }
  .tile-id { font-weight: 600; font-size: 14px; }
  .tile-type {
    font-size: 11px; padding: 2px 6px; border-radius: 3px;
    background: #0f3460;
  }
  .tile-type.ground { background: #1a936f; }
  .tile-type.objects { background: #e7305b88; }

  .tile-meta { font-size: 11px; color: #888; margin-bottom: 8px; }

  .frames-container {
    display: flex; gap: 4px; flex-wrap: wrap; align-items: flex-end;
    margin-bottom: 10px; min-height: 60px;
    background: #111; border-radius: 4px; padding: 8px;
    overflow-x: auto;
  }
  .frames-container img {
    max-width: 80px; max-height: 80px; image-rendering: auto;
    border: 1px solid #333; border-radius: 2px; background: #222;
  }
  .frame-more {
    font-size: 11px; color: #666; padding: 4px 8px;
    background: #1a1a2e; border-radius: 3px; white-space: nowrap;
  }

  .tile-controls { display: flex; gap: 8px; align-items: center; }
  .tile-controls select {
    flex: 1; background: #0f3460; color: #eee; border: 1px solid #444;
    padding: 6px 8px; border-radius: 4px; font-size: 13px; cursor: pointer;
  }
  .tile-controls select:focus { border-color: #7ec8e3; outline: none; }

  .save-indicator {
    font-size: 11px; padding: 2px 6px; border-radius: 3px;
    transition: opacity .3s;
  }
  .save-indicator.saved { color: #1a936f; }
  .save-indicator.saving { color: #f0a500; }
  .save-indicator.error { color: #e7305b; }

  .anim-preview {
    position: relative; cursor: pointer;
  }
  .anim-preview img { transition: opacity .15s; }

  .loading { text-align: center; padding: 40px; color: #666; }
  .empty { text-align: center; padding: 40px; color: #666; }

  .progress-bar {
    height: 4px; background: #333; border-radius: 2px; overflow: hidden;
  }
  .progress-fill {
    height: 100%; background: #1a936f; transition: width .3s;
  }
</style>
</head>
<body>

<div class="toolbar">
  <label>Filter:
    <select id="filterFrames">
      <option value="multi">Multi-frame only (${multiFrameCount})</option>
      <option value="all">All tiles (${totalCount})</option>
    </select>
  </label>
  <label>Type:
    <select id="filterType">
      <option value="">All</option>
      <option value="ground">Ground</option>
      <option value="objects">Objects</option>
    </select>
  </label>
  <label>Behavior:
    <select id="filterBehavior">
      <option value="">All</option>
      <option value="static">Static</option>
      <option value="slope">Slope</option>
      <option value="animated">Animated</option>
      <option value="random">Random</option>
      <option value="resource">Resource</option>
    </select>
  </label>
  <label>Search:
    <input id="searchId" type="text" placeholder="Tile ID..." style="width: 80px">
  </label>
  <div class="stats" id="stats">Loading...</div>
</div>

<div class="progress-bar"><div class="progress-fill" id="progress" style="width:0%"></div></div>
<div class="grid" id="grid"></div>
<div class="loading" id="loading">Loading tiles...</div>

<script>
let allTiles = [];
let currentTiles = [];
const BEHAVIORS = ['static', 'slope', 'animated', 'random', 'resource'];
const BEHAVIOR_COLORS = {
  static: '#888', slope: '#1a936f', animated: '#f0a500',
  random: '#7ec8e3', resource: '#e7305b'
};
const MAX_PREVIEW_FRAMES = 6;

async function loadTiles() {
  const filter = document.getElementById('filterFrames').value;
  const type = document.getElementById('filterType').value;
  const behavior = document.getElementById('filterBehavior').value;
  const search = document.getElementById('searchId').value.trim();

  const params = new URLSearchParams();
  if (filter) params.set('filter', filter);
  if (type) params.set('type', type);
  if (behavior) params.set('behavior', behavior);

  const res = await fetch('/api/tiles?' + params);
  allTiles = await res.json();

  if (search) {
    currentTiles = allTiles.filter(t => t.id.includes(search));
  } else {
    currentTiles = allTiles;
  }

  renderGrid();
  updateStats();
}

function renderGrid() {
  const grid = document.getElementById('grid');
  const loading = document.getElementById('loading');
  loading.style.display = 'none';

  if (currentTiles.length === 0) {
    grid.innerHTML = '<div class="empty">No tiles match filters</div>';
    return;
  }

  // Virtualize: only render visible tiles (batch of 100)
  grid.innerHTML = '';
  renderBatch(0);
}

function renderBatch(startIdx) {
  const grid = document.getElementById('grid');
  const BATCH = 100;
  const end = Math.min(startIdx + BATCH, currentTiles.length);

  for (let i = startIdx; i < end; i++) {
    const tile = currentTiles[i];
    grid.appendChild(createTileCard(tile));
  }

  if (end < currentTiles.length) {
    // Intersection observer for lazy loading
    const sentinel = document.createElement('div');
    sentinel.className = 'loading';
    sentinel.textContent = 'Loading more... (' + end + '/' + currentTiles.length + ')';
    sentinel.id = 'sentinel';
    grid.appendChild(sentinel);

    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        sentinel.remove();
        renderBatch(end);
      }
    });
    observer.observe(sentinel);
  }
}

function createTileCard(tile) {
  const card = document.createElement('div');
  card.className = 'tile-card';
  card.id = 'tile-' + tile.type + '-' + tile.id;

  const previewCount = Math.min(tile.svgPaths.length, MAX_PREVIEW_FRAMES);
  const hasMore = tile.svgPaths.length > MAX_PREVIEW_FRAMES;

  let framesHtml = '';
  for (let i = 0; i < previewCount; i++) {
    framesHtml += '<img src="' + tile.svgPaths[i] + '" loading="lazy" title="Frame ' + i + '">';
  }
  if (hasMore) {
    framesHtml += '<span class="frame-more">+' + (tile.svgPaths.length - MAX_PREVIEW_FRAMES) + ' more</span>';
  }

  card.innerHTML =
    '<div class="tile-header">' +
      '<span class="tile-id">#' + tile.id + '</span>' +
      '<span class="tile-type ' + tile.type + '">' + tile.type + '</span>' +
    '</div>' +
    '<div class="tile-meta">' + tile.frameCount + ' frame' + (tile.frameCount > 1 ? 's' : '') + '</div>' +
    '<div class="frames-container">' + framesHtml + '</div>' +
    '<div class="tile-controls">' +
      '<select data-type="' + tile.type + '" data-id="' + tile.id + '" onchange="classify(this)">' +
        BEHAVIORS.map(b =>
          '<option value="' + b + '"' + (b === tile.behavior ? ' selected' : '') + '>' + b + '</option>'
        ).join('') +
      '</select>' +
      '<span class="save-indicator" id="indicator-' + tile.type + '-' + tile.id + '"></span>' +
    '</div>';

  return card;
}

async function classify(select) {
  const type = select.dataset.type;
  const id = select.dataset.id;
  const behavior = select.value;

  const indicator = document.getElementById('indicator-' + type + '-' + id);
  indicator.textContent = '...';
  indicator.className = 'save-indicator saving';

  try {
    const body = { behavior };

    // Default animation properties for animated tiles
    if (behavior === 'animated') {
      body.fps = 60;
      body.autoplay = true;
      body.loop = true;
    }

    const res = await fetch('/api/classify/' + type + '/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      indicator.textContent = 'saved';
      indicator.className = 'save-indicator saved';
      // Update local state
      const tile = allTiles.find(t => t.type === type && t.id === id);
      if (tile) tile.behavior = behavior;
      updateStats();
      setTimeout(() => { indicator.textContent = ''; }, 1500);
    } else {
      indicator.textContent = 'error';
      indicator.className = 'save-indicator error';
    }
  } catch (e) {
    indicator.textContent = 'error';
    indicator.className = 'save-indicator error';
  }
}

async function updateStats() {
  const res = await fetch('/api/stats');
  const stats = await res.json();
  const el = document.getElementById('stats');

  const parts = [];
  for (const [type, behaviors] of Object.entries(stats)) {
    const items = Object.entries(behaviors).map(([b, c]) => b + ': ' + c).join(', ');
    parts.push(type + ' [' + items + ']');
  }
  el.textContent = parts.join(' | ');
}

// Event listeners
document.getElementById('filterFrames').addEventListener('change', loadTiles);
document.getElementById('filterType').addEventListener('change', loadTiles);
document.getElementById('filterBehavior').addEventListener('change', loadTiles);
document.getElementById('searchId').addEventListener('input', () => {
  const search = document.getElementById('searchId').value.trim();
  if (search) {
    currentTiles = allTiles.filter(t => t.id.includes(search));
  } else {
    currentTiles = allTiles;
  }
  renderGrid();
});

// Initial load
loadTiles();
</script>
</body>
</html>`;
}
