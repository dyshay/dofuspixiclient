import { Application, Container, Graphics, Text as PixiText } from 'pixi.js';
import { renderPanel, type RenderResult } from './renderer';
import type { PanelDef, PanelNode, Edges, GroupNode } from './schema';
import { edgesToRect, createPanelDef } from './schema';
import { generateCode } from './codegen';
import { History } from './history';
import { parsePanel } from './parser';
import { showGridSelector } from './grid-selector';

// ─── SVG Icons ───
const ICON = {
  plus: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  code: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4.5 3L1 7l3.5 4M9.5 3L13 7l-3.5 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  file: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 1h4l3 3v7H3V1z" stroke="currentColor" stroke-width="1.2"/><path d="M7 1v3h3" stroke="currentColor" stroke-width="1.2"/></svg>`,
  disk: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 1h6l2 2v7a1 1 0 01-1 1H3a1 1 0 01-1-1V1z" stroke="currentColor" stroke-width="1.1"/><rect x="4" y="1" width="4" height="3" rx=".5" stroke="currentColor" stroke-width="1"/><rect x="3" y="7" width="6" height="3" rx=".5" stroke="currentColor" stroke-width="1"/></svg>`,
  trash: `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4 3V2h4v1M3 3v7h6V3" stroke="currentColor" stroke-width="1.1"/></svg>`,
  layout: `<svg width="28" height="28" viewBox="0 0 28 28" fill="none"><rect x="2" y="2" width="24" height="24" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M2 8h24M10 8v18" stroke="currentColor" stroke-width="1.2"/><rect x="13" y="11" width="10" height="5" rx="1" stroke="currentColor" stroke-width="1" opacity=".5"/><rect x="13" y="19" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1" opacity=".5"/><rect x="4" y="11" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1" opacity=".5"/></svg>`,
};

// ─── Known project panel files (relative to electrobun/src/lib/) ───
const PROJECT_PANELS: Array<{ name: string; path: string; desc: string }> = [
  { name: 'inventory', path: 'hud/inventory/inventory-panel.ts', desc: 'Inventaire (équipement + grille items)' },
  { name: 'stats', path: 'hud/stats/stats-panel.ts', desc: 'Fiche personnage (stats + carac)' },
  { name: 'worldmap', path: 'hud/worldmap/world-map-panel.ts', desc: 'Carte du monde' },
  { name: 'timeline', path: 'hud/combat/timeline.ts', desc: 'Timeline de combat' },
  { name: 'action-bar', path: 'hud/combat/action-bar.ts', desc: 'Barre d\'actions combat' },
  { name: 'spell-bar', path: 'hud/combat/spell-bar.ts', desc: 'Barre de sorts' },
];

// ─── State ───
const STORAGE_KEY = 'dofus-ui-builder';

// Load saved panels from localStorage, or use builtins
const panels: Record<string, PanelDef> = loadFromStorage() ?? buildDefaultPanels();
let currentName = '';
let selectedNode: PanelNode | null = null;
let selectedNodes: Set<PanelNode> = new Set();
let app: Application | null = null;
let result: RenderResult | null = null;
let viewZoom = 1;
const snapSize = 4;
let snapEnabled = true;
let viewportMode = true;

const history = new History();

// Game viewport dimensions (Dofus 1.29)
const GAME_W = 860;
const GAME_H = 560;
const BANNER_H = 128;

// ─── Persistence ───
function saveToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(panels));
    history.markClean();
    updateTitle();
  } catch { /* quota exceeded */ }
}

function loadFromStorage(): Record<string, PanelDef> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* corrupt */ }
  return null;
}

function buildDefaultPanels(): Record<string, PanelDef> {
  return {};
}

function updateTitle(): void {
  const dot = history.isDirty() ? ' •' : '';
  const c = history.counts();
  document.title = `UI Builder — ${currentName}${dot}`;
  const status = document.getElementById('status');
  if (status) {
    status.textContent = `${dot ? '● unsaved' : '✓ saved'} | undo: ${c.undo} | redo: ${c.redo}`;
  }
}

/** Push a snapshot before making a change */
function pushHistory(): void {
  history.push(getDef());
  updateTitle();
}

function applyUndo(def: PanelDef | null): void {
  if (!def) return;
  panels[currentName] = def;
  clearSelection();
  
  syncPanelInputs();
  rebuild();
}

// ─── DOM refs ───
const canvasWrap = document.getElementById('canvas-wrap')!;
const propsEl = document.getElementById('props')!;
const jsonArea = document.getElementById('json-area') as HTMLTextAreaElement;
const codeArea = document.getElementById('code-area') as HTMLTextAreaElement;
const nodeTree = document.getElementById('node-tree')!;
const panelSelect = document.getElementById('panel-select') as HTMLSelectElement;
const panelNameInput = document.getElementById('panel-name') as HTMLInputElement;
const panelLInput = document.getElementById('panel-l') as HTMLInputElement;
const panelTInput = document.getElementById('panel-t') as HTMLInputElement;
const panelRInput = document.getElementById('panel-r') as HTMLInputElement;
const panelBInput = document.getElementById('panel-b') as HTMLInputElement;
const panelBgInput = document.getElementById('panel-bg') as HTMLInputElement;
const panelBorderInput = document.getElementById('panel-border') as HTMLInputElement;
const zoomLabel = document.getElementById('zoom-label')!;

function getDef(): PanelDef & { edges: Edges } {
  const d = panels[currentName] ?? { name: '', w: 0, h: 0, children: [] };
  if (!d.edges) d.edges = { l: 0, t: 0, r: d.w || 400, b: d.h || 300 };
  // Always sync w/h from edges (edges are the source of truth)
  d.w = d.edges.r - d.edges.l;
  d.h = d.edges.b - d.edges.t;
  return d as PanelDef & { edges: Edges };
}

/** Get edges for a node — creates from x/y/w/h if missing */
function getNodeEdges(node: PanelNode): Edges {
  if ('edges' in node && node.edges) return node.edges;
  const n = node as unknown as Record<string, unknown>;
  const x = (n.x as number) ?? 0;
  const y = (n.y as number) ?? 0;
  const w = (n.w as number) ?? (n.size as number) ?? 32;
  const h = (n.h as number) ?? (n.size as number) ?? 32;
  return { l: x, t: y, r: x + w, b: y + h };
}

/** Set edges on a node — also syncs x/y/w/h for backward compat */
function setNodeEdges(node: PanelNode, edges: Edges): void {
  (node as unknown as Record<string, unknown>).edges = edges;
  const rect = edgesToRect(edges);
  const n = node as unknown as Record<string, unknown>;
  if ('x' in n) n.x = rect.x;
  if ('y' in n) n.y = rect.y;
  if ('w' in n) n.w = rect.w;
  if ('h' in n) n.h = rect.h;
  if ('size' in n && !('w' in n)) n.size = Math.max(rect.w, rect.h);
}

function snap(v: number): number { return snapEnabled ? Math.round(v / snapSize) * snapSize : v; }

/** Find the _body group — where user nodes are added */
function getBodyGroup(def: PanelDef): GroupNode | null {
  return def.children.find(c => c.type === 'group' && c.id === '_body') as GroupNode ?? null;
}

/** Find the _header group */
function getHeaderGroup(def: PanelDef): GroupNode | null {
  return def.children.find(c => c.type === 'group' && c.id === '_header') as GroupNode ?? null;
}

/** Get the title text node inside the header */
function getHeaderTitle(def: PanelDef): PanelNode | null {
  const header = getHeaderGroup(def);
  if (!header) return null;
  return header.children.find(c => c.type === 'text') ?? null;
}

