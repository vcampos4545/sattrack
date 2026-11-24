import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    // satellite.js re-exports an optional WASM/pthreads build whose worker uses
    // top-level await, which only ES-module workers support. Also the right
    // format for our own future propagation worker.
    format: 'es',
  },
});
