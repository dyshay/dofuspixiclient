import { Elysia } from 'elysia';
import { gameWs } from './ws/game-ws.ts';
import { getOnlineCount, getMapInstanceCount } from './game/game-manager.ts';

const PORT = Number(process.env.PORT ?? 8080);

const app = new Elysia()
  .get('/health', () => ({
    status: 'ok',
    online: getOnlineCount(),
    maps: getMapInstanceCount(),
    uptime: process.uptime(),
  }))
  .use(gameWs)
  .listen(PORT);

console.log(`[Server] Dofus game server running on ws://localhost:${PORT}/game`);
console.log(`[Server] Health check at http://localhost:${PORT}/health`);
