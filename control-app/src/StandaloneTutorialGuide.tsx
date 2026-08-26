import {
  useEffect,
  useState,
} from "react";

type TutorialStep = {
  label: string;
  title: string;
  summary: string;
  checks: readonly string[];
  useCase: string;
  action: string;
  hint: string;
  caution?: string;
};

const STEPS: readonly TutorialStep[] = [
  {
    label: "ライブ運行",
    title: "ライブ運行って何？",
    summary:
      "管制を開いたら最初に見る画面です。会場内の人数、入退場の流れ、受付端末、通信状態、これからの人数予測を1画面でまとめて確認できます。",
    checks: [
      "『現在の会場内』は、来場者と会場内にいる部員を合わせた現在人数です。",
      "『5分後の予測』『学習型15分予測』は、直近の入退場と過去イベントの傾向から、この先の人数を予測します。",
      "入口・出口の『○人/分』を見ると、今どちらの流れが強いか分かります。",
      "『Firebase 接続中』なら、この管制端末からサーバーへ実際に通信できています。",
      "入口・出口端末を押すと、そのiPadの詳しい状態や遠隔操作画面へ進めます。",
    ],
    useCase:
      "イベント開始時の全体確認や、本番中に『今どうなってる？』と思ったときは、まずここを見ます。",
    action:
      "左メニューの『ライブ運行』をタップして、実際の画面を確認してみてください。",
    hint:
      "左メニューの一番上にある『ライブ運行』です。",
  },
  {
    label: "端末",
    title: "端末画面では何を見る？",
    summary:
      "入口・出口の受付iPadが、本当に正常に動いているかを細かく確認する画面です。単に『オンライン』だけでなく、カメラや通信品質、未送信データまで確認できます。",
    checks: [
      "『最終通信』が数秒前なら、そのiPadから管制へ状態が届いています。長く途切れていたら通信を確認します。",
      "『カメラ』が正常ならQR読み取り用カメラが動作中です。エラーなら再起動などの対応候補になります。",
      "『Firebase応答』はサーバーとの応答速度です。数字が極端に大きいと通信が遅い可能性があります。",
      "『下り速度』は受付端末側の通信速度の目安です。",
      "『同期待ち』が0件なら、受付データは送信済みです。件数がある場合は未送信データが残っています。",
      "『最終読取』を見ると、その受付で最後にQRを読み取った時刻を確認できます。",
    ],
    useCase:
      "『入口の読み取りが遅い』『出口が反応しない』『データが反映されない』など、受付端末に何かありそうなときに使います。",
    action:
      "左メニューの『端末』をタップして、入口・出口iPadの状態を見てみてください。",
    hint:
      "左メニューの『端末』です。",
    caution:
      "端末をさらに開くと受付停止・カメラ再起動・再同期などの遠隔操作があります。本番中は、必要な理由がある操作だけ実行してください。",
  },
  {
    label: "障害履歴",
    title: "障害履歴は“何が問題か”を見る場所",
    summary:
      "管制が見つけた異常や注意項目をまとめて確認する画面です。全部の数値を自分で見比べなくても、まず確認すべき問題を絞れます。",
    checks: [
      "受付端末から一定時間通信がない場合は、通信なしとして表示されます。",
      "カメラエラー、受付の一時停止、未送信データなども注意・異常として表示されます。",
      "入口・出口でアプリのバージョンが違う場合も、確認項目として出ます。",
      "Firebaseやリアルタイム監視そのものに問題がある場合は、管制端末側の異常として表示されます。",
      "表示が0件なら、管制が現在検知している異常・注意はありません。",
    ],
    useCase:
      "何かおかしいけど原因が分からないときや、定期的に異常が出ていないか確認するときに使います。",
    action:
      "左メニューの『障害履歴』を開いて、現在の異常・注意がどう表示されるか確認してください。",
    hint:
      "左メニューの『障害履歴』です。件数があると数字も表示されます。",
  },
  {
    label: "管制ラボ",
    title: "管制ラボは自動運転の司令室",
    summary:
      "管制が見つけた状況に対して、どこまで自動で判断・操作させるかを設定する実験機能です。自動運転レベルによって動き方が変わります。",
    checks: [
      "OFFは自動運転を停止し、通常の監視だけを行います。",
      "Lv.1『支援』は異常を見つけて対応案を出しますが、操作はしません。",
      "Lv.2『半自動』は、提案を見て人が承認した操作を実行します。",
      "Lv.3『自動』は、カメラ再起動や未送信データの再同期など、安全性を限定した復旧操作を自動実行できます。",
      "受付停止・受付再開のように運用へ直接影響する操作は、Lv.3でも人の確認が必要です。",
    ],
    useCase:
      "端末トラブルへの対応を管制がどこまで支援するか調整したいときや、管制の提案内容を確認したいときに使います。",
    action:
      "左メニューの『管制ラボ』をタップして、自動運転レベルと現在の判断を確認してください。",
    hint:
      "左メニュー下側の『管制ラボ』です。",
    caution:
      "自動運転レベルを変更すると実際の運用動作に影響します。チュートリアルでは、仕組みを確認するだけならレベルを変更しなくても大丈夫です。",
  },
  {
    label: "AI管制",
    title: "AI管制は何をしてくれる？",
    summary:
      "会場人数、入口・出口端末、通信、異常などのライブデータを、文章で質問できる管制コパイロットです。現在は外部AIではなく、ルール推論と意図解析で動く疑似AIです。",
    checks: [
      "『今どんな状態？』で、会場人数・端末数・異常・予測をまとめて確認できます。",
      "『入口の通信を調べて』のように、対象を指定して端末状態を診断できます。",
      "『さっきより増えてる？』と聞くと、直近5分とその前の5分を比較します。",
      "『一番確認すべきことは？』で、現在の異常から優先度の高いものを案内します。",
      "『出口のカメラを再起動して』のような操作指示は、対象と内容を確認してから実行する仕組みです。",
    ],
    useCase:
      "画面の数字を一つずつ読むより、知りたいことをそのまま質問したいときや、異常時に次の確認先を素早く決めたいときに使います。",
    action:
      "最後に『AI管制』を開いて、質問例や現在の判断材料を見てみてください。",
    hint:
      "左メニューの『AI管制』です。",
    caution:
      "疑似AIなので、対応していない質問には推測で答えません。遠隔操作を提案された場合も、対象端末と操作内容を確認してから実行してください。",
  },
];

