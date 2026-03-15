import { decode, encode } from "@msgpack/msgpack";

import type {
  ClientMessage,
  ClientMessageTypeValue,
  ServerMessage,
  ServerMessageTypeValue,
} from "./types.ts";

export function encodeClientMessage<T>(
  type: ClientMessageTypeValue,
  payload: T
): Uint8Array {
  return encode({ type, payload, timestamp: Date.now() });
}

export function decodeClientMessage(
  data: ArrayBuffer | Uint8Array
): ClientMessage {
  const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return decode(buffer) as ClientMessage;
}

export function encodeServerMessage<T>(
  type: ServerMessageTypeValue,
  payload: T
): Uint8Array {
  return encode({ type, payload, timestamp: Date.now() }) as Uint8Array;
}

export function decodeServerMessage(
  data: ArrayBuffer | Uint8Array
): ServerMessage {
  const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return decode(buffer) as ServerMessage;
}
