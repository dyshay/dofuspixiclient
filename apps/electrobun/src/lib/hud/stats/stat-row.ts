import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { StatValue } from '@/types/stats';
import { COLORS, METRICS, boldText, regularText } from '../core/theme';
import { showTooltip, hideTooltip } from '../core/tooltip';

const BTN_W = 16;
const BTN_H = 15;

export class StatRow {
  public container: Container;
  private valueText: Text;
  private boostButton: Container;
  private boostBg: Graphics;
  private iconSprite: Sprite;
  private onBoost?: () => void;
  private boostCost = 0;
  private statName: string;

  constructor(name: string, iconPath: string, panelWidth: number, tooltip?: string) {
    this.container = new Container();
    this.statName = name;

    // SVG icon (loaded async)
    this.iconSprite = new Sprite(Texture.EMPTY);
    this.iconSprite.width = METRICS.ICON_SIZE;
    this.iconSprite.height = METRICS.ICON_SIZE;
    this.iconSprite.x = METRICS.PX;
    this.iconSprite.y = (METRICS.ROW_H - METRICS.ICON_SIZE) / 2;
    this.container.addChild(this.iconSprite);

    this.loadIcon(iconPath);

    // Stat name
    const nameText = new Text({
      text: name,
      style: regularText(11, COLORS.TEXT_DARK),
    });
    nameText.anchor.set(0, 0.5);
    nameText.x = METRICS.PX + 18;
    nameText.y = METRICS.ROW_H / 2;
    this.container.addChild(nameText);
    if (tooltip) {
      nameText.eventMode = 'static';
      nameText.cursor = 'default';
      nameText.on('pointerover', (e) => {
        const stage = this.container.parent?.parent;
        if (stage) showTooltip(stage, tooltip, e.global.x, e.global.y);
      });
      nameText.on('pointerout', () => hideTooltip());
    }

    // Value (right-aligned, vertically centered)
    this.valueText = new Text({
      text: '0',
      style: boldText(11, COLORS.TEXT_DARK),
    });
    this.valueText.anchor.set(1, 0.5);
    this.valueText.x = panelWidth - METRICS.PX - 20;
    this.valueText.y = METRICS.ROW_H / 2;
    this.container.addChild(this.valueText);

    // Orange [+] boost button
    this.boostButton = new Container();
    this.boostButton.x = panelWidth - METRICS.PX - BTN_W;
    this.boostButton.y = (METRICS.ROW_H - BTN_H) / 2;
    this.boostButton.visible = false;
    this.boostButton.eventMode = 'static';
    this.boostButton.cursor = 'pointer';

    this.boostBg = new Graphics();
    this.drawBoostBg(COLORS.BOOST);
    this.boostButton.addChild(this.boostBg);

    const plusText = new Text({
      text: '+',
      style: boldText(12, COLORS.TEXT_WHITE),
    });
    plusText.anchor.set(0.5, 0.5);
    plusText.x = BTN_W / 2;
    plusText.y = BTN_H / 2;
    this.boostButton.addChild(plusText);

    this.boostButton.on('pointerover', (e) => {
      this.drawBoostBg(COLORS.BOOST_HOVER);
      if (this.boostCost > 0) {
        const stage = this.container.parent?.parent;
        if (stage) {
          showTooltip(stage,
            `+1 ${this.statName} : coûte ${this.boostCost} point${this.boostCost > 1 ? 's' : ''} de capital`,
            e.global.x, e.global.y);
        }
      }
    });

    this.boostButton.on('pointerout', () => {
      this.drawBoostBg(COLORS.BOOST);
      hideTooltip();
    });

    this.boostButton.on('pointerdown', () => this.onBoost?.());

    this.container.addChild(this.boostButton);
  }

  private drawBoostBg(color: number): void {
    this.boostBg.clear();
    this.boostBg.rect(0, 0, BTN_W, BTN_H);
    this.boostBg.fill({ color });
  }

  private async loadIcon(path: string): Promise<void> {
    try {
      const tex = await Assets.load(path);
      if (tex) {
        this.iconSprite.texture = tex;
        this.iconSprite.width = METRICS.ICON_SIZE;
        this.iconSprite.height = METRICS.ICON_SIZE;
      }
    } catch {
      // icon not found — keep empty
    }
  }

  setOnBoost(fn: () => void): void { this.onBoost = fn; }

  setBoostCost(cost: number): void { this.boostCost = cost; }

  update(stat: StatValue): void {
    const extra = stat.items + stat.boost;
    if (extra !== 0) {
      const sign = extra > 0 ? '+' : '';
      this.valueText.text = `${stat.base} (${sign}${extra})`;
    } else {
      this.valueText.text = String(stat.base);
    }
  }

  setBoostEnabled(enabled: boolean): void {
    this.boostButton.visible = enabled;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
