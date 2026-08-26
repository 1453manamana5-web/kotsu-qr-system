import { useEffect } from "react";

const OVERVIEW_COPY = "機能を3カテゴリに整理しました。必要な画面だけ開くため、他の試験情報は同時に表示しません。";
const IMPACT_COPY = "「自動運転」だけが設定に応じて実端末へ操作します。端末研究と研究ログは表示・分析のみです。";

function hideSimulationUi() {
  const page = document.querySelector(".lab-page");
  if (!(page instanceof HTMLElement)) return;

  const buttons = page.querySelectorAll<HTMLButtonElement>(".lab-hub-tabs button, .lab-category-grid > button");
  for (const button of buttons) {
    const label = button.textContent ?? "";
    if (!label.includes("シミュレーション")) continue;

    if (!button.hidden) button.hidden = true;
    if (button.style.getPropertyValue("display") !== "none") {
      button.style.setProperty("display", "none", "important");
    }
    if (button.getAttribute("aria-hidden") !== "true") {
      button.setAttribute("aria-hidden", "true");
    }
    if (button.tabIndex !== -1) button.tabIndex = -1;
  }

  for (const row of page.querySelectorAll<HTMLElement>(".lab-research-score dl > div")) {
    const label = row.querySelector("dt")?.textContent ?? "";
    if (!label.includes("仮想シナリオ") && !label.includes("デジタルツイン")) continue;

    if (!row.hidden) row.hidden = true;
    if (row.style.getPropertyValue("display") !== "none") {
      row.style.setProperty("display", "none", "important");
    }
  }

  // Only rewrite when the text is actually different. Rewriting textContent on
  // every MutationObserver pass creates another childList mutation and can trap
  // the lab page in a self-triggering render loop.
  const intro = page.querySelector<HTMLElement>(".lab-overview-intro p");
  if (intro !== null && intro.textContent !== OVERVIEW_COPY) {
    intro.textContent = OVERVIEW_COPY;
  }

  const note = page.querySelector<HTMLElement>(".lab-overview-note span");
  if (note !== null && note.textContent !== IMPACT_COPY) {
    note.textContent = IMPACT_COPY;
  }
}

export default function LabSimulationRemovalBridge() {
  useEffect(() => {
    let scheduled = false;

    const scheduleSync = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        hideSimulationUi();
      });
    };

    scheduleSync();
    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
