import ReactDOM from "react-dom/client";

import AppRoot from "./AppRoot";

import "./index.css";

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
