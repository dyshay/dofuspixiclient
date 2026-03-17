import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const PROJECT_SRC = resolve(__dirname, '../../apps/electrobun/src/lib');

/** Serves project source files at /api/source?file=hud/stats/stats-panel.ts */
function sourceServerPlugin(): Plugin {
  return {
    name: 'source-server',
    configureServer(server) {
      server.middlewares.use('/api/source', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const file = url.searchParams.get('file');
        if (!file) {
          res.statusCode = 400;
          res.end('Missing ?file= parameter');
          return;
        }
        // Security: only allow files under PROJECT_SRC
        const full = resolve(PROJECT_SRC, file);
        if (!full.startsWith(PROJECT_SRC)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }
        try {
          const content = await readFile(full, 'utf-8');
          res.setHeader('Content-Type', 'text/plain');
          res.end(content);
        } catch {
          res.statusCode = 404;
          res.end(`File not found: ${file}`);
        }
      });
    },
  };
}

export default defineConfig({
  root: '.',
  server: { port: 4200 },
  build: { outDir: 'dist' },
  plugins: [sourceServerPlugin()],
});
