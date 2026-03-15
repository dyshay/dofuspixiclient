export interface WsHandle {
  send(data: string | Uint8Array | ArrayBuffer): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  publish(topic: string, data: string | Uint8Array | ArrayBuffer): void;
}

export interface ClientSession {
  ws: WsHandle;
  sessionId: string;
  accountId: number | null;
  characterId: number | null;
  characterName: string | null;
  mapId: number | null;
  cellId: number | null;
  direction: number;
}

const sessions = new Map<string, ClientSession>();

export function createSession(ws: WsHandle, sessionId: string): ClientSession {
  const session: ClientSession = {
    ws,
    sessionId,
    accountId: null,
    characterId: null,
    characterName: null,
    mapId: null,
    cellId: null,
    direction: 1,
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId: string): ClientSession | undefined {
  return sessions.get(sessionId);
}

export function removeSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getSessionByCharacterId(characterId: number): ClientSession | undefined {
  for (const session of sessions.values()) {
    if (session.characterId === characterId) return session;
  }
  return undefined;
}

export function getAllSessions(): IterableIterator<ClientSession> {
  return sessions.values();
}
