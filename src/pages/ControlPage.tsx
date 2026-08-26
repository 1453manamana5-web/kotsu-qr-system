import {
  useEffect,
  useState,
} from "react";

import ControlApp from "../../control-app/src/App";

import {
  db,
} from "../firebase";

import "../../control-app/src/index.css";

type ControlPageProps = {
  setPage: (
    page: string
  ) => void;
};

type TutorialStep = {
  selector: string;
  title: string;
  description: string;
  hint: string;
};

const TUTORIAL_STEPS:
  readonly TutorialStep[] = [
  {
    selector:
      ".sidebar nav button:nth-of-type(1)",
    title:
      "ライブ運行を開こう",
    description:
      "まず、会場人数・受付端末・混雑予測をまとめて確認する『ライブ運行』をタップしてください。",
    hint:
      "左メニューの一番上にある『ライブ運行』です。",
  },
  {
    selector:
      ".sidebar nav button:nth-of-type(3)",
    title:
      "受付端末を確認しよう",
    description:
      "次に『端末』を開いて、入口・出口iPadの通信状態やカメラ状態を確認します。",
    hint:
      "左メニューの『端末』をタップしてください。",
  },
  {
    selector:
      ".sidebar nav button:nth-of-type(4)",
    title:
      "異常を確認しよう",
    description:
      "『障害履歴』を開いて、現在対応が必要な異常や注意項目を確認します。",
    hint:
      "△のようなアイコンが付いた『障害履歴』です。",
  },
  {
    selector:
      ".sidebar nav button:nth-of-type(6)",
    title:
      "管制ラボを開こう",
    description:
      "『管制ラボ』では運用オートパイロットの判断内容や自動運転レベルを確認できます。",
    hint:
      "左メニュー下側の『管制ラボ』をタップしてください。",
  },
  {
    selector:
      ".sidebar nav button:nth-of-type(7)",
    title:
      "AI管制を使ってみよう",
    description:
      "最後に『AI管制』を開きます。会場や端末の状態を質問できる実験機能です。",
    hint:
      "左メニュー一番下の『AI管制』です。",
  },
];

