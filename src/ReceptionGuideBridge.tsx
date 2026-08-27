import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import ReceptionGuidePage from "./pages/ReceptionGuidePage";

type TutorialStep = {
  id: string;
  kind: "click" | "explain";
  selector: string;
  title: string;
  body: string;
  note?: string;
  caution?: string;
};

const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "leave-admin",
    kind: "click",
    selector: ".admin-return-button",
    title: "まず管理画面を閉じます",
    body: "実際の受付画面で練習するため、いま開いている管理画面から元の画面へ戻ります。青く光っている戻るボタンを押してください。",
  },
  {
    id: "ensure-home",
    kind: "click",
    selector: ".entry-home-button, .exit-home-button",
    title: "ホーム画面へ戻る",
    body: "入口・出口受付からガイドを開いていた場合は、ここでいったんホームへ戻ります。すでにホームならこの手順は自動で飛ばします。",
  },
  {
    id: "home-status",
    kind: "explain",
    selector: ".home-event-card",
    title: "受付前にイベントを確認",
    body: "受付を始める前に、ここで現在のイベント名を確認します。違うイベントが表示されている状態では、そのまま受付を始めないでください。",
    note: "画面上部のオンライン表示も一緒に確認します。通信エラー時は受付結果の保存に影響するため、先にWi-Fi状態を確認します。",
  },
  {
    id: "open-entry",
    kind: "click",
    selector: ".home-entry-card",
    title: "入口受付を開く",
    body: "来場者が入場するときは『入口受付』を使います。青く光っている入口受付を押してください。",
  },
  {
    id: "entry-sound",
    kind: "click",
    selector: ".entry-sound-start-button",
    title: "受付開始時に音声を有効化",
    body: "受付画面を開いた直後は、確認音を鳴らしてからカメラを起動します。表示されている場合だけ、このボタンを押してください。すでにカメラが起動済みなら自動で次へ進みます。",
    caution: "確認音が鳴るので、iPadの音量に注意してください。",
  },
  {
    id: "entry-scanner",
    kind: "explain",
    selector: ".entry-scanner-card",
    title: "ここが入口のQR読み取り部",
    body: "来場者のチケットQR全体がこのカメラ範囲に入るようにかざします。読み取りは自動なので、画面を連打したり手動で撮影したりする必要はありません。",
    note: "この練習ではQRを読み取りません。実際のQRを読むと本番データが更新されるためです。",
  },
  {
    id: "entry-result",
    kind: "explain",
    selector: ".entry-scan-instruction",
    title: "読み取ったら必ず結果を確認",
    body: "QRが反応しただけで次の人へ進まず、結果表示まで確認します。緑の『入場OK』なら正常、入口で『再入場OK』なら来場者数は増やさず室内人数だけ増えます。赤い『受付失敗』なら原因を確認してから再操作します。",
    caution: "エラー時に同じQRを連続で何度も読ませるのは避けてください。",
  },
  {
    id: "entry-admin",
    kind: "click",
    selector: ".entry-admin-button",
    title: "受付中に管理モードへ入る",
    body: "受付画面から管理モードへ移るときは、右下の管理モードを押します。実際の認証画面も確認するので、このボタンを押してください。",
  },
  {
    id: "auth-sound",
    kind: "click",
    selector: ".admin-auth-sound-start-button",
    title: "管理者認証を開始",
    body: "管理者認証でも最初に音声を有効にしてカメラを起動します。すでに認証カメラが起動している場合は自動で次へ進みます。",
    caution: "ここでも確認音が鳴ります。",
  },
  {
    id: "auth-scanner",
    kind: "explain",
    selector: ".admin-auth-scanner-card",
    title: "管理モードは部員QRで認証",
    body: "ここでは来場者チケットではなく、登録済みの部員QRを読み取ります。認証に成功した部員だけが管理画面へ進めます。",
    note: "練習中は部員QRを読ませなくてOKです。イベント開催中はホームから管理モードへ入る場合も同じ認証が必要です。",
  },
  {
    id: "auth-return",
    kind: "click",
    selector: ".admin-auth-return-button",
    title: "認証画面から受付へ戻る",
    body: "認証をやめる場合はこのボタンで、入ってきた受付画面へ戻れます。青く光っている戻るボタンを押してください。",
  },
  {
    id: "entry-home",
    kind: "click",
    selector: ".entry-home-button",
    title: "次は出口受付を確認",
    body: "入口受付の確認はここまでです。ホームへ戻って出口受付を見ます。",
  },
  {
    id: "open-exit",
    kind: "click",
    selector: ".home-exit-card",
    title: "出口受付を開く",
    body: "来場者が展示から出るときは『出口受付』を使います。青く光っている出口受付を押してください。",
  },
  {
    id: "exit-sound",
    kind: "click",
    selector: ".exit-sound-start-button",
    title: "出口受付も音声を有効化",
    body: "出口側も初回だけ確認音を鳴らしてカメラを起動します。すでに起動済みなら自動で次へ進みます。",
    caution: "確認音が鳴ります。",
  },
  {
    id: "exit-scanner",
    kind: "explain",
    selector: ".exit-scanner-card",
    title: "出口でも同じQRを読み取る",
    body: "退場時も来場者が持っている同じチケットQRを読み取ります。正常なら『退出OK』が表示され、室内人数が1人分減ります。",
    note: "『まだ入場していません』『すでに退出しています』などの赤い表示が出たら、結果を確認してから対応します。",
  },
  {
    id: "exit-home",
    kind: "click",
    selector: ".exit-home-button",
    title: "最後にホームへ戻る",
    body: "入口と出口の基本操作を確認できました。ホームへ戻って最後の注意点を確認します。",
  },
  {
    id: "home-admin",
    kind: "explain",
    selector: ".home-admin-button",
    title: "本番中はホームからでもQR認証",
    body: "イベント開催中は、ホーム画面の管理モードから入る場合も部員QR認証を挟みます。開始時刻前やイベント終了後は、準備・片付けをしやすいよう直接管理画面へ入れます。",
    note: "これで受付の基本操作、結果確認、管理者認証まで一通り確認できました。",
  },
];

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

