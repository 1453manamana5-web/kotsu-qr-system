import {
  defineConfig,
} from "vite";

import react from "@vitejs/plugin-react";

import {
  VitePWA,
} from "vite-plugin-pwa";

const APP_BASE =
  "/qr-system/";

export default defineConfig({
  base:
    APP_BASE,

  build: {
    rolldownOptions: {
      output: {
        /*
          Firestoreの通信層を独立させ、iPadで一度に
          解析するJavaScriptを抑えます。
        */
        codeSplitting: {
          groups: [
            {
              name:
                "firebase-webchannel",

              test:
                /node_modules[\\/]@firebase[\\/]webchannel-wrapper/,

              priority:
                20,
            },
          ],
        },
      },
    },
  },

  plugins: [
    react(),

    VitePWA({
      /*
        新しいバージョンが公開されたとき、
        キャッシュを自動更新します。

        開いている受付画面を強制的に
        再読み込みするコードは入れていません。
      */
      registerType:
        "autoUpdate",

      injectRegister:
        "auto",

      /*
        publicフォルダから
        オフライン保存するファイル
      */
      includeAssets: [
        "favicon.svg",
        "favicon.ico",
        "apple-touch-icon-180x180.png",
        "sounds/**/*.{wav,mp3,ogg}",
      ],

      manifest: {
        id:
          APP_BASE,

        name:
          "交通研究部QRコード管理システム",

        short_name:
          "QR受付",

        description:
          "交通研究部のイベント受付・入退場・部員・チケットを管理するシステム",

        lang:
          "ja",

        start_url:
          APP_BASE,

        scope:
          APP_BASE,

        display:
          "standalone",

        orientation:
          "landscape",

        background_color:
          "#f4f1fa",

        theme_color:
          "#7c4dff",

        icons: [
          {
            src:
              "pwa-192x192.png",

            sizes:
              "192x192",

            type:
              "image/png",

            purpose:
              "any",
          },

          {
            src:
              "pwa-512x512.png",

            sizes:
              "512x512",

            type:
              "image/png",

            purpose:
              "any",
          },

          {
            src:
              "maskable-icon-512x512.png",

            sizes:
              "512x512",

            type:
              "image/png",

            purpose:
              "maskable",
          },
        ],
      },

      workbox: {
        /*
          アプリ本体・画像・音声を
          オフライン用に保存します。
        */
        globPatterns: [
          "**/*.{js,css,html,ico,png,svg,webp,jpg,jpeg,wav,mp3,ogg}",
        ],

        /*
          PDF生成・QRデザイン・バックアップは管理画面で
          操作したときだけ使います。受付に不要なチャンクを
          初回のPWA保存から外し、必要時に読み込みます。

          受付に必要なカメラとFirestoreは引き続き保存します。
        */
        globIgnores: [
          "**/html2canvas-*.js",
          "**/jspdf.es.min-*.js",
          "**/purify.es-*.js",
          "**/index.es-*.js",
          "**/TicketDesigner-*.{js,css}",
          "**/MemberCardDesigner-*.js",
          "**/backupRestore-*.js",
          "**/manualPrintSupport-*.js",
        ],

        cleanupOutdatedCaches:
          true,

        /*
          オフライン時にページを開いた場合、
          Reactアプリのindex.htmlを返します。
        */
        navigateFallback:
          "index.html",

        /*
          管制PWAは /control/ 配下に独自のService Workerを持ちます。
          受付PWAが管制画面への移動を横取りしないよう除外します。
        */
        navigateFallbackDenylist: [
          /^\/qr-system\/control(?:\/|$)/,
        ],
      },
    }),
  ],
});
