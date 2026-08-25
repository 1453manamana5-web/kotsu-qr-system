import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  createHourDataFromAnalytics,
  rebuildEventAnalytics,
  subscribeToEventAnalytics,
  type EventAnalyticsSummary,
} from "../eventAnalyticsFirestore";

import {
  registerEventDataId,
} from "../firestorePaths";

import OnlineStatus from "./OnlineStatus";

import "./AnalysisPage.css";

type AnalysisPageProps = {
  setPage: (
    page: string
  ) => void;

  eventData: {
    id?: string;
    dataDocumentId?: string;
    name: string;
    date: string;
    startTime: string;
    endTime: string;
    status?:
      | "scheduled"
      | "active"
      | "ended";
    endedAt?: string;
  } | null;
};

function createEventStartDate(
  eventData:
    AnalysisPageProps["eventData"]
) {
  if (
    eventData === null ||
    eventData.date.trim() ===
      "" ||
    eventData.startTime.trim() ===
      ""
  ) {
    return null;
  }

  const startDate =
    new Date(
      `${eventData.date}T${eventData.startTime}`
    );

  if (
    !Number.isFinite(
      startDate.getTime()
    )
  ) {
    return null;
  }

  return startDate;
}

function formatEventStartDate(
  eventStartDate: Date | null
) {
  if (
    eventStartDate ===
    null
  ) {
    return "開始時刻未設定";
  }

  return new Intl.DateTimeFormat(
    "ja-JP",
    {
      year:
        "numeric",

      month:
        "long",

      day:
        "numeric",

      weekday:
        "short",

      hour:
        "2-digit",

      minute:
        "2-digit",

      hour12:
        false,
    }
  ).format(
    eventStartDate
  );
}

function AnalysisIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M11 53V11"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M11 53H55"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M18 44L28 33L37 39L52 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle
        cx="52"
        cy="20"
        r="4"
        fill="currentColor"
      />
    </svg>
  );
}

