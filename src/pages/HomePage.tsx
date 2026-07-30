import OnlineStatus from "./OnlineStatus";

import "../App.css";

type HomePageProps = {
  setPage: (
    page: string
  ) => void;

  eventConfigured:
    boolean;

  eventName: string;
};

function HomePage({
  setPage,
  eventConfigured,
  eventName,
}: HomePageProps) {
  const goToEntry =
    () => {
      if (
        !eventConfigured
      ) {
        return;
      }

      setPage(
        "entry"
      );
    };

  const goToExit =
    () => {
      if (
        !eventConfigured
      ) {
        return;
      }

      setPage(
        "exit"
      );
    };

  return (
    <div className="app">
      <div className="top">
        <div>
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <OnlineStatus />

          {eventConfigured ? (
            <div className="event-name">
              イベント名　
              {eventName}
            </div>
          ) : (
            <div className="event-warning">
              ⚠ イベントを設定してください
            </div>
          )}
        </div>

        <button
          type="button"
          className="admin"
          onClick={() =>
            setPage(
              "admin"
            )
          }
        >
          管理モード
          <br />
          タップしてください
        </button>
      </div>

      <div className="main">
        <button
          type="button"
          className="entry"
          disabled={
            !eventConfigured
          }
          onClick={
            goToEntry
          }
        >
          <div className="title">
            入口受付
          </div>

          <div className="sub">
            タップしてください
          </div>
        </button>

        <div className="line" />

        <button
          type="button"
          className="exit"
          disabled={
            !eventConfigured
          }
          onClick={
            goToExit
          }
        >
          <div className="title">
            出口受付
          </div>

          <div className="sub">
            タップしてください
          </div>
        </button>
      </div>
    </div>
  );
}

export default HomePage;