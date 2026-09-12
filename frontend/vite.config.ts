/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') }, // '@' always resolves to the src directory
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // The backend router is mounted at /api
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET,
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
})
