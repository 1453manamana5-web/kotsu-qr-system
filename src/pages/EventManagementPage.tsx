import {
  useEffect,
  useMemo,
  useState,
} from "react";

import OnlineStatus from "./OnlineStatus";

import "./EventManagementPage.css";

type EventStatus =
  | "scheduled"
  | "active"
  | "ended";

type EventData = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  status?: EventStatus;
  endedAt?: string;
};

type DisplayStatus =
  | "開催前"
  | "開催中"
  | "終了";

type EventEndResult = {
  ticketCount: number;
  memberCount: number;
};

type EventManagementPageProps = {
  setPage: (
    page: string
  ) => void;

  events: EventData[];

  currentEventId:
    | string
    | null;

  onSelectCurrentEvent: (
    eventId: string
  ) => void;

  onDeleteEvent: (
    eventId: string
  ) => void;

  onForceEndEvent: (
    eventId: string
  ) => Promise<EventEndResult>;
};

function createEventDateTime(
  date: string,
  time: string
) {
  const dateTime =
    new Date(
      `${date}T${time}`
    );

  if (
    !Number.isFinite(
      dateTime.getTime()
    )
  ) {
    return null;
  }

  return dateTime;
}

function getDisplayStatus(
  eventData: EventData,
  currentTime: number
): DisplayStatus {
  if (
    eventData.status ===
      "ended" ||
    typeof eventData.endedAt ===
      "string"
  ) {
    return "終了";
  }

  const startDate =
    createEventDateTime(
      eventData.date,
      eventData.startTime
    );

  const endDate =
    createEventDateTime(
      eventData.date,
      eventData.endTime
    );

  if (
    startDate === null ||
    endDate === null
  ) {
    return "開催前";
  }

  if (
    currentTime <
    startDate.getTime()
  ) {
    return "開催前";
  }

  if (
    currentTime >=
    endDate.getTime()
  ) {
    return "終了";
  }

  return "開催中";
}

function getStatusClassName(
  status: DisplayStatus
) {
  if (
    status === "開催中"
  ) {
    return "event-status-active";
  }

  if (
    status === "終了"
  ) {
    return "event-status-ended";
  }

  return "event-status-scheduled";
}

function getStatusOrder(
  status: DisplayStatus
) {
  if (
    status === "開催中"
  ) {
    return 0;
  }

  if (
    status === "開催前"
  ) {
    return 1;
  }

  return 2;
}

function getEventDateParts(
  date: string
) {
  const parts =
    date.split("-");

  if (
    parts.length !== 3
  ) {
    return {
      month: "",
      day: date,
    };
  }

  return {
    month:
      String(
        Number(
          parts[1]
        )
      ),

    day:
      String(
        Number(
          parts[2]
        )
      ),
  };
}

function formatFullDate(
  date: string
) {
  const dateObject =
    new Date(
      `${date}T00:00`
    );

  if (
    !Number.isFinite(
      dateObject.getTime()
    )
  ) {
    return date;
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
    }
  ).format(
    dateObject
  );
}

function formatEndedAt(
  endedAt?: string
) {
  if (
    endedAt ===
    undefined
  ) {
    return "";
  }

  const endedDate =
    new Date(
      endedAt
    );

  if (
    !Number.isFinite(
      endedDate.getTime()
    )
  ) {
    return "";
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

      hour:
        "2-digit",

      minute:
        "2-digit",

      hour12:
        false,
    }
  ).format(
    endedDate
  );
}

function EventManagementIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="14"
        width="46"
        height="41"
        rx="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M9 27H55"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M21 8V20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M43 8V20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M24 41L30 47L42 35"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M16 7V25"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M7 16H25"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
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
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <circle
        cx="32"
        cy="32"
        r="23"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M32 18V33L43 40"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M24 17H54"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M24 32H54"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M24 47H54"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <circle
        cx="12"
        cy="17"
        r="3"
        fill="currentColor"
      />

      <circle
        cx="12"
        cy="32"
        r="3"
        fill="currentColor"
      />

      <circle
        cx="12"
        cy="47"
        r="3"
        fill="currentColor"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M7 16H24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M18 9L25 16L18 23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M25 16H8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M14 9L7 16L14 23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M9 9L23 23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M23 9L9 23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EventManagementPage({
  setPage,
  events,
  currentEventId,
  onSelectCurrentEvent,
  onDeleteEvent,
  onForceEndEvent,
}: EventManagementPageProps) {
  const [
    selectedEventId,
    setSelectedEventId,
  ] = useState<
    string | null
  >(null);

  const [
    currentTime,
    setCurrentTime,
  ] = useState(
    () => Date.now()
  );

  const [
    endingEvent,
    setEndingEvent,
  ] = useState(false);

  useEffect(() => {
    const timer =
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
        timer
      );
    };
  }, []);

  const sortedEvents =
    useMemo(() => {
      return [
        ...events,
      ].sort(
        (
          firstEvent,
          secondEvent
        ) => {
          const firstStatus =
            getDisplayStatus(
              firstEvent,
              currentTime
            );

          const secondStatus =
            getDisplayStatus(
              secondEvent,
              currentTime
            );

          const orderDifference =
            getStatusOrder(
              firstStatus
            ) -
            getStatusOrder(
              secondStatus
            );

          if (
            orderDifference !==
            0
          ) {
            return orderDifference;
          }

          const firstDate =
            createEventDateTime(
              firstEvent.date,
              firstEvent.startTime
            )?.getTime() ??
            0;

          const secondDate =
            createEventDateTime(
              secondEvent.date,
              secondEvent.startTime
            )?.getTime() ??
            0;

          if (
            firstStatus ===
            "終了"
          ) {
            return (
              secondDate -
              firstDate
            );
          }

          return (
            firstDate -
            secondDate
          );
        }
      );
    }, [
      events,
      currentTime,
    ]);

  const selectedEvent =
    events.find(
      (event) =>
        event.id ===
        selectedEventId
    ) ?? null;

  const selectedStatus =
    selectedEvent ===
    null
      ? null
      : getDisplayStatus(
          selectedEvent,
          currentTime
        );

  const activeEventCount =
    sortedEvents.filter(
      (event) =>
        getDisplayStatus(
          event,
          currentTime
        ) ===
        "開催中"
    ).length;

  const scheduledEventCount =
    sortedEvents.filter(
      (event) =>
        getDisplayStatus(
          event,
          currentTime
        ) ===
        "開催前"
    ).length;

  const endedEventCount =
    sortedEvents.filter(
      (event) =>
        getDisplayStatus(
          event,
          currentTime
        ) ===
        "終了"
    ).length;

  const handleSelectCurrent =
    () => {
      if (
        selectedEvent ===
          null ||
        selectedStatus ===
          "終了"
      ) {
        return;
      }

      if (
        selectedEvent.id ===
        currentEventId
      ) {
        return;
      }

      const confirmed =
        window.confirm(
          `${selectedEvent.name}を現在のイベントに設定しますか？`
        );

      if (
        !confirmed
      ) {
        return;
      }

      onSelectCurrentEvent(
        selectedEvent.id
      );
    };

  const handleForceEnd =
    async () => {
      if (
        selectedEvent ===
          null ||
        selectedStatus ===
          "終了" ||
        endingEvent
      ) {
        return;
      }

      const confirmed =
        window.confirm(
          [
            "このイベントを強制終了しますか？",
            "",
            "Firestore上で入場中の来場者と部員を、全員退出扱いにします。",
            "強制退出になった来場者は平均滞在時間に含まれません。",
            "終了後もイベント一覧と分析データは残ります。",
          ].join(
            "\n"
          )
        );

      if (
        !confirmed
      ) {
        return;
      }

      const finalConfirmed =
        window.confirm(
          "この操作は元に戻せません。\n本当に強制終了しますか？"
        );

      if (
        !finalConfirmed
      ) {
        return;
      }

      setEndingEvent(
        true
      );

      try {
        const exitResult =
          await onForceEndEvent(
            selectedEvent.id
          );

        alert(
          [
            "イベントを強制終了しました。",
            "",
            `来場者 ${exitResult.ticketCount}人を退出扱いにしました。`,
            `部員 ${exitResult.memberCount}人を退出扱いにしました。`,
            "強制退出した来場者は平均滞在時間から除外されています。",
          ].join(
            "\n"
          )
        );
      } catch (error) {
        console.error(
          "イベント終了処理に失敗しました。",
          error
        );

        alert(
          error instanceof Error
            ? `イベントを終了できませんでした。\n${error.message}`
            : "イベントを終了できませんでした。\n通信状態を確認してください。"
        );
      } finally {
        setEndingEvent(
          false
        );
      }
    };

  const handleDelete =
    () => {
      if (
        selectedEvent ===
        null
      ) {
        return;
      }

      const confirmed =
        window.confirm(
          `${selectedEvent.name}をイベント一覧から削除しますか？`
        );

      if (
        !confirmed
      ) {
        return;
      }

      const finalConfirmed =
        window.confirm(
          "一覧から完全に削除します。\n本当によろしいですか？"
        );

      if (
        !finalConfirmed
      ) {
        return;
      }

      onDeleteEvent(
        selectedEvent.id
      );

      setSelectedEventId(
        null
      );
    };

  return (
    <div className="event-management-page">
      <div className="event-management-background event-management-background-one" />

      <div className="event-management-background event-management-background-two" />

      <header className="event-management-header">
        <div className="event-management-header-main">
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="event-management-header-meta">
            <OnlineStatus />

            <span
              className="event-management-header-divider"
              aria-hidden="true"
            />

            <span className="event-management-page-name">
              EVENT MANAGEMENT
            </span>
          </div>
        </div>

        <div className="event-management-mode">
          <span className="event-management-mode-icon">
            <EventManagementIcon />
          </span>

          <span className="event-management-mode-copy">
            <small>
              MANAGEMENT
            </small>

            <strong>
              イベント管理
            </strong>
          </span>
        </div>
      </header>

      <main className="event-management-main">
        <section className="event-management-summary">
          <div className="event-summary-heading">
            <span className="event-summary-icon">
              <ListIcon />
            </span>

            <div>
              <span className="event-summary-eyebrow">
                EVENT LIST
              </span>

              <h2>
                イベント一覧
              </h2>
            </div>
          </div>

          <div className="event-summary-counts">
            <div className="event-summary-count event-summary-active">
              <span>
                開催中
              </span>

              <strong>
                {activeEventCount}
              </strong>
            </div>

            <div className="event-summary-count event-summary-scheduled">
              <span>
                開催前
              </span>

              <strong>
                {scheduledEventCount}
              </strong>
            </div>

            <div className="event-summary-count event-summary-ended">
              <span>
                終了
              </span>

              <strong>
                {endedEventCount}
              </strong>
            </div>
          </div>

          <button
            type="button"
            className="create-event-button"
            onClick={() =>
              setPage(
                "create-event"
              )
            }
          >
            <span className="create-event-button-icon">
              <PlusIcon />
            </span>

            <span className="create-event-button-copy">
              <small>
                NEW EVENT
              </small>

              <strong>
                イベントを新規作成
              </strong>
            </span>
          </button>
        </section>

        <section className="event-list-section">
          <div className="event-list-section-header">
            <div>
              <span>
                ALL EVENTS
              </span>

              <h3>
                登録済みイベント
              </h3>
            </div>

            <strong>
              {events.length}

              <small>
                件
              </small>
            </strong>
          </div>

          <div className="event-list-scroll">
            {sortedEvents.length ===
            0 ? (
              <div className="event-empty-message">
                <span className="event-empty-icon">
                  <CalendarIcon />
                </span>

                <strong>
                  イベントがありません
                </strong>

                <p>
                  上の「イベントを新規作成」から、最初のイベントを登録してください。
                </p>
              </div>
            ) : (
              sortedEvents.map(
                (event) => {
                  const status =
                    getDisplayStatus(
                      event,
                      currentTime
                    );

                  const statusClass =
                    getStatusClassName(
                      status
                    );

                  const isCurrent =
                    event.id ===
                    currentEventId;

                  const dateParts =
                    getEventDateParts(
                      event.date
                    );

                  return (
                    <button
                      type="button"
                      className={`event-list-card ${
                        isCurrent
                          ? "event-list-card-current"
                          : ""
                      }`}
                      key={
                        event.id
                      }
                      onClick={() =>
                        setSelectedEventId(
                          event.id
                        )
                      }
                    >
                      <span className="event-list-calendar">
                        <span className="event-list-calendar-month">
                          {
                            dateParts.month
                          }
                          月
                        </span>

                        <strong>
                          {
                            dateParts.day
                          }
                        </strong>
                      </span>

                      <span className="event-list-information">
                        <span className="event-list-name-row">
                          <strong className="event-list-name">
                            {
                              event.name
                            }
                          </strong>

                          {isCurrent && (
                            <span className="event-current-label">
                              現在のイベント
                            </span>
                          )}
                        </span>

                        <span className="event-list-details">
                          <span>
                            <CalendarIcon />

                            {formatFullDate(
                              event.date
                            )}
                          </span>

                          <span>
                            <ClockIcon />

                            {
                              event.startTime
                            }
                            {" ～ "}
                            {
                              event.endTime
                            }
                          </span>
                        </span>
                      </span>

                      <span
                        className={`event-status-label ${statusClass}`}
                      >
                        <span
                          aria-hidden="true"
                        />

                        {status}
                      </span>

                      <span className="event-list-arrow">
                        <ArrowIcon />
                      </span>
                    </button>
                  );
                }
              )
            )}
          </div>
        </section>
      </main>

      <footer className="event-management-footer">
        <button
          type="button"
          className="event-management-back"
          onClick={() =>
            setPage(
              "admin"
            )
          }
        >
          <span>
            <BackIcon />
          </span>

          管理モードに戻る
        </button>
      </footer>

      {selectedEvent !==
        null &&
        selectedStatus !==
          null && (
        <div
          className="event-detail-modal-background"
          role="presentation"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget &&
              !endingEvent
            ) {
              setSelectedEventId(
                null
              );
            }
          }}
        >
          <section
            className="event-detail-panel"
            role="dialog"
            aria-modal="true"
            aria-label="イベント詳細"
          >
            <div className="event-detail-header">
              <div>
                <span className="event-detail-eyebrow">
                  EVENT DETAILS
                </span>

                <h3>
                  イベント詳細
                </h3>
              </div>

              <div className="event-detail-header-actions">
                <span
                  className={`event-detail-status ${getStatusClassName(
                    selectedStatus
                  )}`}
                >
                  <span
                    aria-hidden="true"
                  />

                  {
                    selectedStatus
                  }
                </span>

                <button
                  type="button"
                  className="event-detail-close-icon"
                  aria-label="イベント詳細を閉じる"
                  disabled={
                    endingEvent
                  }
                  onClick={() =>
                    setSelectedEventId(
                      null
                    )
                  }
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            {selectedEvent.id ===
              currentEventId && (
              <div className="current-event-notice">
                <span>
                  ●
                </span>

                現在このイベントが受付に使用されています
              </div>
            )}

            <div className="event-detail-name-card">
              <span className="event-detail-name-icon">
                <EventManagementIcon />
              </span>

              <div>
                <small>
                  EVENT NAME
                </small>

                <strong>
                  {
                    selectedEvent.name
                  }
                </strong>
              </div>
            </div>

            <div className="event-detail-grid">
              <div className="event-detail-information-card">
                <span className="event-detail-information-icon">
                  <CalendarIcon />
                </span>

                <div>
                  <small>
                    開催日
                  </small>

                  <strong>
                    {formatFullDate(
                      selectedEvent.date
                    )}
                  </strong>
                </div>
              </div>

              <div className="event-detail-information-card">
                <span className="event-detail-information-icon">
                  <ClockIcon />
                </span>

                <div>
                  <small>
                    受付時間
                  </small>

                  <strong>
                    {
                      selectedEvent.startTime
                    }
                    {" ～ "}
                    {
                      selectedEvent.endTime
                    }
                  </strong>
                </div>
              </div>

              {selectedEvent.endedAt !==
                undefined && (
                <div className="event-detail-information-card event-detail-ended-card">
                  <span className="event-detail-information-icon">
                    <ClockIcon />
                  </span>

                  <div>
                    <small>
                      強制終了日時
                    </small>

                    <strong>
                      {formatEndedAt(
                        selectedEvent.endedAt
                      )}
                    </strong>
                  </div>
                </div>
              )}
            </div>

            <div className="event-detail-actions">
              <button
                type="button"
                className="event-detail-close"
                disabled={
                  endingEvent
                }
                onClick={() =>
                  setSelectedEventId(
                    null
                  )
                }
              >
                閉じる
              </button>

              {selectedStatus !==
                "終了" && (
                <button
                  type="button"
                  className="event-select-button"
                  disabled={
                    selectedEvent.id ===
                      currentEventId ||
                    endingEvent
                  }
                  onClick={
                    handleSelectCurrent
                  }
                >
                  {selectedEvent.id ===
                  currentEventId
                    ? "現在選択中"
                    : "現在のイベントに設定"}
                </button>
              )}

              <button
                type="button"
                className="event-force-end-button"
                disabled={
                  selectedStatus ===
                    "終了" ||
                  endingEvent
                }
                onClick={() => {
                  void handleForceEnd();
                }}
              >
                {endingEvent
                  ? "終了処理中…"
                  : selectedStatus ===
                    "終了"
                    ? "イベント終了済み"
                    : "イベントを強制終了"}
              </button>

              <button
                type="button"
                className="event-delete-button"
                disabled={
                  endingEvent
                }
                onClick={
                  handleDelete
                }
              >
                イベントを削除
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default EventManagementPage;
