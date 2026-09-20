import { defineConfig } from 'vite'

export default defineConfig({
  server: { host: true, port: 5189 },
  preview: { host: true, port: 5189 },
  // Svět se staví přes top-level await, což je ES2022. Hra stejně potřebuje
  // WebGL2, takže starší prohlížeče nejsou cílová skupina.
  build: { target: 'es2022' },
})
