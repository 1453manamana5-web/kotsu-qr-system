import {
  Suspense,
} from "react";

import ReactDOM from "react-dom/client";

import App from "./App";

import AppSplashScreen from "./AppSplashScreen";

import DeviceAuthGate from "./DeviceAuthGate";

import {
  installReceptionSoundUnlock,
} from "./receptionSound";

import "./index.css";

/*
  iPad・Safariでは、最初のユーザー操作があるまで
  音声再生が制限されます。

  アプリ内で最初に画面をタップしたとき、
  成功音を使える状態にします。
*/
installReceptionSoundUnlock();

const pageLoadingFallback = (
  <main
    className="app-route-loading"
    aria-live="polite"
  >
    <span
      className="app-route-loading-spinner"
      aria-hidden="true"
    />

    <strong>
      画面を読み込んでいます
    </strong>
  </main>
);

const rootElement =
  document.getElementById(
    "root"
  );

if (
  rootElement ===
  null
) {
  throw new Error(
    "Reactの表示領域が見つかりません。"
  );
}

ReactDOM.createRoot(
  rootElement
).render(
  <DeviceAuthGate>
    <AppSplashScreen>
      <Suspense
        fallback={
          pageLoadingFallback
        }
      >
        <App />
      </Suspense>
    </AppSplashScreen>
  </DeviceAuthGate>
);
