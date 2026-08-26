import { useEffect } from "react";

const PANEL_SELECTOR = ".predictive-radar-panel, .correlation-panel";

function syncAutopilotOnlyPanels() {
  const page = document.querySelector(".lab-page");
  if (!(page instanceof HTMLElement)) return;

  const visible = page.classList.contains("lab-focus-autopilot");
  for (const panel of page.querySelectorAll<HTMLElement>(PANEL_SELECTOR)) {
    panel.hidden = !visible;
    panel.setAttribute("aria-hidden", visible ? "false" : "true");

    if (visible) {
      panel.style.removeProperty("display");
    } else {
      panel.style.setProperty("display", "none", "important");
    }
  }
}

export default function LabAutopilotVisibilityBridge() {
  useEffect(() => {
    const first = window.setTimeout(syncAutopilotOnlyPanels, 0);
    const observer = new MutationObserver(syncAutopilotOnlyPanels);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      window.clearTimeout(first);
      observer.disconnect();
    };
  }, []);

  return null;
}
