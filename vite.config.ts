import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so one build works at "/", under "/primal/" on GitHub Pages,
  // and from a file server. Absolute asset URLs are the single most common way
  // a Pages deploy of a working local build comes out broken.
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    // getUserMedia needs a secure context. localhost counts as one, so plain
    // http is fine here; only reaching the console from another device needs
    // https (see docs/running-on-a-phone.md when that lands).
    host: true,
  },
  build: {
    target: 'es2022',
  },
  // The .task model and wasm blobs are large and must not be inlined.
  assetsInclude: ['**/*.task'],
});
