import { useEffect } from "react";

type NavKey =
  | "home"
  | "overview"
  | "operations"
  | "analysis"
  | "devices"
  | "incidents"
  | "diagnostics"
  | "settings"
  | "lab"
  | "copilot";

type SectionKey =
  | "daily"
  | "check"
  | "settings"
  | "experimental";

const NAV_ITEMS: ReadonlyArray<{
  key: NavKey;
  match: string;
  description: string;
}> = [
  { key: "home", match: "ホーム", description: "まず確認する現在状況" },
  { key: "overview", match: "ライブ運行", description: "会場の流れを詳しく確認" },
  { key: "operations", match: "運用管理", description: "照会・修正・チケット予測" },
  { key: "analysis", match: "分析", description: "来場者データを確認" },
  { key: "devices", match: "端末", description: "入口・出口端末を確認" },
  { key: "incidents", match: "障害履歴", description: "異常や注意項目を確認" },
  { key: "diagnostics", match: "通信診断", description: "ネットワーク状態を確認" },
  { key: "settings", match: "設定", description: "バックアップ・データ管理" },
  { key: "lab", match: "管制ラボ", description: "試験中の高度な管制機能" },
  { key: "copilot", match: "AI管制", description: "試験中の管制アシスト" },
];

const NAV_SECTIONS: ReadonlyArray<{
  key: SectionKey;
  title: string;
  description: string;
  items: readonly NavKey[];
}> = [
  {
    key: "daily",
    title: "メイン",
    description: "日常の運用",
    items: ["home", "overview", "operations"],
  },
  {
    key: "check",
    title: "確認",
    description: "状況を調べる",
    items: ["analysis", "devices", "incidents", "diagnostics"],
  },
  {
    key: "settings",
    title: "システム",
    description: "設定・管理",
    items: ["settings"],
  },
  {
    key: "experimental",
    title: "試験機能",
    description: "高度な機能",
    items: ["lab", "copilot"],
  },
];

function decorateNavigation(nav: Element) {
  const buttons = Array.from(
    nav.querySelectorAll<HTMLButtonElement>(":scope > button")
  );

  for (const button of buttons) {
    const text = (button.textContent ?? "")
      .replace(/\s+/g, "")
      .trim();
    const item = NAV_ITEMS.find((candidate) =>
      text.includes(candidate.match)
    );

    if (item === undefined) continue;

    button.dataset.navKey = item.key;
    button.title = `${item.match} — ${item.description}`;
    button.setAttribute(
      "aria-label",
      `${item.match}。${item.description}`
    );
  }
}

function createSectionLabel(
  section: (typeof NAV_SECTIONS)[number]
) {
  const label = document.createElement("span");
  label.className =
    `sidebar-section-label sidebar-section-label-${section.key}`;
  label.dataset.sidebarSection = section.key;
  label.setAttribute("aria-hidden", "true");

  const title = document.createElement("strong");
  title.textContent = section.title;

  const description = document.createElement("small");
  description.textContent = section.description;

  label.append(title, description);
  return label;
}

function getSectionLabel(
  nav: Element,
  section: (typeof NAV_SECTIONS)[number]
) {
  const existing = nav.querySelector<HTMLElement>(
    `:scope > [data-sidebar-section="${section.key}"]`
  );

  if (existing !== null) return existing;

  return createSectionLabel(section);
}

function sameNodeOrder(
  first: readonly Element[],
  second: readonly Element[]
) {
  return (
    first.length === second.length &&
    first.every((node, index) => node === second[index])
  );
}

function arrangeNavigation(nav: Element) {
  decorateNavigation(nav);

  // 以前のPortal版見出しが残っていても二重表示しない。
  for (const oldLabel of nav.querySelectorAll<HTMLElement>(
    ":scope > .sidebar-section-label:not([data-sidebar-section])"
  )) {
    oldLabel.remove();
  }

  const buttons = new Map<NavKey, HTMLButtonElement>();
  for (const button of nav.querySelectorAll<HTMLButtonElement>(
    ":scope > button[data-nav-key]"
  )) {
    const key = button.dataset.navKey as NavKey | undefined;
    if (key !== undefined) buttons.set(key, button);
  }

  const desired: Element[] = [];

  for (const section of NAV_SECTIONS) {
    const sectionButtons = section.items
      .map((key) => buttons.get(key))
      .filter(
        (button): button is HTMLButtonElement =>
          button !== undefined
      );

    // 遅延読込前でまだボタンがない欄は、空見出しを出さない。
    if (sectionButtons.length === 0) continue;

    desired.push(
      getSectionLabel(nav, section),
      ...sectionButtons
    );
  }

  const knownNodes = Array.from(nav.children).filter((node) =>
    node instanceof HTMLElement &&
    (
      node.dataset.navKey !== undefined ||
      node.dataset.sidebarSection !== undefined
    )
  );

  if (sameNodeOrder(knownNodes, desired)) return;

  // CSSのorderだけに頼らず、DOM上でも
  // 「見出し → その欄のボタン」の順に固定する。
  for (const node of desired) {
    nav.append(node);
  }
}

export default function SidebarClarityBridge() {
  useEffect(() => {
    let frame = 0;

    const update = () => {
      if (frame !== 0) return;

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const nav = document.querySelector(".sidebar nav");
        if (nav !== null) arrangeNavigation(nav);
      });
    };

    update();

    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  return null;
}
