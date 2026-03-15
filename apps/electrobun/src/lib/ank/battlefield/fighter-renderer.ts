import { Container, Graphics, Sprite, Text, TextStyle, Ticker } from "pixi.js";

import {
  DEFAULT_GROUND_LEVEL,
  DEFAULT_MAP_WIDTH,
} from "@/constants/battlefield";
import { FighterTeam } from "@/ecs/components";

import {
  type CharacterAnimation,
  getCharacterSpriteLoader,
  getDirectionSuffix,
  isDirectionFlipped,
} from "./character-sprite";
import { getCellPosition } from "./datacenter/cell";
import { DofusPathfinding } from "./dofus-pathfinding";

/**
 * Fighter animation state.
 */
export const FighterAnimation = {
  IDLE: "idle",
  WALK: "walk",
  RUN: "run",
  ATTACK: "attack",
  HIT: "hit",
  DEATH: "death",
  CAST: "cast",
} as const;

export type FighterAnimationValue =
  (typeof FighterAnimation)[keyof typeof FighterAnimation];

/**
 * Map FighterAnimation state to sprite animation base name.
 */
const ANIM_TO_SPRITE_BASE: Record<string, string> = {
  [FighterAnimation.IDLE]: "static",
  [FighterAnimation.WALK]: "walk",
  [FighterAnimation.RUN]: "run",
  [FighterAnimation.ATTACK]: "anim0",
  [FighterAnimation.HIT]: "hit",
  [FighterAnimation.DEATH]: "die",
  [FighterAnimation.CAST]: "anim1",
};

/**
 * Fighter sprite data.
 */
export interface FighterSpriteData {
  id: number;
  name: string;
  team: number;
  cellId: number;
  direction: number;
  look: string;
  hp: number;
  maxHp: number;
  isPlayer: boolean;
}

/**
 * Active fighter sprite.
 */
interface ActiveFighter {
  id: number;
  container: Container;
  sprite: Sprite | null;
  placeholderGraphics: Graphics | null;
  nameText: Text;
  hpBar: Graphics;
  cellId: number;
  direction: number;
  team: number;
  hp: number;
  maxHp: number;
  gfxId: number;
  animation: FighterAnimationValue;
  currentAnimName: string;
  currentAnimData: CharacterAnimation | null;
  frameIndex: number;
  frameTimer: number;
  /** Full path of cell IDs for current movement. */
  path: number[];
  /** Index into path: currently moving FROM path[pathIndex] TO path[pathIndex+1]. */
  pathIndex: number;
  /** Remaining pixel distance to the target cell of the current segment. */
  moveDistance: number;
  /** Movement direction unit vector (x component). */
  moveCosRot: number;
  /** Movement direction unit vector (y component). */
  moveSinRot: number;
  /** Current segment pixel speed in px/ms. */
  movePixelSpeed: number;
  /** Whether the current movement uses run speed. */
  useRun: boolean;
  moving: boolean;
  moveResolve?: () => void;
  spriteLoading: boolean;
}

/**
 * Fighter renderer configuration.
 */
export interface FighterRendererConfig {
  mapWidth?: number;
  groundLevel?: number;
}

/**
 * Per-direction movement speeds in px/ms (from ank.battlefield.mc.Sprite).
 */
const WALK_SPEEDS = [0.07, 0.06, 0.06, 0.06, 0.07, 0.06, 0.06, 0.06];
const RUN_SPEEDS = [0.17, 0.15, 0.15, 0.15, 0.17, 0.15, 0.15, 0.15];
/** Maximum frame delta in ms — matches original's cap in basicMove. */
const MAX_FRAME_MS = 125;
/** Paths with more steps than this use run animation (original: DEFAULT_RUNLINIT = 6, checked as path.length > 6). */
const RUN_THRESHOLD = 6;

/**
 * Parse gfxId from the look string (format: "gfx|color1|color2|color3").
 */
function parseGfxId(look: string): number {
  if (!look) return 0;
  const parts = look.split("|");
  return parseInt(parts[0], 10) || 0;
}

/**
 * Fighter renderer.
 * Manages fighter sprites on the battlefield using character sprite atlases.
 */
export class FighterRenderer {
  private container: Container;
  private fighters: Map<number, ActiveFighter> = new Map();
  private mapWidth: number;
  private groundLevel: number;
  private tickerCallback: () => void;

