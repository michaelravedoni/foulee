import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';

/** Sous-chemin GitHub Pages : https://michaelravedoni.github.io/foulee/ */
const BASE = process.env.FOULEE_BASE ?? '/foulee/';

function commit(): string {
  try {
    return process.env.GITHUB_SHA?.slice(0, 7) ?? execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: BASE,
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __COMMIT__: JSON.stringify(commit()),
  },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: BASE,
        name: 'Foulée – analyse vidéo',
        short_name: 'Foulée',
        description: 'Analyse vidéo pour l’athlétisme : image par image, dessin, comparaison, replay différé.',
        lang: 'fr',
        dir: 'ltr',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'any',
        background_color: '#0f1720',
        theme_color: '#0f1720',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // Moteur de pose : gros fichiers WebAssembly, gardés après le premier usage.
          { urlPattern: ({ url }: { url: URL }) => url.pathname.includes('/mediapipe/'), handler: 'CacheFirst' as const, options: { cacheName: 'foulee-mediapipe', expiration: { maxEntries: 12 } } },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
});
