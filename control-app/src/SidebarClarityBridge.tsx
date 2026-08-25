import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type NavKey =
  | "overview"
  | "operations"
  | "analysis"
  | "devices"
  | "incidents"
  | "diagnostics"
  | "settings"
  | "lab"
  | "copilot";

const NAV_ITEMS: ReadonlyArray<{
  key: NavKey;
  match: string;
  description: string;
}> = [
  { key: "overview", match: "ライブ運行", description: "会場のいまを確認" },
  { key: "operations", match: "運用管理", description: "照会・修正・チケット予測" },
  { key: "analysis", match: "分析", description: "来場者データを確認" },
  { key: "devices", match: "端末", description: "入口・出口端末を確認" },
  { key: "incidents", match: "障害履歴", description: "異常や注意項目を確認" },
  { key: "diagnostics", match: "通信診断", description: "ネットワーク状態を確認" },
  { key: "settings", match: "設定", description: "管制アシスト・データ管理" },
  { key: "lab", match: "管制ラボ", description: "試験中の高度な管制機能" },
  { key: "copilot", match: "AI管制", description: "試験中の管制アシスト" },
];

function decorateNavigation(nav: Element) {
  const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>(":scope > button"));

  for (const button of buttons) {
    const text = (button.textContent ?? "").replace(/\s+/g, "").trim();
    const item = NAV_ITEMS.find((candidate) => text.includes(candidate.match));
    if (item === undefined) continue;

    button.dataset.navKey = item.key;
    button.title = `${item.match} — ${item.description}`;
    button.setAttribute("aria-label", `${item.match}。${item.description}`);
  }
}

export default function SidebarClarityBridge() {
  const [navTarget, setNavTarget] = useState<Element | null>(null);

  useEffect(() => {
    const update = () => {
      const next = document.querySelector(".sidebar nav");
      setNavTarget((current) => current === next ? current : next);
      if (next !== null) decorateNavigation(next);
    };

    const initial = window.setTimeout(update, 0);
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(initial);
      observer.disconnect();
    };
  }, []);

  if (navTarget === null) return null;

  return createPortal(
    <>
      <span className="sidebar-section-label sidebar-section-label-daily">普段使う</span>
      <span className="sidebar-section-label sidebar-section-label-check">確認・調査</span>
      <span className="sidebar-section-label sidebar-section-label-settings">設定</span>
      <span className="sidebar-section-label sidebar-section-label-experimental">試験機能</span>
    </>,
    navTarget
  );
}
