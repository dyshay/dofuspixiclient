import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { CharacterStats } from '@/types/stats';
import { STAT_IDS } from '@/types/stats';
import { StatRow } from './stat-row';
import { getBoostCost } from './boost-costs';
import {
  COLORS, METRICS, boldText, regularText,
  createSectionHeader,
  createProgressBar, createCloseButton, createSlot,
  showTooltip, hideTooltip,
} from '../core';

const W = 250;
const ICON = '/assets/hud/stats';

// Tooltip texts (from Dofus 1.29 lang files)
const TOOLTIPS: Record<string, string> = {
  energy: 'Points d\'énergie : perdus en cas de mort. Régénérés en se déconnectant dans une zone de sauvegarde.',
  xp: 'Points d\'expérience : en gagnant suffisamment de points d\'expérience, vous gagnez un niveau.',
  hp: 'Points de vie : si vos points de vie tombent à 0 en combat, vous êtes vaincu.',
  ap: 'Points d\'action : utilisés pour lancer des sorts et effectuer des actions en combat.',
  mp: 'Points de mouvement : chaque case de déplacement en combat coûte 1 PM.',
  initiative: 'Initiative : détermine l\'ordre de jeu en combat. Plus elle est élevée, plus vous jouez tôt.',
  prospection: 'Prospection : augmente vos chances de trouver des objets sur les monstres vaincus.',
  vitality: 'Vitalité : chaque point de vitalité augmente vos points de vie maximum de 1.',
  wisdom: 'Sagesse : augmente les points d\'expérience gagnés et la résistance aux pertes de PA/PM.',
  strength: 'Force : augmente les dégâts de terre et le pods transportable.',
  intelligence: 'Intelligence : augmente les dégâts de feu et les soins.',
  chance: 'Chance : augmente les dégâts d\'eau et la prospection.',
  agility: 'Agilité : augmente les dégâts d\'air, l\'esquive PA/PM et la fuite.',
  capital: 'Points de capital : utilisez-les pour augmenter vos caractéristiques.',
  quill: 'Plus de statistiques',
};

export class StatsPanel {
  public container: Container;

  private nameText: Text;
  private levelText: Text;
  private energyBar!: { graphics: Graphics; redraw: (pct: number) => void };
  private xpBar!: { graphics: Graphics; redraw: (pct: number) => void };
  private lpVal!: Text;
  private apVal!: Text;
  private mpVal!: Text;
  private initVal!: Text;
  private discVal!: Text;
  private capitalVal!: Text;
  private statRows = new Map<number, StatRow>();
  private iconSizes = new Map<Sprite, { w: number; h: number }>();
  private classId = 0;
  private energyTip = '';
  private xpTip = '';

  private onBoostStat?: (statId: number) => void;
  private onClose?: () => void;