// ─── Tabs (JSON / Code) ───
const tabJson = document.getElementById('tab-json')!;
const tabCode = document.getElementById('tab-code')!;
const jsonWrap = document.getElementById('json-wrap')!;
const codeWrap = document.getElementById('code-wrap')!;

tabJson.addEventListener('click', () => {
  tabJson.style.borderBottomColor = '#0078d4'; tabJson.style.color = '#ccc';
  tabCode.style.borderBottomColor = 'transparent'; tabCode.style.color = '#666';
  jsonWrap.style.display = 'flex'; codeWrap.style.display = 'none';
});
tabCode.addEventListener('click', () => {
  tabCode.style.borderBottomColor = '#0078d4'; tabCode.style.color = '#ccc';
  tabJson.style.borderBottomColor = 'transparent'; tabJson.style.color = '#666';
  codeWrap.style.display = 'flex'; jsonWrap.style.display = 'none';
  codeArea.value = generateCode(getDef());
});

document.getElementById('btn-copy-code')!.addEventListener('click', () => {
  navigator.clipboard.writeText(codeArea.value);
  const btn = document.getElementById('btn-copy-code')!;
  btn.textContent = 'Copied!';
  setTimeout(() => { btn.textContent = 'Copy Code'; }, 1500);
});

// ─── Panel selector ───
function refreshPanelSelect() {
  panelSelect.innerHTML = '';
  for (const name of Object.keys(panels)) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    opt.selected = name === currentName;
    panelSelect.appendChild(opt);
  }
}

panelSelect.addEventListener('change', () => {
  openPanel(panelSelect.value);
});

document.getElementById('btn-home')!.addEventListener('click', () => {
  currentName = '';
  showWelcome();
});

document.getElementById('btn-new')!.addEventListener('click', async () => {
  const result = await showGridSelector();
  if (!result) return;
  const name = prompt('Nom du panel:', `panel_${Object.keys(panels).length}`) || `panel_${Date.now()}`;
  const def = createPanelDef(name, result.w, result.h);
  def.edges = result.edges;
  panels[name] = def;
  openPanel(name);
});

// ─── Panel properties ───
const panelTitleInput = document.getElementById('panel-title') as HTMLInputElement;
const panelHeaderBgInput = document.getElementById('panel-header-bg') as HTMLInputElement;

function syncPanelInputs() {
  const def = getDef();
  panelNameInput.value = def.name;
  panelLInput.value = String(def.edges.l);
  panelTInput.value = String(def.edges.t);
  panelRInput.value = String(def.edges.r);
  panelBInput.value = String(def.edges.b);
  // Get bg color from first rect child (the _bg node)
  const bgNode = def.children.find(c => c.type === 'rect' && 'fill' in c && c.fillAlpha !== 0);
  panelBgInput.value = '#' + ((bgNode as { fill?: number })?.fill ?? 0xddd7b2).toString(16).padStart(6, '0');
  // Get border color from last rect with stroke
  const borderNode = [...def.children].reverse().find(c => c.type === 'rect' && 'stroke' in c);
  panelBorderInput.value = '#' + ((borderNode as { stroke?: number })?.stroke ?? 0x8a7f5f).toString(16).padStart(6, '0');
  // Header title
  const titleNode = getHeaderTitle(def);
  panelTitleInput.value = (titleNode as { value?: string })?.value ?? def.name;
  // Header bg
  const headerGroup = getHeaderGroup(def);
  panelHeaderBgInput.value = '#' + (headerGroup?.fill ?? 0x5c5040).toString(16).padStart(6, '0');
}

panelTitleInput.addEventListener('input', () => {
  if (!currentName) return;
  const titleNode = getHeaderTitle(getDef());
  if (titleNode && 'value' in titleNode) {
    (titleNode as { value: string }).value = panelTitleInput.value;
    rebuild();
  }
});
panelHeaderBgInput.addEventListener('input', () => {
  if (!currentName) return;
  const header = getHeaderGroup(getDef());
  if (header) {
    header.fill = parseInt(panelHeaderBgInput.value.slice(1), 16);
    // Also update the rect children
    for (const child of header.children) {
      if (child.type === 'rect' && 'fill' in child) {
        (child as { fill: number }).fill = header.fill;
      }
    }
    rebuild();
  }
});

panelNameInput.addEventListener('input', () => {
  if (!currentName) return;
  const def = getDef();
  const old = currentName;
  def.name = panelNameInput.value || old;
  if (old !== def.name) {
    panels[def.name] = def; delete panels[old]; currentName = def.name;
    refreshPanelSelect();
  }
});
for (const [inputEl, edgeKey] of [
  [panelLInput, 'l'], [panelTInput, 't'], [panelRInput, 'r'], [panelBInput, 'b'],
] as const) {
  inputEl.addEventListener('input', () => {
    if (!currentName) return; pushHistory();
    const def = getDef();
    def.edges[edgeKey] = parseInt(inputEl.value) || 0;
    rebuild();
  });
}
panelBgInput.addEventListener('input', () => {
  if (!currentName) return; pushHistory();
  const color = parseInt(panelBgInput.value.slice(1), 16);
  const bgNode = getDef().children.find(c => c.type === 'rect' && 'fill' in c && (c as { fillAlpha?: number }).fillAlpha !== 0);
  if (bgNode) (bgNode as { fill: number }).fill = color;
  rebuild();
});
panelBorderInput.addEventListener('input', () => {
  if (!currentName) return; pushHistory();
  const color = parseInt(panelBorderInput.value.slice(1), 16);
  const borderNode = [...getDef().children].reverse().find(c => c.type === 'rect' && 'stroke' in c);
  if (borderNode) (borderNode as { stroke: number }).stroke = color;
  rebuild();
});

// ─── Toolbox ───
document.querySelectorAll<HTMLButtonElement>('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    pushHistory();
    const body = getBodyGroup(getDef());
    const target = body ? body.children : getDef().children;
    const newNode = createDefaultNode(btn.dataset.type!);
    target.push(newNode);
    selectSingle(newNode);
    rebuild();
  });
});

function createDefaultNode(type: string): PanelNode {
  const defs: Record<string, PanelNode> = {
    rect:           { type: 'rect', x: 20, y: 40, w: 80, h: 40, fill: 0xc4be96, fillAlpha: 1, radius: 0 },
    text:           { type: 'text', x: 20, y: 40, value: 'Label', size: 11, bold: true },
    slot:           { type: 'slot', x: 20, y: 40, size: 32, id: `slot_${Date.now() % 10000}` },
    sprite:         { type: 'sprite', x: 20, y: 40, w: 48, h: 48, src: '', alpha: 1 },
    bar:            { type: 'bar', x: 20, y: 40, w: 100, h: 10, value: 0.5, id: 'bar_new' },
    divider:        { type: 'divider', x: 20, y: 40, w: 100, h: 1 },
    'scroll-list':  { type: 'scroll-list', x: 20, y: 40, w: 200, h: 150, rowHeight: 28, rowCount: 20, id: 'list', rowTemplate: [
      { type: 'slot', x: 2, y: 2, size: 24, id: 'item' },
      { type: 'text', x: 30, y: 6, value: 'Item name', size: 10 },
    ]},
    'repeat-column': { type: 'repeat-column', x: 20, y: 40, count: 4, gap: 6, template: { type: 'slot', size: 28 }, idPrefix: 'col' },
    group:          { type: 'group', x: 20, y: 40, children: [] },
  };
  return structuredClone(defs[type] ?? defs.rect);
}

