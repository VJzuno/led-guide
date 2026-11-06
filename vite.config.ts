import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 하위 경로: BASE_PATH=/repo-name/ 로 빌드 (Actions에서 자동 설정)
const base = process.env.BASE_PATH || '/';

import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png'],
      manifest: {
        name: "ZUNO'S LED GUIDE MAKER",
        short_name: 'LED GUIDE',
        description: 'VJ LED input/output guide maker',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192-v2.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512-v2.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512-v2.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 앱 셸 + 폰트(woff2) 전부 프리캐시 → 완전 오프라인
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        // 도구 페이지(public/tools/*.html)는 각자 HTML로 열려야 함 → 앱 셸로 대체하지 않음
        navigateFallbackDenylist: [/\/tools\//],
        cleanupOutdatedCaches: true,
        // 도구가 쓰는 Google Fonts: 한 번 온라인으로 열면 오프라인에서도 같은 글꼴
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-files', expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  build: { target: 'es2020', assetsInlineLimit: 0 },
});
