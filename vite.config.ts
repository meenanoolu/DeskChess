import { defineConfig } from 'vite';

export default defineConfig({
  base: '/DeskChess/',
  server: { host: '0.0.0.0', port: 8081 },
  build: { outDir: 'dist', target: 'esnext' },
});