// ─── Toolbar ───
document.getElementById('btn-duplicate')!.addEventListener('click', () => {
  if (!selectedNode) return;
  pushHistory();
  const clone = structuredClone(selectedNode);
  if ('x' in clone) (clone as { x: number }).x += 16;
  if ('y' in clone) (clone as { y: number }).y += 16;
  // Find parent and insert after
  const def = getDef();
  const idx = def.children.indexOf(selectedNode);
  if (idx >= 0) {
    def.children.splice(idx + 1, 0, clone);
  } else {
    // Search in body group
    const body = getBodyGroup(def);
    if (body) {
      const bi = body.children.indexOf(selectedNode);
      if (bi >= 0) body.children.splice(bi + 1, 0, clone);
      else body.children.push(clone);
    } else {
      def.children.push(clone);
    }
  }
  selectSingle(clone);
  rebuild();
});

document.getElementById('btn-delete')!.addEventListener('click', () => {
  if (!selectedNode) return;
  pushHistory();
  const def = getDef();
  // Remove from top-level or from groups
  let removed = false;
  const idx = def.children.indexOf(selectedNode);
  if (idx >= 0) { def.children.splice(idx, 1); removed = true; }
  if (!removed) {
    for (const child of def.children) {
      if (child.type === 'group' && 'children' in child) {
        const gi = (child as { children: PanelNode[] }).children.indexOf(selectedNode);
        if (gi >= 0) { (child as { children: PanelNode[] }).children.splice(gi, 1); break; }
      }
    }
  }
  clearSelection();
  rebuild();
});

(document.getElementById('snap-toggle') as HTMLInputElement).addEventListener('change', (e) => {
  snapEnabled = (e.target as HTMLInputElement).checked;
});

(document.getElementById('viewport-toggle') as HTMLInputElement).addEventListener('change', (e) => {
  viewportMode = (e.target as HTMLInputElement).checked;
  rebuild();
});

document.getElementById('btn-zoom-in')!.addEventListener('click', () => { viewZoom = Math.min(3, viewZoom + 0.25); rebuild(); });
document.getElementById('btn-zoom-out')!.addEventListener('click', () => { viewZoom = Math.max(0.25, viewZoom - 0.25); rebuild(); });

document.getElementById('btn-export')!.addEventListener('click', () => {
  navigator.clipboard.writeText(JSON.stringify(getDef(), null, 2));
  const btn = document.getElementById('btn-export')!;
  btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy JSON'; }, 1500);
});

document.getElementById('btn-import')!.addEventListener('click', () => {
  try {
    const def = JSON.parse(jsonArea.value) as PanelDef;
    panels[def.name || 'imported'] = def;
    currentName = def.name || 'imported';
    clearSelection();
    refreshPanelSelect(); syncPanelInputs(); rebuild();
  } catch (e) { alert('Invalid JSON: ' + (e as Error).message); }
});

// Keyboard
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;

  // Undo/Redo/Save work even in inputs
  if (mod && e.key === 'z' && !e.shiftKey) {
    e.preventDefault();
    applyUndo(history.undo());
    return;
  }
  if (mod && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
    e.preventDefault();
    applyUndo(history.redo());
    return;
  }
  if (mod && e.key === 's') {
    e.preventDefault();
    saveToStorage();
    return;
  }

  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === 'Delete' || e.key === 'Backspace') document.getElementById('btn-delete')!.click();
  if (mod && e.key === 'd') { e.preventDefault(); document.getElementById('btn-duplicate')!.click(); }
  if (mod && e.key === 'a') { e.preventDefault(); selectAll(); }
  if (e.key === 'Escape') {
    clearSelection();
    
    rebuild();
  }
});

function selectAll() {
  const def = getDef();
  selectedNodes.clear();
  for (const child of def.children) {
    selectedNodes.add(child);
  }
  selectedNode = def.children[0] ?? null;
  rebuild();
}

function isNodeSelected(node: PanelNode): boolean {
  return selectedNodes.size > 0 ? selectedNodes.has(node) : node === selectedNode;
}

function getSelectedNodesList(): PanelNode[] {
  if (selectedNodes.size > 0) return [...selectedNodes];
  if (selectedNode) return [selectedNode];
  return [];
}

function clearSelection() {
  selectedNode = null;
  selectedNodes.clear();
}

function selectSingle(node: PanelNode) {
  selectedNodes.clear();
  selectedNode = node;
}

/** Find the parent group offset for a node (recursive) */
function getParentOffset(target: PanelNode, nodes: PanelNode[], ox = 0, oy = 0): { x: number; y: number } | null {
  for (const node of nodes) {
    if (node === target) return { x: ox, y: oy };
    if (node.type === 'group' && 'children' in node) {
      const gx = node.edges ? node.edges.l : (node.x ?? 0);
      const gy = node.edges ? node.edges.t : (node.y ?? 0);
      const found = getParentOffset(target, node.children, ox + gx, oy + gy);
      if (found) return found;
    }
  }
  return null;
}

/** Get edges in panel-root coordinates (accounts for parent group offsets) */
function getGlobalEdges(node: PanelNode): Edges {
  const local = getNodeEdges(node);
  const offset = getParentOffset(node, getDef().children);
  if (!offset) return local;
  return {
    l: local.l + offset.x,
    t: local.t + offset.y,
    r: local.r + offset.x,
    b: local.b + offset.y,
  };
}

