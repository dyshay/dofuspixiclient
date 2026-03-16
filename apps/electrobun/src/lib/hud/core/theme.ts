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
  BOOST: 0xe86420,
  BOOST_HOVER: 0xffaa44,
  SLOT_BG: 0xdcd5bf,
  ALIGN_BORDER: 0x88bbcc,
} as const;

export const METRICS = {
  ROW_H: 18,
  HEADER_H: 17,
  PX: 10,
  ICON_SIZE: 14,
  BAR_H: 12,
  CLOSE_SIZE: 16,
  ALIGN_FRAME: 50,
  JOB_SLOT: 42,
  SPEC_SLOT: 30,
} as const;

export const FONT = 'Arial';

export function boldText(size: number, color: number): TextStyle {
  return new TextStyle({ fontFamily: FONT, fontSize: size, fill: color, fontWeight: 'bold' });
}

export function regularText(size: number, color: number): TextStyle {
  return new TextStyle({ fontFamily: FONT, fontSize: size, fill: color });
}
