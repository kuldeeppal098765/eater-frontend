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
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:5000",
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
      manifest: {
        name: 'VYAHARAM',
        short_name: 'VYAHARAM',
        description: 'Your favorite food delivery app',
        theme_color: '#ea580c',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: 'https://cdn-icons-png.flaticon.com/512/1046/1046784.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'https://cdn-icons-png.flaticon.com/512/1046/1046784.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})