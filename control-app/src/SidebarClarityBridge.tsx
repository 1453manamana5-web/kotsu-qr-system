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

function syncActiveNavigation(nav: Element) {
  const shell = document.querySelector(".control-shell");
  if (!(shell instanceof HTMLElement)) return;
  const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>(":scope > button[data-nav-key]"));
  const forcedKey = shell.classList.contains("operations-management-view-open")
    ? "operations"
    : shell.classList.contains("maintenance-view-open")
      ? "settings"
      : null;

  if (forcedKey !== null) {
    for (const button of buttons) {
      button.classList.toggle("active", button.dataset.navKey === forcedKey);
    }
    return;
  }

  for (const button of buttons) {
    if (button.dataset.navKey === "operations" || button.dataset.navKey === "settings") {
      button.classList.remove("active");
    }
  }
}

export default function SidebarClarityBridge() {
  const [navTarget, setNavTarget] = useState<Element | null>(null);

  useEffect(() => {
    const update = () => {
      const next = document.querySelector(".sidebar nav");
      setNavTarget((current) => current === next ? current : next);
      if (next !== null) {
        decorateNavigation(next);
        syncActiveNavigation(next);
      }
    };

    const initial = window.setTimeout(update, 0);
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-pressed"],
    });

    return () => {
      window.clearTimeout(initial);
      observer.disconnect();
    };
  }, []);

  if (navTarget === null) return null;

  return createPortal(
    <>
      <span className="sidebar-section-label sidebar-section-label-daily"><strong>メイン</strong><small>日常の運用</small></span>
      <span className="sidebar-section-label sidebar-section-label-check"><strong>確認</strong><small>状況を調べる</small></span>
      <span className="sidebar-section-label sidebar-section-label-settings"><strong>システム</strong><small>設定・管理</small></span>
      <span className="sidebar-section-label sidebar-section-label-experimental"><strong>試験機能</strong><small>高度な機能</small></span>
    </>,
    navTarget
  );
}
