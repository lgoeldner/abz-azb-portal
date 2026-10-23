import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwindcss()], server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': 'http://localhost:8080', '/auth': 'http://localhost:8080', '/dev': 'http://localhost:8080' } }, test: { environment: 'jsdom', setupFiles: './src/test-setup.ts', include: ['src/**/*.test.{ts,tsx}'], restoreMocks: true } });
