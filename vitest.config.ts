import { defineConfig } from 'vitest/config';

// Tests cover the framework-free core and services, so a plain Node
// environment is enough. Keep React/Three out of these tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
