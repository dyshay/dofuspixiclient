import type { Battlefield } from "@/ank/battlefield";
import {
  loadMapDataFromServer,
  type ServerMapDataPayload,
} from "@/ank/battlefield/datacenter/map";
import { DofusPathfinding } from "@/ank/battlefield/dofus-pathfinding";
import { Connection, type ConnectionEvent } from "@/network/connection";
import {
  createMessageHandler,
  type MessageHandler,
} from "@/network/message-handler";
import {
  type ActorAddPayload,
  type ActorMovePayload,
  type ActorRemovePayload,
  ClientMessageType,
  encodeMessage,
  ServerMessageType,
} from "@/network/protocol";

export interface CharacterInfo {
  id: number;
  name: string;
  class: number;
  sex: number;
  gfx: number;
  level: number;
  mapId: number;
  cellId: number;
}

export interface GameClientConfig {
  serverUrl?: string;
}

export class GameClient {
  private connection: Connection;
  private messageHandler: MessageHandler;
  private battlefield: Battlefield | null = null;

  private accountCharacters: CharacterInfo[] = [];
  private currentCharacter: CharacterInfo | null = null;
  private currentMapId: number | null = null;
  private currentCellId: number | null = null;
  private pathfinding: DofusPathfinding | null = null;
  private isMoving = false;
  private mapLoadPromise: Promise<void> = Promise.resolve();

  private onCharacterList?: (characters: CharacterInfo[]) => void;
  private onLoginFailed?: (reason: string) => void;
  private onConnected?: () => void;
  private onDisconnected?: () => void;

  constructor(config?: GameClientConfig) {
    this.connection = new Connection({
      url: config?.serverUrl ?? "ws://localhost:8080/game",
    });
    this.messageHandler = createMessageHandler();

    this.connection.addEventListener((event: ConnectionEvent) => {
      switch (event.type) {
        case "connected":
          console.log("[GameClient] Connected to server");
          this.onConnected?.();
          break;
        case "disconnected":
          console.log("[GameClient] Disconnected:", event.reason);
          this.onDisconnected?.();
          break;
        case "message":
          this.messageHandler.handle(event.message);
          break;
      }
    });

    this.registerHandlers();
  }

  private registerHandlers(): void {
    // AUTH_SUCCESS — receive character list
    this.messageHandler.on(ServerMessageType.AUTH_SUCCESS, (payload: any) => {
      this.accountCharacters = payload.characters ?? [];
      console.log(
        "[GameClient] Login success, characters:",
        this.accountCharacters.length
      );
      this.onCharacterList?.(this.accountCharacters);
    });

    // AUTH_FAILURE
    this.messageHandler.on(ServerMessageType.AUTH_FAILURE, (payload: any) => {
      console.error("[GameClient] Login failed:", payload.reason);
      this.onLoginFailed?.(payload.reason);
    });

    // CHARACTER_INFO — character selected, receive full info
    this.messageHandler.on(ServerMessageType.CHARACTER_INFO, (payload: any) => {
      this.currentCharacter = {
        id: payload.id,
        name: payload.name,
        class: payload.class,
        sex: payload.sex,
        gfx: payload.gfx,
        level: payload.level,
        mapId: payload.mapId,
        cellId: payload.cellId,
      };
      this.currentMapId = payload.mapId;
      this.currentCellId = payload.cellId;
      console.log(
        "[GameClient] Character selected:",
        payload.name,
        "on map",
        payload.mapId,
        "cell",
        payload.cellId
      );
    });

    // MAP_DATA — receive compressed map data from server
    this.messageHandler.on(ServerMessageType.MAP_DATA, (payload: any) => {
      const serverPayload = payload as ServerMapDataPayload;
      console.log(
        "[GameClient] Received MAP_DATA for map",
        serverPayload.mapId
      );

      try {
        const mapData = loadMapDataFromServer(serverPayload);
        this.currentMapId = serverPayload.mapId;

        // Reset movement state — a map change interrupts any in-progress movement
        this.isMoving = false;

        // Build pathfinding from cell data
        const walkableIds = mapData.cells
          .filter((c) => c.walkable)
          .map((c) => c.id);
        this.pathfinding = new DofusPathfinding(
          mapData.width,
          mapData.height,
          walkableIds
        );
        console.log(
          "[GameClient] Pathfinding built:",
          walkableIds.length,
          "walkable cells"
        );

        // Log trigger cell IDs
        const triggerCellIds = mapData.triggerCellIds ?? [];
        if (triggerCellIds.length > 0) {
          console.log(
            `[GameClient] Trigger cells (${triggerCellIds.length}):`,
            triggerCellIds.join(", ")
          );
        } else {
          console.log("[GameClient] No trigger cells on this map");
        }

        if (this.battlefield) {
          // Store the promise so MAP_ACTORS can wait for map rendering to finish
          this.mapLoadPromise = this.battlefield.loadMapFromData(mapData);
          this.battlefield.updateMinimapPosition(serverPayload.mapId);
        }
      } catch (err) {
        console.error("[GameClient] Failed to decompress map data:", err);
      }
    });

    // MAP_ACTORS — existing actors on the map
    this.messageHandler.on(
      ServerMessageType.MAP_ACTORS,
      async (payload: any) => {
        const actors: ActorAddPayload[] = payload.actors ?? [];
        console.log("[GameClient] MAP_ACTORS:", actors.length, "actors");

        if (!this.battlefield) return;

        // Wait for map to finish rendering before adding actors
        await this.mapLoadPromise;

        // Clear existing world actors
        this.battlefield.clearWorldActors();

        for (const actor of actors) {
          const isCurrentPlayer = actor.id === this.currentCharacter?.id;
          this.battlefield.addWorldActor({
            id: actor.id,
            name: actor.name ?? `Player ${actor.id}`,
            cellId: actor.cellId,
            direction: actor.direction,
            look: actor.look ?? "",
            isCurrentPlayer,
          });

          // Sync current cell from server after map change
          if (isCurrentPlayer) {
            this.currentCellId = actor.cellId;
          }
        }
      }
    );

    // ACTOR_ADD — new actor joined the map
    this.messageHandler.on(ServerMessageType.ACTOR_ADD, (payload: any) => {
      const actor = payload as ActorAddPayload;
      console.log("[GameClient] ACTOR_ADD:", actor.name ?? actor.id);

      this.battlefield?.addWorldActor({
        id: actor.id,
        name: actor.name ?? `Player ${actor.id}`,
        cellId: actor.cellId,
        direction: actor.direction,
        look: actor.look ?? "",
        isCurrentPlayer: actor.id === this.currentCharacter?.id,
      });
    });

    // ACTOR_REMOVE — actor left the map
    this.messageHandler.on(ServerMessageType.ACTOR_REMOVE, (payload: any) => {
      const { id } = payload as ActorRemovePayload;
      console.log("[GameClient] ACTOR_REMOVE:", id);
      this.battlefield?.removeWorldActor(id);
    });

    // ACTOR_MOVE — actor moved on the map
    this.messageHandler.on(
      ServerMessageType.ACTOR_MOVE,
      async (payload: any) => {
        const { id, path } = payload as ActorMovePayload;
        if (id === this.currentCharacter?.id && path.length > 0) {
          this.isMoving = true;
        }
        await this.battlefield?.moveWorldActor(id, path);
        if (id === this.currentCharacter?.id && path.length > 0) {
          this.currentCellId = path[path.length - 1];
          this.isMoving = false;
        }
      }
    );
  }

