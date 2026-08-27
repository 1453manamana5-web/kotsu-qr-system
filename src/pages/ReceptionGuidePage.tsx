import OnlineStatus from "./OnlineStatus";

import "./ReceptionGuidePage.css";

export type AdminGuideMode =
  | "events"
  | "members"
  | "tickets"
  | "settings"
  | "devices";

type ReceptionGuidePageProps = {
  setPage: (page: string) => void;
  eventName: string;
  onStartTutorial: () => void;
  onStartAdminGuide: (mode: AdminGuideMode) => void;
};

type GuideItem = {
  number: string;
  title: string;
  lead: string;
  points: string[];
  tone: "blue" | "green" | "orange" | "purple" | "red" | "gray";
};

type AdminGuideItem = {
  mode: AdminGuideMode;
  title: string;
  description: string;
  requiresEvent: boolean;
};

const GUIDE_ITEMS: readonly GuideItem[] = [
  {
    number: "01",
    title: "受付の基本の流れ",
    lead: "ホームから入口受付または出口受付を選び、QRコードを読み取ります。",
    points: [
      "受付を始める前に、現在のイベント名とオンライン表示を確認します。",
      "来場者のQRコードをカメラにかざし、結果表示が出るまで待ちます。",
      "成功表示を確認してから次の人のQRコードを読み取ります。",
    ],
    tone: "blue",
  },
  {
    number: "02",
    title: "入口受付",
    lead: "入場する来場者を記録します。初回入場と再入場は自動で判定されます。",
    points: [
      "初回入場では来場者数と室内人数が増えます。",
      "再入場では来場者数を増やさず、室内人数だけを増やします。",
      "成功画面が出たら、そのまま次の来場者を案内します。",
    ],
    tone: "green",
  },
  {
    number: "03",
    title: "出口受付",
    lead: "退場する来場者を記録し、室内人数を正しく保ちます。",
    points: [
      "出口でQRコードを読むと、室内人数が1人分減ります。",
      "同じ人を続けて退出処理しないよう、画面の結果を確認します。",
      "再入場する場合も同じチケットをそのまま使えます。",
    ],
    tone: "orange",
  },
  {
    number: "04",
    title: "表示の見方",
    lead: "色とメッセージを見れば、その場で次にどう対応するか判断できます。",
    points: [
      "緑の成功表示は正常に記録できた状態です。",
      "再入場表示は初回来場者数を増やさずに入場を記録した状態です。",
      "赤いエラー表示や保存失敗が出た場合は、QRを何度も連続で読まず原因を確認します。",
    ],
    tone: "purple",
  },
  {
    number: "05",
    title: "管理モードへ入る",
    lead: "受付中の誤操作を防ぐため、イベント開催中は部員QR認証が必要です。",
    points: [
      "入口・出口受付から管理モードへ入る場合は部員QRを読み取ります。",
      "イベント開催中はホーム画面から管理モードへ入る場合も部員QR認証が必要です。",
      "認証後に管理画面を閉じると、入ってきた画面へ戻ります。",
    ],
    tone: "gray",
  },
  {
    number: "06",
    title: "困ったとき",
    lead: "QRが読めない・通信できない場合は、連続操作より状態確認を優先します。",
    points: [
      "QRが読めない場合は、QR全体をカメラに入れ、傾き・距離・画面の明るさを調整します。",
      "保存失敗や通信エラーでは、オンライン表示とWi-Fi接続を確認します。",
      "カメラが起動しない場合は画面を開き直し、それでも直らなければ管理担当へ連絡します。",
    ],
    tone: "red",
  },
];

const ADMIN_GUIDE_ITEMS: readonly AdminGuideItem[] = [
  {
    mode: "events",
    title: "イベント管理",
    description: "作成・現在イベント設定・終了・削除",
    requiresEvent: false,
  },
  {
    mode: "members",
    title: "部員管理",
    description: "部員QR・名前・状態・印刷",
    requiresEvent: true,
  },
  {
    mode: "tickets",
    title: "チケット管理",
    description: "発行・印刷・状態確認・無効化",
    requiresEvent: true,
  },
  {
    mode: "settings",
    title: "設定",
    description: "端末設定・バックアップ・初期化",
    requiresEvent: false,
  },
  {
    mode: "devices",
    title: "端末管理",
    description: "利用申請・登録端末・操作履歴",
    requiresEvent: false,
  },
];

function BackIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M25 16H8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 9L7 16L14 23" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GuideIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M15 10H42C47 10 51 14 51 19V51H24C19 51 15 47 15 42V10Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M24 51C24 45 28 41 34 41H51" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M26 21H41M26 29H41" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function PracticeIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 7H25V25H7Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M11 12H21M11 17H18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M19 21L22 24L27 18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ReceptionGuidePage({
  setPage,
  eventName,
  onStartTutorial,
  onStartAdminGuide,
}: ReceptionGuidePageProps) {
  const canPractice = eventName.trim() !== "";

  return (
    <div className="reception-guide-page">
      <header className="reception-guide-header">
        <div>
          <span className="reception-guide-eyebrow">RECEPTION GUIDE</span>
          <h1>使い方ガイド</h1>
          <p>受付で迷ったときに、基本操作と対応方法をここで確認できます。</p>
        </div>

        <div className="reception-guide-header-side">
          <OnlineStatus />
          <div className="reception-guide-event">
            <small>EVENT</small>
            <strong>{eventName || "イベント未設定"}</strong>
          </div>
        </div>
      </header>

      <main className="reception-guide-main">
        <section className="reception-guide-intro">
          <div className="reception-guide-intro-icon"><GuideIcon /></div>
          <div className="reception-guide-intro-copy">
            <small>START HERE</small>
            <h2>本番中は「結果を確認してから次の人へ」</h2>
            <p>QRが反応しても、成功・再入場・エラーのどれが表示されたかを確認してから次の受付へ進んでください。</p>
          </div>
          <div className="reception-guide-practice">
            <button
              type="button"
              className="reception-guide-practice-button"
              disabled={!canPractice}
              onClick={onStartTutorial}
            >
              <span><PracticeIcon /></span>
              <strong>受付を実際の画面で練習</strong>
              <small>{canPractice ? "入口・出口・管理者認証を確認" : "イベント設定後に利用できます"}</small>
            </button>
          </div>
        </section>

        <section className="reception-admin-guide-section">
          <div className="reception-admin-guide-heading">
            <div>
              <small>ADMIN MODE TRAINING</small>
              <h2>管理モードの使い方を実物で確認</h2>
            </div>
            <p>危険な操作は実行せず、場所と意味だけを確認します。</p>
          </div>

          <div className="reception-admin-guide-grid">
            {ADMIN_GUIDE_ITEMS.map((item) => {
              const disabled = item.requiresEvent && !canPractice;

              return (
                <button
                  type="button"
                  key={item.mode}
                  className={`reception-admin-guide-button reception-admin-guide-${item.mode}`}
                  disabled={disabled}
                  onClick={() => onStartAdminGuide(item.mode)}
                >
                  <span className="reception-admin-guide-icon"><PracticeIcon /></span>
                  <span className="reception-admin-guide-copy">
                    <strong>{item.title}</strong>
                    <small>{disabled ? "イベント設定後に利用できます" : item.description}</small>
                  </span>
                  <span className="reception-admin-guide-arrow">→</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="reception-guide-grid">
          {GUIDE_ITEMS.map((item) => (
            <article key={item.number} className={`reception-guide-card ${item.tone}`}>
              <div className="reception-guide-card-head">
                <span>{item.number}</span>
                <h2>{item.title}</h2>
              </div>
              <p>{item.lead}</p>
              <ul>
                {item.points.map((point) => <li key={point}>{point}</li>)}
              </ul>
            </article>
          ))}
        </section>
      </main>

      <footer className="reception-guide-footer">
        <button type="button" onClick={() => setPage("admin")}>
          <span><BackIcon /></span>
          管理メニューへ戻る
        </button>
        <p>練習ガイドは受付データを変更せず、画面の場所と操作順だけを確認します。</p>
      </footer>
    </div>
  );
}

export default ReceptionGuidePage;