/** Bounding box of all selected nodes (in panel-root coords) */
function getSelectionBounds(): { x: number; y: number; w: number; h: number } | null {
  const nodes = getSelectedNodesList();
  if (nodes.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const e = getGlobalEdges(node);
    minX = Math.min(minX, e.l);
    minY = Math.min(minY, e.t);
    maxX = Math.max(maxX, e.r);
    maxY = Math.max(maxY, e.b);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// ─── Node tree ───
const TYPE_ICONS: Record<string, string> = {
  rect: 'R', text: 'T', slot: 'S', sprite: 'I', bar: 'B',
  divider: '-', group: 'G', column: 'C', row: 'W',
  'repeat-column': 'x', 'scroll-list': 'L',
};

// Collapsed state for tree groups
const collapsedGroups = new Set<PanelNode>();

function renderTree() {
  nodeTree.innerHTML = '';
  const def = getDef();
  const body = getBodyGroup(def);
  const bodyNodes = new Set<PanelNode>();
  if (body) {
    function collect(nodes: PanelNode[]) {
      for (const n of nodes) {
        bodyNodes.add(n);
        if ('children' in n && Array.isArray((n as {children:PanelNode[]}).children))
          collect((n as {children:PanelNode[]}).children);
      }
    }
    collect(body.children);
  }

  // Panel root
  const rootDiv = document.createElement('div');
  rootDiv.className = 'tree-node';
  rootDiv.style.cssText = 'padding:4px 8px;color:#666;font-size:10px;border-bottom:1px solid #333;cursor:default';
  const w = def.edges?.r ? def.edges.r - def.edges.l : def.w;
  const h = def.edges?.b ? def.edges.b - def.edges.t : def.h;
  rootDiv.innerHTML = `<span class="type" style="color:#888">${def.name}</span> <span style="color:#444">${w} x ${h}</span>`;
  nodeTree.appendChild(rootDiv);

  // Structural nodes (header, bg, border) — shown dimmed, not selectable
  for (const child of def.children) {
    if (child === body) continue; // body is shown separately
    const id = ('id' in child && child.id) ? child.id : child.type;
    const row = document.createElement('div');
    row.className = 'tree-node';
    row.style.cssText = 'padding:3px 8px 3px 20px;font-size:10px;color:#444;cursor:default';
    const icon = TYPE_ICONS[child.type] ?? '?';
    row.innerHTML = `<span style="opacity:0.4;margin-right:3px">${icon}</span>${id}`;
    nodeTree.appendChild(row);
  }

  // Body content — user nodes (selectable)
  if (body && body.children.length > 0) {
    const bodyHeader = document.createElement('div');
    bodyHeader.style.cssText = 'padding:4px 8px;color:#555;font-size:9px;border-top:1px solid #2a2a2a;border-bottom:1px solid #2a2a2a;text-transform:uppercase;letter-spacing:1px';
    bodyHeader.textContent = 'Contenu';
    nodeTree.appendChild(bodyHeader);

    renderTreeChildren(body.children, 1, bodyNodes);
  }
}


function renderTreeChildren(nodes: PanelNode[], depth: number, _bodyNodes?: Set<PanelNode>) {
  for (const node of nodes) {
    const id = ('id' in node && node.id) ? node.id : null;
    const hasChildren = 'children' in node && Array.isArray((node as { children: PanelNode[] }).children);
    const isCollapsed = collapsedGroups.has(node);

    // Label
    let label: string = node.type;
    if (id) label = id;
    if (node.type === 'text') label = `"${(node as { value: string }).value?.substring(0, 16)}"`;

    const row = makeTreeRow(node, label, node.type, depth, hasChildren ? !isCollapsed : undefined);
    nodeTree.appendChild(row);

    // Recurse children
    if (hasChildren && !isCollapsed) {
      renderTreeChildren((node as { children: PanelNode[] }).children, depth + 1);
    }

    // Template info
    if (node.type === 'repeat-column' && !isCollapsed) {
      const info = makeTreeRow(null, `${node.count} slots`, 'template', depth + 1);
      info.style.opacity = '0.4';
      nodeTree.appendChild(info);
    }
  }
}

function makeTreeRow(
  node: PanelNode | null,
  label: string,
  typeStr: string,
  depth: number,
  expanded?: boolean, // undefined = not expandable
): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'tree-node' + (node && isNodeSelected(node) ? ' selected' : '');
  div.style.paddingLeft = `${6 + depth * 14}px`;
  div.style.cursor = 'pointer';

  // Expand/collapse arrow
  let arrow = '<span style="width:12px;display:inline-block"></span>';
  if (expanded != null) {
    arrow = `<span style="width:12px;display:inline-block;color:#555;font-size:9px">${expanded ? '▼' : '▶'}</span>`;
  }

  const typeIcon = TYPE_ICONS[typeStr] ?? '';
  const typeBadge = typeIcon
    ? `<span style="color:#555;background:#2a2a2a;border:1px solid #333;border-radius:2px;padding:0 3px;font-size:8px;margin-right:4px">${typeIcon}</span>`
    : '';

  const labelEl = document.createElement('span');
  labelEl.innerHTML = `${arrow}${typeBadge}<span class="type">${label}</span>`;
  div.appendChild(labelEl);

  if (node) {
    // Delete button
    const del = document.createElement('button');
    del.className = 'del-btn'; del.textContent = '×';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      pushHistory();
      removeNode(node);
      clearSelection();
      rebuild();
    });
    div.appendChild(del);

    // Click to select
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      // Toggle expand/collapse for groups
      if (expanded != null && e.offsetX < 6 + depth * 14 + 14) {
        if (collapsedGroups.has(node)) collapsedGroups.delete(node);
        else collapsedGroups.add(node);
        renderTree();
        return;
      }
      if (e.shiftKey) {
        if (selectedNodes.has(node)) selectedNodes.delete(node);
        else selectedNodes.add(node);
        selectedNode = node;
      } else {
        selectSingle(node);
      }
      rebuild();
    });
  }

  return div;
}

/** Remove a node from anywhere in the tree */
function removeNode(target: PanelNode) {
  function removeFrom(nodes: PanelNode[]): boolean {
    const idx = nodes.indexOf(target);
    if (idx >= 0) { nodes.splice(idx, 1); return true; }
    for (const n of nodes) {
      if ('children' in n && Array.isArray((n as { children: PanelNode[] }).children)) {
        if (removeFrom((n as { children: PanelNode[] }).children)) return true;
      }
    }
    return false;
  }
  removeFrom(getDef().children);
}

// ─── Props panel ───
function renderProps() {
  propsEl.innerHTML = '';
  if (!selectedNode) {
    propsEl.innerHTML = '<p class="hint">Select a node to edit.<br>Drag nodes on canvas to move.</p>';
    return;
  }

  const node = selectedNode;
  const h3 = document.createElement('h3');
  h3.textContent = node.type;
  propsEl.appendChild(h3);

  // ─── Edges (l, t, r, b) ───
  const edges = getNodeEdges(node);
  const edgeSection = document.createElement('div');
  edgeSection.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;margin-bottom:8px';
  for (const key of ['l', 't', 'r', 'b'] as const) {
    edgeSection.appendChild(makePropRow(key, edges[key], (v) => {
      pushHistory();
      edges[key] = v as number;
      setNodeEdges(node, edges);
      rebuild();
    }));
  }
  propsEl.appendChild(edgeSection);

  // ─── Other props ───
  const skip = new Set(['type', 'children', 'template', 'rowTemplate', 'interaction', 'edges', 'x', 'y', 'w', 'h']);
  for (const [key, value] of Object.entries(node)) {
    if (skip.has(key)) continue;
    propsEl.appendChild(makePropRow(key, value, (v) => {
      pushHistory();
      (node as unknown as Record<string, unknown>)[key] = v;
      rebuild();
    }));
  }

  // Template sub-props
  if (node.type === 'repeat-column' && node.template) {
    addSubProps('template', node.template, () => { pushHistory(); rebuild(); });
  }
  // Row template for scroll-list
  if (node.type === 'scroll-list' && node.rowTemplate) {
    const sub = document.createElement('h3');
    sub.textContent = `rowTemplate (${node.rowTemplate.length} items)`;
    sub.style.marginTop = '10px';
    propsEl.appendChild(sub);

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Edit row template items in JSON tab';
    propsEl.appendChild(hint);
  }

  // ─── Interaction section ───
  renderInteractionProps(node);
}

function renderInteractionProps(node: PanelNode) {
  const interaction: any = (node as any).interaction ?? {};

  const section = document.createElement('div');
  section.style.cssText = 'margin-top:12px;border-top:1px solid #3c3c3c;padding-top:8px';

  const toggle = document.createElement('button');
  toggle.style.cssText = 'background:none;border:1px solid #3c3c3c;color:#888;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:10px;width:100%;text-align:left';
  const hasInteraction = Object.keys(interaction).length > 0;
  toggle.textContent = hasInteraction ? '⚡ Interaction' : '+ Ajouter interaction';

  const content = document.createElement('div');
  content.style.cssText = 'margin-top:6px;' + (hasInteraction ? '' : 'display:none');

  // Bind field
  content.appendChild(makePropRow('bind.field', interaction.bind?.field ?? '', (v) => {
    pushHistory();
    if (!interaction.bind) interaction.bind = { field: '' };
    interaction.bind.field = v as string;
    (node as any).interaction = interaction;
    rebuild();
  }));

  // Tooltip
  content.appendChild(makePropRow('tooltip', interaction.tooltip ?? '', (v) => {
    pushHistory();
    interaction.tooltip = v as string;
    (node as any).interaction = interaction;
    rebuild();
  }));

  // Cursor
  content.appendChild(makePropRow('cursor', interaction.cursor ?? 'default', (v) => {
    pushHistory();
    interaction.cursor = v as string;
    (node as any).interaction = interaction;
    rebuild();
  }));

  // Events — simplified: one click action
  content.appendChild(makePropRow('onClick', interaction.events?.[0]?.action ?? '', (v) => {
    pushHistory();
    if (!interaction.events) interaction.events = [];
    if (interaction.events.length === 0) interaction.events.push({ event: 'click' });
    interaction.events[0].action = v as string;
    (node as any).interaction = interaction;
    rebuild();
  }));

  // Draggable checkbox
  content.appendChild(makePropRow('draggable', interaction.draggable ?? false, (v) => {
    pushHistory();
    interaction.draggable = v as boolean;
    (node as any).interaction = interaction;
    rebuild();
  }));

  // Drop target
  content.appendChild(makePropRow('dropTarget', interaction.dropTarget ?? '', (v) => {
    pushHistory();
    interaction.dropTarget = v as string;
    (node as any).interaction = interaction;
    rebuild();
  }));

  toggle.addEventListener('click', () => {
    content.style.display = content.style.display === 'none' ? '' : 'none';
  });

  section.appendChild(toggle);
  section.appendChild(content);
  propsEl.appendChild(section);
}

