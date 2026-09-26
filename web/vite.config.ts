import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// One origin in normal use (PRD DL13): uvicorn on 127.0.0.1:8765 serves web/dist at `/`.
// The dev server (start.ps1 -Dev) proxies /api to it.
const API_ORIGIN = 'http://127.0.0.1:8765'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Never inline assets as data: URIs. The backend CSP falls back to default-src 'self' for fonts,
    // so an inlined woff2 would be blocked. Self-hosted files only.
    assetsInlineLimit: 0,
    // Stable vendor chunks, cached across releases of the app code. The Workspace (dockview) and each
    // built screen are lazy imports, so the frame and its safety labels paint before them. Phase 5
    // adds a 'charts' group (echarts, uplot, lightweight-charts) that only screens import.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /[\\/]node_modules[\\/](\.pnpm[\\/])?(react|react-dom|scheduler)[@\\/]/, priority: 20 },
            { name: 'dockview', test: /[\\/]node_modules[\\/](\.pnpm[\\/])?dockview(-core|-react)?[@\\/]/, priority: 20 },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': API_ORIGIN },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // Vitest stubs CSS imports to '' by default; the contrast test must read the real tokens file.
    css: { include: [/src[\\/]theme[\\/]tokens\.css/] },
    restoreMocks: true,
  },
})
