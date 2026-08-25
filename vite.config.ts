import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

import { getRuntimeCommitSha } from "./lib/platform/runtime-metadata.server";
import { STATIC_IMAGE_CACHE_CONTROL, STATIC_ROOT_IMAGE_PATHS } from "./lib/shared/media-cache";

const buildId = getRuntimeCommitSha() ?? `local-${new Date().toISOString()}`;

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  plugins: [
    tanstackStart(),
    nitro({
      serverDir: "server",
      serverAssets: [
        { baseName: "event-scoring", dir: "./assets/event-scoring" },
        { baseName: "hot-and-cold", dir: "./assets/hot-and-cold" },
        { baseName: "party-audio", dir: "./assets/party-spelling-audio" },
      ],
      features: {
        websocket: true,
      },
      routeRules: {
        "/sw.js": {
          headers: {
            "Cache-Control": "no-cache, max-age=0, must-revalidate",
            "Service-Worker-Allowed": "/",
            "X-Content-Type-Options": "nosniff",
          },
        },
        "/fonts/**": {
          headers: {
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "same-site",
            "X-Content-Type-Options": "nosniff",
          },
        },
        "/audio/**": {
          headers: {
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "same-site",
            "X-Content-Type-Options": "nosniff",
          },
        },
        "/og/**": {
          headers: {
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "same-site",
            "X-Content-Type-Options": "nosniff",
          },
        },
        "/excalidraw/fonts/**": {
          headers: {
            "Cache-Control": "public, max-age=31536000, immutable",
            "Cross-Origin-Resource-Policy": "same-site",
            "X-Content-Type-Options": "nosniff",
          },
        },
        ...Object.fromEntries(
          STATIC_ROOT_IMAGE_PATHS.map((path) => [
            path,
            { headers: { "Cache-Control": STATIC_IMAGE_CACHE_CONTROL } },
          ]),
        ),
        "/manifest.json": {
          headers: {
            "Cache-Control": "public, max-age=3600, must-revalidate",
            "X-Content-Type-Options": "nosniff",
          },
        },
        "/manifest-forehead.webmanifest": {
          headers: {
            "Cache-Control": "public, max-age=3600, must-revalidate",
            "X-Content-Type-Options": "nosniff",
          },
        },
      },
    }),
    viteReact(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      outDir: ".output/public",
      filename: "sw.ts",
      injectRegister: null,
      manifest: false,
      injectManifest: {
        injectionPoint: undefined,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
