import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { COLORS, METRICS, boldText } from './theme';

export function createPanelBackground(w: number, h: number): Graphics {
  const bg = new Graphics();
  bg.roundRect(0, 0, w, h, 3);
  bg.fill({ color: COLORS.BG });
  bg.stroke({ color: COLORS.BORDER, width: 2 });
  bg.eventMode = 'static';
  return bg;
}

export function createSectionHeader(
  y: number,
  w: number,
  label: string,
  zoom = 1,
): { graphics: Graphics; text: Text; nextY: number } {
  const HEADER_H = Math.round(METRICS.HEADER_H * zoom);
  const PX = Math.round(METRICS.PX * zoom);

  const graphics = new Graphics();
  graphics.rect(0, y, w, HEADER_H);
  graphics.fill({ color: COLORS.HEADER_BG });

  const text = new Text({
    text: label,
    style: boldText(11 * zoom, COLORS.TEXT_WHITE),
  });
  text.anchor.set(0, 0.5);
  text.x = PX;
  text.y = y + HEADER_H / 2;

  return { graphics, text, nextY: y + HEADER_H };
}

export function createAlternatingRow(
  y: number,
  w: number,
  rowIndex: number,
): Graphics | null {
  if (rowIndex % 2 === 1) {
    const row = new Graphics();
    row.rect(0, y, w, METRICS.ROW_H);
    row.fill({ color: COLORS.BG_ALT });
    return row;
  }
  return null;
}

export function createProgressBar(
  x: number,
  y: number,
  w: number,
  h: number,
): { graphics: Graphics; redraw: (pct: number) => void } {
  const r = h / 2;
  const graphics = new Graphics();
  graphics.x = x;
  graphics.y = y;
  // Initial empty bar
  graphics.roundRect(0, 0, w, h, r);
  graphics.fill({ color: COLORS.BAR_BG });
  graphics.roundRect(0, 0, w, h, r);
  graphics.stroke({ color: COLORS.BAR_BORDER, width: 1 });

  const redraw = (pct: number): void => {
    graphics.clear();
    graphics.roundRect(0, 0, w, h, r);
    graphics.fill({ color: COLORS.BAR_BG });
    if (pct > 0) {
      const fw = Math.max(h, (w - 2) * Math.min(pct, 1));
      graphics.roundRect(1, 1, fw, h - 2, r - 1);
      graphics.fill({ color: COLORS.BAR_FILL });
    }
    graphics.roundRect(0, 0, w, h, r);
    graphics.stroke({ color: COLORS.BAR_BORDER, width: 1 });
  };

  return { graphics, redraw };
}

export function createCloseButton(onClick: () => void, zoom = 1): Container {
  const CLOSE_SIZE = Math.round(METRICS.CLOSE_SIZE * zoom);
  const c = new Container();
  c.eventMode = 'static';
  c.cursor = 'pointer';

  const bg = new Graphics();
  bg.rect(0, 0, CLOSE_SIZE, CLOSE_SIZE);
  bg.fill({ color: COLORS.CLOSE_BG });
  c.addChild(bg);

  const x = new Text({ text: 'x', style: boldText(11 * zoom, COLORS.TEXT_WHITE) });
  x.anchor.set(0.5, 0.5);
  x.x = CLOSE_SIZE / 2;
  x.y = CLOSE_SIZE / 2;
  c.addChild(x);

  c.on('pointerdown', onClick);
  return c;
}

export function createSlot(
  x: number,
  y: number,
  size: number,
  borderColor?: number,
): { graphics: Graphics; iconSprite: Sprite } {
  const graphics = new Graphics();
  graphics.rect(x, y, size, size);
  graphics.fill({ color: COLORS.SLOT_BG });
  graphics.stroke({ color: borderColor ?? COLORS.BORDER, width: 1.5 });

  const iconSprite = new Sprite(Texture.EMPTY);
  iconSprite.width = size - 6;
  iconSprite.height = size - 6;
  iconSprite.x = x + 3;
  iconSprite.y = y + 3;

  return { graphics, iconSprite };
}
