import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  subscribeToTickets,
  type Ticket,
} from "../ticketFirestore";

import {
  subscribeToEventMembers,
  type EventMember,
} from "../memberFirestore";

import {
  subscribeToActivityLogs,
  type ActivityLog,
} from "../activityFirestore";

import OnlineStatus from "./OnlineStatus";

import "./AnalysisPage.css";

type AnalysisPageProps = {
  setPage: (
    page: string
  ) => void;

  eventData: {
    id?: string;
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

type HourData = {
  label: string;
  count: number;
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

function calculateAverageStayMinutes(
  logs: ActivityLog[]
) {
  const ticketLogs =
    logs.filter(
      (log) =>
        log.type ===
          "ticket-entry" ||
        log.type ===
          "ticket-exit"
    );

  const currentEntries =
    new Map<
      string,
      number
    >();

  const stayTimes:
    number[] = [];

  ticketLogs.forEach(
    (log) => {
      const logTime =
        new Date(
          log.timestamp
        ).getTime();

      if (
        !Number.isFinite(
          logTime
        )
      ) {
        return;
      }

      if (
        log.type ===
        "ticket-entry"
      ) {
        currentEntries.set(
          log.qrNumber,
          logTime
        );

        return;
      }

      const entryTime =
        currentEntries.get(
          log.qrNumber
        );

      if (
        entryTime ===
        undefined
      ) {
        return;
      }

      const stayTime =
        logTime -
        entryTime;

      if (
        stayTime >=
        0
      ) {
        stayTimes.push(
          stayTime
        );
      }

      currentEntries.delete(
        log.qrNumber
      );
    }
  );

  if (
    stayTimes.length ===
    0
  ) {
    return null;
  }

  const totalMilliseconds =
    stayTimes.reduce(
      (
        total,
        current
      ) =>
        total +
        current,
      0
    );

  return Math.round(
    totalMilliseconds /
      stayTimes.length /
      1000 /
      60
  );
}

function createHourData(
  logs: ActivityLog[],
  eventDate: string,
  startTime: string,
  endTime: string
): HourData[] {
  const entryLogs =
    logs.filter(
      (log) =>
        log.type ===
        "ticket-entry"
    );

  const startDate =
    eventDate !== "" &&
    startTime !== ""
      ? new Date(
          `${eventDate}T${startTime}`
        )
      : null;

  const endDate =
    eventDate !== "" &&
    endTime !== ""
      ? new Date(
          `${eventDate}T${endTime}`
        )
      : null;

  if (
    startDate !==
      null &&
    endDate !==
      null &&
    Number.isFinite(
      startDate.getTime()
    ) &&
    Number.isFinite(
      endDate.getTime()
    ) &&
    endDate.getTime() >
      startDate.getTime()
  ) {
    const firstHour =
      new Date(
        startDate
      );

    firstHour.setMinutes(
      0,
      0,
      0
    );

    const finalHour =
      new Date(
        endDate
      );

    finalHour.setMinutes(
      0,
      0,
      0
    );

    const hourData:
      HourData[] = [];

    const currentHour =
      new Date(
        firstHour
      );

    while (
      currentHour.getTime() <=
      finalHour.getTime()
    ) {
      const hourStart =
        currentHour.getTime();

      const hourEnd =
        hourStart +
        60 *
          60 *
          1000;

      const count =
        entryLogs.filter(
          (log) => {
            const logTime =
              new Date(
                log.timestamp
              ).getTime();

            return (
              logTime >=
                hourStart &&
              logTime <
                hourEnd
            );
          }
        ).length;

      hourData.push({
        label:
          `${String(
            currentHour.getHours()
          ).padStart(
            2,
            "0"
          )}:00`,

        count,
      });

      currentHour.setHours(
        currentHour.getHours() +
          1
      );
    }

    return hourData;
  }

  const groupedData =
    new Map<
      string,
      number
    >();

  entryLogs.forEach(
    (log) => {
      const logDate =
        new Date(
          log.timestamp
        );

      if (
        !Number.isFinite(
          logDate.getTime()
        )
      ) {
        return;
      }

      const label =
        `${String(
          logDate.getHours()
        ).padStart(
          2,
          "0"
        )}:00`;

      groupedData.set(
        label,
        (
          groupedData.get(
            label
          ) ?? 0
        ) + 1
      );
    }
  );

  return Array.from(
    groupedData.entries()
  )
    .sort(
      (
        [firstLabel],
        [secondLabel]
      ) =>
        firstLabel.localeCompare(
          secondLabel
        )
    )
    .map(
      (
        [label, count]
      ) => ({
        label,
        count,
      })
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
    tickets,
    setTickets,
  ] = useState<Ticket[]>(
    []
  );

  const [
    members,
    setMembers,
  ] = useState<EventMember[]>(
    []
  );

  const [
    activityLogs,
    setActivityLogs,
  ] = useState<ActivityLog[]>(
    []
  );

  const [
    ticketsLoading,
    setTicketsLoading,
  ] = useState(
    false
  );

  const [
    membersLoading,
    setMembersLoading,
  ] = useState(
    false
  );

  const [
    activityLoading,
    setActivityLoading,
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

    let unsubscribeTickets =
      () => {};

    let unsubscribeMembers =
      () => {};

    let unsubscribeActivity =
      () => {};

    const eventName =
      eventData?.name ??
      "";

    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setTickets([]);
      setMembers([]);
      setActivityLogs([]);
      setLoadingError("");

      if (
        eventName.trim() ===
        ""
      ) {
        setTicketsLoading(
          false
        );

        setMembersLoading(
          false
        );

        setActivityLoading(
          false
        );

        return;
      }

      setTicketsLoading(
        true
      );

      setMembersLoading(
        true
      );

      setActivityLoading(
        true
      );

      unsubscribeTickets =
      subscribeToTickets(
        eventName,

        (
          updatedTickets
        ) => {
          setTickets(
            updatedTickets
          );

          setTicketsLoading(
            false
          );
        },

        (error) => {
          console.error(
            "分析画面でチケット情報を取得できませんでした。",
            error
          );

          setTicketsLoading(
            false
          );

          setLoadingError(
            "チケット情報を読み込めませんでした。"
          );
        }
      );

      unsubscribeMembers =
      subscribeToEventMembers(
        eventName,

        (
          updatedMembers
        ) => {
          setMembers(
            updatedMembers
          );

          setMembersLoading(
            false
          );
        },

        (error) => {
          console.error(
            "分析画面で部員情報を取得できませんでした。",
            error
          );

          setMembersLoading(
            false
          );

          setLoadingError(
            "部員情報を読み込めませんでした。"
          );
        }
      );

      unsubscribeActivity =
      subscribeToActivityLogs(
        eventName,

        (
          updatedLogs
        ) => {
          setActivityLogs(
            updatedLogs
          );

          setActivityLoading(
            false
          );
        },

        (error) => {
          console.error(
            "分析画面で受付履歴を取得できませんでした。",
            error
          );

          setActivityLoading(
            false
          );

          setLoadingError(
            "受付履歴を読み込めませんでした。"
          );
        }
      );
    });

    return () => {
      cancelled = true;

      unsubscribeTickets();
      unsubscribeMembers();
      unsubscribeActivity();
    };
  }, [
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
      const firstEntryQrNumbers =
        new Set(
          activityLogs
            .filter(
              (log) =>
                log.type ===
                  "ticket-entry" &&
                log.isReEntry !==
                  true
            )
            .map(
              (log) =>
                log.qrNumber
            )
        );

      const visitorCountFromStatus =
        tickets.filter(
          (ticket) =>
            ticket.status ===
              "入場中" ||
            ticket.status ===
              "使用済み"
        ).length;

      const totalVisitors =
        Math.max(
          firstEntryQrNumbers.size,
          visitorCountFromStatus
        );

      const currentInside =
        tickets.filter(
          (ticket) =>
            ticket.status ===
            "入場中"
        ).length;

      const currentMembersInside =
        members.filter(
          (member) =>
            member.status ===
            "入室中"
        ).length;

      const reEntryCount =
        activityLogs.filter(
          (log) =>
            log.type ===
              "ticket-entry" &&
            log.isReEntry ===
              true
        ).length;

      const averageStayMinutes =
        calculateAverageStayMinutes(
          activityLogs
        );

      const hourData =
        createHourData(
          activityLogs,
          eventData?.date ??
            "",
          eventData?.startTime ??
            "",
          eventData?.endTime ??
            ""
        );

      return {
        totalVisitors,
        currentInside,
        currentMembersInside,
        reEntryCount,
        averageStayMinutes,
        hourData,
      };
    }, [
      activityLogs,
      eventData,
      members,
      tickets,
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

  const loading =
    ticketsLoading ||
    membersLoading ||
    activityLoading;

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
                /*
                  Firestoreは自動更新なので、
                  更新ボタンは表示上残すだけです。
                */
              }}
            >
              {loading
                ? "更新中"
                : "自動更新"}
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
                  tickets.length
                }
                枚
              </strong>
            </p>

            <p>
              受付履歴

              <strong>
                {
                  activityLogs.length
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
