export * from "./components";
// Systems are imported directly from their files to avoid @system decorator side-effects
export type { EffectResult, PendingEffect } from "./systems/effect-system";
export type { MovementResult } from "./systems/movement-system";
export type { SpellCastResult, SpellCastValidation } from "./systems/spell-cast-system";
export {
  GameWorld,
  type GameWorldConfig,
  getGameWorld,
  resetGameWorld,
} from "./world";
