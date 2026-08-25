import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function findOverviewButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".sidebar nav button"))
    .find((button) => (button.textContent ?? "").includes("ライブ運行")) ?? null;
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
          <div>
            <small>OPERATIONS MANAGEMENT</small>
            <h2 id="operations-management-title">運用管理</h2>
            <p>イベント情報、チケット・部員の照会、チケット在庫予測をここにまとめています。</p>
          </div>
          <span>運用・照会</span>
        </section>,
        mainTarget
      )}
    </>
  );
}
