// Only export types from this barrel to avoid @system decorator side-effects.
// System classes must be imported directly from their files.
export type { EffectResult, PendingEffect } from "./effect-system";
export type { MovementResult } from "./movement-system";
export type { SpellCastResult, SpellCastValidation } from "./spell-cast-system";
