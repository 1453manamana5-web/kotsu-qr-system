import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import type { AdminGuideMode } from "./pages/ReceptionGuidePage";

import "./admin-mode-guide.css";

type GuideStep = {
  id: string;
  kind: "click" | "explain";
  selector: string;
  title: string;
  body: string;
  note?: string;
  caution?: string;
};

type GuideDefinition = {
  label: string;
  eyebrow: string;
  steps: readonly GuideStep[];
};

const GUIDE_DEFINITIONS: Record<AdminGuideMode, GuideDefinition> = {
  events: {
    label: "イベント管理",
    eyebrow: "EVENT MANAGEMENT",
    steps: [
      {
        id: "events-open",
        kind: "click",
        selector: ".admin-events-card",
        title: "イベント管理を開く",
        body: "イベントの作成・現在イベントの設定・終了・削除はここから行います。青く光っている『イベント管理』を押してください。",
      },
      {
        id: "events-summary",
        kind: "explain",
        selector: ".event-management-summary",
        title: "まず開催状態を確認",
        body: "上部には開催中・開催前・終了の件数と、新規イベント作成ボタンがあります。本番前は、想定しているイベントが『開催前』または『開催中』として存在するか確認します。",
      },
      {
        id: "events-create-open",
        kind: "click",
        selector: ".create-event-button",
        title: "新しいイベントを作る画面",
        body: "新しい文化祭や試験イベントを登録するときに使います。ボタンを押して、入力画面だけ確認します。ここではまだイベントは作成しません。",
      },
      {
        id: "events-create-fields",
        kind: "explain",
        selector: ".create-event-form-panel",
        title: "イベント名・日付・受付時間を入力",
        body: "イベント名、開催日、受付開始時刻、受付終了時刻の4項目を入力します。受付終了時刻は開始時刻より後である必要があります。",
        note: "同じイベント名は重複して作れません。年を付けるなどして区別します。",
      },
      {
        id: "events-create-preview",
        kind: "explain",
        selector: ".create-event-preview",
        title: "作成前に右側のプレビューを確認",
        body: "入力したイベント名・日付・受付時間がここに反映されます。作成する前に、日付や時刻の入力ミスがないか確認します。",
      },
      {
        id: "events-create-submit",
        kind: "explain",
        selector: ".create-event-submit",
        title: "『イベントを作成する』は最後に押す",
        body: "4項目が正しく入力されると作成ボタンが有効になります。押すとFirebaseのイベント一覧へ新しいイベントが追加されます。",
        caution: "このガイドでは押しません。作成すると共有データが実際に増えます。",
      },
      {
        id: "events-create-back",
        kind: "click",
        selector: ".create-event-back",
        title: "イベント管理へ戻る",
        body: "入力せずにイベント管理へ戻ります。青く光っている戻るボタンを押してください。",
      },
      {
        id: "events-list",
        kind: "explain",
        selector: ".event-list-section",
        title: "登録済みイベントの一覧",
        body: "現在のイベント、開催日時、開催状態を一覧で確認できます。『現在のイベント』ラベルが付いているものが受付で実際に使用されます。",
      },
      {
        id: "events-detail-open",
        kind: "click",
        selector: ".event-list-card",
        title: "イベント詳細を開く",
        body: "登録済みイベントを押すと詳細操作が開きます。イベントが1件以上ある場合は、青く光っているカードを押してください。",
      },
      {
        id: "events-detail-actions",
        kind: "explain",
        selector: ".event-detail-actions",
        title: "現在イベントの設定・強制終了・削除",
        body: "ここで受付に使うイベントを設定できます。『強制終了』は入場中の来場者と部員を退出扱いにし、『削除』はイベント一覧から完全に削除します。",
        caution: "強制終了と削除は本番データへ大きく影響します。ガイド中は押さず、実行前に対象イベント名を必ず確認してください。",
      },
      {
        id: "events-detail-close",
        kind: "click",
        selector: ".event-detail-close",
        title: "詳細を閉じる",
        body: "イベント詳細を閉じます。青く光っている『閉じる』を押してください。",
      },
      {
        id: "events-back",
        kind: "click",
        selector: ".event-management-back",
        title: "管理モードへ戻る",
        body: "イベント管理の説明は完了です。管理モードへ戻ります。",
      },
    ],
  },
  members: {
    label: "部員管理",
    eyebrow: "MEMBER MANAGEMENT",
    steps: [
      {
        id: "members-open",
        kind: "click",
        selector: ".admin-members-card",
        title: "部員管理を開く",
        body: "部員QR、今年の部員名、入退室状態、印刷を管理します。青く光っている『部員管理』を押してください。",
      },
      {
        id: "members-summary",
        kind: "explain",
        selector: ".members-summary",
        title: "登録状況を確認",
        body: "QR登録数、名前設定済み人数、現在入室中の部員人数が表示されます。本番前は、必要な部員QRと名前がそろっているか確認します。",
      },
      {
        id: "members-add-open",
        kind: "click",
        selector: ".members-add-button",
        title: "部員QRの新規発行",
        body: "新しい部員QRを追加するときの画面を開きます。ここでは画面だけ確認し、発行はしません。",
      },
      {
        id: "members-add-modal",
        kind: "explain",
        selector: ".members-add-modal",
        title: "QR番号は自動発行、名前は後からでも設定可能",
        body: "新しい部員番号と認証用QRが自動で準備されます。名前はこのイベント用なので、空欄のままQRだけ発行して後から設定することもできます。",
        caution: "『QRを新規発行』を押すと共有の部員QR台帳へ実際に追加されます。",
      },
      {
        id: "members-add-cancel",
        kind: "click",
        selector: ".members-cancel-button",
        title: "発行せず閉じる",
        body: "今回は練習なのでキャンセルします。",
      },
      {
        id: "members-bulk",
        kind: "explain",
        selector: ".members-bulk-edit-button",
        title: "今年の部員名をまとめて変更",
        body: "QR番号は引き継ぎつつ、そのイベントで表示する部員名だけをまとめて入力できます。年度が変わったときの準備に便利です。",
      },
      {
        id: "members-design",
        kind: "explain",
        selector: ".members-design-button",
        title: "部員QRのデザインとまとめて印刷",
        body: "部員QRカードのデザインを整え、複数枚をまとめて印刷するときに使います。",
      },
      {
        id: "members-search",
        kind: "explain",
        selector: ".members-list-tools",
        title: "名前・QR番号で検索",
        body: "部員が多いときは検索欄から名前やQR番号を絞り込めます。",
      },
      {
        id: "members-table",
        kind: "explain",
        selector: ".members-table-wrapper",
        title: "名前と入退室状態はここで確認",
        body: "一覧ではQR番号、部員名、現在の状態を確認できます。名前や状態を変更するとFirebaseへ保存されます。QR表示から個別QRも確認できます。",
        caution: "『QR削除』は今後のイベントでもそのQRを使えなくする操作です。対象を間違えないよう注意してください。",
      },
      {
        id: "members-back",
        kind: "click",
        selector: ".members-return-button",
        title: "管理モードへ戻る",
        body: "部員管理の説明は完了です。管理モードへ戻ります。",
      },
    ],
  },
  tickets: {
    label: "チケット管理",
    eyebrow: "TICKET MANAGEMENT",
    steps: [
      {
        id: "tickets-open",
        kind: "click",
        selector: ".admin-tickets-card",
        title: "チケット管理を開く",
        body: "来場者用チケットの発行・印刷・状態確認を行います。青く光っている『チケット管理』を押してください。",
      },
      {
        id: "tickets-summary",
        kind: "explain",
        selector: ".tickets-summary-panel",
        title: "まずチケット全体の状態を見る",
        body: "未使用・入場中・使用済み・無効の枚数を確認できます。本番中に数が不自然なときは、受付やチケット状態を確認する手掛かりになります。",
      },
      {
        id: "tickets-create-open",
        kind: "click",
        selector: ".tickets-create-button",
        title: "チケット新規発行の画面",
        body: "来場者用QRチケットをまとめて追加するときに使います。画面だけ確認するため、ボタンを押してください。",
      },
      {
        id: "tickets-create-window",
        kind: "explain",
        selector: ".tickets-create-window",
        title: "発行枚数と番号範囲を確認",
        body: "発行枚数を指定すると、作成される最初と最後のチケット番号が表示されます。大量発行する前に枚数と番号範囲を確認します。",
      },
      {
        id: "tickets-create-confirm",
        kind: "explain",
        selector: ".tickets-create-confirm",
        title: "発行ボタンで共有データが作成される",
        body: "『チケットを発行』を押すと、指定枚数のQRチケットがFirebaseへ保存され、受付端末へ反映されます。",
        caution: "このガイドでは押しません。不要なチケットを発行しないよう、枚数を確認してから実行してください。",
      },
      {
        id: "tickets-create-cancel",
        kind: "click",
        selector: ".tickets-create-cancel",
        title: "発行せず閉じる",
        body: "今回は練習なのでキャンセルします。",
      },
      {
        id: "tickets-design",
        kind: "explain",
        selector: ".tickets-design-button",
        title: "デザイン・まとめて印刷",
        body: "発行済みチケットにデザインを合わせて、QR付きチケットをまとめて印刷するときに使います。",
      },
      {
        id: "tickets-tools",
        kind: "explain",
        selector: ".tickets-list-tools",
        title: "QR番号検索と状態フィルター",
        body: "特定のチケットを探すときはQR番号検索、状態別に絞るときはフィルターを使います。",
      },
      {
        id: "tickets-table",
        kind: "explain",
        selector: ".tickets-table-wrapper",
        title: "個別チケットの状態と操作",
        body: "一覧では状態を確認・変更でき、QR表示、無効化、有効化、削除も行えます。状態変更は受付の判定にも反映されます。",
        caution: "本番中の手動状態変更・無効化・削除は受付結果へ影響します。QR番号を確認してから操作してください。",
      },
      {
        id: "tickets-back",
        kind: "click",
        selector: ".tickets-return-button",
        title: "管理モードへ戻る",
        body: "チケット管理の説明は完了です。管理モードへ戻ります。",
      },
    ],
  },
  settings: {
    label: "設定",
    eyebrow: "SETTINGS",
    steps: [
      {
        id: "settings-open",
        kind: "click",
        selector: ".admin-settings-card",
        title: "設定を開く",
        body: "受付画面、端末設定、バックアップ、初期化などシステム全体に関わる項目があります。青く光っている『設定』を押してください。",
      },
      {
        id: "settings-system",
        kind: "explain",
        selector: ".settings-system-section",
        title: "バージョンと現在イベントを確認",
        body: "現在のアプリバージョンと設定中のイベントを確認できます。アップデート後に表示が変わったときは、まずここでバージョンを確認します。",
      },
      {
        id: "settings-reception",
        kind: "explain",
        selector: ".settings-reception-section",
        title: "入口・出口・受付終了へ直接切り替え",
        body: "この端末を入口受付、出口受付へ切り替えたり、ホームへ戻して受付を終了できます。",
        caution: "ボタンを押すとその画面へ実際に移動するので、本番中は端末の役割を確認してから変更してください。",
      },
      {
        id: "settings-device",
        kind: "explain",
        selector: ".settings-device-section",
        title: "端末名と受付音の設定",
        body: "この端末の表示名、受付成功音、受付エラー音を設定します。端末名は現場で見分けやすい名前にしておくと管理しやすくなります。",
      },
      {
        id: "settings-data",
        kind: "explain",
        selector: ".settings-data-section",
        title: "バックアップ・復元・部員状態リセット",
        body: "完全バックアップはイベント、チケット、部員、受付履歴などをJSONへ保存します。復元はFirestoreの共有データをバックアップ時点へ戻します。",
        caution: "バックアップにはQR認証情報が含まれます。復元や部員状態リセットは本番データを変更するため、実行前に対象を確認してください。",
      },
      {
        id: "settings-danger",
        kind: "explain",
        selector: ".settings-danger-section",
        title: "初期化は最も危険な操作",
        body: "データ初期化はイベントや部員QR、設定などを削除します。通常の受付中に使う操作ではありません。",
        caution: "部長や顧問など責任者に確認したうえで実行し、ガイド中は絶対に押さないでください。",
      },
      {
        id: "settings-back",
        kind: "click",
        selector: ".settings-return-button",
        title: "管理モードへ戻る",
        body: "設定の説明は完了です。管理モードへ戻ります。",
      },
    ],
  },
  devices: {
    label: "端末管理",
    eyebrow: "DEVICE MANAGEMENT",
    steps: [
      {
        id: "devices-open",
        kind: "click",
        selector: ".admin-devices-card",
        title: "端末管理を開く",
        body: "部員端末・受付専用端末の利用申請、登録済み端末、操作履歴を管理します。青く光っている『端末管理』を押してください。",
      },
      {
        id: "devices-summary",
        kind: "explain",
        selector: ".device-management-summary",
        title: "承認待ちと登録台数を確認",
        body: "承認待ち件数、部員端末、受付専用端末、この端末の名前が表示されます。新しい端末を追加するときは承認待ちが増えているか確認します。",
      },
      {
        id: "devices-requests",
        kind: "explain",
        selector: ".device-management-requests-panel",
        title: "利用申請を承認・却下",
        body: "新しい端末から申請が来るとここに表示されます。端末名・申請者・端末種別を確認してから承認します。管制アプリの連携申請がある場合は連携コード欄もここに表示されます。",
        caution: "承認するとその端末がすぐ利用可能になります。知らない端末や不明な申請は承認しないでください。",
      },
      {
        id: "devices-audit",
        kind: "explain",
        selector: ".device-management-audit-panel",
        title: "操作履歴で誰が何をしたか確認",
        body: "申請、承認、却下、端末名変更、削除などの履歴が時系列で残ります。端末管理で何かおかしいときの確認に使います。",
      },
      {
        id: "devices-registered",
        kind: "explain",
        selector: ".device-management-devices-panel",
        title: "登録済み端末を確認",
        body: "利用可能な端末が一覧表示され、この端末は一番上に『この端末』として表示されます。自分の端末だけ端末名を変更できます。",
      },
      {
        id: "devices-actions",
        kind: "explain",
        selector: ".device-management-device-actions",
        title: "端末名変更と端末削除",
        body: "自分の端末では名前変更、他の端末では削除が表示されます。削除された端末は再び利用申請が必要になります。",
        caution: "本番中の受付端末を誤って削除すると再申請が必要になるため、対象端末名を必ず確認してください。",
      },
      {
        id: "devices-back",
        kind: "click",
        selector: ".device-management-back",
        title: "管理モードへ戻る",
        body: "端末管理の説明は完了です。管理モードへ戻ります。",
      },
    ],
  },
};

