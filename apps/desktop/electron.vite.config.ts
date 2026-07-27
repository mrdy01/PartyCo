import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * `@partyco/agents` ships TypeScript source (`exports: "./src/index.ts"`), like every other package
 * in this workspace, and is resolved through the npm-workspaces symlink in `node_modules/@partyco`.
 *
 * The alias below is belt to that braces. The provider layer is the one dependency of the main
 * process that must not silently fall back to something else: an unresolved import here would be a
 * build error, but a *stale* one — resolved to a published package of the same name, say — would be
 * a build that spawns somebody else's code with a member's API key in its environment. Pinning the
 * path makes the source of that module a fact of this repository rather than of `node_modules`.
 */
const agentsEntry = resolve(__dirname, '../../packages/agents/src/index.ts');

export default defineConfig({
  main: {
    resolve: {
      alias: { '@partyco/agents': agentsEntry },
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    resolve: {
      alias: { '@partyco/agents': agentsEntry },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        /*
         * **CommonJS, and not by preference.**
         *
         * `apps/desktop/package.json` says `"type": "module"`, so electron-vite emits every bundle as
         * ESM and renames the preload entry to `index.mjs`. The window is created with
         * `sandbox: true` (see `main/index.ts`), and a sandboxed preload is executed as plain
         * CommonJS — Electron never runs it through the ESM loader. The result is not a degraded
         * bridge but no bridge at all: the script dies on its first `import` with «Cannot use import
         * statement outside a module», `window.partyco` stays `undefined`, and every channel in
         * `main/agents.ts` is unreachable. Verified on Electron 43 with a throwaway app: `.mjs` +
         * `sandbox: true` → `typeof window.probe === 'undefined'`; the same script as CJS → `object`.
         *
         * The alternative fix — `sandbox: false` — buys ESM by giving the renderer's preload the
         * OS-level sandbox back, which is the opposite of what a window rendering repository text and
         * model output should do. So the format moves instead of the security posture. `.cjs` rather
         * than `.js` because `out/` inherits `"type": "module"` and the extension should not be the
         * thing anyone has to reason about.
         */
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
      },
    },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
    css: {
      modules: {
        // Readable class names in dev builds make the design-parity pass far easier to audit.
        generateScopedName: '[local]_[hash:base64:5]',
      },
    },
  },
});