function ControlPage({
  setPage,
}: ControlPageProps) {
  const [
    tutorialActive,
    setTutorialActive,
  ] = useState(false);

  const [
    tutorialStep,
    setTutorialStep,
  ] = useState(0);

  const [
    showHint,
    setShowHint,
  ] = useState(false);

  const tutorialCompleted =
    tutorialStep >=
    TUTORIAL_STEPS.length;

  useEffect(() => {
    if (
      !tutorialActive ||
      tutorialCompleted
    ) {
      return undefined;
    }

    const step =
      TUTORIAL_STEPS[
        tutorialStep
      ];

    if (
      step === undefined
    ) {
      return undefined;
    }

    let target:
      HTMLElement | null =
      null;

    let retryTimer:
      number | null =
      null;

    let advanceTimer:
      number | null =
      null;

    const removeTarget =
      () => {
        if (
          target !== null
        ) {
          target.classList.remove(
            "control-tutorial-highlight"
          );

          target.removeEventListener(
            "click",
            handleTargetClick
          );
        }
      };

    const handleTargetClick =
      () => {
        removeTarget();

        advanceTimer =
          window.setTimeout(
            () => {
              setShowHint(false);

              setTutorialStep(
                (currentStep) =>
                  currentStep + 1
              );
            },
            220
          );
      };

    const attachTarget =
      () => {
        target =
          document.querySelector<HTMLElement>(
            step.selector
          );

        if (
          target === null
        ) {
          retryTimer =
            window.setTimeout(
              attachTarget,
              120
            );

          return;
        }

        target.classList.add(
          "control-tutorial-highlight"
        );

        target.addEventListener(
          "click",
          handleTargetClick,
          {
            once: true,
          }
        );

        target.scrollIntoView({
          behavior:
            "smooth",
          block:
            "nearest",
        });
      };

    attachTarget();

    return () => {
      if (
        retryTimer !== null
      ) {
        window.clearTimeout(
          retryTimer
        );
      }

      if (
        advanceTimer !== null
      ) {
        window.clearTimeout(
          advanceTimer
        );
      }

      removeTarget();
    };
  }, [
    tutorialActive,
    tutorialCompleted,
    tutorialStep,
  ]);

  const startTutorial =
    () => {
      setTutorialStep(0);
      setShowHint(false);
      setTutorialActive(true);
    };

  const closeTutorial =
    () => {
      setTutorialActive(false);
      setTutorialStep(0);
      setShowHint(false);
    };

  const currentStep =
    TUTORIAL_STEPS[
      tutorialStep
    ];

  return (
    <div className="control-page-tutorial-root">
      <ControlApp
        database={db}
        onReturn={() =>
          setPage("admin")
        }
      />

      <style>{`
        .control-page-tutorial-root {
          min-height: 100dvh;
        }

        .control-tutorial-launcher {
          position: fixed;
          right: max(18px, env(safe-area-inset-right));
          bottom: max(18px, env(safe-area-inset-bottom));
          z-index: 12000;
          display: inline-flex;
          align-items: center;
          gap: 9px;
          min-height: 50px;
          padding: 10px 18px;
          border: 1px solid rgba(255, 255, 255, 0.75);
          border-radius: 999px;
          background: #7352d6;
          box-shadow: 0 12px 30px rgba(46, 31, 100, 0.28);
          color: #ffffff;
          font: inherit;
          font-size: 16px;
          font-weight: 800;
          cursor: pointer;
        }

        .control-tutorial-launcher span:first-child {
          display: grid;
          width: 26px;
          height: 26px;
          place-items: center;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.18);
        }

        .control-tutorial-card {
          position: fixed;
          right: max(18px, env(safe-area-inset-right));
          bottom: max(18px, env(safe-area-inset-bottom));
          z-index: 12001;
          width: min(440px, calc(100vw - 36px));
          padding: 18px;
          border: 1px solid rgba(255, 255, 255, 0.9);
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 24px 60px rgba(27, 24, 50, 0.28);
          color: #172033;
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
        }

        .control-tutorial-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }

        .control-tutorial-mission {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: #7352d6;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.12em;
        }

        .control-tutorial-progress {
          color: #70798a;
          font-size: 13px;
          font-weight: 800;
        }

        .control-tutorial-card h2 {
          margin: 0;
          font-size: clamp(21px, 2.2vw, 28px);
          line-height: 1.2;
        }

        .control-tutorial-card p {
          margin: 9px 0 0;
          color: #5f6878;
          font-size: 15px;
          font-weight: 650;
          line-height: 1.65;
        }

        .control-tutorial-progress-track {
          height: 7px;
          margin-top: 14px;
          overflow: hidden;
          border-radius: 999px;
          background: #ece9f7;
        }

        .control-tutorial-progress-bar {
          height: 100%;
          border-radius: inherit;
          background: linear-gradient(90deg, #8d6fea, #6444c5);
          transition: width 220ms ease;
        }

        .control-tutorial-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 9px;
          margin-top: 14px;
        }

        .control-tutorial-actions button {
          min-height: 42px;
          padding: 8px 14px;
          border: 1px solid #d9d4e8;
          border-radius: 12px;
          background: #f7f5fb;
          color: #3f4654;
          font: inherit;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
        }

        .control-tutorial-actions button.primary {
          border-color: #7352d6;
          background: #7352d6;
          color: #ffffff;
        }

        .control-tutorial-hint {
          margin-top: 10px !important;
          padding: 10px 12px;
          border-radius: 12px;
          background: #f2effb;
          color: #5e48aa !important;
          font-size: 13px !important;
        }

        .control-tutorial-highlight {
          position: relative !important;
          z-index: 11999 !important;
          outline: 4px solid #9c7cff !important;
          outline-offset: 4px !important;
          box-shadow:
            0 0 0 8px rgba(139, 107, 235, 0.2),
            0 0 32px rgba(114, 82, 214, 0.55) !important;
          animation: controlTutorialPulse 1.05s ease-in-out infinite;
        }

        @keyframes controlTutorialPulse {
          0%, 100% {
            box-shadow:
              0 0 0 7px rgba(139, 107, 235, 0.16),
              0 0 25px rgba(114, 82, 214, 0.38);
          }

          50% {
            box-shadow:
              0 0 0 12px rgba(139, 107, 235, 0.08),
              0 0 38px rgba(114, 82, 214, 0.6);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .control-tutorial-highlight {
            animation: none;
          }

          .control-tutorial-progress-bar {
            transition: none;
          }
        }

        @media (max-width: 700px) {
          .control-tutorial-launcher,
          .control-tutorial-card {
            right: 12px;
            bottom: max(12px, env(safe-area-inset-bottom));
          }

          .control-tutorial-card {
            width: calc(100vw - 24px);
          }
        }
      `}</style>

      {!tutorialActive && (
        <button
          type="button"
          className="control-tutorial-launcher"
          onClick={
            startTutorial
          }
        >
          <span>?</span>
          <span>
            使い方
          </span>
        </button>
      )}

      {tutorialActive && (
        <section
          className="control-tutorial-card"
          aria-live="polite"
        >
          {tutorialCompleted ? (
            <>
              <div className="control-tutorial-card-header">
                <span className="control-tutorial-mission">
                  TRAINING COMPLETE
                </span>

                <span className="control-tutorial-progress">
                  5 / 5
                </span>
              </div>

              <h2>
                基本操作クリア！
              </h2>

              <p>
                ライブ運行 → 端末 → 障害履歴 → 管制ラボ → AI管制の基本ルートを実際の画面で操作しました。
              </p>

              <div className="control-tutorial-progress-track">
                <div
                  className="control-tutorial-progress-bar"
                  style={{
                    width:
                      "100%",
                  }}
                />
              </div>

              <div className="control-tutorial-actions">
                <button
                  type="button"
                  onClick={
                    startTutorial
                  }
                >
                  もう一度
                </button>

                <button
                  type="button"
                  className="primary"
                  onClick={
                    closeTutorial
                  }
                >
                  訓練を終了
                </button>
              </div>
            </>
          ) : currentStep !==
            undefined ? (
            <>
              <div className="control-tutorial-card-header">
                <span className="control-tutorial-mission">
                  MISSION
                </span>

                <span className="control-tutorial-progress">
                  {tutorialStep + 1}
                  {" / "}
                  {
                    TUTORIAL_STEPS.length
                  }
                </span>
              </div>

              <h2>
                {
                  currentStep.title
                }
              </h2>

              <p>
                {
                  currentStep.description
                }
              </p>

              <div className="control-tutorial-progress-track">
                <div
                  className="control-tutorial-progress-bar"
                  style={{
                    width:
                      `${(
                        (
                          tutorialStep +
                          1
                        ) /
                        TUTORIAL_STEPS.length
                      ) * 100}%`,
                  }}
                />
              </div>

              {showHint && (
                <p className="control-tutorial-hint">
                  ヒント：
                  {
                    currentStep.hint
                  }
                </p>
              )}

              <div className="control-tutorial-actions">
                <button
                  type="button"
                  onClick={() =>
                    setShowHint(
                      (current) =>
                        !current
                    )
                  }
                >
                  {showHint
                    ? "ヒントを隠す"
                    : "ヒント"}
                </button>

                <button
                  type="button"
                  onClick={
                    closeTutorial
                  }
                >
                  終了
                </button>
              </div>
            </>
          ) : null}
        </section>
      )}
    </div>
  );
}

export default ControlPage;
