/**
 * Declarative panel definition schema.
 *
 * A panel is described as a tree of nodes. The renderer walks the tree
 * and creates Pixi.js display objects. This keeps the definition pure
 * data — no Pixi imports, serializable as JSON.
 */

// ─── Interactions & data bindings ─────────────────────────────

/** Bind a node's display value to a protocol/data field */
export interface DataBinding {
  /** Data path: e.g. "inventory.kamas", "character.hp", "item.quantity" */
  field: string;
  /** How to format the value for display */
  format?: 'number' | 'percent' | 'text';
}

/** Event handler declaration */
export interface EventHandler {
  /** Event type */
  event: 'click' | 'hover' | 'drag' | 'drop';
  /** Protocol message to send: e.g. "INVENTORY_MOVE", "INVENTORY_USE" */
  action?: string;
  /** Emit a local UI event: e.g. "select-item", "toggle-filter" */
  emit?: string;
  /** Payload template — keys reference data paths */
  payload?: Record<string, string>;
}

/** Common interaction properties that any node can have */
export interface NodeInteraction {
  /** Bind display value to data */
  bind?: DataBinding;
  /** Event handlers */
  events?: EventHandler[];
  /** Cursor on hover */
  cursor?: 'pointer' | 'move' | 'grab' | 'default';
  /** Tooltip text or data binding */
  tooltip?: string;
  /** Whether this node is draggable (for drag & drop items) */
  draggable?: boolean;
  /** Drop target id (accepts dragged items) */
  dropTarget?: string;
}

// ─── Edges: the universal positioning model ──────────────────
// Every element (including the panel itself) is defined by 4 edges.
// l=left, t=top, r=right, b=bottom.
// Width = r - l, Height = b - t.
// x = l, y = t (for backward compat with renderers).

export interface Edges {
  l: number;  // left
  t: number;  // top
  r: number;  // right
  b: number;  // bottom
}

/** Convert edges to x,y,w,h */
export function edgesToRect(e: Edges) {
  return { x: e.l, y: e.t, w: e.r - e.l, h: e.b - e.t };
}

/** Convert x,y,w,h to edges */
export function rectToEdges(x: number, y: number, w: number, h: number): Edges {
  return { l: x, t: y, r: x + w, b: y + h };
}

// ─── Base ────────────────────────────────────────────────────

interface BaseNode {
  /** Interaction / protocol binding (optional on any node) */
  interaction?: NodeInteraction;
  /** Edge-based positioning (preferred over x/y/w/h) */
  edges?: Edges;
}

// ─── Leaf node types ─────────────────────────────────────────

export interface RectNode extends BaseNode {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: number;
  fillAlpha?: number;
  radius?: number;
  stroke?: number;
  strokeWidth?: number;
}

export interface TextNode extends BaseNode {
  type: 'text';
  x: number;
  y: number;
  value: string;
  size?: number;
  color?: number;
  bold?: boolean;
  anchorX?: number;
  anchorY?: number;
  wordWrapWidth?: number;
}

export interface SlotNode extends BaseNode {
  type: 'slot';
  x: number;
  y: number;
  size: number;
  id?: string;            // logical slot id (e.g. "helmet", "dofus_1")
  borderColor?: number;
  icon?: string;          // asset path for icon
}

export interface SpriteNode extends BaseNode {
  type: 'sprite';
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;            // asset path
  alpha?: number;
}

export interface BarNode extends BaseNode {
  type: 'bar';
  x: number;
  y: number;
  w: number;
  h: number;
  value?: number;         // 0..1
  id?: string;
}

export interface DividerNode extends BaseNode {
  type: 'divider';
  x: number;
  y: number;
  w: number;
  h: number;
  color?: number;
}

// ─── Layout nodes ────────────────────────────────────────────

export interface GroupNode extends BaseNode {
  type: 'group';
  id?: string;
  x?: number;
  y?: number;
  children: PanelNode[];
  /** Visual properties (when group acts as a container with background) */
  fill?: number;
  fillAlpha?: number;
  radius?: number;
  stroke?: number;
  strokeWidth?: number;
}

export interface ColumnNode extends BaseNode {
  type: 'column';
  x: number;
  y: number;
  gap: number;
  children: PanelNode[];
}

export interface RowNode extends BaseNode {
  type: 'row';
  x: number;
  y: number;
  gap: number;
  children: PanelNode[];
}

/**
 * Repeat a template node N times in a column layout.
 * Useful for slot columns (e.g. 6 dofus slots).
 */
