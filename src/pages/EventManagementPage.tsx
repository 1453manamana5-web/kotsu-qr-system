import {
  useEffect,
  useMemo,
  useState,
} from "react";

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

type TicketStatus =
  | "未使用"
  | "入場中"
  | "使用済み"
  | "無効";

type MemberStatus =
  | "未入室"
  | "入室中"
  | "退出済み";

type Ticket = {
  id: string;
  qrNumber: string;
  authToken: string;
  status: TicketStatus;
  createdAt: string;
};

type EventMember = {
  qrNumber: string;
  name: string;
  status: MemberStatus;
};

type ActivityType =
  | "ticket-entry"
  | "ticket-exit"
  | "member-entry"
  | "member-exit";

type ActivityLog = {
  id: string;
  type: ActivityType;
  qrNumber: string;
  timestamp: string;
  isReEntry?: boolean;
  source?: "scanner" | "manual";
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
  ) => void;
};

function createSafeEventName(
  eventName: string
) {
  return eventName.trim() === ""
    ? "event-not-set"
    : encodeURIComponent(
        eventName.trim()
      );
}

function createTicketStorageKey(
  eventName: string
) {
  return `qr-management-event-tickets-${createSafeEventName(
    eventName
  )}`;
}

function createMemberStorageKey(
  eventName: string
) {
  return `qr-management-event-members-${createSafeEventName(
    eventName
  )}`;
}

function createActivityStorageKey(
  eventName: string
) {
  return `qr-management-event-activity-${createSafeEventName(
    eventName
  )}`;
}

function createActivityId() {
  try {
    if (
      typeof globalThis.crypto !==
        "undefined" &&
      typeof globalThis.crypto.randomUUID ===
        "function"
    ) {
      return globalThis.crypto.randomUUID();
    }
  } catch (error) {
    console.warn(
      "履歴IDを生成できませんでした。",
      error
    );
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function loadTickets(
  eventName: string
): Ticket[] {
  try {
    const savedData =
      localStorage.getItem(
        createTicketStorageKey(
          eventName
        )
      );

    if (savedData === null) {
      return [];
    }

    const parsedData: unknown =
      JSON.parse(savedData);

    if (!Array.isArray(parsedData)) {
      return [];
    }

    return parsedData.filter(
      (
        ticket
      ): ticket is Ticket =>
        typeof ticket?.id ===
          "string" &&
        typeof ticket?.qrNumber ===
          "string" &&
        typeof ticket?.authToken ===
          "string" &&
        typeof ticket?.createdAt ===
          "string" &&
        (
          ticket?.status ===
            "未使用" ||
          ticket?.status ===
            "入場中" ||
          ticket?.status ===
            "使用済み" ||
          ticket?.status ===
            "無効"
        )
    );
  } catch (error) {
    console.error(
      "チケット情報の読み込みに失敗しました。",
      error
    );

    return [];
  }
}

function loadMembers(
  eventName: string
): EventMember[] {
  try {
    const savedData =
      localStorage.getItem(
        createMemberStorageKey(
          eventName
        )
      );

    if (savedData === null) {
      return [];
    }

    const parsedData: unknown =
      JSON.parse(savedData);

    if (!Array.isArray(parsedData)) {
      return [];
    }

    return parsedData.filter(
      (
        member
      ): member is EventMember =>
        typeof member?.qrNumber ===
          "string" &&
        typeof member?.name ===
          "string" &&
        (
          member?.status ===
            "未入室" ||
          member?.status ===
            "入室中" ||
          member?.status ===
            "退出済み"
        )
    );
  } catch (error) {
    console.error(
      "部員情報の読み込みに失敗しました。",
      error
    );

    return [];
  }
}

function loadActivityLogs(
  eventName: string
): ActivityLog[] {
  try {
    const savedData =
      localStorage.getItem(
        createActivityStorageKey(
          eventName
        )
      );

    if (savedData === null) {
      return [];
    }

    const parsedData: unknown =
      JSON.parse(savedData);

    return Array.isArray(parsedData)
      ? (parsedData as ActivityLog[])
      : [];
  } catch (error) {
    console.error(
      "受付履歴の読み込みに失敗しました。",
      error
    );

    return [];
  }
}

function forceEveryoneToExit(
  eventName: string
) {
  const endedAt =
    new Date().toISOString();

  const tickets =
    loadTickets(eventName);

  const members =
    loadMembers(eventName);

  const currentLogs =
    loadActivityLogs(
      eventName
    );

  const insideTickets =
    tickets.filter(
      (ticket) =>
        ticket.status ===
        "入場中"
    );

  const insideMembers =
    members.filter(
      (member) =>
        member.status ===
        "入室中"
    );

  const updatedTickets =
    tickets.map(
      (ticket): Ticket =>
        ticket.status ===
        "入場中"
          ? {
              ...ticket,
              status: "使用済み",
            }
          : ticket
    );

  const updatedMembers =
    members.map(
      (
        member
      ): EventMember =>
        member.status ===
        "入室中"
          ? {
              ...member,
              status: "退出済み",
            }
          : member
    );

  const ticketExitLogs:
    ActivityLog[] =
    insideTickets.map(
      (ticket) => ({
        id: createActivityId(),
        type: "ticket-exit",
        qrNumber:
          ticket.qrNumber,
        timestamp: endedAt,
        source: "manual",
      })
    );

  const memberExitLogs:
    ActivityLog[] =
    insideMembers.map(
      (member) => ({
        id: createActivityId(),
        type: "member-exit",
        qrNumber:
          member.qrNumber,
        timestamp: endedAt,
        source: "manual",
      })
    );

  localStorage.setItem(
    createTicketStorageKey(
      eventName
    ),
    JSON.stringify(
      updatedTickets
    )
  );

  localStorage.setItem(
    createMemberStorageKey(
      eventName
    ),
    JSON.stringify(
      updatedMembers
    )
  );

  localStorage.setItem(
    createActivityStorageKey(
      eventName
    ),
    JSON.stringify([
      ...currentLogs,
      ...ticketExitLogs,
      ...memberExitLogs,
    ])
  );

  return {
    ticketCount:
      insideTickets.length,

    memberCount:
      insideMembers.length,
  };
}

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

function formatListDate(
  date: string
) {
  const parts =
    date.split("-");

  if (
    parts.length !== 3
  ) {
    return date;
  }

  return `${Number(
    parts[1]
  )}/${Number(parts[2])}`;
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
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    }
  ).format(dateObject);
}

