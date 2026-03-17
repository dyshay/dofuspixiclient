/**
 * PanelRenderer — walks a PanelDef tree and produces Pixi.js display objects.
 * Also supports interactive editing: drag to move, click to select, property panel.
 */
import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { PanelDef, PanelNode } from './schema';
import { edgesToRect } from './schema';
import { COLORS, boldText, regularText } from './theme';

/** Get x,y,w,h from a node — prefers edges if present, falls back to x/y/w/h or x/y/size */
export function nodeRect(node: PanelNode): { x: number; y: number; w: number; h: number } {
  if ('edges' in node && node.edges) return edgesToRect(node.edges);
  const n = node as unknown as Record<string, unknown>;
  const x = (n.x as number) ?? 0;
  const y = (n.y as number) ?? 0;
  const w = (n.w as number) ?? (n.size as number) ?? 32;
  const h = (n.h as number) ?? (n.size as number) ?? 32;
  return { x, y, w, h };
}

export interface RenderedSlot {
  id: string;
  graphics: Graphics;
  iconSprite: Sprite;
}

export interface RenderResult {
  container: Container;
  slots: Map<string, RenderedSlot>;
  bars: Map<string, { graphics: Graphics; redraw: (pct: number) => void }>;
  /** All rendered nodes with their source definition, for the editor */
  nodes: Array<{ node: PanelNode; display: Container; parent: Container }>;
}

export function renderPanel(def: PanelDef): RenderResult {
  const container = new Container();
  container.label = def.name;
  container.eventMode = 'static';

  const slots = new Map<string, RenderedSlot>();
  const bars = new Map<string, { graphics: Graphics; redraw: (pct: number) => void }>();
  const nodes: RenderResult['nodes'] = [];

  // Render all children — bg, header, body, border are all just nodes
  for (const child of def.children) {
    renderNode(child, container, slots, bars, nodes);
  }

  return { container, slots, bars, nodes };
}

