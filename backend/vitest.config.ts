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
        'postgresql://postgres:postgres@localhost:5433/app?schema=public',
      REDIS_URL: 'redis://localhost:6379',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OLLAMA_LLM_MODEL: 'gemma4:26b',
      OLLAMA_EMBEDDING_MODEL: 'embeddinggemma',
      OLLAMA_EMBEDDING_DIM: '768',
      OLLAMA_TIMEOUT_MS: '120000',
      OLLAMA_NUM_CTX: '4096',
      OLLAMA_TEMPERATURE: '0.1',
      OLLAMA_MAX_RETRIES: '2',
      OLLAMA_THINKING: 'true',
      ROM_LIBRARY_ROOT: '/roms',
      ROM_EXTENSIONS: '.gb,.gbc,.gba,.nes,.sfc,.smc,.md,.bin,.gen',
      SCAN_CONCURRENCY: '4',
      SESSION_COOKIE_NAME: 'rr_session',
      SESSION_TTL_SECONDS: '604800',
      AI_CACHE_TTL_SECONDS: '86400',
      AI_CONFIDENCE_THRESHOLD: '0.75',
      POSTGRES_PORT: '5433',
      FRONTEND_PORT: '5173',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
      exclude: ['src/generated/**', '**/*.test.ts'],
    },
  },
})
