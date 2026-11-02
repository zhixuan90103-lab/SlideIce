import { defineConfig } from 'vite';

/**
 * base: './' is REQUIRED for Capacitor (capacitor:// / file:// asset loading).
 * Absolute /assets/... paths break inside the iOS WebView.
 */
export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5190,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5190,
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
