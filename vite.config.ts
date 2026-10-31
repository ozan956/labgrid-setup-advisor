import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          if (id.includes('node_modules/ajv') || id.includes('node_modules/yaml') || id.includes('node_modules/fast-deep-equal') || id.includes('node_modules/json-schema-traverse') || id.includes('node_modules/fast-uri')) return 'validation';
          if (id.includes('/src/bench/') || id.includes('/src/data/hardware/') || id.includes('/schemas/hardware-') || id.includes('/schemas/bench-') || id.includes('/schemas/lab-')) return 'bench';
          if (id.includes('/src/data/') && id.includes('.yaml')) return 'definitions';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
  },
});
