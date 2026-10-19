import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'ui',
  server: {
    port: 3000,
  },
  build: {
    outDir: '../dist/ui',
    emptyOutDir: true,
  }
});
