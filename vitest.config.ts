import { defineConfig } from 'vitest/config';

// Tests for the pure, environment-agnostic pieces of the app: the
// preprocessing pipeline (src/pipeline/) and the frontend's pure date/range
// helpers (src/timeRange.ts). No DOM needed, so the default 'node'
// environment is enough; nothing here touches Timeline.json or public/data.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
