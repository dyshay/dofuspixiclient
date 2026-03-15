import { Elysia } from 'elysia';
import { decodeClientMessage, encodeServerMessage } from '../protocol/codec.ts';
import { ClientMessageType, ServerMessageType } from '../protocol/types.ts';
import { createSession, getSession, removeSession, type WsHandle } from './client-session.ts';
import { handleLogin, handleCharacterSelect, handleLogout } from '../handlers/auth.ts';
import { handleMapChange } from '../handlers/map.ts';
import { handleMovement } from '../handlers/movement.ts';

let sessionCounter = 0;

export const gameWs = new Elysia().ws('/game', {
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
      const raw = data instanceof ArrayBuffer
        ? data
        : data instanceof Uint8Array
          ? data.buffer
          : typeof data === 'object' && data !== null && 'buffer' in data
            ? (data as { buffer: ArrayBuffer }).buffer
            : data;

      const msg = decodeClientMessage(raw as ArrayBuffer);

      switch (msg.type) {
        case ClientMessageType.AUTH_LOGIN:
          await handleLogin(session, msg.payload as any);
          break;

        case ClientMessageType.AUTH_LOGOUT:
          await handleLogout(session);
          break;

        case ClientMessageType.CHARACTER_SELECT:
          await handleCharacterSelect(session, msg.payload as any);
          break;

        case ClientMessageType.CHARACTER_MOVE:
          await handleMovement(session, msg.payload as any);
          break;

        case ClientMessageType.MAP_CHANGE:
          await handleMapChange(session, msg.payload as any);
          break;

        case ClientMessageType.PING:
          ws.raw.send(encodeServerMessage(ServerMessageType.PONG, { time: Date.now() }));
          break;

        default:
          console.log(`[WS] Unknown message type: 0x${msg.type.toString(16)}`);
      }
    } catch (err) {
      console.error(`[WS] Message handling error:`, err);
    }
  },

  async close(ws) {
    const sessionId = (ws.data as Record<string, unknown>).sessionId as string;
    const session = getSession(sessionId);
    if (session) {
      await handleLogout(session);
      removeSession(sessionId);
    }
    console.log(`[WS] Client disconnected: ${sessionId}`);
  },
});
