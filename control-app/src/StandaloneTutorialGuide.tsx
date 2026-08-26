import {
  useEffect,
  useState,
} from "react";

type TutorialStep = {
  label: string;
  title: string;
  description: string;
  hint: string;
};

const STEPS: readonly TutorialStep[] = [
  {
    label: "ライブ運行",
    title: "ライブ運行を開こう",
    description: "まず、会場人数・受付端末・予測をまとめて確認する『ライブ運行』をタップしてください。",
    hint: "左メニューの『ライブ運行』です。",
  },
  {
    label: "端末",
    title: "受付端末を確認しよう",
    description: "次に『端末』を開いて、入口・出口iPadの通信状態やカメラ状態を確認します。",
    hint: "左メニューの『端末』をタップしてください。",
  },
  {
    label: "障害履歴",
    title: "異常を確認しよう",
    description: "『障害履歴』を開いて、現在対応が必要な異常や注意項目を確認します。",
    hint: "左メニューの『障害履歴』です。",
  },
  {
    label: "管制ラボ",
    title: "管制ラボを開こう",
    description: "『管制ラボ』では運用オートパイロットの判断内容や自動運転レベルを確認できます。",
    hint: "左メニュー下側の『管制ラボ』です。",
  },
  {
    label: "AI管制",
    title: "AI管制を使ってみよう",
    description: "最後に『AI管制』を開きます。会場や端末の状態を質問できる実験機能です。",
    hint: "左メニューの『AI管制』です。",
  },
];

function findMenuButton(label: string) {
  const buttons =
    Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        ".sidebar nav button"
      )
    );

  return (
    buttons.find((button) =>
      button.textContent?.includes(label)
    ) ?? null
  );
}

