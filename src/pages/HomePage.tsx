import OnlineStatus from "./OnlineStatus";

import { unlockReceptionSound } from "../receptionSound";

import "./HomePage.css";

type HomePageProps = {
  setPage: (page: string) => void;

  eventConfigured: boolean;

  eventName: string;
};

function EntryIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M37 11H52V53H37"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M7 32H38"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />

      <path
        d="M28 22L39 32L28 42"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ExitIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M27 11H12V53H27"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M26 32H57"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />

      <path
        d="M46 22L57 32L46 42"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect
        x="10"
        y="15"
        width="44"
        height="39"
        rx="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M10 27H54"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M21 9V20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M43 9V20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <circle cx="23" cy="38" r="3" fill="currentColor" />

      <circle cx="32" cy="38" r="3" fill="currentColor" />

      <circle cx="41" cy="38" r="3" fill="currentColor" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M32 7L51 15V29C51 42 43 52 32 57C21 52 13 42 13 29V15L32 7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <circle
        cx="32"
        cy="28"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M21 45C23 38 27 35 32 35C37 35 41 38 43 45"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M8 16H24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M18 10L24 16L18 22"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HomePage({
  setPage,
  eventConfigured,
  eventName,
}: HomePageProps) {
  const goToEntry = () => {
    if (!eventConfigured) {
      return;
    }

    void unlockReceptionSound();

    setPage("entry");
  };

  const goToExit = () => {
    if (!eventConfigured) {
      return;
    }

    void unlockReceptionSound();

    setPage("exit");
  };

  return (
    <div className="home-page">
      <div className="home-background-decoration home-background-decoration-one" />

      <div className="home-background-decoration home-background-decoration-two" />

      <header className="home-header">
        <div className="home-header-main">
          <h1 className="home-app-title">
            交通研究部QRコード管理システム
          </h1>

          <div className="home-online-status">
            <OnlineStatus />
          </div>
        </div>

        <button
          type="button"
          className="home-admin-button"
          onClick={() => setPage("admin")}
        >
          <span className="home-admin-icon">
            <AdminIcon />
          </span>

          <span className="home-admin-text">
            管理モード
          </span>

          <span className="home-admin-arrow">
            <ArrowIcon />
          </span>
        </button>
      </header>

      <section
        className={
          eventConfigured
            ? "home-event-card"
            : "home-event-card home-event-card-warning"
        }
      >
        <div className="home-event-icon">
          <CalendarIcon />
        </div>

        <div className="home-event-information">
          <span className="home-event-label">
            {eventConfigured
              ? "イベント名"
              : "現在のイベント"}
          </span>

          <strong className="home-event-value">
            {eventConfigured
              ? eventName
              : "イベントを設定してください"}
          </strong>
        </div>

        {!eventConfigured && (
          <div className="home-event-warning-mark">
            !
          </div>
        )}
      </section>

      <main className="home-action-grid">
        <button
          type="button"
          className="home-action-card home-entry-card"
          disabled={!eventConfigured}
          onClick={goToEntry}
        >
          <span className="home-action-decoration home-action-decoration-one" />

          <span className="home-action-decoration home-action-decoration-two" />

          <span className="home-action-icon">
            <EntryIcon />
          </span>

          <span className="home-action-english">
            ENTRY
          </span>

          <span className="home-action-title">
            入口受付
          </span>

          <span className="home-action-divider" />

          <span className="home-action-description">
            {eventConfigured
              ? "来場者の入場を記録"
              : "イベントを設定してください"}
          </span>

          <span className="home-action-arrow">
            <ArrowIcon />
          </span>
        </button>

        <button
          type="button"
          className="home-action-card home-exit-card"
          disabled={!eventConfigured}
          onClick={goToExit}
        >
          <span className="home-action-decoration home-action-decoration-one" />

          <span className="home-action-decoration home-action-decoration-two" />

          <span className="home-action-icon">
            <ExitIcon />
          </span>

          <span className="home-action-english">
            EXIT
          </span>

          <span className="home-action-title">
            出口受付
          </span>

          <span className="home-action-divider" />

          <span className="home-action-description">
            {eventConfigured
              ? "来場者の退場を記録"
              : "イベントを設定してください"}
          </span>

          <span className="home-action-arrow">
            <ArrowIcon />
          </span>
        </button>
      </main>
    </div>
  );
}

export default HomePage;