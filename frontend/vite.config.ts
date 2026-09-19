/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'

// .env files live at the monorepo root, not in frontend/ (Vite's default envDir)
const envDir = path.resolve(import.meta.dirname, '..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, 'VITE_')

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') }, // '@' always resolves to the src directory
    },
    envDir,
    server: {
      host: true,
      port: 5173,
      proxy: {
        // The backend router is mounted at /api
        '/api': {
          target: env.VITE_API_PROXY_TARGET,
          changeOrigin: true,
        },
      },
    },
    optimizeDeps: { exclude: ['@repo/shared'] },
    test: {
      environment: 'jsdom',
      globals: true,
      css: true,
    },
  }
})
