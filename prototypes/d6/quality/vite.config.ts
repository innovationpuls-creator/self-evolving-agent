import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4187, strictPort: true, fs: { allow: ['../../..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
