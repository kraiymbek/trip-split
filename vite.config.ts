import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Trip Split — общие расходы',
        short_name: 'Trip Split',
        description: 'Кто кому сколько должен в поездке',
        lang: 'ru',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#0d9488',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        importScripts: ['sw-notify.js'], // тап по уведомлению открывает приложение
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/@fawazahmed0\/currency-api/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'rates', expiration: { maxEntries: 50, maxAgeSeconds: 7 * 86400 } },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node' },
})
