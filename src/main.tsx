import ReactDOM from "react-dom/client";

import AppRoot from "./AppRoot";
import {
  installIntentionalReceptionStopGuard,
} from "./receptionIntentionalStopGuard";

import "./index.css";


/*
  GitHub Pagesへ新しい版が公開されても、開いたままのPWAは
  以前のJavaScriptを表示し続けることがあります。
  新しいService Workerへ切り替わった瞬間だけ再読み込みし、
  最新画面へ自動的に移行します。
*/
const installAutomaticAppUpdate = () => {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const hadController =
    navigator.serviceWorker.controller !== null;
  let reloading = false;

  navigator.serviceWorker.addEventListener(
    "controllerchange",
    () => {
      if (
        !hadController ||
        reloading
      ) {
        return;
      }

      reloading = true;
      window.location.reload();
    }
  );

  window.addEventListener(
    "load",
    () => {
      void navigator.serviceWorker.ready
        .then((registration) =>
          registration.update()
        )
        .catch((error) => {
          console.warn(
            "アプリの更新確認に失敗しました。",
            error
          );
        });
    },
    {
      once: true,
    }
  );
};

installAutomaticAppUpdate();
installIntentionalReceptionStopGuard();

/*
  iPad用印刷画面が表示されるたびに、
  ホーム画面アプリ向けのPDF印刷ボタンを追加します。

  初回表示を妨げないよう、ブラウザが空いた時点で
  印刷サポートだけを追加読み込みします。
*/
const installPrintSupport = () => {
  void import(
    "./manualPrintSupport"
  )
    .then(({
      installManualPrintSupport,
    }) => {
      installManualPrintSupport();
    })
    .catch((error) => {
      console.warn(
        "印刷サポートを読み込めませんでした。",
        error
      );
    });
};

window.setTimeout(
  installPrintSupport,
  1000
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
  <AppRoot />
);
