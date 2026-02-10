import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/sw/worker.ts'),
      name: 'AigaSW',
      fileName: 'sw',
      formats: ['es'],
    },
    outDir: 'dist',
    emptyDir: false,
    sourcemap: true,
  },
});