function formatEndedAt(
  endedAt?: string
) {
  if (
    endedAt === undefined
  ) {
    return "";
  }

  const endedDate =
    new Date(endedAt);

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
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }
  ).format(endedDate);
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

  useEffect(() => {
    const timer =
      window.setInterval(() => {
        setCurrentTime(
          Date.now()
        );
      }, 1000);

    return () => {
      window.clearInterval(
        timer
      );
    };
  }, []);

  const sortedEvents =
    useMemo(() => {
      return [...events].sort(
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
            orderDifference !== 0
          ) {
            return orderDifference;
          }

          const firstDate =
            createEventDateTime(
              firstEvent.date,
              firstEvent.startTime
            )?.getTime() ?? 0;

          const secondDate =
            createEventDateTime(
              secondEvent.date,
              secondEvent.startTime
            )?.getTime() ?? 0;

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
    selectedEvent === null
      ? null
      : getDisplayStatus(
          selectedEvent,
          currentTime
        );

  const handleSelectCurrent =
    () => {
      if (
        selectedEvent === null ||
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

      if (!confirmed) {
        return;
      }

      onSelectCurrentEvent(
        selectedEvent.id
      );
    };

  const handleForceEnd =
    () => {
      if (
        selectedEvent === null ||
        selectedStatus ===
          "終了"
      ) {
        return;
      }

      const tickets =
        loadTickets(
          selectedEvent.name
        );

      const members =
        loadMembers(
          selectedEvent.name
        );

      const insideTicketCount =
        tickets.filter(
          (ticket) =>
            ticket.status ===
            "入場中"
        ).length;

      const insideMemberCount =
        members.filter(
          (member) =>
            member.status ===
            "入室中"
        ).length;

      const confirmed =
        window.confirm(
          [
            "このイベントを強制終了しますか？",
            "",
            `入場中の来場者：${insideTicketCount}人`,
            `入室中の部員：${insideMemberCount}人`,
            "",
            "入場中の来場者と部員は、全員退出扱いになります。",
            "終了後もイベント一覧と分析データは残ります。",
          ].join("\n")
        );

      if (!confirmed) {
        return;
      }

      const finalConfirmed =
        window.confirm(
          "この操作は元に戻せません。\n本当に強制終了しますか？"
        );

      if (!finalConfirmed) {
        return;
      }

      try {
        const exitResult =
          forceEveryoneToExit(
            selectedEvent.name
          );

        onForceEndEvent(
          selectedEvent.id
        );

        alert(
          [
            "イベントを強制終了しました。",
            "",
            `来場者 ${exitResult.ticketCount}人を退出扱いにしました。`,
            `部員 ${exitResult.memberCount}人を退出扱いにしました。`,
          ].join("\n")
        );
      } catch (error) {
        console.error(
          "イベント終了処理に失敗しました。",
          error
        );

        alert(
          "イベントを終了できませんでした。\nデータは変更されていない可能性があります。"
        );
      }
    };

  const handleDelete =
    () => {
      if (
        selectedEvent === null
      ) {
        return;
      }

      const confirmed =
        window.confirm(
          `${selectedEvent.name}をイベント一覧から削除しますか？`
        );

      if (!confirmed) {
        return;
      }

      const finalConfirmed =
        window.confirm(
          "一覧から完全に削除します。\n本当によろしいですか？"
        );

      if (!finalConfirmed) {
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
      <header className="event-management-header">
        <div>
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <h2>
            イベント管理
          </h2>
        </div>

        <div className="event-management-mode">
          管理モード
        </div>
      </header>

      <main className="event-management-main">
        <button
          type="button"
          className="create-event-button"
          onClick={() =>
            setPage(
              "create-event"
            )
          }
        >
          <span className="plus">
            ＋
          </span>

          イベントを新規作成
        </button>

        <section className="event-list-section">
          <div className="event-list-heading">
            <h3>
              イベント一覧
            </h3>

            <span>
              {events.length}件
            </span>
          </div>

          <div className="event-table">
            <div className="event-table-row event-table-header">
              <div>
                イベント
              </div>

              <div>
                日付
              </div>

              <div>
                状態
              </div>
            </div>

            <div className="event-table-scroll">
              {sortedEvents.length ===
              0 ? (
                <div className="event-empty-message">
                  イベントがありません
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

                    return (
                      <button
                        type="button"
                        className={`event-table-row event-table-item ${
                          isCurrent
                            ? "current-event-row"
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
                        <div className="event-name-cell">
                          <span>
                            {
                              event.name
                            }
                          </span>

                          {isCurrent && (
                            <small>
                              現在のイベント
                            </small>
                          )}
                        </div>

                        <div>
                          {formatListDate(
                            event.date
                          )}
                        </div>

                        <div>
                          <span
                            className={`event-status-label ${statusClass}`}
                          >
                            {status}
                          </span>
                        </div>
                      </button>
                    );
                  }
                )
              )}
            </div>
          </div>
        </section>

        {selectedEvent !==
          null &&
          selectedStatus !==
            null && (
          <div
            className="event-detail-modal-background"
            role="presentation"
            onMouseDown={(event) => {
              if (
                event.target ===
                event.currentTarget
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
              <div className="event-detail-title-row">
                <h3>
                  イベント詳細
                </h3>

                <span
                  className={`event-detail-status ${getStatusClassName(
                    selectedStatus
                  )}`}
                >
                  {
                    selectedStatus
                  }
                </span>
              </div>

              {selectedEvent.id ===
                currentEventId && (
                <div className="current-event-notice">
                  現在このイベントが受付に使用されています
                </div>
              )}

              <div className="event-detail-row">
                <span>
                  イベント名
                </span>

                <strong>
                  {
                    selectedEvent.name
                  }
                </strong>
              </div>

              <div className="event-detail-row">
                <span>
                  開催日
                </span>

                <strong>
                  {formatFullDate(
                    selectedEvent.date
                  )}
                </strong>
              </div>

              <div className="event-detail-row">
                <span>
                  受付時間
                </span>

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

              {selectedEvent.endedAt !==
                undefined && (
                <div className="event-detail-row">
                  <span>
                    強制終了日時
                  </span>

                  <strong>
                    {formatEndedAt(
                      selectedEvent.endedAt
                    )}
                  </strong>
                </div>
              )}

              <div className="event-detail-actions">
                <button
                  type="button"
                  className="event-detail-close"
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
                      currentEventId
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
                    "終了"
                  }
                  onClick={
                    handleForceEnd
                  }
                >
                  {selectedStatus ===
                  "終了"
                    ? "イベント終了済み"
                    : "イベントを強制終了"}
                </button>

                <button
                  type="button"
                  className="event-delete-button"
                  onClick={
                    handleDelete
                  }
                >
                  イベントを削除する
                </button>
              </div>
            </section>
          </div>
        )}
      </main>

      <button
        type="button"
        className="event-management-back"
        onClick={() =>
          setPage("admin")
        }
      >
        前のページに戻る
      </button>
    </div>
  );
}

export default EventManagementPage;