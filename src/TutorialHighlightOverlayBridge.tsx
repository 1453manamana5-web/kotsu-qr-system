import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type HighlightTone = "blue" | "purple";

type ActiveHighlight = {
  element: HTMLElement;
  tone: HighlightTone;
};

const HIGHLIGHT_SELECTORS: ReadonlyArray<{
  selector: string;
  tone: HighlightTone;
}> = [
  {
    selector: ".reception-tutorial-highlight",
    tone: "blue",
  },
  {
    selector: ".admin-mode-tutorial-highlight",
    tone: "blue",
  },
  {
    selector: ".tutorial-v3-highlight",
    tone: "purple",
  },
  {
    selector: ".lab-tutorial-highlight",
    tone: "purple",
  },
];

function findActiveHighlight(): ActiveHighlight | null {
  for (const item of HIGHLIGHT_SELECTORS) {
    const element = document.querySelector<HTMLElement>(item.selector);

    if (element !== null) {
      return {
        element,
        tone: item.tone,
      };
    }
  }

  return null;
}

export default function TutorialHighlightOverlayBridge() {
  const [activeHighlight, setActiveHighlight] =
    useState<ActiveHighlight | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let frame = 0;

    const refresh = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = findActiveHighlight();

        setActiveHighlight((current) => {
          if (
            current?.element === next?.element &&
            current?.tone === next?.tone
          ) {
            return current;
          }

          return next;
        });
      });
    };

    refresh();

    const observer = new MutationObserver(refresh);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (activeHighlight === null) {
      return undefined;
    }

    let frame = 0;
    const target = activeHighlight.element;
    const margin = 8;
    const padding = 6;

    const update = () => {
      const overlay = overlayRef.current;

      if (overlay === null || !target.isConnected) {
        return;
      }

      const rect = target.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const left = Math.max(margin, rect.left - padding);
      const top = Math.max(margin, rect.top - padding);
      const right = Math.min(
        viewportWidth - margin,
        rect.right + padding
      );
      const bottom = Math.min(
        viewportHeight - margin,
        rect.bottom + padding
      );

      if (
        right <= left ||
        bottom <= top ||
        rect.bottom <= 0 ||
        rect.top >= viewportHeight ||
        rect.right <= 0 ||
        rect.left >= viewportWidth
      ) {
        overlay.style.opacity = "0";
      } else {
        overlay.style.opacity = "1";
        overlay.style.left = `${left}px`;
        overlay.style.top = `${top}px`;
        overlay.style.width = `${right - left}px`;
        overlay.style.height = `${bottom - top}px`;

        const radius = Number.parseFloat(
          window.getComputedStyle(target).borderRadius
        );
        overlay.style.borderRadius = `${Math.max(
          10,
          Number.isFinite(radius) ? radius + padding : 14
        )}px`;
      }

      frame = window.requestAnimationFrame(update);
    };

    frame = window.requestAnimationFrame(update);

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeHighlight]);

  return createPortal(
    <>
      <style>{`
        html body .reception-tutorial-highlight,
        html body .admin-mode-tutorial-highlight,
        html body .tutorial-v3-highlight,
        html body .lab-tutorial-highlight {
          outline: none !important;
          box-shadow: none !important;
          animation: none !important;
        }

        .tutorial-highlight-overlay-bridge {
          position: fixed;
          z-index: 2147483645;
          pointer-events: none;
          box-sizing: border-box;
          border: 4px solid #66a0ff;
          box-shadow:
            0 0 0 8px rgba(85, 145, 239, .14),
            0 0 34px rgba(70, 120, 205, .64);
          transition:
            left .12s ease,
            top .12s ease,
            width .12s ease,
            height .12s ease,
            opacity .12s ease;
          animation: tutorialHighlightOverlayBlue 1.05s ease-in-out infinite;
        }

        .tutorial-highlight-overlay-bridge[data-tone="purple"] {
          border-color: #9d80ff;
          box-shadow:
            0 0 0 8px rgba(145, 111, 239, .14),
            0 0 36px rgba(115, 82, 214, .68);
          animation-name: tutorialHighlightOverlayPurple;
        }

        @keyframes tutorialHighlightOverlayBlue {
          0%, 100% {
            box-shadow:
              0 0 0 7px rgba(85, 145, 239, .13),
              0 0 24px rgba(70, 120, 205, .42);
          }
          50% {
            box-shadow:
              0 0 0 11px rgba(85, 145, 239, .06),
              0 0 40px rgba(70, 120, 205, .7);
          }
        }

        @keyframes tutorialHighlightOverlayPurple {
          0%, 100% {
            box-shadow:
              0 0 0 7px rgba(145, 111, 239, .13),
              0 0 24px rgba(115, 82, 214, .44);
          }
          50% {
            box-shadow:
              0 0 0 11px rgba(145, 111, 239, .06),
              0 0 42px rgba(115, 82, 214, .74);
          }
        }
      `}</style>

      {activeHighlight !== null && (
        <div
          ref={overlayRef}
          className="tutorial-highlight-overlay-bridge"
          data-tone={activeHighlight.tone}
          aria-hidden="true"
        />
      )}
    </>,
    document.body
  );
}
