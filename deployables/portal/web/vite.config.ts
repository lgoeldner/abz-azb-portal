import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig(({ mode }) => ({
  base: mode === 'preview' ? (process.env.VITE_BASE ?? './') : '/',
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: [
      '@milkdown/crepe/builder',
      '@milkdown/crepe/feature/*',
      '@milkdown/kit/plugin/upload',
      '@milkdown/kit/utils',
      '@milkdown/kit/preset/commonmark',
      '@milkdown/kit/preset/gfm',
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    allowedHosts: [process.env.PUBLIC_HOST ?? 'localhost'],
    proxy: { '/api': 'http://localhost:8080', '/auth': 'http://localhost:8080' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
}));
