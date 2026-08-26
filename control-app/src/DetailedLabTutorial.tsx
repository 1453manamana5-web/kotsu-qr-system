import { useEffect, useMemo, useState } from "react";

type LabStep = {
  kind: "menu" | "explain";
  menuLabel?: string;
  selector?: string;
  title: string;
  body: string;
  note?: string;
  caution?: string;
};

const LAB_STEPS: readonly LabStep[] = [
  {
    kind: "menu",
    menuLabel: "管制ラボ",
    title: "管制ラボを開く",
    body: "左の『管制ラボ』を押してください。ここは運用オートパイロットを試すための試験機能です。通常の監視画面とは分けて、どこまで自動化するかを設定・確認します。",
  },
  {
    kind: "explain",
    selector: ".lab-status-hero",
    title: "まず『現在のレベル』を確認",
    body: "この大きな表示が、いまオートパイロットがどのレベルで動いているかを示します。現在レベルだけでなく、判断対象の件数・自動実行した件数・設定を同期した時刻もここで確認できます。",
    note: "本番中に管制ラボを開いたら、最初にここを見て『自分が想定しているレベルになっているか』を確認します。",
  },
  {
    kind: "explain",
    selector: ".autopilot-level-grid > button:nth-child(1)",
    title: "OFF：オートパイロットを止める",
    body: "OFFでは、オートパイロットによる監視・提案・自動操作を停止します。通常の管制画面や障害表示そのものを止めるわけではなく、自動運転部分だけを止めるモードです。",
    caution: "このボタンを押すと実際の設定が変わります。ガイド中は押さずに見るだけでOKです。",
  },
  {
    kind: "explain",
    selector: ".autopilot-level-grid > button:nth-child(2)",
    title: "Lv.1 支援：判断だけ手伝う",
    body: "Lv.1では異常を見つけて『こう対応した方がよい』という提案を出します。ただし受付端末への遠隔操作は自動では実行しません。まず管制に慣れる時に使いやすいレベルです。",
    note: "人が判断の主役で、システムは見落とし防止と確認先の提示を担当します。",
  },
  {
    kind: "explain",
    selector: ".autopilot-level-grid > button:nth-child(3)",
    title: "Lv.2 半自動：人が承認して実行",
    body: "Lv.2ではシステムが対応候補を作り、管制担当が内容を確認してから実行します。『何をすべきか探す』部分をシステムに任せつつ、最終判断は人が持つ運用です。",
    note: "本番で安全性と省力化を両立したい場合の中心になるレベルです。",
  },
  {
    kind: "explain",
    selector: ".autopilot-level-grid > button:nth-child(4)",
    title: "Lv.3 自動：安全な復旧だけ自動化",
    body: "Lv.3では、カメラ再起動や未送信データの再同期など、影響範囲を限定できる復旧操作を自動実行できます。同じ異常に対して何度も連続実行しないよう、原則1回だけ処理します。",
    caution: "受付停止・受付再開など運用へ直接影響する操作は、Lv.3でも人の確認なしには自動実行しません。",
  },
  {
    kind: "explain",
    selector: ".autopilot-lab-panel",
    title: "『現在の判断』がオートパイロットの頭脳",
    body: "ここには、いま検知している異常と、それに対してシステムが考えている対応が表示されます。問題がなければ正常表示、問題があれば優先して確認すべき内容や操作候補が並びます。",
    note: "レベルによって、ここに出た判断が『提案だけ』『承認待ち』『安全なものだけ自動実行』へ変わります。",
  },
  {
    kind: "explain",
    selector: ".predictive-radar-panel",
    title: "異常予兆レーダー：障害になる前の変化を見る",
    body: "異常予兆レーダーは、いま故障しているかだけを見るのではなく、直近約5分の通信遅延・通信速度・同期待ち・端末の応答間隔などの変化をまとめて、悪化の兆候を早めに見つけるための表示です。スコアが上がっている端末ほど、先に状態を確認する優先度が高いと考えます。",
    note: "このリスクスコアは『故障する確率』ではありません。観測値の悪化傾向をまとめた注意指標なので、急に上がった時や高い状態が続く時に重点確認します。",
  },
  {
    kind: "explain",
    selector: ".correlation-panel",
    title: "異常相関分析：複数の症状をつないで原因を絞る",
    body: "異常相関分析は、入口と出口の通信・同期・カメラなどを横断して比べます。たとえば入口と出口が同じ時間帯に悪化していれば共通Wi-FiやFirebaseなどの共通経路を疑い、片側だけならその端末固有の問題を優先して疑います。症状を1件ずつ見るのではなく、『何から確認すべきか』を絞るための機能です。",
    note: "相関が強いからといって原因を100%断定するものではありません。表示された推定と根拠を見て、共通障害か端末固有かを切り分けるために使います。",
  },
  {
    kind: "explain",
    selector: ".lab-guardrail-grid article:nth-child(1)",
    title: "自動実行してよい範囲",
    body: "自動化するのは、失敗しても受付全体を止めにくい復旧操作に限定しています。現在はカメラ再起動と、未送信データの再同期が主な対象です。",
  },
  {
    kind: "explain",
    selector: ".lab-guardrail-grid article:nth-child(2)",
    title: "人の承認が必要な操作",
    body: "受付停止・受付再開・定員やイベント設定の変更など、運用そのものへ影響する操作は人が確認します。自動化レベルを上げても、この安全線は越えない設計です。",
  },
  {
    kind: "explain",
    selector: ".lab-guardrail-grid article:nth-child(3)",
    title: "システムにもできないことがある",
    body: "受付端末が完全に通信切断している場合、管制側から命令を送ること自体ができません。この場合は遠隔復旧ではなく、現地で端末やWi-Fiを確認する必要があります。",
    note: "『管制から見える＝遠隔操作できる』ではなく、通信できていることが前提です。",
  },
  {
    kind: "explain",
    selector: ".lab-emergency-stop",
    title: "緊急停止は最後の安全装置",
    body: "動作がおかしい、想定外の提案が続くなど、オートパイロットをすぐ止めたい時はこのボタンでOFFへ戻せます。通常の受付や管制監視を止めるボタンではなく、自動運転部分を止めるためのものです。",
    caution: "これは実際に設定をOFFへ変更するボタンです。ガイド中は押さないでください。",
  },
];

