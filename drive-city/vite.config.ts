import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
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
