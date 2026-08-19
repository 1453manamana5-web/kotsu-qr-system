type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

function isStandaloneApp() {
  const displayModeStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia(
      "(display-mode: standalone)"
    ).matches;

  const iosStandalone =
    (navigator as NavigatorWithStandalone)
      .standalone === true;

  return (
    displayModeStandalone ||
    iosStandalone
  );
}

function enhanceManualPrintToolbar() {
  const toolbar =
    document.querySelector<HTMLElement>(
      ".ticket-manual-print-toolbar"
    );

  if (toolbar === null) {
    return;
  }

  const instruction =
    toolbar.querySelector<HTMLParagraphElement>(
      "p"
    );

  if (instruction !== null) {
    instruction.textContent =
      isStandaloneApp()
        ? "ホーム画面アプリでは、右の「印刷する」を押してください。印刷画面が開かない場合はSafariでサイトを開き、共有ボタンから「プリント」を選択してください。"
        : "右の「印刷する」を押すか、Safariの共有ボタンから「プリント」を選択してください。";
  }

  const existingPrintButton =
    toolbar.querySelector<HTMLButtonElement>(
      ".ticket-manual-print-button"
    );

  if (existingPrintButton !== null) {
    return;
  }

  const printButton =
    document.createElement(
      "button"
    );

  printButton.type =
    "button";

  printButton.className =
    "ticket-manual-print-button";

  printButton.textContent =
    "🖨 印刷する";

  printButton.style.background =
    "#ccebd8";

  printButton.style.borderColor =
    "#9bc9ad";

  printButton.addEventListener(
    "click",
    () => {
      window.print();
    }
  );

  const backButton =
    toolbar.querySelector<HTMLButtonElement>(
      "button"
    );

  if (backButton === null) {
    toolbar.appendChild(
      printButton
    );

    return;
  }

  toolbar.insertBefore(
    printButton,
    backButton
  );
}

export function installManualPrintSupport() {
  enhanceManualPrintToolbar();

  const observer =
    new MutationObserver(
      () => {
        enhanceManualPrintToolbar();
      }
    );

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
    }
  );
}
