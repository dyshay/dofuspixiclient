import { Elysia } from "elysia";
import { match } from "ts-pattern";

import {
  handleCharacterSelect,
  handleLogin,
  handleLogout,
} from "../handlers/auth.ts";
import { handleMapChange } from "../handlers/map.ts";
import {
  clearPendingTransition,
  handleMoveEnd,
  handleMovement,
} from "../handlers/movement.ts";
import { handleBoostStat, handleDebugGiveCapital } from "../handlers/stats.ts";
import { decodeClientMessage, encodeServerMessage } from "../protocol/codec.ts";
import { ClientMessageType, ServerMessageType } from "../protocol/types.ts";
import {
  createSession,
  getSession,
  removeSession,
  type WsHandle,
} from "./client-session.ts";

let sessionCounter = 0;

export const gameWs = new Elysia().ws("/game", {
  open(ws) {
    const sessionId = `s${++sessionCounter}_${Date.now()}`;
    // Store sessionId on the ws data context
    (ws.data as Record<string, unknown>).sessionId = sessionId;
    // Use ws.raw (Bun's ServerWebSocket) to bypass Elysia's JSON serialization
    createSession(ws.raw as unknown as WsHandle, sessionId);
    console.log(`[WS] Client connected: ${sessionId}`);
  },

  async message(ws, data) {
    const sessionId = (ws.data as Record<string, unknown>).sessionId as string;
    const session = getSession(sessionId);
    if (!session) return;

    try {
      // data from Elysia WS can be string, Buffer, or undefined for binary
      const raw =
        data instanceof ArrayBuffer
          ? data
          : data instanceof Uint8Array
            ? data.buffer
            : typeof data === "object" && data !== null && "buffer" in data
              ? (data as { buffer: ArrayBuffer }).buffer
              : data;

      const msg = decodeClientMessage(raw as ArrayBuffer);

      await match(msg.type)
        .with(ClientMessageType.AUTH_LOGIN, () => handleLogin(session, msg.payload as any))
        .with(ClientMessageType.AUTH_LOGOUT, () => handleLogout(session))
        .with(ClientMessageType.CHARACTER_SELECT, () => handleCharacterSelect(session, msg.payload as any))
        .with(ClientMessageType.CHARACTER_MOVE, () => handleMovement(session, msg.payload as any))
        .with(ClientMessageType.CHARACTER_MOVE_END, () => handleMoveEnd(session))
        .with(ClientMessageType.MAP_CHANGE, () => handleMapChange(session, msg.payload as any))
        .with(ClientMessageType.CHARACTER_BOOST_STAT, () => handleBoostStat(session, msg.payload as any))
        .with(ClientMessageType.DEBUG_GIVE_CAPITAL, () => handleDebugGiveCapital(session, msg.payload as any))
        .with(ClientMessageType.PING, () => {
          ws.raw.send(encodeServerMessage(ServerMessageType.PONG, { time: Date.now() }));
        })
        .otherwise((type) => {
          console.log(`[WS] Unknown message type: 0x${type.toString(16)}`);
        });
    } catch (err) {
      console.error(`[WS] Message handling error:`, err);
    }
  },

  async close(ws) {
    const sessionId = (ws.data as Record<string, unknown>).sessionId as string;
    const session = getSession(sessionId);
    if (session) {
      clearPendingTransition(sessionId);
      await handleLogout(session);
      removeSession(sessionId);
    }
    console.log(`[WS] Client disconnected: ${sessionId}`);
  },
});
