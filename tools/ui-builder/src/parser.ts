/**
 * TS Panel Parser — extracts a PanelDef from existing panel source code.
 *
 * Parses patterns like:
 *   const W = 250;
 *   graphics.roundRect(0, 0, W, headerH, 3);
 *   graphics.fill({ color: 0x5c5040 });
 *   new Text({ text: 'Label', style: boldText(11, 0xffffff) })
 *   createSlot(x, y, size)
 *   createProgressBar(x, y, w, h)
 *   createSectionHeader(y, w, 'label')
 *   createCloseButton(...)
 */
import type { PanelDef, PanelNode } from './schema';
import { createPanelDef } from './schema';

// Known COLORS/METRICS constants
const KNOWN_COLORS: Record<string, number> = {
  'COLORS.BG': 0xddd7b2,
  'COLORS.BG_ALT': 0xc4be96,
  'COLORS.HEADER_BG': 0x5c5040,
  'COLORS.BORDER': 0x8a7f5f,
  'COLORS.TEXT_DARK': 0x3d3529,
  'COLORS.TEXT_WHITE': 0xffffff,
  'COLORS.BAR_BG': 0x3d3529,
  'COLORS.BAR_FILL': 0xe86420,
  'COLORS.BAR_BORDER': 0x2a2218,
  'COLORS.CLOSE_BG': 0xcc4400,
  'COLORS.SLOT_BG': 0xdcd5bf,
  'COLORS.ALIGN_BORDER': 0x88bbcc,
};

const KNOWN_METRICS: Record<string, number> = {
  'METRICS.ROW_H': 18,
  'METRICS.HEADER_H': 17,
  'METRICS.PX': 10,
  'METRICS.ICON_SIZE': 14,
  'METRICS.BAR_H': 12,
  'METRICS.CLOSE_SIZE': 16,
  'METRICS.ALIGN_FRAME': 50,
  'METRICS.JOB_SLOT': 42,
  'METRICS.SPEC_SLOT': 30,
};

