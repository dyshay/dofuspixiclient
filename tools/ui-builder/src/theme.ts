/**
 * Dofus 1.29 HUD theme — copied from client core/theme.ts
 * Kept in sync manually. Single source of truth for colors/metrics.
 */
import { TextStyle } from 'pixi.js';

export const COLORS = {
  BG: 0xddd7b2,
  BG_ALT: 0xc4be96,
  HEADER_BG: 0x5c5040,
  BORDER: 0x8a7f5f,
  TEXT_DARK: 0x3d3529,
  TEXT_WHITE: 0xffffff,
  BAR_BG: 0x3d3529,
  BAR_FILL: 0xe86420,
  BAR_BORDER: 0x2a2218,
  CLOSE_BG: 0xcc4400,
  SLOT_BG: 0xdcd5bf,
} as const;

export const FONT = 'Arial';

export function boldText(size: number, color: number): TextStyle {
  return new TextStyle({ fontFamily: FONT, fontSize: size, fill: color, fontWeight: 'bold' });
}

export function regularText(size: number, color: number): TextStyle {
  return new TextStyle({ fontFamily: FONT, fontSize: size, fill: color });
}
