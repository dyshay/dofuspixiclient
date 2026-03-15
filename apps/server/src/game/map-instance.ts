import { encodeServerMessage } from '../protocol/codec.ts';
import { ServerMessageType, type ActorAddPayload, type ActorRemovePayload } from '../protocol/types.ts';
import type { ClientSession } from '../ws/client-session.ts';

interface MapActor {
  id: number;
  type: number;
  cellId: number;
  direction: number;
  name: string;
  look: string;
  session: ClientSession;
}

export class MapInstance {
  readonly mapId: number;
  private actors = new Map<number, MapActor>();

  constructor(mapId: number) {
    this.mapId = mapId;
  }

  get topic(): string {
    return `map:${this.mapId}`;
  }

  addActor(session: ClientSession, characterId: number, name: string, cellId: number, direction: number, look: string): void {
    this.actors.set(characterId, {
      id: characterId,
      type: 0,
      cellId,
      direction,
      name,
      look,
      session,
    });

    // Subscribe to map topic
    session.ws.subscribe(this.topic);

    // Broadcast ACTOR_ADD to others on this map
    const addPayload: ActorAddPayload = { id: characterId, type: 0, cellId, direction, name, look };
    const msg = encodeServerMessage(ServerMessageType.ACTOR_ADD, addPayload);
    session.ws.publish(this.topic, msg);
  }

  removeActor(characterId: number): void {
    const actor = this.actors.get(characterId);
    if (!actor) return;

    // Broadcast ACTOR_REMOVE before unsubscribing
    const removePayload: ActorRemovePayload = { id: characterId };
    const msg = encodeServerMessage(ServerMessageType.ACTOR_REMOVE, removePayload);
    actor.session.ws.publish(this.topic, msg);

    actor.session.ws.unsubscribe(this.topic);
    this.actors.delete(characterId);
  }

  updateActorCell(characterId: number, cellId: number, direction: number): void {
    const actor = this.actors.get(characterId);
    if (actor) {
      actor.cellId = cellId;
      actor.direction = direction;
    }
  }

  getActors(): ActorAddPayload[] {
    const result: ActorAddPayload[] = [];
    for (const actor of this.actors.values()) {
      result.push({
        id: actor.id,
        type: actor.type,
        cellId: actor.cellId,
        direction: actor.direction,
        name: actor.name,
        look: actor.look,
      });
    }
    return result;
  }

  broadcast(data: Uint8Array, sender: ClientSession): void {
    sender.ws.publish(this.topic, data);
  }

  get actorCount(): number {
    return this.actors.size;
  }

  isEmpty(): boolean {
    return this.actors.size === 0;
  }
}
