import { defineConfig } from 'vitest/config'

// No test lives here (see CONVENTIONS.md), schemas are covered by the backend
// tests: this config only keeps `npm test` uniform across workspaces
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
