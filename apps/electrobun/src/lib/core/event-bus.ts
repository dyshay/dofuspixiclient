import type { ActorAddPayload } from "@dofus/protocol";

import type { MapData } from "@/ank/battlefield/datacenter/map";
import type { CharacterInfo } from "@/game/game-client";

export interface GameEvents {
  "auth:character-list": { characters: CharacterInfo[] };
  "auth:login-failed": { reason: string };
  "auth:connected": void;
  "auth:disconnected": void;
  "world:map-loaded": { mapData: MapData };
  "world:map-changed": { mapId: number };
  "world:actor-add": ActorAddPayload;
  "world:actor-remove": { id: number };
  "world:actor-move": { id: number; path: number[] };
  "world:cell-click": { cellId: number };
  "combat:init": { fightId: number };
  "combat:start": void;
  "combat:end": void;
  "combat:turn-start": { fighterId: number };
  "combat:turn-end": { fighterId: number };
}

type EventHandler<T> = T extends void ? () => void : (data: T) => void;

export class EventBus {
  private handlers = new Map<string, Set<Function>>();

  on<K extends keyof GameEvents>(
    event: K,
    handler: EventHandler<GameEvents[K]>
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  emit<K extends keyof GameEvents>(
    event: K,
    ...args: GameEvents[K] extends void ? [] : [GameEvents[K]]
  ): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;

    for (const handler of handlers) {
      (handler as Function)(...args);
    }
  }

  off<K extends keyof GameEvents>(
    event: K,
    handler: EventHandler<GameEvents[K]>
  ): void {
    this.handlers.get(event)?.delete(handler);
  }

  clear(): void {
    this.handlers.clear();
  }
}

let eventBusInstance: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!eventBusInstance) {
    eventBusInstance = new EventBus();
  }
  return eventBusInstance;
}
