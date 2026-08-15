import ReactDOM from "react-dom/client";

import App from "./App";

import {
  installReceptionSoundUnlock,
} from "./receptionSound";

import {
  startOfflineReceptionSync,
} from "./offlineReceptionSync";

import "./index.css";

/*
  iPad・Safariでは、最初のユーザー操作があるまで
  音声再生が制限されます。

  アプリ内で最初に画面をタップしたとき、
  成功音を使える状態にします。
*/
installReceptionSoundUnlock();
startOfflineReceptionSync();

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
  <App />
);
