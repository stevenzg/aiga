import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(__dirname),
  resolve: {
    alias: {
      '@': resolve(__dirname, '../../src'),
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
