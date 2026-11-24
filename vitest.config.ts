import { defineConfig } from 'vitest/config';

// Tests cover the framework-free core and services, so a plain Node
// environment is enough. Keep React and WebGL out of these tests (Three.js
// math classes are fine, e.g. to check the globe's frame mapping).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