  constructor(parentContainer: Container, config: FighterRendererConfig = {}) {
    this.mapWidth = config.mapWidth ?? DEFAULT_MAP_WIDTH;
    this.groundLevel = config.groundLevel ?? DEFAULT_GROUND_LEVEL;

    this.container = new Container();
    this.container.label = "fighter-renderer";
    this.container.sortableChildren = true;

    parentContainer.addChild(this.container);

    this.tickerCallback = () => this.update();
    Ticker.shared.add(this.tickerCallback);
  }

  /**
   * Add a fighter to the battlefield.
   */
  addFighter(data: FighterSpriteData): void {
    if (this.fighters.has(data.id)) {
      this.updateFighter(data.id, data);
      return;
    }

    const fighterContainer = new Container();
    fighterContainer.label = `fighter-${data.id}`;
    fighterContainer.sortableChildren = true;

    // Start with placeholder graphics while sprite loads
    const placeholderGraphics = new Graphics();
    this.drawFighterPlaceholder(placeholderGraphics, data.team, data.direction);
    fighterContainer.addChild(placeholderGraphics);

    // Name text
    const nameStyle = new TextStyle({
      fontFamily: "Arial",
      fontSize: 10,
      fontWeight: "bold",
      fill: data.isPlayer ? 0x66ff66 : 0xffffff,
      stroke: { color: 0x000000, width: 2 },
      align: "center",
    });

    const nameText = new Text({ text: data.name, style: nameStyle });
    nameText.anchor.set(0.5, 1);
    nameText.y = -50;
    fighterContainer.addChild(nameText);

    // HP bar (hidden for world actors in roleplay mode)
    const hpBar = new Graphics();
    hpBar.visible = false;
    fighterContainer.addChild(hpBar);

    // Position at cell
    const pos = getCellPosition(data.cellId, this.mapWidth, this.groundLevel);
    fighterContainer.x = pos.x;
    fighterContainer.y = pos.y;
    fighterContainer.zIndex = this.calculateZIndex(data.cellId);

    this.container.addChild(fighterContainer);

    const gfxId = parseGfxId(data.look);

    const fighter: ActiveFighter = {
      id: data.id,
      container: fighterContainer,
      sprite: null,
      placeholderGraphics,
      nameText,
      hpBar,
      cellId: data.cellId,
      direction: data.direction,
      team: data.team,
      hp: data.hp,
      maxHp: data.maxHp,
      gfxId,
      animation: FighterAnimation.IDLE,
      currentAnimName: "",
      currentAnimData: null,
      frameIndex: 0,
      frameTimer: 0,
      path: [],
      pathIndex: 0,
      moveDistance: 0,
      moveCosRot: 0,
      moveSinRot: 0,
      movePixelSpeed: 0,
      useRun: false,
      moving: false,
      spriteLoading: false,
    };

    this.fighters.set(data.id, fighter);

    // Load the character sprite asynchronously
    if (gfxId > 0) {
      this.loadFighterSprite(fighter, "static", data.direction).then(() => {
        // Preload walk + run animations for common directions so movement is instant
        if (!this.fighters.has(data.id)) return;
        const loader = getCharacterSpriteLoader();
        const suffix = getDirectionSuffix(data.direction);
        loader.loadAnimation(gfxId, `walk${suffix}`);
        loader.loadAnimation(gfxId, `run${suffix}`);
      });
    }
  }

  /**
   * Load and apply a character sprite animation for a fighter.
   */
  private async loadFighterSprite(
    fighter: ActiveFighter,
    baseAnim: string,
    direction: number
  ): Promise<void> {
    if (fighter.spriteLoading) return;
    fighter.spriteLoading = true;

    const loader = getCharacterSpriteLoader();
    const result = await loader.loadAnimationWithFallback(
      fighter.gfxId,
      baseAnim,
      direction
    );

    fighter.spriteLoading = false;

    // Fighter may have been removed while loading
    if (!this.fighters.has(fighter.id)) return;

    if (!result) return;

    const { animation, animName } = result;
    this.applyAnimation(fighter, animation, animName);
  }

