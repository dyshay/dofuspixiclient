import { Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";

import type { StatValue } from "@/types/stats";
import { i18n } from "@/i18n";
import { statsLabels } from "@/i18n/hud.messages";

import { boldText, COLORS, METRICS, regularText } from "../core/theme";
import { hideTooltip, showTooltip } from "../core/tooltip";

export class StatRow {
  public container: Container;
  private valueText: Text;
  private boostButton: Container;
  private boostBg: Graphics;
  private iconSprite: Sprite;
  private onBoost?: () => void;
  private boostCost = 0;
  private statName: string;
  private btnW: number;
  private btnH: number;
  private zoom: number;

  constructor(
    name: string,
    iconPath: string,
    panelWidth: number,
    tooltip?: string,
    zoom = 1
  ) {
    this.container = new Container();
    this.statName = name;
    this.zoom = zoom;

    const p = (n: number) => Math.round(n * zoom);
    const f = (n: number) => n * zoom;

    const ROW_H = p(METRICS.ROW_H);
    const ICON_SIZE = p(METRICS.ICON_SIZE);
    const PX = p(METRICS.PX);

    this.btnW = p(16);
    this.btnH = p(15);

    // SVG icon (loaded async)
    this.iconSprite = new Sprite(Texture.EMPTY);
    this.iconSprite.width = ICON_SIZE;
    this.iconSprite.height = ICON_SIZE;
    this.iconSprite.x = PX;
    this.iconSprite.y = (ROW_H - ICON_SIZE) / 2;
    this.container.addChild(this.iconSprite);

    this.loadIcon(iconPath);

    // Stat name
    const nameText = new Text({
      text: name,
      style: regularText(f(11), COLORS.TEXT_DARK),
    });
    nameText.anchor.set(0, 0.5);
    nameText.x = PX + p(18);
    nameText.y = ROW_H / 2;
    this.container.addChild(nameText);
    if (tooltip) {
      nameText.eventMode = "static";
      nameText.cursor = "default";
      nameText.on("pointerover", (e) => {
        const stage = this.container.parent?.parent;
        if (stage) showTooltip(stage, tooltip, e.global.x, e.global.y);
      });
      nameText.on("pointerout", () => hideTooltip());
    }

    // Value (right-aligned, vertically centered)
    this.valueText = new Text({
      text: "0",
      style: boldText(f(11), COLORS.TEXT_DARK),
    });
    this.valueText.anchor.set(1, 0.5);
    this.valueText.x = panelWidth - PX - p(20);
    this.valueText.y = ROW_H / 2;
    this.container.addChild(this.valueText);

    // Orange [+] boost button
    this.boostButton = new Container();
    this.boostButton.x = panelWidth - PX - this.btnW;
    this.boostButton.y = (ROW_H - this.btnH) / 2;
    this.boostButton.visible = false;
    this.boostButton.eventMode = "static";
    this.boostButton.cursor = "pointer";

    this.boostBg = new Graphics();
    this.drawBoostBg(COLORS.BOOST);
    this.boostButton.addChild(this.boostBg);

    const plusText = new Text({
      text: "+",
      style: boldText(f(12), COLORS.TEXT_WHITE),
    });
    plusText.anchor.set(0.5, 0.5);
    plusText.x = this.btnW / 2;
    plusText.y = this.btnH / 2;
    this.boostButton.addChild(plusText);

    this.boostButton.on("pointerover", (e) => {
      this.drawBoostBg(COLORS.BOOST_HOVER);
      if (this.boostCost > 0) {
        const stage = this.container.parent?.parent;
        if (stage) {
          showTooltip(
            stage,
            i18n._(statsLabels.boostTip.id, {
              name: this.statName,
              cost: this.boostCost,
            }),
            e.global.x,
            e.global.y
          );
        }
      }
    });

    this.boostButton.on("pointerout", () => {
      this.drawBoostBg(COLORS.BOOST);
      hideTooltip();
    });

    this.boostButton.on("pointerdown", () => this.onBoost?.());

    this.container.addChild(this.boostButton);
  }

  private drawBoostBg(color: number): void {
    this.boostBg.clear();
    this.boostBg.rect(0, 0, this.btnW, this.btnH);
    this.boostBg.fill({ color });
  }

  private async loadIcon(path: string): Promise<void> {
    try {
      const res = this.zoom * (window.devicePixelRatio || 1);
      const tex = await Assets.load({ src: path, data: { resolution: res } });

      if (tex) {
        const w = this.iconSprite.width;
        const h = this.iconSprite.height;
        this.iconSprite.texture = tex;
        this.iconSprite.width = w;
        this.iconSprite.height = h;
      }
    } catch {
      // icon not found — keep empty
    }
  }

  setOnBoost(fn: () => void): void {
    this.onBoost = fn;
  }

  setBoostCost(cost: number): void {
    this.boostCost = cost;
  }

  update(stat: StatValue): void {
    const extra = stat.items + stat.boost;
    if (extra !== 0) {
      const sign = extra > 0 ? "+" : "";
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
