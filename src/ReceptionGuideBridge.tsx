import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import ReceptionGuidePage from "./pages/ReceptionGuidePage";

function GuideMenuIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M15 10H42C47 10 51 14 51 19V51H24C19 51 15 47 15 42V10Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M24 51C24 45 28 41 34 41H51" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M26 21H41M26 29H41" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 16H24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M18 9L25 16L18 23" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function readEventName() {
  const event = document.querySelector<HTMLElement>(".admin-event-pill strong");
  const text = event?.textContent?.trim() ?? "";
  return text === "イベントを設定してください" ? "" : text;
}

export default function ReceptionGuideBridge() {
  const [menuTarget, setMenuTarget] = useState<Element | null>(null);
  const [open, setOpen] = useState(false);
  const [eventName, setEventName] = useState("");

  useEffect(() => {
    let scheduled = false;

    const refresh = () => {
      if (scheduled) return;
      scheduled = true;

      window.requestAnimationFrame(() => {
        scheduled = false;
        const next = document.querySelector(".admin-menu-grid");
        setMenuTarget((current) => current === next ? current : next);
      });
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  const openGuide = () => {
    setEventName(readEventName());
    setOpen(true);
  };

  return (
    <>
      {menuTarget !== null && createPortal(
        <button
          type="button"
          className="admin-menu-card admin-guide-card"
          onClick={openGuide}
        >
          <span className="admin-menu-card-icon"><GuideMenuIcon /></span>
          <span className="admin-menu-card-copy">
            <strong>使い方ガイド</strong>
            <small>受付と管理モードの操作手順を確認</small>
          </span>
          <span className="admin-menu-card-arrow"><ArrowIcon /></span>
        </button>,
        menuTarget
      )}

      {open && createPortal(
        <ReceptionGuidePage
          eventName={eventName}
          setPage={(page) => {
            if (page === "admin") setOpen(false);
          }}
        />,
        document.body
      )}
    </>
  );
}