function renderNode(
  node: PanelNode,
  parent: Container,
  slots: Map<string, RenderedSlot>,
  bars: Map<string, { graphics: Graphics; redraw: (pct: number) => void }>,
  nodes: RenderResult['nodes'],
): void {
  switch (node.type) {
    case 'rect': {
      const g = new Graphics();
      if (node.radius) {
        g.roundRect(node.x, node.y, node.w, node.h, node.radius);
      } else {
        g.rect(node.x, node.y, node.w, node.h);
      }
      g.fill({ color: node.fill ?? COLORS.BG, alpha: node.fillAlpha ?? 1 });
      if (node.stroke != null) {
        if (node.radius) {
          g.roundRect(node.x, node.y, node.w, node.h, node.radius);
        } else {
          g.rect(node.x, node.y, node.w, node.h);
        }
        g.stroke({ color: node.stroke, width: node.strokeWidth ?? 1 });
      }
      parent.addChild(g);
      nodes.push({ node, display: g, parent });
      break;
    }

    case 'text': {
      const style = node.bold
        ? boldText(node.size ?? 11, node.color ?? COLORS.TEXT_DARK)
        : regularText(node.size ?? 11, node.color ?? COLORS.TEXT_DARK);
      if (node.wordWrapWidth) {
        style.wordWrap = true;
        style.wordWrapWidth = node.wordWrapWidth;
      }
      const t = new Text({ text: node.value, style, resolution: Math.max(2, window.devicePixelRatio ?? 2) });
      t.x = node.x;
      t.y = node.y;
      if (node.anchorX != null || node.anchorY != null) {
        t.anchor.set(node.anchorX ?? 0, node.anchorY ?? 0);
      }
      parent.addChild(t);
      nodes.push({ node, display: t, parent });
      break;
    }

    case 'slot': {
      const g = new Graphics();
      g.rect(node.x, node.y, node.size, node.size);
      g.fill({ color: COLORS.SLOT_BG });
      g.stroke({ color: node.borderColor ?? COLORS.BORDER, width: 1.5 });

      const iconSprite = new Sprite(Texture.EMPTY);
      iconSprite.width = node.size - 6;
      iconSprite.height = node.size - 6;
      iconSprite.x = node.x + 3;
      iconSprite.y = node.y + 3;

      if (node.icon) {
        Assets.load(node.icon).then((tex: Texture) => {
          iconSprite.texture = tex;
          iconSprite.width = node.size - 6;
          iconSprite.height = node.size - 6;
        }).catch(() => {});
      }

      parent.addChild(g);
      parent.addChild(iconSprite);

      const id = node.id ?? `slot_${node.x}_${node.y}`;
      slots.set(id, { id, graphics: g, iconSprite });
      nodes.push({ node, display: g, parent });
      break;
    }

    case 'sprite': {
      const spr = new Sprite(Texture.EMPTY);
      spr.x = node.x;
      spr.y = node.y;
      spr.width = node.w;
      spr.height = node.h;
      spr.alpha = node.alpha ?? 1;
      parent.addChild(spr);

      Assets.load(node.src).then((tex: Texture) => {
        spr.texture = tex;
        spr.width = node.w;
        spr.height = node.h;
      }).catch(() => {});

      nodes.push({ node, display: spr, parent });
      break;
    }

    case 'bar': {
      const r = node.h / 2;
      const g = new Graphics();
      g.x = node.x;
      g.y = node.y;

      const redraw = (pct: number): void => {
        g.clear();
        g.roundRect(0, 0, node.w, node.h, r);
        g.fill({ color: COLORS.BAR_BG });
        if (pct > 0) {
          const fw = Math.max(node.h, (node.w - 2) * Math.min(pct, 1));
          g.roundRect(1, 1, fw, node.h - 2, r - 1);
          g.fill({ color: COLORS.BAR_FILL });
        }
        g.roundRect(0, 0, node.w, node.h, r);
        g.stroke({ color: COLORS.BAR_BORDER, width: 1 });
      };
      redraw(node.value ?? 0);

      parent.addChild(g);
      if (node.id) bars.set(node.id, { graphics: g, redraw });
      nodes.push({ node, display: g, parent });
      break;
    }

    case 'divider': {
      const g = new Graphics();
      g.rect(node.x, node.y, node.w, node.h);
      g.fill({ color: node.color ?? COLORS.BORDER });
      parent.addChild(g);
      nodes.push({ node, display: g, parent });
      break;
    }

    case 'group': {
      const c = new Container();
      c.eventMode = 'static'; // Required for child events to work
      // Position from edges or x/y
      if (node.edges) {
        c.x = node.edges.l;
        c.y = node.edges.t;
      } else {
        c.x = node.x ?? 0;
        c.y = node.y ?? 0;
      }
      // Visual background (if group has fill/stroke)
      if (node.fill != null || node.stroke != null) {
        const gw = node.edges ? (node.edges.r - node.edges.l) : 0;
        const gh = node.edges ? (node.edges.b - node.edges.t) : 0;
        if (gw > 0 && gh > 0) {
          const bg = new Graphics();
          if (node.fill != null) {
            if (node.radius) bg.roundRect(0, 0, gw, gh, node.radius);
            else bg.rect(0, 0, gw, gh);
            bg.fill({ color: node.fill, alpha: node.fillAlpha ?? 1 });
          }
          if (node.stroke != null) {
            if (node.radius) bg.roundRect(0, 0, gw, gh, node.radius);
            else bg.rect(0, 0, gw, gh);
            bg.stroke({ color: node.stroke, width: node.strokeWidth ?? 1 });
          }
          bg.eventMode = 'static';
          c.addChild(bg);
        }
      }
      // Render children relative to group origin
      for (const child of node.children) {
        renderNode(child, c, slots, bars, nodes);
      }
      parent.addChild(c);
      nodes.push({ node, display: c, parent });
      break;
    }

    case 'column': {
      let cy = 0;
      for (const child of node.children) {
        const wrapper = { ...child } as PanelNode & { x: number; y: number };
        if ('x' in wrapper) wrapper.x = (wrapper.x ?? 0);
        if ('y' in wrapper) wrapper.y = (wrapper.y ?? 0) + cy;
        // Estimate height from node
        const h = getNodeHeight(child);
        renderNode(offsetNode(child, node.x, node.y + cy), parent, slots, bars, nodes);
        cy += h + node.gap;
      }
      break;
    }

    case 'row': {
      let cx = 0;
      for (const child of node.children) {
        const w = getNodeWidth(child);
        renderNode(offsetNode(child, node.x + cx, node.y), parent, slots, bars, nodes);
        cx += w + node.gap;
      }
      break;
    }

    case 'repeat-column': {
      for (let i = 0; i < node.count; i++) {
        const slotNode = {
          ...node.template,
          type: 'slot' as const,
          x: node.x,
          y: node.y + i * (node.template.size + node.gap),
          id: node.idPrefix ? `${node.idPrefix}_${i}` : undefined,
        };
        renderNode(slotNode, parent, slots, bars, nodes);
      }
      break;
    }

    case 'scroll-list': {
      const listContainer = new Container();
      listContainer.x = node.x;
      listContainer.y = node.y;

      // Background
      const listBg = new Graphics();
      listBg.rect(0, 0, node.w, node.h);
      listBg.fill({ color: node.bg ?? COLORS.BG_ALT });
      listContainer.addChild(listBg);

      // Clip mask
      const mask = new Graphics();
      mask.rect(0, 0, node.w, node.h);
      mask.fill({ color: 0xffffff });
      listContainer.addChild(mask);

      // Scrollable content
      const content = new Container();
      content.mask = mask;
      listContainer.addChild(content);

      // Render visible rows as preview
      const sbW = node.scrollbarWidth ?? 8;
      const contentW = node.w - sbW - 2;
      const visible = node.visibleRows ?? Math.floor(node.h / node.rowHeight);
      const previewCount = Math.min(node.rowCount, visible + 2);
      for (let i = 0; i < previewCount; i++) {
        // Alternating row bg
        if (i % 2 === 1) {
          const rowBg = new Graphics();
          rowBg.rect(0, i * node.rowHeight, contentW, node.rowHeight);
          rowBg.fill({ color: COLORS.BG_ALT, alpha: 0.5 });
          content.addChild(rowBg);
        }
        // Render row template children
        for (const tmpl of node.rowTemplate) {
          renderNode(offsetNode(tmpl, 0, i * node.rowHeight), content, slots, bars, nodes);
        }
      }

      // Scrollbar track
      const track = new Graphics();
      track.rect(node.w - sbW, 0, sbW, node.h);
      track.fill({ color: COLORS.BAR_BG });
      listContainer.addChild(track);

      // Scrollbar thumb
      const thumbRatio = Math.min(1, visible / Math.max(1, node.rowCount));
      const thumbH = Math.max(20, node.h * thumbRatio);
      const thumb = new Graphics();
      thumb.roundRect(node.w - sbW + 1, 0, sbW - 2, thumbH, 3);
      thumb.fill({ color: COLORS.BORDER });
      listContainer.addChild(thumb);

      parent.addChild(listContainer);
      nodes.push({ node, display: listContainer, parent });
      break;
    }
  }
}

/** Offset a node's x/y position (returns a shallow copy). */
function offsetNode(node: PanelNode, dx: number, dy: number): PanelNode {
  if ('x' in node && 'y' in node) {
    return { ...node, x: (node.x as number) + dx, y: (node.y as number) + dy } as PanelNode;
  }
  return node;
}

function getNodeHeight(node: PanelNode): number {
  if ('h' in node) return (node as { h: number }).h;
  if ('size' in node) return (node as { size: number }).size;
  return 32;
}

function getNodeWidth(node: PanelNode): number {
  if ('w' in node) return (node as { w: number }).w;
  if ('size' in node) return (node as { size: number }).size;
  return 32;
}
