import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/** `npm run dev:ui`: the renderer alone in a browser, with the fake engine from src/renderer/demo. */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  plugins: [
    react(),
    {
      // The harness shows the reader from a blob: URL. The real app only allows its own scriptorium-book: scheme.
      name: 'demo-csp',
      transformIndexHtml: (html) => html.replace('frame-src scriptorium-book:', 'frame-src scriptorium-book: blob:')
    }
  ],
  server: { port: 5199, strictPort: true }
})