  /**
   * Apply a loaded animation to a fighter, replacing placeholder or previous sprite.
   */
  private applyAnimation(
    fighter: ActiveFighter,
    animation: CharacterAnimation,
    animName: string
  ): void {
    // Don't re-apply same animation
    if (fighter.currentAnimName === animName && fighter.sprite) return;

    fighter.currentAnimData = animation;
    fighter.currentAnimName = animName;
    fighter.frameIndex = 0;
    fighter.frameTimer = 0;

    // Remove placeholder if present
    if (fighter.placeholderGraphics) {
      fighter.container.removeChild(fighter.placeholderGraphics);
      fighter.placeholderGraphics.destroy();
      fighter.placeholderGraphics = null;
    }

    // Apply horizontal flip for mirrored directions (SW, W, NE)
    const flipped = isDirectionFlipped(fighter.direction);

    // Create or update sprite
    if (!fighter.sprite) {
      const sprite = new Sprite(animation.textures[0]);
      sprite.anchor.set(0, 1);
      sprite.scale.x = flipped ? -1 : 1;
      sprite.x = flipped ? -animation.offsetX : animation.offsetX;
      sprite.y = animation.offsetY;
      sprite.zIndex = 0;
      fighter.container.addChild(sprite);
      fighter.sprite = sprite;
    } else {
      fighter.sprite.texture = animation.textures[0];
      fighter.sprite.scale.x = flipped ? -1 : 1;
      fighter.sprite.x = flipped ? -animation.offsetX : animation.offsetX;
      fighter.sprite.y = animation.offsetY;
    }

    // Update name position based on sprite height
    fighter.nameText.y = animation.offsetY - animation.frameHeight - 5;
  }

  /**
   * Switch a fighter's animation (e.g., idle → walk).
   */
  private switchAnimation(
    fighter: ActiveFighter,
    baseAnim: string,
    direction: number
  ): void {
    const suffix = getDirectionSuffix(direction);
    const animName = `${baseAnim}${suffix}`;

    // Same animation name but direction may have changed flip state
    // (e.g., SE uses "R" un-flipped, SW uses "R" flipped)
    if (fighter.currentAnimName === animName && fighter.sprite) {
      this.updateFlip(fighter);
      return;
    }

    // Check if cached
    const loader = getCharacterSpriteLoader();
    const cached = loader.getAnimationSync(fighter.gfxId, animName);

    if (cached) {
      this.applyAnimation(fighter, cached, animName);
    } else {
      // Load asynchronously
      this.loadFighterSprite(fighter, baseAnim, direction);
    }
  }

  /**
   * Update sprite flip based on current direction (without changing animation).
   */
  private updateFlip(fighter: ActiveFighter): void {
    if (!fighter.sprite || !fighter.currentAnimData) return;
    const flipped = isDirectionFlipped(fighter.direction);
    fighter.sprite.scale.x = flipped ? -1 : 1;
    fighter.sprite.x = flipped
      ? -fighter.currentAnimData.offsetX
      : fighter.currentAnimData.offsetX;
  }

