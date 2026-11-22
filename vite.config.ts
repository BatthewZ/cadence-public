import { readFileSync } from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

const DAY = 24 * 60 * 60;

const { version } = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as {
  version: string;
};

export default defineConfig({
  root: "src/web",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "generateSW",
      registerType: "prompt",
      // src/web/lib/pwa registers /sw.js itself with workbox-window.
      injectRegister: null,
      // The glob below already precaches public/ icons; listing them again duplicates entries.
      includeManifestIcons: false,
      manifest: {
        name: "Cadence",
        short_name: "Cadence",
        description:
          "Fast, beautiful project management that gets out of your way. Own your data, pick your theme, focus on the work.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        // Default theme: --C-PRIMARY and --C-CANVAS (src/web/style/tokens/colors.css).
        theme_color: "#1e293b",
        background_color: "#ffffff",
        icons: [
          // From scripts/gen-icons.ts. Chrome needs a 192 and a 512 PNG to offer install.
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Take control on the first visit, so offline works from the second load. With
        // clientsClaim, "Reload" must handle a page another tab already updated (lib/pwa/sw.ts).
        clientsClaim: true,
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,ico,webp,woff2}"],
        // The app never loads these: image.png is the master for scripts/gen-icons.ts, and the
        // install icons are fetched by the browser or OS while online, at install time.
        globIgnores: ["image.png", "pwa-*.png", "maskable-*.png", "apple-touch-icon-*.png"],
        // A lazy route chunk left out of the precache fails offline navigation.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        // No /api route (network only): the offline data layer owns API data.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === "https://images.unsplash.com",
            handler: "CacheFirst",
            options: {
              cacheName: "unsplash-images",
              // <img> fetches are no-cors, so most entries are opaque (status 0).
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 200, maxAgeSeconds: 30 * DAY, purgeOnQuotaError: true },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
