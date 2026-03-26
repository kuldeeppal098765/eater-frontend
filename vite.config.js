/** Fresto — Vite + PWA (customer, partner, rider, admin). */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Use VITE_API_URL=/api in .env to route /api → backend during dev
      "/api": {
        target: "https://api.vyaharam.com",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "https://api.vyaharam.com",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'fresto-icon.svg', 'apple-touch-icon.png', 'mask-icon.svg'],
      /** Role-specific manifests live in `public/manifest-*.json`; switched at runtime via `PwaManifestRouteSync`. */
      manifest: false,
    })
  ]
})