function addSubProps(title: string, obj: Record<string, unknown>, onChange: () => void) {
  const sub = document.createElement('h3');
  sub.textContent = title;
  sub.style.marginTop = '10px';
  propsEl.appendChild(sub);
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'type') continue;
    propsEl.appendChild(makePropRow(key, value, (v) => {
      obj[key] = v;
      onChange();
    }));
  }
}

/** Parse a color string: supports #51493c, 0x51493c, or raw decimal */
function parseColor(str: string): number {
  const s = str.trim();
  if (s.startsWith('#')) return parseInt(s.slice(1), 16) || 0;
  if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s.slice(2), 16) || 0;
  return parseInt(s, 10) || 0;
}

function colorToHex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function makePropRow(key: string, value: unknown, onChange: (v: unknown) => void): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'prop-row';
  const label = document.createElement('label');
  label.textContent = key;
  row.appendChild(label);

  const isColor = typeof value === 'number' &&
    ['fill', 'color', 'stroke', 'borderColor', 'border', 'bg'].includes(key);

  if (isColor) {
    const ci = document.createElement('input');
    ci.type = 'color';
    ci.value = colorToHex(value as number);
    row.appendChild(ci);

    // Text input for hex (#51493c or 0x51493c)
    const hi = document.createElement('input');
    hi.type = 'text';
    hi.value = colorToHex(value as number);
    hi.style.width = '80px';
    hi.placeholder = '#51493c';

    ci.addEventListener('input', () => {
      const v = parseInt(ci.value.slice(1), 16);
      hi.value = ci.value;
      onChange(v);
    });
    hi.addEventListener('input', () => {
      const v = parseColor(hi.value);
      ci.value = colorToHex(v);
      onChange(v);
    });
    row.appendChild(hi);
  } else if (key === 'radius' && typeof value === 'number') {
    // Range slider + number input for radius
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0'; range.max = '50'; range.step = '1';
    range.value = String(value);
    range.style.cssText = 'flex:1;height:16px;cursor:pointer';
    const num = document.createElement('input');
    num.type = 'number';
    num.value = String(value);
    num.style.width = '42px';
    num.min = '0';
    range.addEventListener('input', () => { num.value = range.value; onChange(parseInt(range.value)); });
    num.addEventListener('input', () => { range.value = num.value; onChange(parseInt(num.value) || 0); });
    row.appendChild(range);
    row.appendChild(num);
  } else if (key === 'fillAlpha' || key === 'alpha') {
    // Range slider for alpha 0..1
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0'; range.max = '1'; range.step = '0.05';
    range.value = String(value);
    range.style.cssText = 'flex:1;height:16px;cursor:pointer';
    const num = document.createElement('input');
    num.type = 'number';
    num.value = String(value);
    num.style.width = '50px';
    num.step = '0.05'; num.min = '0'; num.max = '1';
    range.addEventListener('input', () => { num.value = range.value; onChange(parseFloat(range.value)); });
    num.addEventListener('input', () => { range.value = num.value; onChange(parseFloat(num.value) || 0); });
    row.appendChild(range);
    row.appendChild(num);
  } else if (typeof value === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.style.width = 'auto';
    input.addEventListener('change', () => onChange(input.checked));
    row.appendChild(input);
  } else {
    const input = document.createElement('input');
    input.type = typeof value === 'number' ? 'number' : 'text';
    input.value = String(value ?? '');
    if (typeof value === 'number') input.step = '1';
    input.addEventListener('input', () => {
      if (typeof value === 'number') {
        onChange(parseFloat(input.value) || 0);
      } else {
        onChange(input.value);
      }
    });
    row.appendChild(input);
  }

  return row;
}

// ─── Resize handles ───
// We use a global resize state so the stage-level pointermove can drive it
// even after the handle Graphics is destroyed by rebuild().
let resizeState: {
  active: boolean;
  handlePos: string;
  startGX: number; startGY: number;
  origEdges: Edges;
  zoom: number;
  isPanel: boolean;
  origContainerX: number; origContainerY: number;
  origNodeEdges?: Edges[];
} | null = null;


const HANDLE_SIZE = 8;
const HANDLE_COLOR = 0x00aaff;

function addResizeHandles(panelContainer: Container, zoom: number) {
  const selected = getSelectedNodesList();
  if (selected.length === 0) return;
  const bounds = getSelectionBounds();
  if (!bounds) return;
  const isPanel = false;

  // Selection outline
  const selBox = new Graphics();
  selBox.rect(bounds.x - 1, bounds.y - 1, bounds.w + 2, bounds.h + 2);
  selBox.stroke({ color: HANDLE_COLOR, width: 1.5 });
  selBox.eventMode = 'none';
  panelContainer.addChild(selBox);

  // Size label
  const sizeLabel = new PixiText({
    text: `${Math.round(bounds.w)} x ${Math.round(bounds.h)}`,
    style: { fontSize: 9, fill: HANDLE_COLOR, fontFamily: 'monospace' },
  });
  sizeLabel.anchor.set(1, 0);
  sizeLabel.x = bounds.x + bounds.w;
  sizeLabel.y = bounds.y + bounds.h + 4;
  sizeLabel.alpha = 0.6;
  sizeLabel.eventMode = 'none';
  panelContainer.addChild(sizeLabel);

  // If multi-select, also outline each individual node
  if (!isPanel && selected.length > 1) {
    for (const node of selected) {
      if (!('x' in node && 'y' in node)) continue;
      const n = node as { x: number; y: number; w?: number; h?: number; size?: number };
      const nw = n.w ?? n.size ?? 32;
      const nh = n.h ?? n.size ?? 32;
      const indBox = new Graphics();
      indBox.rect(n.x, n.y, nw, nh);
      indBox.stroke({ color: 0x66ccff, width: 1 });
      indBox.eventMode = 'none';
      panelContainer.addChild(indBox);
    }
  }

  // Build edges from bounds
  const origEdges: Edges = { l: bounds.x, t: bounds.y, r: bounds.x + bounds.w, b: bounds.y + bounds.h };
  const bx = bounds.x, by = bounds.y, bw = bounds.w, bh = bounds.h;
  const corners: Array<{ pos: string; cx: number; cy: number; cursor: string }> = [
    { pos: 'tl', cx: bx,          cy: by,          cursor: 'nwse-resize' },
    { pos: 't',  cx: bx + bw / 2, cy: by,          cursor: 'ns-resize' },
    { pos: 'tr', cx: bx + bw,     cy: by,          cursor: 'nesw-resize' },
    { pos: 'l',  cx: bx,          cy: by + bh / 2, cursor: 'ew-resize' },
    { pos: 'r',  cx: bx + bw,     cy: by + bh / 2, cursor: 'ew-resize' },
    { pos: 'bl', cx: bx,          cy: by + bh,     cursor: 'nesw-resize' },
    { pos: 'b',  cx: bx + bw / 2, cy: by + bh,     cursor: 'ns-resize' },
    { pos: 'br', cx: bx + bw,     cy: by + bh,     cursor: 'nwse-resize' },
  ];

  for (const hp of corners) {
    const h = new Graphics();
    const hs = HANDLE_SIZE;
    h.rect(hp.cx - hs / 2, hp.cy - hs / 2, hs, hs);
    h.fill({ color: HANDLE_COLOR });
    h.stroke({ color: 0xffffff, width: 1 });
    h.eventMode = 'static';
    h.cursor = hp.cursor;

    h.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
      e.stopPropagation();
      pushHistory();
      resizeState = {
        active: true,
        handlePos: hp.pos,
        startGX: e.global.x, startGY: e.global.y,
        origEdges: { ...origEdges },
        zoom,
        isPanel,
        origContainerX: panelContainer.x, origContainerY: panelContainer.y,
      };
    });

    panelContainer.addChild(h);
  }
}


