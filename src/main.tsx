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
  iPadのホーム画面アプリではSafariの共有ボタンが
  表示されないため、印刷専用画面に直接印刷できる
  ボタンを追加します。
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
