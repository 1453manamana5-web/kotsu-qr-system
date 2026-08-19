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
  印刷サポート側は、iPad用印刷画面が表示された瞬間を
  MutationObserverで監視しています。

  以前は、ツールバーの文言を書き換える処理自身を
  MutationObserverが再検知し続けてしまい、
  「選択した範囲を印刷」を押した直後に画面が固まる
  ことがありました。

  印刷ツールバーを最初に検出した1回だけ処理して
  監視を終了するObserverに差し替えてから初期化します。
*/
function installManualPrintSupportSafely() {
  const NativeMutationObserver =
    window.MutationObserver;

  class OneShotManualPrintObserver {
    private readonly observer:
      MutationObserver;

    constructor(
      callback: MutationCallback
    ) {
      this.observer =
        new NativeMutationObserver(
          (
            records,
            observer
          ) => {
            const toolbar =
              document.querySelector(
                ".ticket-manual-print-toolbar"
              );

            if (
              toolbar === null
            ) {
              return;
            }

            observer.disconnect();

            callback(
              records,
              observer
            );
          }
        );
    }

    observe(
      target: Node,
      options?: MutationObserverInit
    ) {
      this.observer.observe(
        target,
        options
      );
    }

    disconnect() {
      this.observer.disconnect();
    }

    takeRecords() {
      return this.observer.takeRecords();
    }
  }

  window.MutationObserver =
    OneShotManualPrintObserver as unknown as
      typeof MutationObserver;

  try {
    installManualPrintSupport();
  } finally {
    window.MutationObserver =
      NativeMutationObserver;
  }
}

installManualPrintSupportSafely();

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
