import { useEffect, useMemo, useState } from "react";

type Step = {
  kind: "menu" | "explain";
  menuLabel?: string;
  selector?: string;
  text?: string;
  closest?: string;
  title: string;
  body: string;
  note?: string;
};

const STEPS: readonly Step[] = [
  { kind: "menu", menuLabel: "ライブ運行", title: "まずライブ運行を開く", body: "左の『ライブ運行』を押してください。押したあと、画面が切り替わってから中身を1つずつ説明します。" },
  { kind: "explain", selector: ".summary-grid article:nth-child(1)", title: "現在の会場内", body: "ここが今この瞬間に会場内にいる人数です。来場者だけでなく、会場内にいる部員も含めて現在人数を把握するための数字です。", note: "本番中に『今何人いる？』となったら最初にここを見ます。" },
  { kind: "explain", selector: ".summary-grid article:nth-child(2)", title: "5分後の予測", body: "直近の入退場ペースなどから、5分後に何人くらいになりそうかを出しています。現在人数だけでは分からない『このあと増えそうか減りそうか』を見る表示です。" },
  { kind: "explain", selector: ".live-map-panel", title: "会場ライブ運行", body: "ここでは入口と出口の受付端末、入場・退場ペース、Firebaseの接続状態をまとめて見られます。どちら側で人の流れが強いか、受付端末が生きているかを1か所で確認できます。" },
  { kind: "explain", selector: ".forecast-chart", title: "人数推移と予測グラフ", body: "これまでの人数推移と、この先の人数見込みを重ねて見るグラフです。定員線との距離も含め、今後の余裕を視覚的に確認できます。" },
  { kind: "menu", menuLabel: "端末", title: "次に端末を開く", body: "左の『端末』を押してください。ここから受付iPadそのものの状態を見ていきます。" },
  { kind: "explain", selector: ".all-device-grid", title: "受付端末一覧", body: "ここに現在稼働している入口・出口iPadが並びます。まず何台見えているかと、それぞれの状態を確認します。", note: "端末が0台でも正常にチュートリアルを続けられます。入口か出口が消えている場合は、通信断や受付アプリ停止の可能性があります。" },
  { kind: "explain", text: "最終通信", closest: ".device-card", title: "最終通信を見る", body: "『最終通信』は、そのiPadから最後に状態が届いた時刻です。数秒前なら正常です。時間が大きく空いている場合は、その端末のWi-Fiや受付画面を確認します。", note: "現在オンラインの端末がない場合、この項目は表示されないため自動的にスキップ可能になります。" },
  { kind: "explain", text: "Firebase応答", closest: ".device-card", title: "Firebase応答を見る", body: "これは受付端末とサーバーの応答速度です。数字が大きくなり続ける場合、通信が不安定な可能性があります。", note: "現在オンラインの端末がない場合、この項目は表示されないため自動的にスキップ可能になります。" },
  { kind: "menu", menuLabel: "障害履歴", title: "障害履歴を開く", body: "左の『障害履歴』を押してください。異常をまとめて確認する場所を見ます。" },
  { kind: "explain", selector: ".alert-list", title: "現在の異常・注意", body: "ここに管制が検知した通信断、カメラエラー、同期待ち、受付停止、バージョン不一致などが並びます。0件なら現在検知中の異常はありません。", note: "何かおかしいけど原因が分からないときは、まずここを見ると確認先を絞れます。" },
  { kind: "menu", menuLabel: "管制ラボ", title: "管制ラボを開く", body: "左の『管制ラボ』を押してください。自動運転の状態と判断範囲を確認します。" },
  { kind: "explain", selector: ".lab-status-hero", title: "現在の自動運転レベル", body: "ここが現在の自動運転レベルです。OFF、Lv.1支援、Lv.2半自動、Lv.3自動のどこで動いているかと、現在の判断対象件数を確認できます。" },
  { kind: "explain", selector: ".autopilot-level-grid", title: "自動運転レベルの違い", body: "Lv.1は提案だけ、Lv.2は人の承認後に操作、Lv.3は安全な復旧操作を自動実行します。ここを押すと実際の設定が変わるので、チュートリアル中は見るだけでOKです。", note: "受付停止・受付再開のように運用へ直接影響する操作は、人の確認が必要です。" },
  { kind: "menu", menuLabel: "AI管制", title: "最後にAI管制を開く", body: "左の『AI管制』を押してください。ライブデータを文章で確認するコパイロット画面を見ます。" },
  { kind: "explain", selector: ".copilot-status-strip", title: "AI管制の状態表示", body: "ここにはAI管制が判断に使っている現在状態がまとまっています。会場や端末のライブデータをもとに質問への回答を組み立てます。" },
  { kind: "explain", selector: ".copilot-page", title: "管制コパイロット", body: "『今どんな状態？』『入口の通信を調べて』『一番確認すべきことは？』のように、そのまま文章で質問できます。遠隔操作につながる内容は、対象と操作内容を確認してから実行する仕組みです。", note: "現在は外部AIではなく、ライブデータとルール推論を使う疑似AIです。" },
];