  constructor() {
    this.container = new Container();
    this.container.label = 'stats-panel';
    this.container.visible = false;
    this.container.eventMode = 'static';

    let y = 0;

    // ═══════ TOP: Name header (dark) ═══════
    const headerH = 28;
    const headerBg = new Graphics();
    headerBg.roundRect(0, 0, W, headerH, 3);
    headerBg.fill({ color: COLORS.HEADER_BG });
    headerBg.rect(0, 3, W, headerH - 3);
    headerBg.fill({ color: COLORS.HEADER_BG });
    headerBg.eventMode = 'static';
    this.container.addChild(headerBg);

    this.nameText = new Text({ text: '', style: boldText(13, COLORS.TEXT_WHITE) });
    this.nameText.anchor.set(0, 0.5);
    this.nameText.x = METRICS.ALIGN_FRAME + METRICS.PX + 12;
    this.nameText.y = headerH / 2;
    this.container.addChild(this.nameText);

    const closeBtn = createCloseButton(() => { this.hide(); this.onClose?.(); });
    closeBtn.x = W - 19;
    closeBtn.y = (headerH - METRICS.CLOSE_SIZE) / 2;
    this.container.addChild(closeBtn);

    // ═══════ Level (below header, beige zone) ═══════
    this.levelText = new Text({ text: 'Niveau 1', style: boldText(11, COLORS.TEXT_DARK) });
    this.levelText.x = METRICS.ALIGN_FRAME + METRICS.PX + 6;
    this.levelText.y = headerH + 8;
    this.container.addChild(this.levelText);

    y = headerH + METRICS.ROW_H + 18;

    // Alignment icon frame — added at end for z-index
    const alignFrame = new Container();
    const alignBg = new Graphics();
    alignBg.roundRect(0, 0, METRICS.ALIGN_FRAME, METRICS.ALIGN_FRAME, 3);
    alignBg.fill({ color: COLORS.SLOT_BG });
    alignBg.stroke({ color: COLORS.ALIGN_BORDER, width: 2 });
    alignFrame.addChild(alignBg);
    alignFrame.x = METRICS.PX;
    alignFrame.y = 4;

    const alignIcon = this.makeIcon('AlignIcon.svg', METRICS.ALIGN_FRAME - 6, METRICS.ALIGN_FRAME - 6);
    alignIcon.x = 3;
    alignIcon.y = 3;
    // Move from this.container to alignFrame
    this.container.removeChild(alignIcon);
    alignFrame.addChild(alignIcon);

    // ═══════ ALTERNATING ROW BACKGROUNDS — single Graphics ═══════
    let rowIdx = 0;
    const rowStartY = y;
    // Pre-count: 2 bar rows + 5 combat rows = 7, then header, then 6 stat rows = 13 total
    const totalRows = 13;
    const altBg = new Graphics();
    let tempY = rowStartY;
    for (let i = 0; i < totalRows; i++) {
      if (i % 2 === 1) {
        altBg.rect(0, tempY, W, METRICS.ROW_H);
        altBg.fill({ color: COLORS.BG_ALT });
      }
      tempY += METRICS.ROW_H;
      // After 7 rows (energy, xp, 5 combat), skip header height
      if (i === 6) tempY += METRICS.HEADER_H;
    }
    this.container.addChild(altBg);

    // ═══════ ENERGY BAR (row 0) ═══════
    this.energyBar = createProgressBar(90, y + (METRICS.ROW_H - METRICS.BAR_H) / 2, W - 90 - METRICS.PX, METRICS.BAR_H);
    const energyLabel = new Text({ text: 'Energie', style: boldText(11, COLORS.TEXT_DARK) });
    energyLabel.anchor.set(0, 0.5);
    energyLabel.x = METRICS.PX;
    energyLabel.y = y + METRICS.ROW_H / 2;
    this.container.addChild(energyLabel);
    this.withTooltip(energyLabel, TOOLTIPS.energy);
    this.container.addChild(this.energyBar.graphics);
    this.withDynamicTooltip(this.energyBar.graphics, () => this.energyTip);
    y += METRICS.ROW_H;
    rowIdx++;

    // ═══════ XP BAR (row 1) ═══════
    this.xpBar = createProgressBar(90, y + (METRICS.ROW_H - METRICS.BAR_H) / 2, W - 90 - METRICS.PX, METRICS.BAR_H);
    const xpLabel = new Text({ text: 'Expérience', style: boldText(11, COLORS.TEXT_DARK) });
    xpLabel.anchor.set(0, 0.5);
    xpLabel.x = METRICS.PX;
    xpLabel.y = y + METRICS.ROW_H / 2;
    this.container.addChild(xpLabel);
    this.withTooltip(xpLabel, TOOLTIPS.xp);
    this.container.addChild(this.xpBar.graphics);
    this.withDynamicTooltip(this.xpBar.graphics, () => this.xpTip);
    y += METRICS.ROW_H;
    rowIdx++;

    // ═══════ COMBAT STATS (rows 2-6) ═══════
    const combatRows: Array<{ icon: string; label: string; isLP: boolean; tip: string; tint?: number; onVal: (t: Text) => void }> = [
      { icon: 'IconVita.svg', label: 'Points de vie', isLP: true, tip: TOOLTIPS.hp, onVal: (t) => { this.lpVal = t; } },
      { icon: 'StarSymbol.svg', label: 'Points d\'actions', isLP: false, tip: TOOLTIPS.ap, tint: 0xffcc00, onVal: (t) => { this.apVal = t; } },
      { icon: 'IconMP.svg', label: 'Points de mouvement', isLP: false, tip: TOOLTIPS.mp, onVal: (t) => { this.mpVal = t; } },
      { icon: 'IconInit.svg', label: 'Initiative', isLP: false, tip: TOOLTIPS.initiative, onVal: (t) => { this.initVal = t; } },
      { icon: 'IconPP.svg', label: 'Prospection', isLP: false, tip: TOOLTIPS.prospection, onVal: (t) => { this.discVal = t; } },
    ];
    for (const cr of combatRows) {
      y = this.addCombatRow(y, cr.icon, cr.label, cr.isLP, cr.onVal, cr.tip, cr.tint);
      rowIdx++;
    }

    // ═══════ CARACTÉRISTIQUES HEADER ═══════
    const caracHdr = createSectionHeader(y, W, 'Caractéristiques');
    this.container.addChild(caracHdr.graphics);
    this.container.addChild(caracHdr.text);

    const quill = this.makeIcon('QuillIcon.svg', 12, 12);
    quill.x = W - METRICS.PX - 14;
    quill.y = y + (METRICS.HEADER_H - 12) / 2;
    this.withTooltip(quill, TOOLTIPS.quill);

    y = caracHdr.nextY;

    // ═══════ 6 CHARACTERISTIC ROWS (rows 7-12) ═══════
    const stats = [
      { id: STAT_IDS.VITALITY, n: 'Vitalité', ic: 'IconVita.svg', tip: TOOLTIPS.vitality },
      { id: STAT_IDS.WISDOM, n: 'Sagesse', ic: 'IconWisdom.svg', tip: TOOLTIPS.wisdom },
      { id: STAT_IDS.STRENGTH, n: 'Force', ic: 'IconEarth.svg', tip: TOOLTIPS.strength },
      { id: STAT_IDS.INTELLIGENCE, n: 'Intelligence', ic: 'IconFire.svg', tip: TOOLTIPS.intelligence },
      { id: STAT_IDS.CHANCE, n: 'Chance', ic: 'IconWater.svg', tip: TOOLTIPS.chance },
      { id: STAT_IDS.AGILITY, n: 'Agilité', ic: 'IconAir.svg', tip: TOOLTIPS.agility },
    ];

    for (const s of stats) {
      const row = new StatRow(s.n, `${ICON}/${s.ic}`, W, s.tip);
      row.container.y = y;
      row.setOnBoost(() => this.onBoostStat?.(s.id));
      this.statRows.set(s.id, row);
      this.container.addChild(row.container);
      y += METRICS.ROW_H;
      rowIdx++;
    }

    // ═══════ CAPITAL HEADER ═══════
    const capBg = new Graphics();
    capBg.rect(0, y, W, METRICS.HEADER_H);
    capBg.fill({ color: 0x7a7a56 });
    this.container.addChild(capBg);
    const capLabel = new Text({ text: 'Capital', style: boldText(11, COLORS.TEXT_WHITE) });
    capLabel.anchor.set(0, 0.5);
    capLabel.x = METRICS.PX;
    capLabel.y = y + METRICS.HEADER_H / 2;
    this.container.addChild(capLabel);
    this.withTooltip(capLabel, TOOLTIPS.capital);

    this.capitalVal = new Text({ text: '0', style: boldText(12, COLORS.TEXT_WHITE) });
    this.capitalVal.anchor.set(1, 0.5);
    this.capitalVal.x = W - METRICS.PX;
    this.capitalVal.y = y + METRICS.HEADER_H / 2;
    this.container.addChild(this.capitalVal);
    y += METRICS.HEADER_H;

    // ═══════ MES MÉTIERS HEADER ═══════
    const jobHdr = createSectionHeader(y, W, 'Mes métiers');
    this.container.addChild(jobHdr.graphics);
    this.container.addChild(jobHdr.text);
    y = jobHdr.nextY;

    // ═══════ JOB & SPEC SLOTS — side by side, centered vertically ═══════
    const panelH = 420;
    const jobAreaH = panelH - y;
    const jobGap = 4;
    const specGap = 3;
    const midGap = 8;
    const jobTotalW = 3 * METRICS.JOB_SLOT + 2 * jobGap;
    const specTotalW = 3 * METRICS.SPEC_SLOT + 2 * specGap;
    const allW = jobTotalW + midGap + specTotalW;
    const startX = (W - allW) / 2;
    const jobY = y + (jobAreaH - METRICS.JOB_SLOT) / 2;

    for (let i = 0; i < 3; i++) {
      const sx = startX + i * (METRICS.JOB_SLOT + jobGap);
      const slot = createSlot(sx, jobY, METRICS.JOB_SLOT);
      this.container.addChild(slot.graphics);
    }

    const specX = startX + jobTotalW + midGap;
    const specBlockH = 10 + METRICS.SPEC_SLOT;
    const specTopY = jobY + (METRICS.JOB_SLOT - specBlockH) / 2;
    const specLabel = new Text({ text: 'Spécialisations', style: regularText(8, COLORS.TEXT_DARK) });
    specLabel.x = specX;
    specLabel.y = specTopY;
    this.container.addChild(specLabel);
    const specSlotY = specTopY + 12;
    for (let i = 0; i < 3; i++) {
      const sx = specX + i * (METRICS.SPEC_SLOT + specGap);
      const slot = createSlot(sx, specSlotY, METRICS.SPEC_SLOT);
      this.container.addChild(slot.graphics);
    }

    // ═══════ FIXED HEIGHT background (at bottom of z-order) ═══════
    const bgFill = new Graphics();
    bgFill.roundRect(0, 0, W, panelH, 3);
    bgFill.fill({ color: COLORS.BG });
    bgFill.eventMode = 'static';
    this.container.addChildAt(bgFill, 0);

    // Border overlay (on top of everything)
    const borderOverlay = new Graphics();
    borderOverlay.roundRect(0, 0, W, panelH, 3);
    borderOverlay.stroke({ color: COLORS.BORDER, width: 2 });
    borderOverlay.eventMode = 'none';
    this.container.addChild(borderOverlay);

    // Alignment frame on top
    this.container.addChild(alignFrame);

    this.loadIcons();
  }

