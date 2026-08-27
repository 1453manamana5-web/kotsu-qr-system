import { useEffect } from "react";

function setStrongCount(strong: HTMLElement, count: string) {
  const currentText = strong.textContent?.replace(/\s+/g, "").trim() ?? "";
  if (currentText === `${count}台`) return;

  strong.replaceChildren(document.createTextNode(count));
  const unit = document.createElement("span");
  unit.textContent = "台";
  strong.appendChild(unit);
}

function refreshUnifiedDeviceManagement() {
  const page = document.querySelector(".device-management-page");
  if (page === null) return;

  const summary = page.querySelector(".device-management-summary");
  const summaryCards = summary?.querySelectorAll<HTMLElement>(":scope > article");
  const registeredPanel = page.querySelector(".device-management-devices-panel");
  const registeredCount = registeredPanel?.querySelector<HTMLElement>(
    ".device-management-panel-heading > strong"
  )?.textContent?.trim() ?? "0";

  if (summaryCards !== undefined && summaryCards.length >= 4) {
    const registeredCard = summaryCards.item(1);
    const receptionSplitCard = summaryCards.item(2);

    const label = registeredCard.querySelector("small");
    const strong = registeredCard.querySelector<HTMLElement>("strong");

    if (label !== null) label.textContent = "登録済み端末";
    if (strong !== null) setStrongCount(strong, registeredCount);

    receptionSplitCard.classList.add("unified-device-summary-hidden");
    summary?.classList.add("unified-device-summary");
  }

  for (const badge of page.querySelectorAll<HTMLElement>(
    ".device-management-devices-panel .device-management-role"
  )) {
    if (
      badge.classList.contains("device-management-role-member") ||
      badge.classList.contains("device-management-role-control")
    ) {
      badge.textContent = "登録端末";
      badge.classList.remove("device-management-role-control");
      badge.classList.add("device-management-role-member");
    }
  }
}

export default function UnifiedDeviceManagementBridge() {
  useEffect(() => {
    let frame = 0;

    const scheduleRefresh = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        refreshUnifiedDeviceManagement();
      });
    };

    scheduleRefresh();
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <style>{`
      .device-management-summary.unified-device-summary {
        grid-template-columns:
          repeat(2, minmax(118px, .7fr))
          minmax(220px, 1.5fr) !important;
      }

      .device-management-summary > .unified-device-summary-hidden {
        display: none !important;
      }

      @media (max-width: 900px) {
        .device-management-summary.unified-device-summary {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }
      }
    `}</style>
  );
}
