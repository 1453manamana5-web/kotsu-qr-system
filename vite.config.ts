import {
  defineConfig,
  type Plugin,
  type ViteDevServer,
} from "vite";

import react from "@vitejs/plugin-react";

import {
  VitePWA,
} from "vite-plugin-pwa";

const APP_BASE =
  "/qr-system/";

const SPEED_TEST_ASSET_BYTES =
  256 * 1024;

function createSpeedTestAsset() {
  const bytes =
    new Uint8Array(
      SPEED_TEST_ASSET_BYTES
    );

  let state =
    0x6d2b79f5;

  for (
    let index = 0;
    index < bytes.length;
    index += 1
  ) {
    state ^=
      state << 13;
    state ^=
      state >>> 17;
    state ^=
      state << 5;

    bytes[index] =
      state >>> 24;
  }

  return bytes;
}

function speedTestAssetPlugin(): Plugin {
  const bytes =
    createSpeedTestAsset();

  const serveSpeedTestAsset = (
    server: ViteDevServer
  ) => {
    server.middlewares.use(
      (request, response, next) => {
        const pathname =
          (request.url ?? "").split("?")[0];

        if (
          pathname !==
          `${APP_BASE}speed-test.bin`
        ) {
          next();
          return;
        }

        response.statusCode =
          200;
        response.setHeader(
          "Content-Type",
          "application/octet-stream"
        );
        response.setHeader(
          "Cache-Control",
          "no-store"
        );
        response.end(
          bytes
        );
      }
    );
  };

  return {
    name:
      "qr-speed-test-asset",

    configureServer:
      serveSpeedTestAsset,

    generateBundle() {

      this.emitFile({
        type:
          "asset",
        fileName:
          "speed-test.bin",
        source:
          bytes,
      });
    },
  };
}

export default defineConfig({
  base:
    APP_BASE,

  resolve: {
    /*
      管制画面はcontrol-app側のソースも再利用します。
      Reactが2組バンドルされるとHooksが別インスタンスを
      参照して白画面になるため、受付本体のReactへ統一します。
    */
    dedupe: [
      "react",
      "react-dom",
      "firebase",
    ],
  },

  build: {
    rolldownOptions: {
      output: {
        /*
          大きな共通ライブラリを用途別に分離し、iPadが初回表示時に
          1つの巨大JavaScriptを解析する負荷を抑えます。
          機能や読み込み順は変えず、ブラウザキャッシュも効きやすくします。
        */
        codeSplitting: {
          groups: [
            {
              name:
                "firebase-webchannel",

              test:
                /node_modules[\\/]@firebase[\\/]webchannel-wrapper/,

              priority:
                40,
            },
            {
              name:
                "firebase-firestore",

              test:
                /node_modules[\\/]@firebase[\\/]firestore/,

              priority:
                30,
            },
            {
              name:
                "firebase-auth",

              test:
                /node_modules[\\/]@firebase[\\/]auth/,

              priority:
                30,
            },
            {
              name:
                "firebase-core",

              test:
                /node_modules[\\/](@firebase|firebase)[\\/]/,

              priority:
                20,
            },
            {
              name:
                "react",

              test:
                /node_modules[\\/](react|react-dom|scheduler)[\\/]/,

              priority:
                10,
            },
          ],
        },
      },
    },
  },

  plugins: [
    react(),

    speedTestAssetPlugin(),

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
          受付本番で最初に使わない管理・分析・印刷系は
          初回PWA保存から外します。必要な画面を開いた時だけ
          通常のブラウザキャッシュへ入り、受付・QR読取の起動を優先します。

          カメラ、React、Firebase、入口・出口など
          受付に必要なチャンクは引き続き事前保存します。
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
          "**/AnalysisPage-*.{js,css}",
          "**/PastDataPage-*.{js,css}",
          "**/SettingsPage-*.{js,css}",
          "**/AdminPage-*.{js,css}",
          "**/AdminAuthPage-*.{js,css}",
          "**/DeviceManagementPage-*.{js,css}",
          "**/CreateEventPage-*.{js,css}",
          "**/EventManagementPage-*.{js,css}",
          "**/MembersPage-*.{js,css}",
          "**/TicketsPage-*.{js,css}",
          "**/ControlPage-*.{js,css}",
          "**/FirebaseTestPage-*.js",
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
