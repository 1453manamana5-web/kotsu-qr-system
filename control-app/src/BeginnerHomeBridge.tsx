import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import "./beginner-home.css";

type Severity = "normal" | "warning" | "critical";

type HomeSnapshot = {
  severity: Severity;
  statusLabel: string;
  occupancy: string;
  predicted: string;
  occupancyRate: string;
  terminals: string;
  issueCount: number;
  guidanceTitle: string;
  guidanceDetail: string;
};

const EMPTY_SNAPSHOT: HomeSnapshot = {
  severity: "normal",
  statusLabel: "確認中",
  occupancy: "—",
  predicted: "—",
  occupancyRate: "—",
  terminals: "—",
  issueCount: 0,
  guidanceTitle: "現在の運行状況を確認しています",
  guidanceDetail: "ライブデータが揃うと、ここに最初に見るべき内容を表示します。",
};

function textOf(element: Element | null) {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function findSidebarButton(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("aside.sidebar nav button"))
    .find((button) => textOf(button).includes(label)) ?? null;
}

function readSummaryValue(index: number) {
  const cards = document.querySelectorAll(".summary-grid article");
  const card = cards.item(index);
  if (!(card instanceof HTMLElement)) return "—";
  const strong = card.querySelector("strong");
  return textOf(strong) || "—";
}

function readSnapshot(): HomeSnapshot {
  const pill = document.querySelector(".operation-pill");
  const severity: Severity = pill?.classList.contains("critical")
    ? "critical"
    : pill?.classList.contains("warning")
      ? "warning"
      : "normal";

  const issueButton = findSidebarButton("障害履歴");
  const issueBadge = issueButton?.querySelector("b");
  const issueCount = Number.parseInt(textOf(issueBadge), 10);
  const safeIssueCount = Number.isFinite(issueCount) ? issueCount : 0;

  const guidanceTitle = severity === "critical"
    ? "対応が必要な異常があります"
    : severity === "warning"
      ? "確認した方がよい項目があります"
      : "現在は通常監視でOKです";

  const guidanceDetail = severity === "critical"
    ? "まず「異常・注意を見る」を開いて、最上段の項目から確認してください。"
    : severity === "warning"
      ? "受付は続けられますが、注意項目を確認しておくと安心です。"
      : "入口・出口端末と会場人数は正常範囲です。必要な時だけ詳しい画面を開いてください。";

  return {
    severity,
    statusLabel: textOf(pill) || (severity === "normal" ? "正常運用" : "要確認"),
    occupancy: readSummaryValue(0),
    predicted: readSummaryValue(1),
    occupancyRate: readSummaryValue(2),
    terminals: readSummaryValue(3),
    issueCount: safeIssueCount,
    guidanceTitle,
    guidanceDetail,
  };
}

function ensureHomeHost() {
  const summary = document.querySelector(".summary-grid");
  if (summary === null || summary.parentElement === null) return null;

  let host = document.getElementById("beginner-home-host");
  if (host === null) {
    host = document.createElement("div");
    host.id = "beginner-home-host";
  }

  const personalized = document.getElementById("personalized-control-host");
  const target = personalized?.parentElement === summary.parentElement ? personalized : summary;
  if (host.parentElement !== summary.parentElement || host.nextElementSibling !== target) {
    summary.parentElement.insertBefore(host, target);
  }

  return host;
}

function ensureDetailGuideHost() {
  const details = document.querySelector(".live-operations-grid");
  if (details === null || details.parentElement === null) return null;

  let host = document.getElementById("beginner-detail-guide-host");
  if (host === null) {
    host = document.createElement("div");
    host.id = "beginner-detail-guide-host";
  }

  if (host.parentElement !== details.parentElement || host.nextElementSibling !== details) {
    details.parentElement.insertBefore(host, details);
  }

  return host;
}

