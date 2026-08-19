import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Dev: Vite serves the UI on :4001 and proxies API + unsubscribe to the Express
// server on :4000. Prod/Docker: Express serves the built bundle from dist/web.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // shadcn/mapcn components import via the "@/" alias (see components.json).
    alias: { '@': path.resolve(__dirname, 'web') },
  },
  server: {
    port: 4001,
    proxy: {
      '/api': 'http://localhost:4000',
      '/unsubscribe': 'http://localhost:4000',
    },
  },
  build: {
    outDir: 'dist/web',
  },
})
