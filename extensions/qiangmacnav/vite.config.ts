import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root, base: './', plugins: [react()],
  build: {
    outDir: 'dist', emptyOutDir: true,
    rollupOptions: {
      input: { index: `${root}index.html`, background: `${root}src/background.ts` },
      output: { entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js' },
    },
  },
});