function findMenuButton(label: string) {
  const buttons = Array.from(
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

  const completed = stepIndex >= STEPS.length;

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
          width: min(560px, calc(100vw - 36px)) !important;
          max-height: min(82dvh, 760px) !important;
          overflow-y: auto !important;
          box-sizing: border-box !important;
          padding: 20px !important;
          border: 1px solid rgba(255,255,255,.9) !important;
          border-radius: 22px !important;
          background: rgba(255,255,255,.98) !important;
          box-shadow: 0 24px 70px rgba(20,17,45,.35) !important;
          color: #172033 !important;
        }

        .standalone-tutorial-card h2 {
          margin: 7px 0 0 !important;
          font-size: 24px !important;
          line-height: 1.25 !important;
        }

        .standalone-tutorial-summary {
          margin: 10px 0 0 !important;
          color: #4e5869 !important;
          font-size: 15px !important;
          font-weight: 650 !important;
          line-height: 1.7 !important;
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

        .standalone-tutorial-detail {
          margin-top: 15px !important;
          padding: 14px !important;
          border: 1px solid #e6e2f0 !important;
          border-radius: 16px !important;
          background: #faf9fd !important;
        }

        .standalone-tutorial-detail > strong {
          display: block !important;
          margin-bottom: 8px !important;
          color: #2f3746 !important;
          font-size: 14px !important;
        }

        .standalone-tutorial-detail ul {
          display: grid !important;
          gap: 7px !important;
          margin: 0 !important;
          padding-left: 20px !important;
          color: #566071 !important;
        }

        .standalone-tutorial-detail li {
          line-height: 1.55 !important;
          font-size: 13px !important;
        }

        .standalone-tutorial-when,
        .standalone-tutorial-action,
        .standalone-tutorial-caution,
        .standalone-tutorial-hint {
          margin-top: 11px !important;
          padding: 11px 13px !important;
          border-radius: 13px !important;
          font-size: 13px !important;
          line-height: 1.6 !important;
        }

        .standalone-tutorial-when {
          background: #edf7f4 !important;
          color: #27645d !important;
        }

        .standalone-tutorial-action {
          background: #f1eefb !important;
          color: #58449e !important;
          font-weight: 800 !important;
        }

        .standalone-tutorial-caution {
          border: 1px solid #f1dcae !important;
          background: #fff8e9 !important;
          color: #77571d !important;
        }

        .standalone-tutorial-hint {
          background: #f5f3fa !important;
          color: #5e48aa !important;
        }

        .standalone-tutorial-progress {
          height: 7px !important;
          margin-top: 15px !important;
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

        @media (max-width: 700px) {
          .standalone-tutorial-card {
            right: 12px !important;
            bottom: max(12px, env(safe-area-inset-bottom)) !important;
            width: calc(100vw - 24px) !important;
            max-height: 78dvh !important;
          }
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
              <p className="standalone-tutorial-summary">
                ライブ運行・端末・障害履歴・管制ラボ・AI管制が、それぞれ何を見るための画面なのか確認できました。
              </p>
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
                <span>MISSION · {step.label}</span>
                <span>{stepIndex + 1} / {STEPS.length}</span>
              </div>

              <h2>{step.title}</h2>
              <p className="standalone-tutorial-summary">{step.summary}</p>

              <div className="standalone-tutorial-detail">
                <strong>ここを見ればOK</strong>
                <ul>
                  {step.checks.map((check) => (
                    <li key={check}>{check}</li>
                  ))}
                </ul>
              </div>

              <p className="standalone-tutorial-when">
                <strong>こういう時に使う：</strong> {step.useCase}
              </p>

              {step.caution !== undefined && (
                <p className="standalone-tutorial-caution">
                  <strong>注意：</strong> {step.caution}
                </p>
              )}

              <p className="standalone-tutorial-action">
                ▶ {step.action}
              </p>

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