function AnalysisPage({
  setPage,
  eventData,
}: AnalysisPageProps) {
  const [
    analytics,
    setAnalytics,
  ] = useState<EventAnalyticsSummary | null>(
    null
  );

  const [
    loading,
    setLoading,
  ] = useState(
    false
  );

  const [
    loadingError,
    setLoadingError,
  ] = useState("");

  const [
    currentTime,
    setCurrentTime,
  ] = useState(
    () =>
      Date.now()
  );

  useEffect(() => {
    const clockTimer =
      window.setInterval(
        () => {
          setCurrentTime(
            Date.now()
          );
        },
        1000
      );

    return () => {
      window.clearInterval(
        clockTimer
      );
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    let unsubscribeAnalytics =
      () => {};

    const eventName =
      eventData?.name ??
      "";

    const eventDataId =
      eventData?.dataDocumentId ??
      "";

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setAnalytics(null);
      setLoadingError("");

      if (
        eventName.trim() ===
        ""
      ) {
        setLoading(
          false
        );

        return;
      }

      if (
        eventDataId.trim() !==
        ""
      ) {
        registerEventDataId(
          eventName,
          eventDataId
        );
      }

      setLoading(
        true
      );

      unsubscribeAnalytics =
      subscribeToEventAnalytics(
        eventName,

        (
          updatedSummary
        ) => {
          setAnalytics(
            updatedSummary
          );

          setLoading(
            false
          );
        },

        (error) => {
          console.error(
            "分析画面で集計情報を取得できませんでした。",
            error
          );

          setLoading(
            false
          );

          setLoadingError(
            "集計情報を読み込めませんでした。"
          );
        }
      );
    });

    return () => {
      cancelled = true;

      unsubscribeAnalytics();
    };
  }, [
    eventData?.dataDocumentId,
    eventData?.name,
  ]);

  const eventStartDate =
    useMemo(
      () =>
        createEventStartDate(
          eventData
        ),
      [eventData]
    );

  const isEventNotConfigured =
    eventData ===
    null;

  const isBeforeStart =
    !isEventNotConfigured &&
    eventStartDate !==
      null &&
    currentTime <
      eventStartDate.getTime();

  const formattedStartDate =
    formatEventStartDate(
      eventStartDate
    );

  const analysisData =
    useMemo(() => {
      return {
        totalVisitors:
          analytics?.totalVisitors ??
          0,

        currentInside:
          analytics?.currentInside ??
          0,

        currentMembersInside:
          analytics?.currentMembersInside ??
          0,

        reEntryCount:
          analytics?.reEntryCount ??
          0,

        averageStayMinutes:
          analytics?.averageStayMinutes ??
          null,

        ticketCount:
          analytics?.ticketCount ??
          0,

        activityCount:
          analytics?.activityCount ??
          0,

        hourData:
          analytics ===
          null
            ? []
            : createHourDataFromAnalytics(
                analytics,
                eventData?.date ??
                  "",
                eventData?.startTime ??
                  "",
                eventData?.endTime ??
                  ""
              ),
      };
    }, [
      analytics,
      eventData,
    ]);

  const maximumHourCount =
    Math.max(
      ...analysisData.hourData.map(
        (data) =>
          data.count
      ),
      1
    );

  const middleHourCount =
    Math.ceil(
      maximumHourCount /
        2
    );

  return (
    <div
      className={`analysis-page ${
        isBeforeStart
          ? "before-start"
          : ""
      } ${
        isEventNotConfigured
          ? "event-not-configured"
          : ""
      }`}
    >
      <header className="analysis-header">
        <div>
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="analysis-title-row">
            <OnlineStatus />

            <div className="analysis-event-name">
              イベント名{" "}
              {eventData?.name ??
                "未設定"}
            </div>
          </div>
        </div>

        <div className="analysis-mode-label">
          <span className="analysis-mode-icon">
            <AnalysisIcon />
          </span>

          <span className="analysis-mode-copy">
            <small>
              ANALYSIS
            </small>

            <strong>
              分析
            </strong>
          </span>
        </div>
      </header>

      <main className="analysis-content">
        <section className="analysis-graph-panel">
          <div className="analysis-panel-title">
            <div>
              <h3>
                時間帯別入場者数
              </h3>

              <p>
                再入場を含む受付回数
              </p>
            </div>

            <button
              type="button"
              className="analysis-refresh-button"
              disabled={
                loading
              }
              onClick={() => {
                const eventName =
                  eventData?.name ??
                  "";

                if (
                  eventName.trim() ===
                  ""
                ) {
                  return;
                }

                setLoading(
                  true
                );

                setLoadingError("");

                void rebuildEventAnalytics(
                  eventName
                )
                  .catch(
                    (error) => {
                      console.error(
                        "集計を再計算できませんでした。",
                        error
                      );

                      setLoadingError(
                        "集計を再計算できませんでした。"
                      );
                    }
                  )
                  .finally(
                    () => {
                      setLoading(
                        false
                      );
                    }
                  );
              }}
            >
              {loading
                ? "更新中"
                : "再計算"}
            </button>
          </div>

          {loading &&
            !isEventNotConfigured && (
            <div className="analysis-no-data">
              <strong>
                Firebaseから最新情報を読み込んでいます…
              </strong>
            </div>
          )}

          {!loading &&
            loadingError !==
              "" && (
            <div className="analysis-no-data">
              <strong>
                データを読み込めませんでした
              </strong>

              <span>
                {
                  loadingError
                }
              </span>
            </div>
          )}

          {!loading &&
            loadingError ===
              "" &&
            analysisData.hourData
              .length ===
              0 ? (
            <div className="analysis-no-data">
              <strong>
                まだ入場履歴がありません
              </strong>

              <span>
                チケットを読み取るとグラフに反映されます
              </span>
            </div>
          ) : !loading &&
            loadingError ===
              "" ? (
            <div
              className="analysis-chart"
              role="img"
              aria-label={`時間帯別入場者数。${analysisData.hourData
                .map(
                  (data) =>
                    `${data.label} ${data.count}人`
                )
                .join("、")}`}
            >
              <div
                className="analysis-chart-scale"
                aria-hidden="true"
              >
                <strong>
                  人数
                </strong>

                <div>
                  <span>
                    {
                      maximumHourCount
                    }
                  </span>

                  <span>
                    {
                      middleHourCount
                    }
                  </span>

                  <span>
                    0
                  </span>
                </div>
              </div>

              {analysisData.hourData.map(
                (data) => {
                  const barHeight =
                    data.count ===
                      0
                      ? 0
                      : Math.max(
                          8,
                          (
                            data.count /
                            maximumHourCount
                          ) *
                            100
                        );

                  return (
                    <div
                      className="analysis-chart-column"
                      key={
                        data.label
                      }
                    >
                      <div className="analysis-chart-value">
                        {
                          data.count
                        }
                      </div>

                      <div className="analysis-chart-bar-area">
                        <div
                          className="analysis-chart-bar"
                          style={{
                            height:
                              `${barHeight}%`,
                          }}
                        />
                      </div>

                      <div className="analysis-chart-label">
                        {
                          data.label
                        }
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          ) : null}
        </section>

        <aside className="analysis-summary-panel">
          <section className="analysis-summary-card">
            <span>
              合計来場者数
            </span>

            <strong>
              {
                analysisData.totalVisitors
              }
              人
            </strong>
          </section>

          <section className="analysis-summary-card current">
            <span>
              現在の室内人数
            </span>

            <strong>
              {
                analysisData.currentInside
              }
              人
            </strong>
          </section>

          <section className="analysis-summary-card">
            <span>
              平均滞在時間
            </span>

            <strong>
              {analysisData.averageStayMinutes ===
              null
                ? "―"
                : `${analysisData.averageStayMinutes}分`}
            </strong>
          </section>

          <section className="analysis-small-card-area">
            <div className="analysis-small-card">
              <span>
                再入場数
              </span>

              <strong>
                {
                  analysisData.reEntryCount
                }
                回
              </strong>
            </div>

            <div className="analysis-small-card member">
              <span>
                入室中の部員
              </span>

              <strong>
                {
                  analysisData.currentMembersInside
                }
                人
              </strong>
            </div>
          </section>

          <section className="analysis-detail-card">
            <p>
              発行済みチケット

              <strong>
                {
                  analysisData.ticketCount
                }
                枚
              </strong>
            </p>

            <p>
              受付履歴

              <strong>
                {
                  analysisData.activityCount
                }
                件
              </strong>
            </p>
          </section>
        </aside>
      </main>

      {isBeforeStart && (
        <>
          <div
            className="analysis-before-start-overlay"
            aria-hidden="true"
          />

          <section
            className="analysis-before-start-message"
            role="status"
            aria-live="polite"
          >
            <div className="analysis-before-start-icon">
              ◷
            </div>

            <h2>
              開催前です
            </h2>

            <p>
              開始予定
            </p>

            <strong>
              {
                formattedStartDate
              }
            </strong>

            <span>
              開始時刻になると自動的に表示されます
            </span>
          </section>
        </>
      )}

      {isEventNotConfigured && (
        <>
          <div
            className="analysis-no-event-overlay"
            aria-hidden="true"
          />

          <section
            className="analysis-no-event-message"
            role="status"
            aria-live="polite"
          >
            <div className="analysis-no-event-icon">
              ⚠
            </div>

            <h2>
              イベントが設定されていません
            </h2>

            <p>
              分析を表示するイベントがありません。
            </p>

            <strong>
              イベント管理からイベントを作成するか、
              現在のイベントを選択してください。
            </strong>

            <button
              type="button"
              className="analysis-no-event-button"
              onClick={() =>
                setPage(
                  "events"
                )
              }
            >
              イベント管理を開く
            </button>
          </section>
        </>
      )}

      <div className="analysis-bottom-buttons">
        <button
          type="button"
          className="analysis-return-button"
          onClick={() =>
            setPage(
              "admin"
            )
          }
        >
          前のページに戻る
        </button>

        <button
          type="button"
          className="analysis-history-button"
          onClick={() =>
            setPage(
              "past-data"
            )
          }
        >
          過去のデータ
        </button>
      </div>
    </div>
  );
}

export default AnalysisPage;