  // ─── Helpers ───

  private withDynamicTooltip(target: Container, getTip: () => string): void {
    target.eventMode = 'static';
    target.cursor = 'default';
    target.on('pointerover', (e) => {
      showTooltip(this.container, getTip(), e.global.x, e.global.y);
    });
    target.on('pointerout', () => hideTooltip());
  }

  private withTooltip(target: Container, tip: string): void {
    target.eventMode = 'static';
    target.cursor = 'default';
    target.on('pointerover', (e) => {
      showTooltip(this.container, tip, e.global.x, e.global.y);
    });
    target.on('pointerout', () => hideTooltip());
  }

  private makeIcon(label: string, w: number, h: number): Sprite {
    const spr = new Sprite(Texture.EMPTY);
    spr.width = w;
    spr.height = h;
    spr.label = label;
    this.iconSizes.set(spr, { w, h });
    this.container.addChild(spr);
    return spr;
  }

  private addCombatRow(
    y: number, iconFile: string, label: string, isLP: boolean,
    onVal: (t: Text) => void, tooltip?: string, tint?: number,
  ): number {
    const midY = y + METRICS.ROW_H / 2;

    const ico = this.makeIcon(iconFile, METRICS.ICON_SIZE, METRICS.ICON_SIZE);
    ico.x = METRICS.PX;
    ico.y = y + (METRICS.ROW_H - METRICS.ICON_SIZE) / 2;
    if (tint != null) ico.tint = tint;

    const lbl = new Text({ text: label, style: boldText(11, COLORS.TEXT_DARK) });
    lbl.anchor.set(0, 0.5);
    lbl.x = METRICS.PX + 18;
    lbl.y = midY;
    this.container.addChild(lbl);
    if (tooltip) this.withTooltip(lbl, tooltip);

    const val = new Text({ text: isLP ? '0 / 0' : '0', style: boldText(11, COLORS.TEXT_DARK) });
    val.anchor.set(1, 0.5);
    val.x = W - METRICS.PX;
    val.y = midY;
    this.container.addChild(val);
    onVal(val);
    return y + METRICS.ROW_H;
  }

