import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function findOverviewButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".sidebar nav button"))
    .find((button) => (button.textContent ?? "").includes("ライブ運行")) ?? null;
}

const MANAGEMENT_GUIDES = [
  {
    number: "1",
    title: "現在の状況",
    description: "イベント・チケット・部員を確認",
    selector: ".admin-ops-heading",
  },
  {
    number: "2",
    title: "チケット照会",
    description: "番号から状態確認・修正",
    selector: ".ticket-control-panel",
  },
  {
    number: "3",
    title: "部員照会",
    description: "名前から入退室状態を確認",
    selector: ".member-control-panel",
  },
  {
    number: "4",
    title: "チケット予測",
    description: "残数と今後の消費を確認",
    selector: ".ticket-forecast-panel",
  },
] as const;

function scrollToManagementSection(selector: string) {
  const target = document.querySelector(selector);
  if (!(target instanceof HTMLElement)) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.classList.remove("management-section-highlight");
  window.requestAnimationFrame(() => {
    target.classList.add("management-section-highlight");
    window.setTimeout(() => target.classList.remove("management-section-highlight"), 900);
  });
}

export default function OperationsManagementBridge() {
  const [navTarget, setNavTarget] = useState<Element | null>(null);
  const [mainTarget, setMainTarget] = useState<Element | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const updateTargets = () => {
      setNavTarget((current) => {
        const next = document.querySelector(".sidebar nav");
        return current === next ? current : next;
      });
      setMainTarget((current) => {
        const next = document.querySelector(".control-shell main");
        return current === next ? current : next;
      });
    };

    const initial = window.setTimeout(updateTargets, 0);
    const observer = new MutationObserver(updateTargets);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(initial);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const shell = document.querySelector(".control-shell");
    if (!(shell instanceof HTMLElement)) return undefined;
    shell.classList.toggle("operations-management-view-open", open);
    return () => shell.classList.remove("operations-management-view-open");
  }, [open]);

  useEffect(() => {
    if (navTarget === null) return undefined;

    const closeWhenAnotherViewOpens = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (button === null || button.classList.contains("operations-management-nav-button")) return;
      setOpen(false);
    };

    navTarget.addEventListener("click", closeWhenAnotherViewOpens);
    return () => navTarget.removeEventListener("click", closeWhenAnotherViewOpens);
  }, [navTarget]);

  const openOperations = () => {
    const overviewButton = findOverviewButton();
    if (overviewButton !== null && !overviewButton.classList.contains("active")) {
      overviewButton.click();
      window.setTimeout(() => setOpen(true), 0);
      return;
    }
    setOpen(true);
  };

  if (navTarget === null || mainTarget === null) return null;

  return (
    <>
      {createPortal(
        <button
          type="button"
          className={`operations-management-nav-button${open ? " active" : ""}`}
          onClick={openOperations}
          aria-pressed={open}
        >
          <span aria-hidden="true">運</span>
          運用管理
        </button>,
        navTarget
      )}

      {open && createPortal(
        <section className="operations-management-page-heading" aria-labelledby="operations-management-title">
          <div className="operations-management-title-row">
            <div>
              <small>OPERATIONS MANAGEMENT</small>
              <h2 id="operations-management-title">運用管理</h2>
              <p>確認したい内容を選ぶと、その場所まですぐ移動できます。</p>
            </div>
            <span>運用・照会</span>
          </div>

          <nav className="operations-management-guide" aria-label="運用管理の内容">
            {MANAGEMENT_GUIDES.map((guide) => (
              <button
                key={guide.selector}
                type="button"
                onClick={() => scrollToManagementSection(guide.selector)}
              >
                <span aria-hidden="true">{guide.number}</span>
                <div>
                  <strong>{guide.title}</strong>
                  <small>{guide.description}</small>
                </div>
                <b aria-hidden="true">→</b>
              </button>
            ))}
          </nav>
        </section>,
        mainTarget
      )}
    </>
  );
}