// Panel resize state (survives rebuild)

// Global drag state (survives rebuild)
let dragState: {
  active: boolean;
  node: PanelNode;
  startGX: number; startGY: number;
  origX: number; origY: number;
  zoom: number;
  _historyPushed?: boolean;
} | null = null;

// Throttle rebuild calls during drag/resize for real-time visual
let rebuildScheduled = false;
function scheduleRebuild() {
  if (rebuildScheduled) return;
  rebuildScheduled = true;
  requestAnimationFrame(() => {
    rebuildScheduled = false;
    rebuild();
  });
}

// Stage-level listeners for drag + resize (survive rebuild)
function initResizeListener() {
  if (!app) return;
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen;

  app.stage.on('globalpointermove', (e: import('pixi.js').FederatedPointerEvent) => {
    // Resize
    if (resizeState?.active) {
      const rs = resizeState;
      const dx = snap((e.global.x - rs.startGX) / rs.zoom);
      const dy = snap((e.global.y - rs.startGY) / rs.zoom);

      // New edges: only the dragged edges move
      const ne: Edges = { ...rs.origEdges };
      if (rs.handlePos.includes('l')) ne.l = rs.origEdges.l + dx;
      if (rs.handlePos.includes('r')) ne.r = rs.origEdges.r + dx;
      if (rs.handlePos.includes('t')) ne.t = rs.origEdges.t + dy;
      if (rs.handlePos.includes('b')) ne.b = rs.origEdges.b + dy;
      // Minimum size
      if (ne.r - ne.l < 8) { if (rs.handlePos.includes('l')) ne.l = ne.r - 8; else ne.r = ne.l + 8; }
      if (ne.b - ne.t < 8) { if (rs.handlePos.includes('t')) ne.t = ne.b - 8; else ne.b = ne.t + 8; }

      if (rs.isPanel) {
        // Panel: update edges — position is driven by edges directly
        const def = getDef();
        def.edges = { ...ne };
        panelLInput.value = String(ne.l);
        panelTInput.value = String(ne.t);
        panelRInput.value = String(ne.r);
        panelBInput.value = String(ne.b);
      } else {
        // Node(s): convert global edges back to local
        const selected = getSelectedNodesList();
        if (selected.length === 1) {
          const offset = getParentOffset(selected[0], getDef().children) ?? { x: 0, y: 0 };
          setNodeEdges(selected[0], {
            l: ne.l - offset.x, t: ne.t - offset.y,
            r: ne.r - offset.x, b: ne.b - offset.y,
          });
        } else if (selected.length > 1) {
          const ow = rs.origEdges.r - rs.origEdges.l;
          const oh = rs.origEdges.b - rs.origEdges.t;
          if (ow > 0 && oh > 0) {
            const scaleX = (ne.r - ne.l) / ow;
            const scaleY = (ne.b - ne.t) / oh;
            if (!rs.origNodeEdges) {
              rs.origNodeEdges = selected.map((node) => getGlobalEdges(node));
            }
            for (let i = 0; i < selected.length; i++) {
              const orig = rs.origNodeEdges[i];
              const offset = getParentOffset(selected[i], getDef().children) ?? { x: 0, y: 0 };
              const scaled: Edges = {
                l: snap(ne.l + (orig.l - rs.origEdges.l) * scaleX) - offset.x,
                t: snap(ne.t + (orig.t - rs.origEdges.t) * scaleY) - offset.y,
                r: snap(ne.l + (orig.r - rs.origEdges.l) * scaleX) - offset.x,
                b: snap(ne.t + (orig.b - rs.origEdges.t) * scaleY) - offset.y,
              };
              setNodeEdges(selected[i], scaled);
            }
          }
        }
      }
      scheduleRebuild();
      return;
    }

    // Drag
    if (dragState?.active) {
      const ds = dragState;
      // Push history on first move
      if (!ds._historyPushed) { pushHistory(); ds._historyPushed = true; }

      const newX = snap(ds.origX + (e.global.x - ds.startGX) / ds.zoom);
      const newY = snap(ds.origY + (e.global.y - ds.startGY) / ds.zoom);

      // Update node position
      const edges = getNodeEdges(ds.node);
      const w = edges.r - edges.l;
      const h = edges.b - edges.t;
      setNodeEdges(ds.node, { l: newX, t: newY, r: newX + w, b: newY + h });
      scheduleRebuild();
    }
  });

  const endInteraction = () => {
    if (resizeState) { resizeState.active = false; resizeState = null; }
    if (dragState) { dragState.active = false; dragState = null; }
  };

  app.stage.on('pointerup', endInteraction);
  app.stage.on('pointerupoutside', endInteraction);
}