  private async loadIcons(): Promise<void> {
    // Batch load: collect valid paths, load all at once, then assign
    const entries: Array<{ spr: Sprite; path: string }> = [];
    for (const [spr] of this.iconSizes) {
      entries.push({ spr, path: `${ICON}/${spr.label}` });
    }

    // Load in parallel, ignoring missing files
    const results = await Promise.allSettled(
      entries.map(e => Assets.load(e.path))
    );

    for (let i = 0; i < entries.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled' && result.value) {
        const { spr } = entries[i];
        const size = this.iconSizes.get(spr)!;
        spr.texture = result.value;
        spr.width = size.w;
        spr.height = size.h;
      }
    }
  }

  // ─── Public API ───

  setOnBoostStat(fn: (statId: number) => void): void { this.onBoostStat = fn; }
  setOnClose(fn: () => void): void { this.onClose = fn; }
  setClassId(classId: number): void { this.classId = classId; }

  setCharacterName(name: string): void { this.nameText.text = name; }

  updateStats(stats: CharacterStats): void {
    this.levelText.text = `Niveau ${stats.level ?? 1}`;

    const energy = stats.energy ?? 0;
    const maxEnergy = stats.maxEnergy ?? 1;
    const ePct = maxEnergy > 0 ? energy / maxEnergy : 0;
    this.energyBar.redraw(ePct);
    this.energyTip = `Énergie : ${energy} / ${maxEnergy}`;

    const xp = stats.xp ?? 0;
    const xpLow = stats.xpLow ?? 0;
    const xpHigh = stats.xpHigh ?? 0;
    const xpRange = xpHigh - xpLow;
    const xPct = xpRange > 0 ? (xp - xpLow) / xpRange : 0;
    this.xpBar.redraw(xPct);
    this.xpTip = `Expérience : ${xp - xpLow} / ${xpRange} (niveau ${stats.level ?? 1})`;

    this.lpVal.text = `${stats.hp ?? 0} / ${stats.maxHp ?? 0}`;
    this.apVal.text = String(stats.ap ?? 0);
    this.mpVal.text = String(stats.mp ?? 0);
    this.initVal.text = String(stats.initiative ?? 0);
    this.discVal.text = String(stats.discernment ?? 0);

    const keys: [number, keyof CharacterStats][] = [
      [STAT_IDS.VITALITY, 'vitality'], [STAT_IDS.WISDOM, 'wisdom'],
      [STAT_IDS.STRENGTH, 'strength'], [STAT_IDS.INTELLIGENCE, 'intelligence'],
      [STAT_IDS.CHANCE, 'chance'], [STAT_IDS.AGILITY, 'agility'],
    ];
    const bp = stats.bonusPoints ?? 0;
    for (const [id, key] of keys) {
      const row = this.statRows.get(id);
      const v = stats[key] as { base: number; items: number; boost: number } | undefined;
      const stat = v ?? { base: 0, items: 0, boost: 0 };
      row?.update(stat);
      const cost = getBoostCost(this.classId, id, stat.base);
      row?.setBoostCost(cost);
      row?.setBoostEnabled(bp >= cost);
    }

    this.capitalVal.text = String(bp);
  }

  toggle(): void { this.container.visible = !this.container.visible; }
  show(): void { this.container.visible = true; }
  hide(): void { this.container.visible = false; }
  isVisible(): boolean { return this.container.visible; }

  setScale(s: number): void { this.container.scale.set(s); }
  setPosition(x: number, y: number): void { this.container.x = x; this.container.y = y; }

  destroy(): void {
    for (const row of this.statRows.values()) row.destroy();
    this.statRows.clear();
    this.iconSizes.clear();
    this.container.destroy({ children: true });
  }
}