function findMenuButton(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".sidebar nav button"))
    .find((button) => button.textContent?.includes(label)) ?? null;
}

function resolveTarget(step: LabStep) {
  if (step.kind === "menu" && step.menuLabel !== undefined) return findMenuButton(step.menuLabel);
  if (step.selector !== undefined) return document.querySelector<HTMLElement>(step.selector);
  return null;
}

export default function DetailedLabTutorial() {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetReady, setTargetReady] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);

  const completed = stepIndex >= LAB_STEPS.length;
  const step = LAB_STEPS[stepIndex];
  const progress = useMemo(
    () => completed ? 100 : Math.round(((stepIndex + 1) / LAB_STEPS.length) * 100),
    [completed, stepIndex]
  );

  useEffect(() => {
    const start = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail !== "lab") return;
      event.stopImmediatePropagation();
      setStepIndex(0);
      setTargetReady(false);
      setTargetMissing(false);
      setActive(true);
    };

    window.addEventListener("control-tutorial:start", start, { capture: true });
    return () => window.removeEventListener("control-tutorial:start", start, { capture: true });
  }, []);

  useEffect(() => {
    if (!active || completed || step === undefined) return undefined;

    let target: HTMLElement | null = null;
    let retryTimer: number | null = null;
    let advanceTimer: number | null = null;
    let attempts = 0;

    const clean = () => {
      if (target !== null) {
        target.classList.remove("lab-tutorial-highlight");
        if (step.kind === "menu") target.removeEventListener("click", onMenuClick);
      }
      target = null;
    };

    const onMenuClick = () => {
      clean();
      setTargetReady(false);
      setTargetMissing(false);
      advanceTimer = window.setTimeout(() => setStepIndex((current) => current + 1), 420);
    };

    const attach = () => {
      attempts += 1;
      target = resolveTarget(step);
      if (target === null) {
        if (step.kind === "explain" && attempts >= 14) {
          setTargetMissing(true);
          setTargetReady(true);
          return;
        }
        retryTimer = window.setTimeout(attach, 130);
        return;
      }

      target.classList.add("lab-tutorial-highlight");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setTargetMissing(false);
      setTargetReady(true);
      if (step.kind === "menu") target.addEventListener("click", onMenuClick, { once: true });
    };

    retryTimer = window.setTimeout(attach, step.kind === "explain" ? 360 : 60);

    return () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      if (advanceTimer !== null) window.clearTimeout(advanceTimer);
      clean();
    };
  }, [active, completed, step, stepIndex]);

  const close = () => {
    setActive(false);
    setStepIndex(0);
    setTargetReady(false);
    setTargetMissing(false);
  };

  const next = () => {
    if (step?.kind !== "explain") return;
    setTargetReady(false);
    setTargetMissing(false);
    setStepIndex((current) => current + 1);
  };

  const restart = () => {
    setStepIndex(0);
    setTargetReady(false);
    setTargetMissing(false);
  };

  if (!active) return null;

  return (
    <>
      <style>{`
        .lab-tutorial-card{position:fixed!important;right:max(16px,env(safe-area-inset-right))!important;bottom:max(16px,env(safe-area-inset-bottom))!important;z-index:2147483646!important;width:min(500px,calc(100vw - 32px))!important;max-height:min(72dvh,680px)!important;overflow:auto!important;padding:19px!important;border:1px solid rgba(255,255,255,.95)!important;border-radius:22px!important;background:rgba(255,255,255,.985)!important;color:#172033!important;box-shadow:0 24px 70px rgba(20,17,45,.34)!important;box-sizing:border-box!important}
        .lab-tutorial-meta{display:flex!important;justify-content:space-between!important;gap:12px!important;color:#6950c7!important;font-size:11px!important;font-weight:900!important;letter-spacing:.08em!important}.lab-tutorial-card h2{margin:8px 0 0!important;font-size:23px!important;line-height:1.3!important}.lab-tutorial-card p{margin:10px 0 0!important;color:#566176!important;font-size:14px!important;line-height:1.7!important}.lab-tutorial-note,.lab-tutorial-caution,.lab-tutorial-missing{padding:10px 12px!important;border-radius:12px!important;font-size:12px!important;font-weight:750!important}.lab-tutorial-note{background:#f1effb!important;color:#5946a4!important}.lab-tutorial-caution{background:#fff2df!important;color:#855000!important}.lab-tutorial-missing{background:#fff7e8!important;color:#805600!important}.lab-tutorial-instruction{padding:10px 12px!important;border-left:4px solid #7352d6!important;border-radius:10px!important;background:#f8f7fc!important;color:#313849!important;font-weight:850!important}.lab-tutorial-progress{height:7px!important;margin-top:14px!important;overflow:hidden!important;border-radius:999px!important;background:#ebe8f6!important}.lab-tutorial-progress>span{display:block!important;height:100%!important;background:#7352d6!important}.lab-tutorial-actions{display:flex!important;gap:9px!important;flex-wrap:wrap!important;margin-top:14px!important}.lab-tutorial-actions button{min-height:42px!important;padding:8px 14px!important;border:1px solid #d8d2e9!important;border-radius:12px!important;background:#f6f4fb!important;color:#3f4654!important;font:inherit!important;font-weight:850!important}.lab-tutorial-actions .primary{border-color:#7352d6!important;background:#7352d6!important;color:#fff!important}.lab-tutorial-actions button:disabled{opacity:.5!important}.lab-tutorial-highlight{position:relative!important;z-index:2147483645!important;outline:4px solid #9d80ff!important;outline-offset:5px!important;box-shadow:0 0 0 10px rgba(145,111,239,.16),0 0 38px rgba(115,82,214,.72)!important;animation:labTutorialPulse 1.05s ease-in-out infinite!important}@keyframes labTutorialPulse{0%,100%{box-shadow:0 0 0 8px rgba(145,111,239,.14),0 0 24px rgba(115,82,214,.45)}50%{box-shadow:0 0 0 13px rgba(145,111,239,.07),0 0 42px rgba(115,82,214,.75)}}@media(max-width:760px){.lab-tutorial-card{right:12px!important;width:calc(100vw - 24px)!important;max-height:78dvh!important}}
      `}</style>

      <section className="lab-tutorial-card" aria-live="polite">
        {completed ? (
          <>
            <div className="lab-tutorial-meta"><span>CONTROL LAB TRAINING</span><span>{LAB_STEPS.length} / {LAB_STEPS.length}</span></div>
            <h2>管制ラボの考え方まで確認できました</h2>
            <p>レベルの違いに加えて、現在の判断、異常予兆レーダー、異常相関分析、自動実行できる範囲、人が承認する範囲、通信断時の限界、緊急停止の意味まで確認しました。</p>
            <div className="lab-tutorial-progress"><span style={{ width: "100%" }} /></div>
            <div className="lab-tutorial-actions"><button type="button" onClick={restart}>もう一度</button><button type="button" className="primary" onClick={close}>終了</button></div>
          </>
        ) : step !== undefined ? (
          <>
            <div className="lab-tutorial-meta"><span>試験機能 · 管制ラボ</span><span>{stepIndex + 1} / {LAB_STEPS.length}</span></div>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
            {step.note !== undefined && <p className="lab-tutorial-note">{step.note}</p>}
            {step.caution !== undefined && <p className="lab-tutorial-caution">注意：{step.caution}</p>}
            {targetMissing && <p className="lab-tutorial-missing">この項目は現在の画面には表示されていません。このまま説明だけ確認して次へ進めます。</p>}
            <p className="lab-tutorial-instruction">{step.kind === "menu" ? "紫色に光っている『管制ラボ』を押してください。" : targetMissing ? "現在は実物がないため、そのまま次へ進めます。" : targetReady ? "紫色に光っている実物が、いま説明している場所です。触らずに内容を確認してください。" : "説明する場所を探しています…"}</p>
            <div className="lab-tutorial-progress"><span style={{ width: `${progress}%` }} /></div>
            <div className="lab-tutorial-actions">
              <button type="button" onClick={close}>終了</button>
              {step.kind === "explain" && <button type="button" className="primary" disabled={!targetReady} onClick={next}>{targetMissing ? "スキップして次へ" : "次へ"}</button>}
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}