  setBattlefield(battlefield: Battlefield): void {
    this.battlefield = battlefield;
    this.battlefield.setOnCellClick((cellId) => this.handleCellClick(cellId));
  }

  private handleCellClick(targetCellId: number): void {
    if (this.currentCellId === null || !this.pathfinding || this.isMoving)
      return;

    const path = this.pathfinding.findPath(this.currentCellId, targetCellId);
    if (!path || path.length < 2) return;

    console.log(
      "[GameClient] Moving:",
      this.currentCellId,
      "→",
      targetCellId,
      `(${path.length - 1} steps)`
    );
    this.move(path);
  }

  connect(): void {
    this.connection.connect();
  }

  disconnect(): void {
    this.connection.disconnect();
  }

  login(username: string, password: string): void {
    this.connection.send(
      encodeMessage(ClientMessageType.AUTH_LOGIN, {
        username,
        password,
        version: "1.29",
      })
    );
  }

  selectCharacter(characterId: number): void {
    this.connection.send(
      encodeMessage(ClientMessageType.CHARACTER_SELECT, { characterId })
    );
  }

  move(path: number[]): void {
    this.connection.send(
      encodeMessage(ClientMessageType.CHARACTER_MOVE, { path })
    );
  }

  changeMap(mapId: number): void {
    this.connection.send(
      encodeMessage(ClientMessageType.MAP_CHANGE, { mapId })
    );
  }

  isConnected(): boolean {
    return this.connection.isConnected();
  }

  getCharacters(): CharacterInfo[] {
    return this.accountCharacters;
  }

  getCurrentCharacter(): CharacterInfo | null {
    return this.currentCharacter;
  }

  getCurrentMapId(): number | null {
    return this.currentMapId;
  }

  // Event callbacks
  setOnCharacterList(fn: (characters: CharacterInfo[]) => void): void {
    this.onCharacterList = fn;
  }

  setOnLoginFailed(fn: (reason: string) => void): void {
    this.onLoginFailed = fn;
  }

  setOnConnected(fn: () => void): void {
    this.onConnected = fn;
  }

  setOnDisconnected(fn: () => void): void {
    this.onDisconnected = fn;
  }

  destroy(): void {
    this.connection.destroy();
    this.messageHandler.clear();
    this.battlefield = null;
  }
}
