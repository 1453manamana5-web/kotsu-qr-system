import { useEffect } from "react";

function hideSimulationUi() {
  const page = document.querySelector(".lab-page");
  if (!(page instanceof HTMLElement)) return;

  const buttons = page.querySelectorAll<HTMLButtonElement>(".lab-hub-tabs button, .lab-category-grid > button");
  for (const button of buttons) {
    const label = button.textContent ?? "";
    if (label.includes("シミュレーション")) {
      button.hidden = true;
      button.style.setProperty("display", "none", "important");
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
    }
  }

  for (const row of page.querySelectorAll<HTMLElement>(".lab-research-score dl > div")) {
    const label = row.querySelector("dt")?.textContent ?? "";
    if (label.includes("仮想シナリオ") || label.includes("デジタルツイン")) {
      row.hidden = true;
      row.style.setProperty("display", "none", "important");
    }
  }

  const intro = page.querySelector<HTMLElement>(".lab-overview-intro p");
  if (intro !== null) {
    intro.textContent = "機能を3カテゴリに整理しました。必要な画面だけ開くため、他の試験情報は同時に表示しません。";
  }

  const note = page.querySelector<HTMLElement>(".lab-overview-note span");
  if (note !== null) {
    note.textContent = "「自動運転」だけが設定に応じて実端末へ操作します。端末研究と研究ログは表示・分析のみです。";
  }
}

export default function LabSimulationRemovalBridge() {
  useEffect(() => {
    const first = window.setTimeout(hideSimulationUi, 0);
    const observer = new MutationObserver(hideSimulationUi);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(first);
      observer.disconnect();
    };
  }, []);

  return null;
}