export default function StandaloneTutorialGuide() {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [showHint, setShowHint] = useState(false);

  const completed =
    stepIndex >= STEPS.length;

  useEffect(() => {
    if (!active || completed) {
      return undefined;
    }

    const step = STEPS[stepIndex];

    if (step === undefined) {
      return undefined;
    }

    let target: HTMLButtonElement | null = null;
    let retryTimer: number | null = null;
    let advanceTimer: number | null = null;

    const clearTarget = () => {
      if (target === null) {
        return;
      }

      target.classList.remove(
        "standalone-tutorial-highlight"
      );
      target.removeEventListener(
        "click",
        handleClick
      );
      target = null;
    };

    const handleClick = () => {
      clearTarget();
      advanceTimer = window.setTimeout(() => {
        setShowHint(false);
        setStepIndex((current) => current + 1);
      }, 180);
    };

    const attach = () => {
      target = findMenuButton(step.label);

      if (target === null) {
        retryTimer = window.setTimeout(
          attach,
          120
        );
        return;
      }

      target.classList.add(
        "standalone-tutorial-highlight"
      );
      target.addEventListener(
        "click",
        handleClick,
        { once: true }
      );
      target.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    };

    attach();

    return () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      if (advanceTimer !== null) {
        window.clearTimeout(advanceTimer);
      }
      clearTarget();
    };
  }, [active, completed, stepIndex]);

  const start = () => {
    setStepIndex(0);
    setShowHint(false);
    setActive(true);
  };

  const close = () => {
    setActive(false);
    setStepIndex(0);
    setShowHint(false);
  };

  const step = STEPS[stepIndex];

  return (
    <>
      <style>{`
        .standalone-tutorial-launcher,
        .standalone-tutorial-card {
          position: fixed !important;
          right: max(18px, env(safe-area-inset-right)) !important;
          bottom: max(18px, env(safe-area-inset-bottom)) !important;
          z-index: 2147483646 !important;
        }

        .standalone-tutorial-launcher {
          min-height: 52px !important;
          padding: 10px 18px !important;
          border: 2px solid rgba(255,255,255,.9) !important;
          border-radius: 999px !important;
          background: #7352d6 !important;
          box-shadow: 0 14px 36px rgba(41,27,94,.34) !important;
          color: #fff !important;
          font: inherit !important;
          font-size: 16px !important;
          font-weight: 900 !important;
          cursor: pointer !important;
        }

        .standalone-tutorial-card {
          width: min(440px, calc(100vw - 36px)) !important;
          box-sizing: border-box !important;
          padding: 18px !important;
          border: 1px solid rgba(255,255,255,.9) !important;
          border-radius: 22px !important;
          background: rgba(255,255,255,.98) !important;
          box-shadow: 0 24px 70px rgba(20,17,45,.35) !important;
          color: #172033 !important;
        }

        .standalone-tutorial-card h2 {
          margin: 6px 0 0 !important;
          font-size: 24px !important;
        }

        .standalone-tutorial-card p {
          margin: 9px 0 0 !important;
          color: #5f6878 !important;
          line-height: 1.65 !important;
        }

        .standalone-tutorial-meta {
          display: flex !important;
          justify-content: space-between !important;
          gap: 12px !important;
          color: #7352d6 !important;
          font-size: 12px !important;
          font-weight: 900 !important;
          letter-spacing: .08em !important;
        }

        .standalone-tutorial-progress {
          height: 7px !important;
          margin-top: 14px !important;
          overflow: hidden !important;
          border-radius: 999px !important;
          background: #ebe8f6 !important;
        }

        .standalone-tutorial-progress > span {
          display: block !important;
          height: 100% !important;
          border-radius: inherit !important;
          background: #7352d6 !important;
          transition: width 180ms ease !important;
        }

        .standalone-tutorial-actions {
          display: flex !important;
          gap: 9px !important;
          flex-wrap: wrap !important;
          margin-top: 14px !important;
        }

        .standalone-tutorial-actions button {
          min-height: 42px !important;
          padding: 8px 14px !important;
          border: 1px solid #d8d2e9 !important;
          border-radius: 12px !important;
          background: #f6f4fb !important;
          color: #3f4654 !important;
          font: inherit !important;
          font-weight: 800 !important;
          cursor: pointer !important;
        }

        .standalone-tutorial-actions button.primary {
          border-color: #7352d6 !important;
          background: #7352d6 !important;
          color: #fff !important;
        }

        .standalone-tutorial-hint {
          padding: 10px 12px !important;
          border-radius: 12px !important;
          background: #f1eefb !important;
          color: #5e48aa !important;
          font-size: 13px !important;
        }

        .standalone-tutorial-highlight {
          position: relative !important;
          z-index: 2147483645 !important;
          outline: 4px solid #9d80ff !important;
          outline-offset: 4px !important;
          box-shadow: 0 0 0 9px rgba(145,111,239,.18), 0 0 32px rgba(115,82,214,.65) !important;
          animation: standaloneTutorialPulse 1s ease-in-out infinite !important;
        }

        @keyframes standaloneTutorialPulse {
          0%, 100% { box-shadow: 0 0 0 7px rgba(145,111,239,.14), 0 0 24px rgba(115,82,214,.4); }
          50% { box-shadow: 0 0 0 12px rgba(145,111,239,.08), 0 0 38px rgba(115,82,214,.7); }
        }
      `}</style>

      {!active && (
        <button
          type="button"
          className="standalone-tutorial-launcher"
          onClick={start}
        >
          ？ 使い方
        </button>
      )}

      {active && (
        <section
          className="standalone-tutorial-card"
          aria-live="polite"
        >
          {completed ? (
            <>
              <div className="standalone-tutorial-meta">
                <span>TRAINING COMPLETE</span>
                <span>5 / 5</span>
              </div>
              <h2>基本操作クリア！</h2>
              <p>管制の基本メニューを実際に触りながら確認できました。</p>
              <div className="standalone-tutorial-progress">
                <span style={{ width: "100%" }} />
              </div>
              <div className="standalone-tutorial-actions">
                <button type="button" onClick={start}>もう一度</button>
                <button type="button" className="primary" onClick={close}>訓練を終了</button>
              </div>
            </>
          ) : step !== undefined ? (
            <>
              <div className="standalone-tutorial-meta">
                <span>MISSION</span>
                <span>{stepIndex + 1} / {STEPS.length}</span>
              </div>
              <h2>{step.title}</h2>
              <p>{step.description}</p>
              <div className="standalone-tutorial-progress">
                <span
                  style={{
                    width: `${((stepIndex + 1) / STEPS.length) * 100}%`,
                  }}
                />
              </div>
              {showHint && (
                <p className="standalone-tutorial-hint">
                  ヒント：{step.hint}
                </p>
              )}
              <div className="standalone-tutorial-actions">
                <button
                  type="button"
                  onClick={() => setShowHint((current) => !current)}
                >
                  {showHint ? "ヒントを隠す" : "ヒント"}
                </button>
                <button type="button" onClick={close}>終了</button>
              </div>
            </>
          ) : null}
        </section>
      )}
    </>
  );
}