export default function BeginnerHomeBridge() {
  const [homeHost, setHomeHost] = useState<HTMLElement | null>(null);
  const [detailHost, setDetailHost] = useState<HTMLElement | null>(null);
  const [snapshot, setSnapshot] = useState<HomeSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    let refreshQueued = false;
    const refresh = () => {
      if (refreshQueued) return;
      refreshQueued = true;
      queueMicrotask(() => {
        refreshQueued = false;
        setHomeHost(ensureHomeHost());
        setDetailHost(ensureDetailGuideHost());
        if (document.querySelector(".summary-grid") !== null) {
          setSnapshot(readSnapshot());
        }
      });
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    const interval = window.setInterval(refresh, 10_000);

    return () => {
      observer.disconnect();
      window.clearInterval(interval);
    };
  }, []);

  const navigate = useCallback((label: string) => {
    findSidebarButton(label)?.click();
  }, []);

  const primaryAction = useMemo(() => {
    if (snapshot.severity === "critical" || snapshot.severity === "warning") {
      return { label: "異常・注意を見る", target: "障害履歴" };
    }
    return { label: "受付端末を確認", target: "端末" };
  }, [snapshot.severity]);

  return (
    <>
      {homeHost !== null && createPortal(
        <section className={`beginner-home-card ${snapshot.severity}`} aria-label="初めて使う人向けの現在状況">
          <div className="beginner-home-hero">
            <div className="beginner-home-copy">
              <small>FIRST LOOK · まずここを確認</small>
              <div className="beginner-home-title-row">
                <h2>{snapshot.guidanceTitle}</h2>
                <span className={`beginner-home-status ${snapshot.severity}`}>{snapshot.statusLabel}</span>
              </div>
              <p>{snapshot.guidanceDetail}</p>
            </div>
            <button type="button" className="beginner-home-primary" onClick={() => navigate(primaryAction.target)}>
              {primaryAction.label}<span aria-hidden="true">→</span>
            </button>
          </div>

          <div className="beginner-home-overview">
            <article>
              <span aria-hidden="true">人</span>
              <div><small>いま会場にいる人数</small><strong>{snapshot.occupancy}</strong><p>まず見る数字です</p></div>
            </article>
            <article>
              <span aria-hidden="true">予</span>
              <div><small>5分後の予測</small><strong>{snapshot.predicted}</strong><p>増えそうかを確認</p></div>
            </article>
            <article>
              <span aria-hidden="true">端</span>
              <div><small>受付端末</small><strong>{snapshot.terminals}</strong><p>入口・出口が動いているか</p></div>
            </article>
            <article className={snapshot.issueCount > 0 ? "has-issues" : ""}>
              <span aria-hidden="true">!</span>
              <div><small>要対応</small><strong>{snapshot.issueCount}件</strong><p>{snapshot.issueCount > 0 ? "上から順に確認" : "今は対応不要"}</p></div>
            </article>
          </div>

          <div className="beginner-home-actions" aria-label="よく使う操作">
            <div><strong>迷ったらここから</strong><span>目的に近いボタンを押せばOKです</span></div>
            <button type="button" onClick={() => navigate("端末")}><b>端</b><span>端末を見る<small>入口・出口の状態</small></span></button>
            <button type="button" onClick={() => navigate("障害履歴")}><b>!</b><span>異常・注意<small>問題がある時</small></span></button>
            <button type="button" onClick={() => navigate("AI管制")}><b>AI</b><span>AIに聞く<small>何を見ればいいか迷った時</small></span></button>
            <button type="button" onClick={() => navigate("分析")}><b>分</b><span>分析を見る<small>来場者数や傾向</small></span></button>
          </div>
        </section>,
        homeHost
      )}

      {detailHost !== null && createPortal(
        <div className="beginner-detail-guide">
          <div><small>DETAILS</small><strong>ここから下は詳しい運行情報</strong></div>
          <p>会場の流れや予測を詳しく確認したい時に見ればOKです。</p>
        </div>,
        detailHost
      )}
    </>
  );
}
