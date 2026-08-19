import ReactDOM from "react-dom/client";

import AppRoot from "./AppRoot";

import {
  installReceptionSoundUnlock,
} from "./receptionSound";

import {
  installManualPrintSupport,
} from "./manualPrintSupport";

import "./index.css";

/*
  iPad・Safariでは、最初のユーザー操作があるまで
  音声再生が制限されます。

  アプリ内で最初に画面をタップしたとき、
  成功音を使える状態にします。
*/
installReceptionSoundUnlock();

/*
  iPad用印刷画面が表示されるたびに、
  ホーム画面アプリ向けのPDF印刷ボタンを追加します。

  印刷サポート側で同じツールバーを二重処理しないため、
  MutationObserverは継続して監視してもループしません。
*/
installManualPrintSupport();

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
  <AppRoot />
);
