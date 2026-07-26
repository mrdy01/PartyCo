import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Renderer-only dev server — no Electron.
 *
 * Purpose: iterate on the UI and the design-system page in a plain browser, without waiting for the
 * Electron binary or the core daemon. `window.partyco` is absent here, and the app is written to
 * handle that (see App.tsx and CoreStatus.tsx) rather than hang on a blank window.
 *
 * This is a development convenience, NOT a shipping target: the real app runs under Electron with
 * the CSP and the preload bridge from electron.vite.config.ts.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src/renderer/src') },
  },
  css: {
    modules: { generateScopedName: '[local]_[hash:base64:5]' },
  },
  /*
   * 5273 by default so the port stays predictable, but `PORT` wins — two sessions previewing the
   * same tree at once would otherwise collide on a strict port and the second one would just die.
   */
  server: process.env.PORT
    ? { port: Number(process.env.PORT), strictPort: false }
    : { port: 5273, strictPort: true },
});