function isAdminGuideMode(value: unknown): value is AdminGuideMode {
  return value === "events" ||
    value === "members" ||
    value === "tickets" ||
    value === "settings" ||
    value === "devices";
}

export default function AdminModeGuideBridge() {
  const [mode, setMode] = useState<AdminGuideMode | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetReady, setTargetReady] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);

  const definition = mode === null ? null : GUIDE_DEFINITIONS[mode];
  const steps = definition?.steps ?? [];
  const completed = mode !== null && stepIndex >= steps.length;
  const step = steps[stepIndex];
  const progress = useMemo(
    () => completed
      ? 100
      : steps.length === 0
        ? 0
        : Math.round(((stepIndex + 1) / steps.length) * 100),
    [completed, stepIndex, steps.length]
  );

  useEffect(() => {
    const handleStart = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;

      if (!isAdminGuideMode(detail)) {
        return;
      }

      setMode(detail);
      setStepIndex(0);
      setTargetReady(false);
      setTargetMissing(false);
    };

    window.addEventListener("admin-guide:start", handleStart);

    return () => {
      window.removeEventListener("admin-guide:start", handleStart);
    };
  }, []);

  useEffect(() => {
    if (mode === null || completed || step === undefined) {
      return undefined;
    }

    let target: HTMLElement | null = null;
    let retryTimer: number | null = null;
    let advanceTimer: number | null = null;
    let attempts = 0;

    const clean = () => {
      if (target !== null) {
        target.classList.remove("admin-mode-tutorial-highlight");

        if (step.kind === "click") {
          target.removeEventListener("click", onTargetClick);
        }
      }

      target = null;
    };

    const advance = (delay = 320) => {
      clean();
      setTargetReady(false);
      setTargetMissing(false);
      advanceTimer = window.setTimeout(
        () => setStepIndex((current) => current + 1),
        delay
      );
    };

    const onTargetClick = () => {
      advance(430);
    };

    const attach = () => {
      attempts += 1;
      target = document.querySelector<HTMLElement>(step.selector);

      if (target === null) {
        if (attempts >= 26) {
          setTargetReady(true);
          setTargetMissing(true);
          return;
        }

        retryTimer = window.setTimeout(attach, 140);
        return;
      }

      target.classList.add("admin-mode-tutorial-highlight");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setTargetReady(true);
      setTargetMissing(false);

      if (step.kind === "click") {
        target.addEventListener("click", onTargetClick, { once: true });
      }
    };

    retryTimer = window.setTimeout(attach, 180);

    return () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }

      if (advanceTimer !== null) {
        window.clearTimeout(advanceTimer);
      }

      clean();
    };
  }, [completed, mode, step, stepIndex]);

  const close = () => {
    setMode(null);
    setStepIndex(0);
    setTargetReady(false);
    setTargetMissing(false);
  };

  const next = () => {
    if (step?.kind !== "explain") {
      return;
    }

    setTargetReady(false);
    setTargetMissing(false);
    setStepIndex((current) => current + 1);
  };

  const skip = () => {
    setTargetReady(false);
    setTargetMissing(false);
    setStepIndex((current) => current + 1);
  };

  const restart = () => {
    setStepIndex(0);
    setTargetReady(false);
    setTargetMissing(false);
  };

  if (mode === null || definition === null) {
    return null;
  }

  return createPortal(
    <section className="admin-mode-tutorial-card" aria-live="polite">
      {completed ? (
        <>
          <div className="admin-mode-tutorial-meta">
            <span>{definition.eyebrow}</span>
            <span>{steps.length} / {steps.length}</span>
          </div>

          <h2>{definition.label}の使い方を確認できました</h2>
          <p>危険な操作は実行せず、実際の画面で場所と意味だけを確認しました。本番では対象のイベント・QR番号・端末名を確認してから操作してください。</p>

          <div className="admin-mode-tutorial-progress">
            <span style={{ width: "100%" }} />
          </div>

          <div className="admin-mode-tutorial-actions">
            <button type="button" onClick={restart}>もう一度</button>
            <button type="button" className="primary" onClick={close}>終了</button>
          </div>
        </>
      ) : step !== undefined ? (
        <>
          <div className="admin-mode-tutorial-meta">
            <span>{definition.label} · 実地ガイド</span>
            <span>{stepIndex + 1} / {steps.length}</span>
          </div>

          <h2>{step.title}</h2>
          <p>{step.body}</p>

          {step.note !== undefined && (
            <p className="admin-mode-tutorial-note">{step.note}</p>
          )}

          {step.caution !== undefined && (
            <p className="admin-mode-tutorial-caution">注意：{step.caution}</p>
          )}

          {targetMissing && (
            <p className="admin-mode-tutorial-missing">この項目は現在の状態では表示されていません。登録データの有無などで表示が変わる項目なので、この手順だけ飛ばせます。</p>
          )}

          <p className="admin-mode-tutorial-instruction">
            {targetMissing
              ? "この手順をスキップして次へ進めます。"
              : step.kind === "click"
                ? targetReady
                  ? "青く光っている実物を押してください。押すと自動で次へ進みます。"
                  : "操作する場所を探しています…"
                : targetReady
                  ? "青く光っている実物が説明中の場所です。確認して『次へ』を押してください。"
                  : "説明する場所を探しています…"}
          </p>

          <div className="admin-mode-tutorial-progress">
            <span style={{ width: `${progress}%` }} />
          </div>

          <div className="admin-mode-tutorial-actions">
            <button type="button" onClick={close}>終了</button>

            {targetMissing && (
              <button type="button" className="primary" onClick={skip}>スキップして次へ</button>
            )}

            {!targetMissing && step.kind === "explain" && (
              <button type="button" className="primary" disabled={!targetReady} onClick={next}>次へ</button>
            )}
          </div>
        </>
      ) : null}
    </section>,
    document.body
  );
}
