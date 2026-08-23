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
          PDF生成は過去データ画面で操作したときだけ使います。
          受付に不要な大容量チャンクを初回のPWA保存から外し、
          必要になった時点で通常の通信から読み込みます。
        */
        globIgnores: [
          "**/html2canvas-*.js",
          "**/jspdf.es.min-*.js",
          "**/purify.es-*.js",
        ],

        cleanupOutdatedCaches:
          true,

        /*
          オフライン時にページを開いた場合、
          Reactアプリのindex.htmlを返します。
        */
        navigateFallback:
          "index.html",
      },
    }),
  ],
});