export interface RepeatColumnNode extends BaseNode {
  type: 'repeat-column';
  x: number;
  y: number;
  count: number;
  gap: number;
  template: Omit<SlotNode, 'x' | 'y'>;
  idPrefix?: string;      // generates ids: `${idPrefix}_0`, `${idPrefix}_1`…
}

/**
 * Scrollable list — renders a clipped container with N visible rows.
 * Each row is built from `rowTemplate`. Scrolls via wheel or drag.
 */
export interface ScrollListNode extends BaseNode {
  type: 'scroll-list';
  x: number;
  y: number;
  w: number;
  h: number;
  id?: string;
  rowHeight: number;
  rowCount: number;         // total data rows (for scrollbar sizing)
  visibleRows?: number;     // auto-calculated from h/rowHeight if omitted
  rowTemplate: PanelNode[]; // nodes rendered per row (x/y relative to row origin)
  bg?: number;
  scrollbarWidth?: number;
}

// ─── Union type ──────────────────────────────────────────────

export type PanelNode =
  | RectNode
  | TextNode
  | SlotNode
  | SpriteNode
  | BarNode
  | DividerNode
  | GroupNode
  | ColumnNode
  | RowNode
  | RepeatColumnNode
  | ScrollListNode;

// ─── Panel definition ────────────────────────────────────────

/**
 * PanelDef — a panel is just a root GroupNode with metadata.
 *
 * Structure:
 *   Panel (root group, edges = full size)
 *   ├── _bg      (rect: background fill)
 *   ├── _header  (group: header bar)
 *   │   ├── rect (header bg)
 *   │   └── text (title)
 *   ├── _body    (group: user content area)
 *   │   ├── ...user nodes...
 *   ├── _border  (rect: border overlay)
 *
 * The children array IS the node tree. Header and body are just nodes.
 */
export interface PanelDef {
  name: string;
  edges?: Edges;
  /** Derived from edges for convenience */
  w: number;
  h: number;
  /** The full node tree (bg, header, body, border are all nodes here) */
  children: PanelNode[];

  /** Viewport placement (for preview overlay) */
  viewport?: {
    position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    fillPercent?: number;
    offsetX?: number;
    offsetY?: number;
  };
}

// ─── Panel factory ───────────────────────────────────────────

/** Create a new panel with the standard structure: bg + header + body + border */
export function createPanelDef(
  name: string,
  w: number,
  h: number,
  opts?: { headerHeight?: number; bg?: number; headerBg?: number; border?: number; radius?: number },
): PanelDef {
  const hh = opts?.headerHeight ?? 24;
  const bg = opts?.bg ?? 0xddd7b2;
  const headerBg = opts?.headerBg ?? 0x5c5040;
  const border = opts?.border ?? 0x8a7f5f;
  const radius = opts?.radius ?? 3;

  return {
    name,
    edges: { l: 0, t: 0, r: w, b: h },
    w, h,
    children: [
      // Background
      {
        type: 'rect', x: 0, y: 0, w, h,
        fill: bg, radius,
        edges: { l: 0, t: 0, r: w, b: h },
      },
      // Header group
      {
        type: 'group', id: '_header',
        edges: { l: 0, t: 0, r: w, b: hh },
        fill: headerBg, radius,
        children: [
          { type: 'rect', x: 0, y: 0, w, h: hh, fill: headerBg, radius },
          { type: 'rect', x: 0, y: radius, w, h: hh - radius, fill: headerBg },
          { type: 'text', x: 10, y: hh / 2, value: name, size: 12, color: 0xffffff, bold: true, anchorY: 0.5 },
          // Close button
          { type: 'rect', x: w - 20, y: (hh - 16) / 2, w: 16, h: 16, fill: 0xcc4400, radius: 0,
            edges: { l: w - 20, t: (hh - 16) / 2, r: w - 4, b: (hh - 16) / 2 + 16 },
            interaction: { cursor: 'pointer', events: [{ event: 'click', emit: 'close' }] } },
          { type: 'text', x: w - 12, y: hh / 2, value: 'x', size: 11, color: 0xffffff, bold: true, anchorX: 0.5, anchorY: 0.5 },
        ],
      },
      // Body group (user content goes here)
      {
        type: 'group', id: '_body',
        edges: { l: 0, t: hh, r: w, b: h },
        children: [],
      },
      // Border overlay
      {
        type: 'rect', x: 0, y: 0, w, h,
        stroke: border, strokeWidth: 2, radius,
        fillAlpha: 0,
        edges: { l: 0, t: 0, r: w, b: h },
      },
    ],
    viewport: { position: 'center', fillPercent: 75 },
  };
}
