import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/** Dev-only. Reads and writes public/levels/1.json, 2.json, … */
function levelSavePlugin(): Plugin {
  const dir = path.resolve('public/levels');
  const fileOf = (index: number) => path.join(dir, `${index}.json`);
  const ids = (): number[] => {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .map((name) => /^(\d+)\.json$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);
  };
  const readBody = (req: import('node:http').IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  const emptyLevel = {
    cols: 5,
    rows: 5,
    dist: 1200,
    pieces: [{ id: '红', color: '#e06b66', cells: [] }],
  };
  return {
    name: 'level-save',
    configureServer(server) {
      server.middlewares.use('/__levels', (req, res, next) => {
        const url = req.url ?? '';
        const index = /^\/(\d+)\/?$/.exec(url);
        if (req.method === 'POST' && (url === '/' || url === '')) {
          const nextIndex = (ids().at(-1) ?? 0) + 1;
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fileOf(nextIndex), `${JSON.stringify(emptyLevel, null, 2)}\n`);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ index: nextIndex }));
          return;
        }
        if (!index) {
          next();
          return;
        }
        const n = Number(index[1]);
        if (req.method === 'PUT') {
          void readBody(req).then((text) => {
            JSON.parse(text);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fileOf(n), text.endsWith('\n') ? text : `${text}\n`);
            res.statusCode = 204;
            res.end();
          }).catch((error: unknown) => {
            res.statusCode = 400;
            res.end(error instanceof Error ? error.message : 'bad json');
          });
          return;
        }
        if (req.method === 'DELETE') {
          const have = ids();
          if (!have.includes(n) || have.length <= 1) {
            res.statusCode = 400;
            res.end('keep one level');
            return;
          }
          fs.unlinkSync(fileOf(n));
          for (const id of have) {
            if (id > n) fs.renameSync(fileOf(id), fileOf(id - 1));
          }
          res.statusCode = 204;
          res.end();
          return;
        }
        next();
      });
    },
  };
}

/**
 * base: './' is REQUIRED for Capacitor (capacitor:// / file:// asset loading).
 * Absolute /assets/... paths break inside the iOS WebView.
 * The editor page is served by `npm run dev` and is not part of the phone build.
 */
export default defineConfig({
  base: './',
  plugins: [levelSavePlugin()],
  server: {
    host: true,
    port: 5193,
    strictPort: true,
    // Saving a level from the distance slider must not reload the page.
    watch: {
      ignored: ['**/public/levels/**'],
    },
  },
  preview: {
    host: true,
    port: 5193,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  esbuild: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
});