  /**
   * Remove a fighter from the battlefield.
   */
  removeFighter(id: number): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    this.container.removeChild(fighter.container);
    fighter.container.destroy({ children: true });
    this.fighters.delete(id);
  }

  /**
   * Update fighter data.
   */
  updateFighter(id: number, data: Partial<FighterSpriteData>): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    if (
      data.cellId !== undefined &&
      data.cellId !== fighter.cellId &&
      !fighter.moving
    ) {
      this.teleportFighter(id, data.cellId);
    }

    if (data.direction !== undefined && data.direction !== fighter.direction) {
      fighter.direction = data.direction;
      if (fighter.sprite) {
        const baseAnim = ANIM_TO_SPRITE_BASE[fighter.animation] ?? "static";
        this.switchAnimation(fighter, baseAnim, data.direction);
      } else if (fighter.placeholderGraphics) {
        this.drawFighterPlaceholder(
          fighter.placeholderGraphics,
          fighter.team,
          fighter.direction
        );
      }
    }

    if (data.hp !== undefined || data.maxHp !== undefined) {
      fighter.hp = data.hp ?? fighter.hp;
      fighter.maxHp = data.maxHp ?? fighter.maxHp;
      if (fighter.hpBar.visible) {
        this.drawHPBar(fighter.hpBar, fighter.hp, fighter.maxHp, fighter.team);
      }
    }

    if (data.name !== undefined) {
      fighter.nameText.text = data.name;
    }
  }

  /**
   * Move fighter along a path.
   */
  moveFighter(id: number, path: number[]): Promise<void> {
    return new Promise((resolve) => {
      const fighter = this.fighters.get(id);

      if (!fighter || path.length < 2) {
        resolve();
        return;
      }

      // Choose walk or run based on path length (original: path.length > DEFAULT_RUNLINIT)
      const useRun = path.length > RUN_THRESHOLD;
      fighter.path = path;
      fighter.pathIndex = 0;
      fighter.useRun = useRun;
      fighter.moving = true;
      fighter.animation = useRun ? FighterAnimation.RUN : FighterAnimation.WALK;
      fighter.moveResolve = resolve;

      // Start the first segment
      this.startMoveSegment(fighter);
    });
  }

  /**
   * Begin a new cell-to-cell movement segment (matches original moveToCell).
   * Computes pixel distance, direction vector, and speed for the current segment.
   */
  private startMoveSegment(fighter: ActiveFighter): void {
    const fromCell = fighter.path[fighter.pathIndex];
    const toCell = fighter.path[fighter.pathIndex + 1];

    // Compute direction
    const dir = DofusPathfinding.getDirection(fromCell, toCell, this.mapWidth);
    fighter.direction = dir;

    // Get pixel positions
    const fromPos = getCellPosition(fromCell, this.mapWidth, this.groundLevel);
    const toPos = getCellPosition(toCell, this.mapWidth, this.groundLevel);

    // Pixel distance (matches original: Math.sqrt(dx^2 + dy^2))
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    fighter.moveDistance = Math.sqrt(dx * dx + dy * dy);

    // Direction unit vector (matches original: atan2 → cos/sin)
    const angle = Math.atan2(dy, dx);
    fighter.moveCosRot = Math.cos(angle);
    fighter.moveSinRot = Math.sin(angle);

    // Speed in px/ms (matches original WALK_SPEEDS / RUN_SPEEDS indexed by direction)
    fighter.movePixelSpeed = fighter.useRun
      ? RUN_SPEEDS[dir]
      : WALK_SPEEDS[dir];

    // Switch animation for this segment's direction
    const baseAnim = fighter.useRun ? "run" : "walk";
    this.switchAnimation(fighter, baseAnim, dir);
  }

  /**
   * Teleport fighter to a cell instantly.
   */
  teleportFighter(id: number, cellId: number): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    fighter.cellId = cellId;
    const pos = getCellPosition(cellId, this.mapWidth, this.groundLevel);
    fighter.container.x = pos.x;
    fighter.container.y = pos.y;
    fighter.container.zIndex = this.calculateZIndex(cellId);
  }

  /**
   * Set fighter animation.
   */
  setAnimation(id: number, animation: FighterAnimationValue): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    fighter.animation = animation;
    const baseAnim = ANIM_TO_SPRITE_BASE[animation] ?? "static";
    this.switchAnimation(fighter, baseAnim, fighter.direction);
  }

  /**
   * Set fighter direction.
   */
  setDirection(id: number, direction: number): void {
    const fighter = this.fighters.get(id);

    if (!fighter) {
      return;
    }

    fighter.direction = direction;
    const baseAnim = ANIM_TO_SPRITE_BASE[fighter.animation] ?? "static";
    this.switchAnimation(fighter, baseAnim, direction);
  }

  /**
   * Get fighter cell position.
   */
  getFighterCell(id: number): number | undefined {
    return this.fighters.get(id)?.cellId;
  }

  /**
   * Get all fighter IDs.
   */
  getFighterIds(): number[] {
    return Array.from(this.fighters.keys());
  }

  /**
   * Check if fighter exists.
   */
  hasFighter(id: number): boolean {
    return this.fighters.has(id);
  }

  /**
   * Update animation tick — handles movement interpolation and sprite frame animation.
   * Movement matches original basicMove: deltaPx = speed * min(deltaMs, 125).
   */
  private update(): void {
    const deltaMs = Ticker.shared.deltaMS;
    const deltaS = deltaMs / 1000;
    const clampedMs = Math.min(deltaMs, MAX_FRAME_MS);

    for (const fighter of this.fighters.values()) {
      // Animate sprite frames
      this.updateSpriteAnimation(fighter, deltaS);

      // Handle path movement (pixel-based, matching original basicMove)
      if (!fighter.moving || fighter.path.length === 0) {
        continue;
      }

      const deltaPx = fighter.movePixelSpeed * clampedMs;

      if (fighter.moveDistance <= deltaPx) {
        // Segment complete — snap to destination cell and advance
        const toCell = fighter.path[fighter.pathIndex + 1];
        const toPos = getCellPosition(toCell, this.mapWidth, this.groundLevel);
        fighter.container.x = toPos.x;
        fighter.container.y = toPos.y;
        fighter.cellId = toCell;
        fighter.container.zIndex = this.calculateZIndex(toCell);

        fighter.pathIndex++;

        if (fighter.pathIndex >= fighter.path.length - 1) {
          // Entire path complete — stop and return to idle
          fighter.path = [];
          fighter.pathIndex = 0;
          fighter.moveDistance = 0;
          fighter.moving = false;
          fighter.animation = FighterAnimation.IDLE;

          this.switchAnimation(fighter, "static", fighter.direction);

          if (fighter.moveResolve) {
            const resolve = fighter.moveResolve;
            fighter.moveResolve = undefined;
            resolve();
          }
        } else {
          // Start next segment
          this.startMoveSegment(fighter);
        }
      } else {
        // Mid-segment: advance position by deltaPx along direction vector
        fighter.container.x += deltaPx * fighter.moveCosRot;
        fighter.container.y += deltaPx * fighter.moveSinRot;
        fighter.moveDistance -= deltaPx;
      }
    }
  }

  /**
   * Update sprite frame animation for a fighter.
   */
  private updateSpriteAnimation(fighter: ActiveFighter, deltaS: number): void {
    if (!fighter.sprite || !fighter.currentAnimData) return;

    const anim = fighter.currentAnimData;
    if (anim.textures.length <= 1) return;

    fighter.frameTimer += deltaS;

    const frameDuration = 1 / anim.fps;
    if (fighter.frameTimer >= frameDuration) {
      fighter.frameTimer -= frameDuration;
      fighter.frameIndex = (fighter.frameIndex + 1) % anim.textures.length;
      fighter.sprite.texture = anim.textures[fighter.frameIndex];
    }
  }

  /**
   * Calculate z-index from cell position.
   */
  private calculateZIndex(cellId: number): number {
    const pos = getCellPosition(cellId, this.mapWidth, this.groundLevel);
    return Math.floor(pos.y * 100 + pos.x);
  }

  /**
   * Draw placeholder fighter graphic (used while sprite loads).
   */
  private drawFighterPlaceholder(
    graphics: Graphics,
    team: number,
    direction: number
  ): void {
    graphics.clear();

    const color = team === FighterTeam.RED ? 0xff4444 : 0x4444ff;

    // Body circle
    graphics.circle(0, -10, 12);
    graphics.fill({ color, alpha: 0.8 });
    graphics.stroke({ color: 0x000000, width: 2 });

    // Head circle
    graphics.circle(0, -25, 8);
    graphics.fill({ color, alpha: 0.9 });
    graphics.stroke({ color: 0x000000, width: 2 });

    // Direction indicator
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];
    const angle = (angles[direction] * Math.PI) / 180;
    const indicatorX = Math.cos(angle) * 15;
    const indicatorY = Math.sin(angle) * 8 - 10;

    graphics.circle(indicatorX, indicatorY, 4);
    graphics.fill({ color: 0xffff00 });
  }

  /**
   * Draw HP bar.
   */
  private drawHPBar(
    graphics: Graphics,
    hp: number,
    maxHp: number,
    team: number
  ): void {
    graphics.clear();

    const width = 30;
    const height = 4;
    const ratio = Math.max(0, Math.min(1, hp / maxHp));

    // Background
    graphics.rect(-width / 2, 0, width, height);
    graphics.fill({ color: 0x333333 });

    // HP fill
    const hpColor = team === FighterTeam.RED ? 0xff4444 : 0x4444ff;
    graphics.rect(-width / 2, 0, width * ratio, height);
    graphics.fill({ color: hpColor });

    // Border
    graphics.rect(-width / 2, 0, width, height);
    graphics.stroke({ color: 0x000000, width: 1 });
  }

  /**
   * Set map dimensions.
   */
  setMapDimensions(width: number, groundLevel?: number): void {
    this.mapWidth = width;

    if (groundLevel !== undefined) {
      this.groundLevel = groundLevel;
    }
  }

  /**
   * Update container position.
   */
  setOffset(x: number, y: number): void {
    this.container.x = x;
    this.container.y = y;
  }

  /**
   * Set container scale.
   */
  setScale(scale: number): void {
    this.container.scale.set(scale);
  }

  /**
   * Clear all fighters.
   */
  clear(): void {
    for (const fighter of this.fighters.values()) {
      fighter.container.destroy({ children: true });
    }

    this.fighters.clear();
    this.container.removeChildren();
  }

  /**
   * Destroy the renderer.
   */
  destroy(): void {
    Ticker.shared.remove(this.tickerCallback);
    this.clear();
    this.container.destroy();
  }
}
