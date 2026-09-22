import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Update the worker without reloading the current page. This prevents an
      // outdated worker from serving stale install metadata to Android WebAPK.
      registerType: 'prompt',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/notification-badge.png'],
      // Selected before first paint, with the same identity for both themes.
      manifest: false,
      workbox: {
        importScripts: ['/planner-notifications-sw.js'],
        skipWaiting: true,
        clientsClaim: true,
        // The manifest must always come from the network so Chrome's WebAPK
        // updater receives current theme and background colors.
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
})
