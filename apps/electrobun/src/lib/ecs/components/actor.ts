import type { Container } from "pixi.js";
import { component, field } from "@lastolivegames/becsy";

import type { CharacterAnimation } from "@/ank/battlefield/character-sprite";

@component
export class ActorTag {
  @field.boolean declare isCurrentPlayer: boolean;
}

@component
export class SpriteState {
  @field.object declare container: Container | null;
  @field.uint32 declare gfxId: number;
  @field.uint8 declare animationType: number;
  @field.object declare currentAnimName: string;
  @field.object declare currentAnimData: CharacterAnimation | null;
  @field.uint16 declare frameIndex: number;
  @field.float32 declare frameTimer: number;
  @field.boolean declare spriteLoading: boolean;
}

@component
export class MovementAnimation {
  @field.float64 declare moveDistance: number;
  @field.float64 declare cosRot: number;
  @field.float64 declare sinRot: number;
  @field.float64 declare pixelSpeed: number;
  @field.boolean declare useRun: boolean;
}

@component
export class DamageDisplay {
  @field.int32 declare amount: number;
  @field.uint8 declare damageType: number;
  @field.uint8 declare element: number;
  @field.boolean declare critical: boolean;
  @field.float32 declare lifetime: number;
}