export function parsePanel(source: string): PanelDef {
  const constants = extractConstants(source);
  const allConsts = { ...KNOWN_METRICS, ...constants };

  // Extract panel name from container.label
  const labelMatch = source.match(/container\.label\s*=\s*'([^']+)'/);
  const name = labelMatch?.[1]?.replace('-panel', '') ?? 'parsed';

  // Extract W and H
  const w = resolveNumber('W', allConsts) ?? resolveNumber('PANEL_W', allConsts) ?? 400;
  const h = resolveNumber('PANEL_H', allConsts) ?? resolveNumber('H', allConsts) ?? 300;

  // Extract bg color from first roundRect + fill
  const bgMatch = source.match(/roundRect\(0,\s*0,\s*\w+,\s*\w+,\s*(\d+)\)[\s\S]*?\.fill\(\{\s*color:\s*(0x[0-9a-fA-F]+|COLORS\.\w+)/);
  const bg = bgMatch ? resolveColor(bgMatch[2]) : 0xddd7b2;
  const radius = bgMatch ? parseInt(bgMatch[1]) : 3;

  const children: PanelNode[] = [];

  // ─── Parse Graphics rect/roundRect + fill blocks ───
  const rectPattern = /(\w+)\.(rect|roundRect)\(([^)]+)\)[\s\S]*?\1\.fill\(\{\s*color:\s*([^,}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = rectPattern.exec(source)) !== null) {
    const shape = m[2];
    const args = m[3].split(',').map(a => resolveExpr(a.trim(), allConsts));
    const color = resolveColor(m[4].trim());

    if (args.length >= 4 && args.every(a => a !== null)) {
      const node: PanelNode = {
        type: 'rect',
        x: args[0]!, y: args[1]!, w: args[2]!, h: args[3]!,
        fill: color,
        radius: shape === 'roundRect' && args[4] != null ? args[4] : undefined,
      };
      // Skip the main bg rect (0,0,W,H)
      if (node.x === 0 && node.y === 0 && node.w === w && node.h === h) continue;
      children.push(node);
    }
  }

  // ─── Parse new Text({ text: '...', style: boldText(size, color) }) ───
  const textPattern = /new Text\(\{\s*text:\s*'([^']*)'(?:,\s*style:\s*(boldText|regularText)\((\d+),\s*(0x[0-9a-fA-F]+|COLORS\.\w+)\))?\s*\}\)/g;
  while ((m = textPattern.exec(source)) !== null) {
    const value = m[1];
    const bold = m[2] === 'boldText';
    const size = m[3] ? parseInt(m[3]) : 11;
    const color = m[4] ? resolveColor(m[4]) : 0x3d3529;

    // Find .x and .y assignments after this match
    const after = source.substring(m.index, m.index + 300);
    const xMatch = after.match(/\.x\s*=\s*([^;]+)/);
    const yMatch = after.match(/\.y\s*=\s*([^;]+)/);
    const anchorMatch = after.match(/\.anchor\.set\(([^,]+),\s*([^)]+)\)/);

    const x = xMatch ? resolveExpr(xMatch[1].trim(), allConsts) ?? 0 : 0;
    const y = yMatch ? resolveExpr(yMatch[1].trim(), allConsts) ?? 0 : 0;

    const node: PanelNode & { anchorX?: number; anchorY?: number } = {
      type: 'text', x, y, value, size, color, bold,
    };
    if (anchorMatch) {
      node.anchorX = parseFloat(anchorMatch[1]);
      node.anchorY = parseFloat(anchorMatch[2]);
    }
    children.push(node);
  }

  // ─── Parse createSlot(x, y, size) ───
  const slotPattern = /createSlot\(([^)]+)\)/g;
  while ((m = slotPattern.exec(source)) !== null) {
    const args = m[1].split(',').map(a => resolveExpr(a.trim(), allConsts));
    if (args.length >= 3 && args[0] != null && args[1] != null && args[2] != null) {
      children.push({
        type: 'slot', x: args[0], y: args[1], size: args[2],
      });
    }
  }

  // ─── Parse createProgressBar(x, y, w, h) ───
  const barPattern = /createProgressBar\(([^)]+)\)/g;
  while ((m = barPattern.exec(source)) !== null) {
    const args = m[1].split(',').map(a => resolveExpr(a.trim(), allConsts));
    if (args.length >= 4 && args.every(a => a !== null)) {
      children.push({
        type: 'bar', x: args[0]!, y: args[1]!, w: args[2]!, h: args[3]!, value: 0,
      });
    }
  }

  // ─── Parse createSectionHeader(y, w, 'label') ───
  const hdrPattern = /createSectionHeader\(([^,]+),\s*([^,]+),\s*'([^']+)'\)/g;
  while ((m = hdrPattern.exec(source)) !== null) {
    const y = resolveExpr(m[1].trim(), allConsts) ?? 0;
    const sw = resolveExpr(m[2].trim(), allConsts) ?? w;
    children.push(
      { type: 'rect', x: 0, y, w: sw, h: 17, fill: 0x5c5040 },
      { type: 'text', x: 10, y: y + 8.5, value: m[3], size: 11, color: 0xffffff, bold: true, anchorY: 0.5 },
    );
  }

  // Deduplicate (same type+x+y)
  const seen = new Set<string>();
  const unique = children.filter(n => {
    const key = `${n.type}_${'x' in n ? n.x : ''}_${'y' in n ? n.y : ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Use createPanelDef to get the standard structure, then inject parsed nodes into _body
  const panel = createPanelDef(name, w, h, { bg, radius });
  const body = panel.children.find(c => c.type === 'group' && (c as { id?: string }).id === '_body');
  if (body && 'children' in body) {
    (body as { children: PanelNode[] }).children = unique;
  }
  return panel;
}

// ─── Helpers ───

function extractConstants(source: string): Record<string, number> {
  const consts: Record<string, number> = {};
  const pattern = /(?:const|let|var)\s+(\w+)\s*=\s*(\d+(?:\.\d+)?|0x[0-9a-fA-F]+)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(source)) !== null) {
    const val = m[2].startsWith('0x') ? parseInt(m[2], 16) : parseFloat(m[2]);
    consts[m[1]] = val;
  }
  return consts;
}

function resolveNumber(name: string, consts: Record<string, number>): number | null {
  return consts[name] ?? null;
}

function resolveColor(expr: string): number {
  if (expr.startsWith('0x')) return parseInt(expr, 16);
  return KNOWN_COLORS[expr] ?? 0xcccccc;
}

function resolveExpr(expr: string, consts: Record<string, number>): number | null {
  // Direct number
  if (/^-?\d+(\.\d+)?$/.test(expr)) return parseFloat(expr);
  if (/^0x[0-9a-fA-F]+$/.test(expr)) return parseInt(expr, 16);

  // Known constant
  if (expr in consts) return consts[expr];
  if (expr in KNOWN_COLORS) return KNOWN_COLORS[expr];

  // Simple arithmetic: A + B, A - B, A * B, A / B
  const arithMatch = expr.match(/^(.+?)\s*([+\-*/])\s*(.+)$/);
  if (arithMatch) {
    const left = resolveExpr(arithMatch[1].trim(), consts);
    const right = resolveExpr(arithMatch[3].trim(), consts);
    if (left !== null && right !== null) {
      switch (arithMatch[2]) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/': return right !== 0 ? left / right : 0;
      }
    }
  }

  // Property access: obj.prop
  const propMatch = expr.match(/^(\w+)\.(\w+)$/);
  if (propMatch) {
    const key = `${propMatch[1]}.${propMatch[2]}`;
    if (key in KNOWN_COLORS) return KNOWN_COLORS[key];
    if (key in KNOWN_METRICS) return KNOWN_METRICS[key];
  }

  return null;
}
