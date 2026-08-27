import OnlineStatus from "./OnlineStatus";

import "./ReceptionGuidePage.css";

type ReceptionGuidePageProps = {
  setPage: (page: string) => void;
  eventName: string;
};

type GuideItem = {
  number: string;
  title: string;
  lead: string;
  points: string[];
  tone: "blue" | "green" | "orange" | "purple" | "red" | "gray";
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

function ReceptionGuidePage({ setPage, eventName }: ReceptionGuidePageProps) {
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
          <div>
            <small>START HERE</small>
            <h2>本番中は「結果を確認してから次の人へ」</h2>
            <p>QRが反応しても、成功・再入場・エラーのどれが表示されたかを確認してから次の受付へ進んでください。</p>
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
        <p>次の更新で、実際の受付画面を光らせながら操作できる練習ガイドにも拡張できます。</p>
      </footer>
    </div>
  );
}

export default ReceptionGuidePage;