function findMenuButton(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".sidebar nav button"))
    .find((button) => button.textContent?.includes(label)) ?? null;
}

function findTextTarget(text: string, closest?: string) {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("main *"));
  const found = candidates.find((element) => {
    const ownText = element.textContent?.trim() ?? "";
    return ownText.includes(text) && element.children.length <= 3;
  }) ?? null;
  if (found === null) return null;
  if (closest === undefined) return found;
  return found.closest<HTMLElement>(closest) ?? found;
}

function resolveTarget(step: Step) {
  if (step.kind === "menu" && step.menuLabel !== undefined) return findMenuButton(step.menuLabel);
  if (step.selector !== undefined) return document.querySelector<HTMLElement>(step.selector);
  if (step.text !== undefined) return findTextTarget(step.text, step.closest);
  return null;
}

export default function StandaloneTutorialGuideV3() {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetReady, setTargetReady] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);

  const completed = stepIndex >= STEPS.length;
  const step = STEPS[stepIndex];
  const progress = useMemo(
    () => completed ? 100 : Math.round(((stepIndex + 1) / STEPS.length) * 100),
    [completed, stepIndex]
  );

  useEffect(() => {
    if (!active || completed || step === undefined) return undefined;

    let target: HTMLElement | null = null;
    let retryTimer: number | null = null;
    let advanceTimer: number | null = null;
    let attempts = 0;

    const clean = () => {
      if (target !== null) {
        target.classList.remove("tutorial-v3-highlight");
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
        if (step.kind === "explain" && attempts >= 12) {
          setTargetMissing(true);
          setTargetReady(true);
          return;
        }
        retryTimer = window.setTimeout(attach, 130);
        return;
      }

      target.classList.add("tutorial-v3-highlight");
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

  const start = () => {
    setStepIndex(0);
    setTargetReady(false);
    setTargetMissing(false);
    setActive(true);
  };

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

  return <>
    <style>{`
      .tutorial-v3-launcher,.tutorial-v3-card{position:fixed!important;right:max(16px,env(safe-area-inset-right))!important;z-index:2147483646!important}
      .tutorial-v3-launcher{bottom:max(16px,env(safe-area-inset-bottom))!important;min-height:52px!important;padding:10px 18px!important;border:2px solid rgba(255,255,255,.9)!important;border-radius:999px!important;background:#7352d6!important;color:#fff!important;box-shadow:0 14px 36px rgba(41,27,94,.34)!important;font:inherit!important;font-weight:900!important;cursor:pointer!important}
      .tutorial-v3-card{bottom:max(16px,env(safe-area-inset-bottom))!important;width:min(470px,calc(100vw - 32px))!important;max-height:min(68dvh,620px)!important;overflow:auto!important;box-sizing:border-box!important;padding:18px!important;border:1px solid rgba(255,255,255,.94)!important;border-radius:22px!important;background:rgba(255,255,255,.98)!important;color:#172033!important;box-shadow:0 24px 70px rgba(20,17,45,.34)!important}
      .tutorial-v3-meta{display:flex!important;justify-content:space-between!important;gap:12px!important;color:#7352d6!important;font-size:12px!important;font-weight:900!important;letter-spacing:.08em!important}
      .tutorial-v3-card h2{margin:8px 0 0!important;font-size:23px!important;line-height:1.25!important}.tutorial-v3-card p{margin:10px 0 0!important;color:#556071!important;font-size:15px!important;line-height:1.7!important}
      .tutorial-v3-note{padding:10px 12px!important;border-radius:12px!important;background:#f2effb!important;color:#5e48aa!important;font-size:13px!important}.tutorial-v3-missing{padding:10px 12px!important;border-radius:12px!important;background:#fff7e8!important;color:#805600!important;font-size:13px!important;font-weight:800!important}.tutorial-v3-instruction{padding:10px 12px!important;border-left:4px solid #7352d6!important;border-radius:10px!important;background:#f8f7fc!important;color:#313849!important;font-weight:800!important}
      .tutorial-v3-progress{height:7px!important;margin-top:14px!important;overflow:hidden!important;border-radius:999px!important;background:#ece9f7!important}.tutorial-v3-progress>span{display:block!important;height:100%!important;border-radius:inherit!important;background:#7352d6!important}
      .tutorial-v3-actions{display:flex!important;gap:9px!important;margin-top:14px!important;flex-wrap:wrap!important}.tutorial-v3-actions button{min-height:42px!important;padding:8px 14px!important;border:1px solid #d8d2e9!important;border-radius:12px!important;background:#f6f4fb!important;color:#3f4654!important;font:inherit!important;font-weight:800!important;cursor:pointer!important}.tutorial-v3-actions .primary{border-color:#7352d6!important;background:#7352d6!important;color:#fff!important}.tutorial-v3-actions button:disabled{opacity:.5!important;cursor:default!important}
      .tutorial-v3-highlight{position:relative!important;z-index:2147483645!important;outline:4px solid #9d80ff!important;outline-offset:5px!important;box-shadow:0 0 0 10px rgba(145,111,239,.16),0 0 36px rgba(115,82,214,.7)!important;animation:tutorialV3Pulse 1.05s ease-in-out infinite!important}@keyframes tutorialV3Pulse{0%,100%{box-shadow:0 0 0 8px rgba(145,111,239,.14),0 0 24px rgba(115,82,214,.45)}50%{box-shadow:0 0 0 13px rgba(145,111,239,.07),0 0 40px rgba(115,82,214,.72)}}
      @media(max-width:760px){.tutorial-v3-card{width:calc(100vw - 24px)!important;right:12px!important}.tutorial-v3-launcher{right:12px!important}}
    `}</style>

    {!active && <button type="button" className="tutorial-v3-launcher" onClick={start}>？ 使い方</button>}

    {active && <section className="tutorial-v3-card" aria-live="polite">
      {completed ? <>
        <div className="tutorial-v3-meta"><span>TRAINING COMPLETE</span><span>{STEPS.length} / {STEPS.length}</span></div>
        <h2>実物を見ながら基本操作を確認できました</h2>
        <p>各画面の人数、予測、端末状態、障害、自動運転、AI管制の実物を順番に確認しました。</p>
        <div className="tutorial-v3-progress"><span style={{ width: "100%" }} /></div>
        <div className="tutorial-v3-actions"><button type="button" onClick={start}>もう一度</button><button type="button" className="primary" onClick={close}>終了</button></div>
      </> : step !== undefined ? <>
        <div className="tutorial-v3-meta"><span>{step.kind === "menu" ? "操作してください" : "実物を確認"}</span><span>{stepIndex + 1} / {STEPS.length}</span></div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {step.note !== undefined && <p className="tutorial-v3-note">{step.note}</p>}
        {targetMissing && <p className="tutorial-v3-missing">この項目は現在の画面には表示されていません。端末未接続など、現在の運用状態によって出ない項目です。このまま次へ進めます。</p>}
        <p className="tutorial-v3-instruction">{step.kind === "menu" ? "紫色に光っているメニューを押してください。" : targetMissing ? "現在は実物がないため、説明を確認して『次へ』を押してください。" : targetReady ? "紫色に光っている実物が、いま説明している場所です。" : "説明する場所を探しています…"}</p>
        <div className="tutorial-v3-progress"><span style={{ width: `${progress}%` }} /></div>
        <div className="tutorial-v3-actions">
          <button type="button" onClick={close}>終了</button>
          {step.kind === "explain" && <button type="button" className="primary" disabled={!targetReady} onClick={next}>{targetMissing ? "スキップして次へ" : "次へ"}</button>}
        </div>
      </> : null}
    </section>}
  </>;
}
