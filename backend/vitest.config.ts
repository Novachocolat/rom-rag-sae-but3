import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      PORT: '3000',
      CORS_ORIGIN: 'http://localhost:5173',
      DATABASE_URL:
        'postgresql://postgres:postgres@localhost:5432/app?schema=public',
      REDIS_URL: 'redis://localhost:6379',
    },
  },
})
