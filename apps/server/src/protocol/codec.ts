import { encode, decode } from '@msgpack/msgpack';
import type { ClientMessage, ServerMessageTypeValue } from './types.ts';

export function decodeClientMessage(data: ArrayBuffer | Uint8Array): ClientMessage {
  const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  return decode(buffer) as ClientMessage;
}

export function encodeServerMessage<T>(type: ServerMessageTypeValue, payload: T): Uint8Array {
  return encode({ type, payload, timestamp: Date.now() }) as Uint8Array;
}
