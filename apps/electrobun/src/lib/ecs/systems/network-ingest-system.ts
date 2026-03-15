import { match } from "ts-pattern";
import type {
  ActorAddPayload,
  ActorMovePayload,
  ActorRemovePayload,
} from "@dofus/protocol";
import { ServerMessageType } from "@dofus/protocol";
import { System, system } from "@lastolivegames/becsy";

import {
  ActorTag,
  CellPosition,
  FighterLook,
  type NetworkCommand,
  NetworkId,
  Position,
  Renderable,
  SpriteState,
} from "@/ecs/components";

/**
 * Shared command queue — external code pushes here,
 * NetworkIngestSystem drains it each frame.
 */
const pendingCommands: NetworkCommand[] = [];

export function pushNetworkCommand(command: NetworkCommand): void {
  pendingCommands.push(command);
}

/**
 * Drains the shared command queue each frame and maps server messages
 * to entity operations (create/modify/destroy).
 */
@system
export class NetworkIngestSystem extends System {
  private networkEntities = this.query((q) => q.current.with(NetworkId).read);

  execute(): void {
    if (pendingCommands.length === 0) return;

    const commands = pendingCommands.splice(0, pendingCommands.length);

    for (const cmd of commands) {
      this.processCommand(cmd);
    }
  }

  private processCommand(cmd: NetworkCommand): void {
    match(cmd.type)
      .with(ServerMessageType.ACTOR_ADD, () => this.handleActorAdd(cmd.payload as ActorAddPayload))
      .with(ServerMessageType.ACTOR_REMOVE, () => this.handleActorRemove(cmd.payload as ActorRemovePayload))
      .with(ServerMessageType.ACTOR_MOVE, () => this.handleActorMove(cmd.payload as ActorMovePayload))
      .otherwise(() => {});
  }

  private handleActorAdd(payload: ActorAddPayload): void {
    const gfxId = payload.look
      ? parseInt(payload.look.split("|")[0], 10) || 0
      : 0;

    this.createEntity(
      NetworkId,
      { value: payload.id },
      CellPosition,
      { cellId: payload.cellId, groundLevel: 7 },
      ActorTag,
      { isCurrentPlayer: false },
      SpriteState,
      {
        container: null,
        gfxId,
        animationType: 0,
        currentAnimName: "",
        currentAnimData: null,
        frameIndex: 0,
        frameTimer: 0,
        spriteLoading: false,
      },
      Position,
      { x: 0, y: 0 },
      Renderable,
      { sprite: null, visible: true, alpha: 1 },
      FighterLook,
      {
        look: payload.look ?? "",
        name: payload.name ?? "",
        entityType: payload.type,
      },
    );
  }

  private handleActorRemove(payload: ActorRemovePayload): void {
    for (const entity of this.networkEntities.current) {
      if (entity.read(NetworkId).value === payload.id) {
        entity.delete();
        break;
      }
    }
  }

  private handleActorMove(_payload: ActorMovePayload): void {
    // Movement will be handled by MovementAnimationSystem in a future step
  }
}
