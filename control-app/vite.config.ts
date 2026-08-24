import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/qr-system/control/",
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "firebase-webchannel",
              test: /node_modules[\\/]@firebase[\\/]webchannel-wrapper/,
              priority: 40,
            },
            {
              name: "firebase-firestore",
              test: /node_modules[\\/]@firebase[\\/]firestore/,
              priority: 30,
            },
            {
              name: "firebase-auth",
              test: /node_modules[\\/]@firebase[\\/]auth/,
              priority: 30,
            },
            {
              name: "firebase-core",
              test: /node_modules[\\/](@firebase|firebase)[\\/]/,
              priority: 20,
            },
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["control-icon.svg"],
      manifest: {
        name: "QR管理・管制システム",
        short_name: "QR管制",
        description: "QR受付端末の運用状況を監視する管制システム",
        theme_color: "#25325c",
        background_color: "#eef2f8",
        display: "standalone",
        start_url: "/qr-system/control/",
        scope: "/qr-system/control/",
        lang: "ja",
        icons: [
          {
            src: "control-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: "/qr-system/control/index.html",
      },
    }),
  ],
});
