import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * Rapier's compat build carries its 2 MB WebAssembly as a base64 string inside the JS: 1029 KB gzipped on the wire,
 * where the same bytes as a .wasm file are 743 KB (GitHub Pages gzips application/wasm). In a build, the string is
 * written out as `assets/rapier-<hash>.wasm` and the init fetches that instead (wasm-bindgen's init takes a Response
 * as readily as bytes). 2026-10-17, 「启动减重」. The dev server and the tests keep the inline one.
 */
function rapierWasmFile(): Plugin {
  return {
    name: 'rapier-wasm-file',
    apply: 'build',
    enforce: 'post',
    transform(code, id) {
      if (!/@dimforge[\\/]rapier3d-compat[\\/]dist[\\/]rapier\.mjs$/.test(id)) return null;
      const m = code.match(/(\w+)\.toByteArray\("([A-Za-z0-9+/=]{100000,})"\)\.buffer/);
      if (!m) { this.warn('rapier: inline wasm not found, left as it is'); return null; }
      const bytes = Buffer.from(m[2], 'base64');
      const name = `rapier-${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}.wasm`;
      this.emitFile({ type: 'asset', fileName: `assets/${name}`, source: bytes });
      // a variable, not a literal: Vite's new URL(…, import.meta.url) handling must not try to resolve it
      return { code: code.replace(m[0], `fetch(new URL(${JSON.stringify(name)}.toString(), import.meta.url))`), map: null };
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [rapierWasmFile()],
  // FROZEN=1 (a second server for long probes, port 5198): no hot reload and no file watching, so
  // editing src/ does not reload a page in the middle of a measurement.
  server: process.env.FROZEN ? { port: 5198, open: false, host: '127.0.0.1', hmr: false, watch: null } : { port: 5195, open: false, host: '127.0.0.1' },
  preview: { port: 5196, host: '127.0.0.1' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/ }],
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 60000 },
});
