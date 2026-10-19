import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig(({ command }) => {
  /*
   * `__LOCAL__` ne dépend d'aucun fichier .env : il suit la commande.
   *   `vite`        (npm run dev)   → command === 'serve'  → true
   *   `vite build`  (npm run build) → command === 'build'  → false
   *
   * Un build de production a donc TOUJOURS `__LOCAL__ = false`, et le bloc de
   * démonstration — bouton et mot de passe de test compris — est retiré du
   * bundle par le tree-shaking, quoi que contienne un fichier .env local.
   */
  const estLocal = command === 'serve'

  return {
  define: {
    __LOCAL__: JSON.stringify(estLocal),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'ISTC SmartPresence',
        short_name: 'SmartPresence',
        description:
          'Chaque présence compte. Présences des enseignants et des étudiants, heures effectuées et absences, avec ou sans connexion.',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#0B4FC4',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    host: true,
    port: 5173,
    /*
     * Développement contre le VRAI backend PHP (XAMPP).
     *
     * Le navigateur ne parle qu'à Vite (http://localhost:5173) : tout appel
     * `/api/...` est relayé vers Apache (http://localhost/api/...), qui sert le
     * dossier `api/` du projet via une jonction dans `htdocs`. Même origine côté
     * navigateur → le cookie de session passe et aucun en-tête CORS n'est requis.
     *
     * N'affecte QUE `npm run dev` ; `vite build` ignore ce bloc.
     */
    proxy: {
      '/api': { target: 'http://localhost', changeOrigin: true },
    },
  },
  }
})