// ─── Rebuild canvas ───
async function rebuild() {
  if (!currentName || !panels[currentName]) return;
  const def = getDef();

  if (!app) {
    app = new Application();
    await app.init({
      backgroundColor: 0x1a1a1a,
      antialias: true,
      resizeTo: canvasWrap,
    });
    canvasWrap.innerHTML = '';
    canvasWrap.appendChild(app.canvas);
    initResizeListener();
  }

  app.stage.removeChildren();

  // ─── Viewport preview mode ───
  if (viewportMode) {
    const screenW = app.screen.width;
    const screenH = app.screen.height;
    const vpScale = Math.min((screenW - 40) / GAME_W, (screenH - 40) / GAME_H) * 0.9;

    const vpX = (screenW - GAME_W * vpScale) / 2;
    const vpY = (screenH - GAME_H * vpScale) / 2;

    // Game area background
    const gameArea = new Graphics();
    gameArea.rect(vpX, vpY, GAME_W * vpScale, (GAME_H - BANNER_H) * vpScale);
    gameArea.fill({ color: 0x333333 });
    app.stage.addChild(gameArea);

    // "Game area" label
    const areaLabel = new PixiText({ text: 'Zone de jeu', style: { fontSize: 12, fill: 0x666666 } });
    areaLabel.x = vpX + 8; areaLabel.y = vpY + 8;
    app.stage.addChild(areaLabel);

    // Banner area
    const bannerArea = new Graphics();
    bannerArea.rect(vpX, vpY + (GAME_H - BANNER_H) * vpScale, GAME_W * vpScale, BANNER_H * vpScale);
    bannerArea.fill({ color: 0xd5cfaa });
    app.stage.addChild(bannerArea);

    const bannerLabel = new PixiText({ text: 'Banner', style: { fontSize: 10, fill: 0x666666 } });
    bannerLabel.x = vpX + 8; bannerLabel.y = vpY + (GAME_H - BANNER_H) * vpScale + 4;
    app.stage.addChild(bannerLabel);

    // Border
    const vpBorder = new Graphics();
    vpBorder.rect(vpX, vpY, GAME_W * vpScale, GAME_H * vpScale);
    vpBorder.stroke({ color: 0x555555, width: 1 });
    app.stage.addChild(vpBorder);

    // Panel inside viewport — positioned according to edges
    result = renderPanel(def);
    // vpScale maps game pixels to screen pixels
    result.container.scale.set(vpScale);
    // Position using the panel's edges (l, t in game coordinates)
    result.container.x = vpX + def.edges.l * vpScale;
    result.container.y = vpY + def.edges.t * vpScale;
    app.stage.addChild(result.container);

    // Show the grid workspace outline
    const wsOutline = new Graphics();
    wsOutline.rect(
      vpX + def.edges.l * vpScale,
      vpY + def.edges.t * vpScale,
      (def.edges.r - def.edges.l) * vpScale,
      (def.edges.b - def.edges.t) * vpScale,
    );
    wsOutline.stroke({ color: 0x0078d4, width: 1, alpha: 0.3 });
    wsOutline.eventMode = 'none';
    app.stage.addChild(wsOutline);
  } else {
    // ─── Normal edit mode (centered, no viewport) ───
    result = renderPanel(def);
    result.container.scale.set(viewZoom);
    result.container.x = (app.screen.width - def.w * viewZoom) / 2;
    result.container.y = (app.screen.height - def.h * viewZoom) / 2;
    // Note: in normal mode, edges don't affect visual position (panel is centered)
    app.stage.addChild(result.container);
  }


  // Track whether a node was clicked this frame (to prevent bg drag)
  let nodeClickedThisFrame = false;

  // Build set of user-selectable nodes (only nodes inside _body)
  const bodyGroup = getBodyGroup(def);
  const selectableNodes = new Set<PanelNode>();
  if (bodyGroup) {
    (function collectSelectable(nodes: PanelNode[]) {
      for (const n of nodes) {
        selectableNodes.add(n);
        if ('children' in n && Array.isArray((n as {children:PanelNode[]}).children)) {
          collectSelectable((n as {children:PanelNode[]}).children);
        }
      }
    })(bodyGroup.children);
  }

  const zoomForDrag = viewportMode ? (result?.container.scale.x ?? 1) : viewZoom;
  for (const entry of result!.nodes) {
    const isSelectable = selectableNodes.has(entry.node);

    entry.display.eventMode = 'static';
    entry.display.cursor = isSelectable ? 'move' : 'default';

    if (isSelectable) {
      // Create a transparent overlay in the root container (global coords)
      // to ensure click detection works regardless of Container nesting
      const ge = getGlobalEdges(entry.node);
      const overlay = new Graphics();
      overlay.rect(ge.l, ge.t, ge.r - ge.l, ge.b - ge.t);
      overlay.fill({ color: 0x000000, alpha: 0.001 });
      overlay.eventMode = 'static';
      overlay.cursor = 'move';
      result!.container.addChild(overlay);

      overlay.on('pointerdown', (e) => {
        e.stopPropagation();
        nodeClickedThisFrame = true;

        if (e.shiftKey) {
          selectedNodes.add(entry.node);
        } else {
          selectSingle(entry.node);
        }

        // Setup drag
        dragState = {
          active: true,
          node: entry.node,
          startGX: e.global.x, startGY: e.global.y,
          origX: ge.l, origY: ge.t,
          zoom: zoomForDrag,
        };

        scheduleRebuild();
      });
    }
  }

  // ─── Click anywhere → deselect if no node was clicked ───
  // Use app.stage so it catches clicks even on empty areas
  app.stage.on('pointerdown', () => {
    setTimeout(() => {
      if (nodeClickedThisFrame) { nodeClickedThisFrame = false; return; }
      if (selectedNode) {
        clearSelection();
        rebuild();
      }
    }, 0);
  });

  // ─── Resize handles on selected node (panel root is not resizable — use grid) ───
  if (getSelectedNodesList().length > 0) {
    addResizeHandles(result!.container, zoomForDrag);
  }

  zoomLabel.textContent = `${Math.round(viewZoom * 100)}%`;
  renderTree();
  renderProps();
  jsonArea.value = JSON.stringify(def, null, 2);
  // Update code if tab is active
  if (codeWrap.style.display !== 'none') {
    codeArea.value = generateCode(def);
  }
}

// ─── Init ───
// Ensure DOM is ready, then show welcome
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => showWelcome());
} else {
  showWelcome();
}

// Auto-save reminder on close
window.addEventListener('beforeunload', (e) => {
  if (history.isDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});


function showWelcome() {
  if (app) { app.destroy(true); app = null; }

  canvasWrap.innerHTML = '';
  const page = document.createElement('div');
  page.style.cssText = `
    width:100%; height:100%; overflow-y:auto;
    background:#161616;
    display:flex; flex-direction:column; align-items:center;
    padding:48px 24px 32px;
    font-family: 'Segoe UI', system-ui, sans-serif;
  `;

  // Subtle grid bg
  const gridBg = document.createElement('div');
  gridBg.style.cssText = `
    position:absolute; inset:0; opacity:0.04; pointer-events:none;
    background-image: linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px),
                      linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px);
    background-size: 40px 40px;
  `;
  page.style.position = 'relative';
  page.appendChild(gridBg);

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'text-align:center;margin-bottom:36px;position:relative;z-index:1';
  hdr.innerHTML = `
    <div style="color:#808080;margin-bottom:12px;display:inline-block">${ICON.layout}</div>
    <h1 style="color:#e8e8e8;font-size:22px;font-weight:600;margin:0 0 6px;letter-spacing:-0.3px">UI Builder</h1>
    <p style="color:#585858;font-size:12px;margin:0;font-weight:400">Panel editor for Dofus 1.29 HUD components</p>
  `;
  page.appendChild(hdr);

  // Action buttons
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:10px;max-width:480px;width:100%;margin-bottom:32px;position:relative;z-index:1';

  const newBtn = el('button', `
    background:#2a2a2a; border:1px solid #383838; color:#d0d0d0; padding:12px 18px;
    border-radius:6px; cursor:pointer; font-size:12px; flex:1;
    transition:all 0.15s; font-weight:500; display:flex; align-items:center; justify-content:center; gap:7px;
  `);
  newBtn.innerHTML = `${ICON.plus} Nouvelle interface`;
  hoverEffect(newBtn, '#333', '#2a2a2a', '#4a9');
  newBtn.addEventListener('click', async () => {
    const result = await showGridSelector();
    if (!result) return;
    const name = prompt('Nom du panel:', 'mon-panel') || 'mon-panel';
    const def = createPanelDef(name, result.w, result.h);
    def.edges = result.edges;
    panels[name] = def;
    openPanel(name);
  });
  actions.appendChild(newBtn);

  const pasteBtn = el('button', `
    background:#2a2a2a; border:1px solid #383838; color:#d0d0d0; padding:12px 18px;
    border-radius:6px; cursor:pointer; font-size:12px; flex:1;
    transition:all 0.15s; font-weight:500; display:flex; align-items:center; justify-content:center; gap:7px;
  `);
  pasteBtn.innerHTML = `${ICON.code} Importer du code TS`;
  hoverEffect(pasteBtn, '#333', '#2a2a2a', '#5a9fd4');
  pasteBtn.addEventListener('click', () => showPasteDialog());
  actions.appendChild(pasteBtn);
  page.appendChild(actions);

  // Project panels section
  page.appendChild(sectionDivider('Panels du projet'));
  const projectGrid = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:480px;width:100%;margin-bottom:28px;position:relative;z-index:1');
  for (const pf of PROJECT_PANELS) {
    projectGrid.appendChild(panelCard(
      pf.name,
      pf.desc,
      `${pf.path.split('/').pop()}`,
      ICON.file,
      '#b08840',
      async () => { await importProjectPanel(pf); },
    ));
  }
  page.appendChild(projectGrid);

  // Saved panels
  const savedNames = Object.keys(panels);
  if (savedNames.length > 0) {
    page.appendChild(sectionDivider(`Sauvegardés (${savedNames.length})`));
    const savedGrid = el('div', 'display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:480px;width:100%;margin-bottom:20px;position:relative;z-index:1');
    for (const name of savedNames) {
      const p = panels[name];
      savedGrid.appendChild(panelCard(
        name,
        `${p.w} x ${p.h}  --  ${p.children?.length ?? 0} nodes`,
        'local storage',
        ICON.disk,
        '#5a8fbf',
        () => openPanel(name),
      ));
    }
    page.appendChild(savedGrid);

    const clearBtn = el('button', 'background:none;border:none;color:#444;cursor:pointer;font-size:10px;position:relative;z-index:1;display:flex;align-items:center;gap:5px');
    clearBtn.innerHTML = `${ICON.trash} Effacer les sauvegardes`;
    clearBtn.addEventListener('mouseenter', () => { clearBtn.style.color = '#a44'; });
    clearBtn.addEventListener('mouseleave', () => { clearBtn.style.color = '#444'; });
    clearBtn.addEventListener('click', () => {
      if (!confirm('Supprimer tous les panels sauvegardés ?')) return;
      localStorage.removeItem(STORAGE_KEY);
      for (const key of Object.keys(panels)) delete panels[key];
      showWelcome();
    });
    page.appendChild(clearBtn);
  }

  // Shortcuts footer
  const footer = el('div', 'position:relative;z-index:1;margin-top:auto;padding-top:24px;display:flex;gap:16px');
  const shortcuts = [['Ctrl+Z', 'Undo'], ['Ctrl+S', 'Save'], ['Ctrl+A', 'Select all'], ['Del', 'Delete'], ['Ctrl+D', 'Duplicate']];
  for (const [key, label] of shortcuts) {
    const s = el('span', 'font-size:10px;color:#3a3a3a');
    s.innerHTML = `<kbd style="background:#222;border:1px solid #333;padding:1px 5px;border-radius:3px;font-family:inherit;color:#555;font-size:9px">${key}</kbd> ${label}`;
    footer.appendChild(s);
  }
  page.appendChild(footer);

  canvasWrap.appendChild(page);
}

// ─── Welcome helpers ───

function el(tag: string, css: string): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  return e;
}

