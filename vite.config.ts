import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          validation: ['ajv', 'yaml'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
  },
});