function shouldAutoSkip(step: TutorialStep) {
  if (step.id === "ensure-home") {
    return document.querySelector(".home-page") !== null;
  }

  if (step.id === "entry-sound") {
    return document.querySelector(".entry-scanner-card") !== null;
  }

  if (step.id === "auth-sound") {
    return document.querySelector(".admin-auth-scanner-card") !== null;
  }

  if (step.id === "exit-sound") {
    return document.querySelector(".exit-scanner-card") !== null;
  }

  return false;
}

export default function ReceptionGuideBridge() {
  const [menuTarget, setMenuTarget] = useState<Element | null>(null);
  const [open, setOpen] = useState(false);
  const [eventName, setEventName] = useState("");
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [tutorialTargetReady, setTutorialTargetReady] = useState(false);
  const [tutorialTargetMissing, setTutorialTargetMissing] = useState(false);

  const tutorialCompleted = tutorialStepIndex >= TUTORIAL_STEPS.length;
  const tutorialStep = TUTORIAL_STEPS[tutorialStepIndex];
  const tutorialProgress = useMemo(
    () => tutorialCompleted
      ? 100
      : Math.round(((tutorialStepIndex + 1) / TUTORIAL_STEPS.length) * 100),
    [tutorialCompleted, tutorialStepIndex]
  );

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

  useEffect(() => {
    if (!tutorialActive || tutorialCompleted || tutorialStep === undefined) return undefined;

    let target: HTMLElement | null = null;
    let retryTimer: number | null = null;
    let advanceTimer: number | null = null;
    let attempts = 0;

    const clean = () => {
      if (target !== null) {
        target.classList.remove("reception-tutorial-highlight");
        if (tutorialStep.kind === "click") target.removeEventListener("click", onTargetClick);
      }
      target = null;
    };

    const advance = (delay = 320) => {
      clean();
      setTutorialTargetReady(false);
      setTutorialTargetMissing(false);
      advanceTimer = window.setTimeout(
        () => setTutorialStepIndex((current) => current + 1),
        delay
      );
    };

    const onTargetClick = () => advance(430);

    const attach = () => {
      attempts += 1;

      if (shouldAutoSkip(tutorialStep)) {
        advance(260);
        return;
      }

      target = document.querySelector<HTMLElement>(tutorialStep.selector);

      if (target === null) {
        if (attempts >= 24) {
          setTutorialTargetMissing(true);
          setTutorialTargetReady(true);
          return;
        }

        retryTimer = window.setTimeout(attach, 140);
        return;
      }

      target.classList.add("reception-tutorial-highlight");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setTutorialTargetMissing(false);
      setTutorialTargetReady(true);

      if (tutorialStep.kind === "click") {
        target.addEventListener("click", onTargetClick, { once: true });
      }
    };

    retryTimer = window.setTimeout(attach, 180);

    return () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (advanceTimer !== null) window.clearTimeout(advanceTimer);
      clean();
    };
  }, [tutorialActive, tutorialCompleted, tutorialStep, tutorialStepIndex]);

  const openGuide = () => {
    setEventName(readEventName());
    setOpen(true);
  };

  const startTutorial = () => {
    setOpen(false);
    setTutorialStepIndex(0);
    setTutorialTargetReady(false);
    setTutorialTargetMissing(false);
    window.setTimeout(() => setTutorialActive(true), 80);
  };

  const closeTutorial = () => {
    setTutorialActive(false);
    setTutorialStepIndex(0);
    setTutorialTargetReady(false);
    setTutorialTargetMissing(false);
  };

  const nextTutorialStep = () => {
    if (tutorialStep?.kind !== "explain") return;
    setTutorialTargetReady(false);
    setTutorialTargetMissing(false);
    setTutorialStepIndex((current) => current + 1);
  };

  const skipMissingTutorialStep = () => {
    setTutorialTargetReady(false);
    setTutorialTargetMissing(false);
    setTutorialStepIndex((current) => current + 1);
  };

  const restartTutorial = () => {
    setTutorialStepIndex(0);
    setTutorialTargetReady(false);
    setTutorialTargetMissing(false);
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
          onStartTutorial={startTutorial}
          setPage={(page) => {
            if (page === "admin") setOpen(false);
          }}
        />,
        document.body
      )}

      {tutorialActive && createPortal(
        <>
          <style>{`
            .reception-tutorial-card{position:fixed!important;right:max(14px,env(safe-area-inset-right))!important;bottom:max(14px,env(safe-area-inset-bottom))!important;z-index:2147483646!important;width:min(470px,calc(100vw - 28px))!important;max-height:min(70dvh,650px)!important;overflow:auto!important;padding:18px!important;border:1px solid rgba(255,255,255,.96)!important;border-radius:21px!important;background:rgba(255,255,255,.985)!important;color:#172033!important;box-shadow:0 24px 70px rgba(31,45,73,.32)!important;box-sizing:border-box!important;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic UI",sans-serif!important}.reception-tutorial-meta{display:flex!important;justify-content:space-between!important;gap:12px!important;color:#3f69b8!important;font-size:11px!important;font-weight:900!important;letter-spacing:.08em!important}.reception-tutorial-card h2{margin:8px 0 0!important;font-size:22px!important;line-height:1.3!important}.reception-tutorial-card p{margin:9px 0 0!important;color:#566176!important;font-size:13px!important;line-height:1.65!important}.reception-tutorial-note,.reception-tutorial-caution,.reception-tutorial-missing{padding:9px 11px!important;border-radius:11px!important;font-size:12px!important;font-weight:750!important}.reception-tutorial-note{background:#edf4ff!important;color:#3f619e!important}.reception-tutorial-caution{background:#fff1df!important;color:#855000!important}.reception-tutorial-missing{background:#fff7e8!important;color:#805600!important}.reception-tutorial-instruction{padding:9px 11px!important;border-left:4px solid #4f78c7!important;border-radius:10px!important;background:#f5f8fd!important;color:#313849!important;font-weight:850!important}.reception-tutorial-progress{height:7px!important;margin-top:13px!important;overflow:hidden!important;border-radius:999px!important;background:#e8edf6!important}.reception-tutorial-progress>span{display:block!important;height:100%!important;background:#4f78c7!important}.reception-tutorial-actions{display:flex!important;gap:8px!important;flex-wrap:wrap!important;margin-top:13px!important}.reception-tutorial-actions button{min-height:40px!important;padding:8px 13px!important;border:1px solid #d5dce9!important;border-radius:11px!important;background:#f5f7fa!important;color:#3e4654!important;font:inherit!important;font-weight:850!important}.reception-tutorial-actions .primary{border-color:#4f78c7!important;background:#4f78c7!important;color:#fff!important}.reception-tutorial-actions button:disabled{opacity:.5!important}.reception-tutorial-highlight{position:relative!important;z-index:2147483000!important;outline:4px solid #66a0ff!important;outline-offset:5px!important;box-shadow:0 0 0 10px rgba(85,145,239,.16),0 0 38px rgba(70,120,205,.68)!important;animation:receptionTutorialPulse 1.05s ease-in-out infinite!important}@keyframes receptionTutorialPulse{0%,100%{box-shadow:0 0 0 8px rgba(85,145,239,.13),0 0 24px rgba(70,120,205,.42)}50%{box-shadow:0 0 0 13px rgba(85,145,239,.06),0 0 42px rgba(70,120,205,.72)}}@media(max-width:760px){.reception-tutorial-card{right:10px!important;bottom:10px!important;width:calc(100vw - 20px)!important;max-height:74dvh!important}}
          `}</style>

          <section className="reception-tutorial-card" aria-live="polite">
            {tutorialCompleted ? (
              <>
                <div className="reception-tutorial-meta"><span>RECEPTION TRAINING</span><span>{TUTORIAL_STEPS.length} / {TUTORIAL_STEPS.length}</span></div>
                <h2>受付の基本操作を一通り確認できました</h2>
                <p>入口・出口の使い分け、QRをかざす場所、結果確認、部員QRによる管理者認証まで確認しました。本番では「結果を確認してから次の人へ」を基本にしてください。</p>
                <div className="reception-tutorial-progress"><span style={{ width: "100%" }} /></div>
                <div className="reception-tutorial-actions">
                  <button type="button" onClick={restartTutorial}>もう一度</button>
                  <button type="button" className="primary" onClick={closeTutorial}>終了</button>
                </div>
              </>
            ) : tutorialStep !== undefined ? (
              <>
                <div className="reception-tutorial-meta"><span>受付 · 実地ガイド</span><span>{tutorialStepIndex + 1} / {TUTORIAL_STEPS.length}</span></div>
                <h2>{tutorialStep.title}</h2>
                <p>{tutorialStep.body}</p>
                {tutorialStep.note !== undefined && <p className="reception-tutorial-note">{tutorialStep.note}</p>}
                {tutorialStep.caution !== undefined && <p className="reception-tutorial-caution">注意：{tutorialStep.caution}</p>}
                {tutorialTargetMissing && <p className="reception-tutorial-missing">この項目は現在の画面で見つかりませんでした。状態によっては表示されない項目なので、この手順だけ飛ばせます。</p>}
                <p className="reception-tutorial-instruction">
                  {tutorialTargetMissing
                    ? "この手順をスキップして次へ進めます。"
                    : tutorialStep.kind === "click"
                      ? tutorialTargetReady
                        ? "青く光っている実物を押してください。押すと自動で次へ進みます。"
                        : "操作する場所を探しています…"
                      : tutorialTargetReady
                        ? "青く光っている実物が、いま説明している場所です。内容を確認して『次へ』を押してください。"
                        : "説明する場所を探しています…"}
                </p>
                <div className="reception-tutorial-progress"><span style={{ width: `${tutorialProgress}%` }} /></div>
                <div className="reception-tutorial-actions">
                  <button type="button" onClick={closeTutorial}>終了</button>
                  {tutorialTargetMissing && <button type="button" className="primary" onClick={skipMissingTutorialStep}>スキップして次へ</button>}
                  {!tutorialTargetMissing && tutorialStep.kind === "explain" && (
                    <button type="button" className="primary" disabled={!tutorialTargetReady} onClick={nextTutorialStep}>次へ</button>
                  )}
                </div>
              </>
            ) : null}
          </section>
        </>,
        document.body
      )}
    </>
  );
}