function hoverEffect(btn: HTMLElement, hoverBg: string, baseBg: string, accentBorder: string) {
  btn.addEventListener('mouseenter', () => { btn.style.background = hoverBg; btn.style.borderColor = accentBorder; btn.style.transform = 'translateY(-1px)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = baseBg; btn.style.borderColor = '#383838'; btn.style.transform = 'none'; });
}

function sectionDivider(text: string): HTMLDivElement {
  const div = el('div', 'display:flex;align-items:center;gap:12px;max-width:480px;width:100%;margin-bottom:10px;position:relative;z-index:1') as HTMLDivElement;
  div.innerHTML = `
    <div style="flex:1;height:1px;background:#2a2a2a"></div>
    <span style="color:#4a4a4a;font-size:10px;text-transform:uppercase;letter-spacing:1.2px;font-weight:500">${text}</span>
    <div style="flex:1;height:1px;background:#2a2a2a"></div>
  `;
  return div;
}

function panelCard(title: string, desc: string, tag: string, icon: string, accentColor: string, onClick: () => void): HTMLButtonElement {
  const card = document.createElement('button');
  card.style.cssText = `
    background:#1e1e1e; border:1px solid #2a2a2a; color:#b0b0b0;
    padding:14px 10px 12px; border-radius:6px; cursor:pointer; font-size:11px; text-align:left;
    transition:all 0.15s; display:flex; flex-direction:column; gap:5px;
  `;
  card.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px">
      <span style="color:${accentColor}">${icon}</span>
      <span style="font-size:12px;font-weight:600;color:#d0d0d0">${title}</span>
    </div>
    <div style="font-size:9px;color:#505050;line-height:1.3">${desc}</div>
    <div style="font-size:9px;color:#3a3a3a;margin-top:1px">${tag}</div>
  `;
  card.addEventListener('mouseenter', () => { card.style.background = '#252525'; card.style.borderColor = accentColor + '66'; card.style.transform = 'translateY(-1px)'; });
  card.addEventListener('mouseleave', () => { card.style.background = '#1e1e1e'; card.style.borderColor = '#2a2a2a'; card.style.transform = 'none'; });
  card.addEventListener('click', onClick);
  return card;
}


async function importProjectPanel(pf: { name: string; path: string }) {
  try {
    const resp = await fetch(`/api/source?file=${encodeURIComponent(pf.path)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const source = await resp.text();
    const def = parsePanel(source);
    def.name = pf.name;
    panels[pf.name] = def;
    openPanel(pf.name);
  } catch {
    // Fallback: prompt user to paste the code manually
    showPasteDialog(pf.name);
  }
}

function showPasteDialog(defaultName?: string) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed; top:0; left:0; right:0; bottom:0; z-index:9999;
    background:rgba(10,10,10,0.85); backdrop-filter:blur(6px);
    display:flex; align-items:center; justify-content:center;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background:#1e1e1e; border:1px solid #3c3c3c; border-radius:12px;
    padding:24px 32px; max-width:700px; width:90%;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    display:flex; flex-direction:column; gap:12px;
  `;

  const pasteHeader = document.createElement('div');
  pasteHeader.innerHTML = `
    <h2 style="color:#e0e0e0;font-size:16px;margin:0 0 4px">Importer du code TypeScript</h2>
    <p style="color:#666;font-size:11px;margin:0">Colle le contenu d'un fichier panel (ex: stats-panel.ts, inventory-panel.ts)</p>
  `;
  modal.appendChild(pasteHeader);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = defaultName ?? '';
  nameInput.placeholder = 'Nom du panel';
  nameInput.style.cssText = 'background:#2a2a2a;border:1px solid #3c3c3c;color:#ccc;padding:8px 12px;border-radius:6px;font-size:13px;';
  modal.appendChild(nameInput);

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Colle le code TypeScript ici...';
  textarea.style.cssText = `
    background:#1a1a1a; color:#b5e853; border:1px solid #3c3c3c;
    border-radius:6px; padding:10px; font-family:'JetBrains Mono',monospace;
    font-size:11px; min-height:300px; resize:vertical; tab-size:2;
  `;
  modal.appendChild(textarea);

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;';

  const cancelBtn = el('button', 'background:#333;border:1px solid #444;color:#ccc;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:12px;flex:1;transition:all 0.15s') as HTMLButtonElement;
  cancelBtn.textContent = 'Annuler';
  hoverEffect(cancelBtn, '#444', '#333', '#666');
  cancelBtn.addEventListener('click', () => { overlay.remove(); });
  btnRow.appendChild(cancelBtn);

  const importBtn = el('button', 'background:#2a2a2a;border:1px solid #383838;color:#d0d0d0;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:12px;flex:1;transition:all 0.15s;font-weight:500') as HTMLButtonElement;
  importBtn.textContent = 'Importer';
  hoverEffect(importBtn, '#333', '#2a2a2a', '#5a9fd4');
  importBtn.addEventListener('click', () => {
    const source = textarea.value.trim();
    if (!source) { alert('Colle du code TypeScript'); return; }
    try {
      const def = parsePanel(source);
      def.name = nameInput.value || def.name || 'imported';
      panels[def.name] = def;
      overlay.remove();
      openPanel(def.name);
    } catch (e) {
      alert('Erreur de parsing: ' + (e as Error).message);
    }
  });
  btnRow.appendChild(importBtn);
  modal.appendChild(btnRow);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  textarea.focus();
}

function openPanel(name: string) {
  currentName = name;
  clearSelection();
  
  history.init(getDef());
  refreshPanelSelect();
  syncPanelInputs();
  updateTitle();
  rebuild();
}
