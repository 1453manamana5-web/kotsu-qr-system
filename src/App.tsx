import {
  useEffect,
  useRef,
  useState,
} from "react";

import "./App.css";

import HomePage from "./pages/HomePage";
import EntryPage from "./pages/EntryPage";
import ExitPage from "./pages/ExitPage";
import AdminPage from "./pages/AdminPage";
import AdminAuthPage from "./pages/AdminAuthPage";
import EventManagementPage from "./pages/EventManagementPage";
import CreateEventPage from "./pages/CreateEventPage";
import MembersPage from "./pages/MembersPage";
import TicketsPage from "./pages/TicketsPage";
import AnalysisPage from "./pages/AnalysisPage";
import PastDataPage from "./pages/PastDataPage";
import SettingsPage from "./pages/SettingsPage";
import FirebaseTestPage from "./pages/FirebaseTestPage";

import {
  createEventInFirestore,
  deleteEventFromFirestore,
  saveEventToFirestore,
  setCurrentEventIdInFirestore,
  subscribeToCurrentEventId,
  subscribeToEvents,
  type EventData,
  type EventStatus,
  type EventStore,
} from "./eventFirestore";

import {
  subscribeToTickets,
} from "./ticketFirestore";

import {
  subscribeToEventMembers,
  subscribeToMemberCards,
} from "./memberFirestore";

type NewEventData = {
  name: string;
  date: string;
  startTime: string;
  endTime: string;
};

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
  source?:
    | "scanner"
    | "manual";
};

type Page =
  | "home"
  | "entry"
  | "exit"
  | "admin-auth"
  | "admin"
  | "events"
  | "create-event"
  | "members"
  | "tickets"
  | "analysis"
  | "past-data"
  | "settings"
  | "firebase-test";

type AdminOrigin =
  | "home"
  | "entry"
  | "exit";

const EVENTS_STORAGE_KEY =
  "qr-management-events";

const CURRENT_EVENT_ID_STORAGE_KEY =
  "qr-management-current-event-id";

const LEGACY_CURRENT_EVENT_KEY =
  "qr-management-current-event";

function isStoredEvent(
  value: unknown
): value is EventData {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const event = value as
    Partial<EventData>;

  return (
    typeof event.id === "string" &&
    typeof event.name === "string" &&
    typeof event.date === "string" &&
    typeof event.startTime === "string" &&
    typeof event.endTime === "string" &&
    (
      event.status === undefined ||
      event.status === "scheduled" ||
      event.status === "active" ||
      event.status === "ended"
    ) &&
    (
      event.endedAt === undefined ||
      typeof event.endedAt === "string"
    )
  );
}

function loadStoredEventStore(): EventStore {
  try {
    const savedEvents =
      localStorage.getItem(
        EVENTS_STORAGE_KEY
      );

    const parsedEvents: unknown =
      savedEvents === null
        ? []
        : JSON.parse(savedEvents);

    const events = Array.isArray(
      parsedEvents
    )
      ? parsedEvents.filter(
          isStoredEvent
        )
      : [];

    const savedCurrentEventId =
      localStorage.getItem(
        CURRENT_EVENT_ID_STORAGE_KEY
      );

    return {
      events,
      currentEventId:
        typeof savedCurrentEventId ===
          "string" &&
        savedCurrentEventId !== ""
          ? savedCurrentEventId
          : null,
    };
  } catch (error) {
    console.warn(
      "保存済みイベント情報を読み込めませんでした。",
      error
    );

    return {
      events: [],
      currentEventId: null,
    };
  }
}

function createSafeRandomId() {
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
      "IDの生成にrandomUUIDを使用できませんでした。",
      error
    );
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

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

    if (
      savedData === null
    ) {
      return [];
    }

    const parsedData: unknown =
      JSON.parse(
        savedData
      );

    if (
      !Array.isArray(
        parsedData
      )
    ) {
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

    if (
      savedData === null
    ) {
      return [];
    }

    const parsedData: unknown =
      JSON.parse(
        savedData
      );

    if (
      !Array.isArray(
        parsedData
      )
    ) {
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

    if (
      savedData === null
    ) {
      return [];
    }

    const parsedData: unknown =
      JSON.parse(
        savedData
      );

    return Array.isArray(
      parsedData
    )
      ? (
          parsedData as
            ActivityLog[]
        )
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
  eventName: string,
  endedAt: string
) {
  const tickets =
    loadTickets(
      eventName
    );

  const members =
    loadMembers(
      eventName
    );

  const activityLogs =
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

  if (
    insideTickets.length ===
      0 &&
    insideMembers.length ===
      0
  ) {
    return;
  }

  const updatedTickets =
    tickets.map(
      (ticket): Ticket =>
        ticket.status ===
        "入場中"
          ? {
              ...ticket,
              status:
                "使用済み",
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
              status:
                "退出済み",
            }
          : member
    );

  const ticketExitLogs:
    ActivityLog[] =
    insideTickets.map(
      (ticket) => ({
        id:
          createSafeRandomId(),

        type:
          "ticket-exit",

        qrNumber:
          ticket.qrNumber,

        timestamp:
          endedAt,

        source:
          "manual",
      })
    );

  const memberExitLogs:
    ActivityLog[] =
    insideMembers.map(
      (member) => ({
        id:
          createSafeRandomId(),

        type:
          "member-exit",

        qrNumber:
          member.qrNumber,

        timestamp:
          endedAt,

        source:
          "manual",
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
      ...activityLogs,
      ...ticketExitLogs,
      ...memberExitLogs,
    ])
  );
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

function getRuntimeStatus(
  eventData: EventData
): EventStatus {
  if (
    eventData.status ===
      "ended" ||
    typeof eventData.endedAt ===
      "string"
  ) {
    return "ended";
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
    return "scheduled";
  }

  const currentTime =
    Date.now();

  if (
    currentTime <
    startDate.getTime()
  ) {
    return "scheduled";
  }

  if (
    currentTime >=
    endDate.getTime()
  ) {
    return "ended";
  }

  return "active";
}

function App() {
  const [
    eventStore,
    setEventStore,
  ] = useState<EventStore>(
    loadStoredEventStore
  );

  const hasUsableEventsRef =
    useRef(
      eventStore.events.length > 0
    );

  const hasCurrentEventRef =
    useRef(
      eventStore.currentEventId !==
        null
    );

  const [
    page,
    setPage,
  ] = useState<Page>(
    "home"
  );

  /*
    受付で使う3画面と管理メニューは、ブラウザ全体が
    スクロールしないよう表示領域に固定します。
    一覧など内部スクロールが必要な画面では、この指定を外します。
  */
  useEffect(() => {
    const shouldLockViewport =
      page === "home" ||
      page === "entry" ||
      page === "exit" ||
      page === "admin";

    document.documentElement.classList.toggle(
      "viewport-locked",
      shouldLockViewport
    );

    document.body.classList.toggle(
      "viewport-locked",
      shouldLockViewport
    );

    return () => {
      document.documentElement.classList.remove(
        "viewport-locked"
      );

      document.body.classList.remove(
        "viewport-locked"
      );
    };
  }, [page]);

  const [
    adminOrigin,
    setAdminOrigin,
  ] = useState<AdminOrigin>(
    "home"
  );

  const [
    eventSyncReady,
    setEventSyncReady,
  ] = useState(
    () =>
      eventStore.events.length > 0 ||
      navigator.onLine === false
  );

  const [
    eventSyncError,
    setEventSyncError,
  ] = useState("");

  /*
    自動終了処理を同じ端末内で
    何度も実行しないために使います。
  */
  const endingEventIdsRef =
    useRef(
      new Set<string>()
    );

  /*
    Firestoreからイベント一覧を
    リアルタイム受信します。
  */
  useEffect(() => {
    const unsubscribeEvents =
      subscribeToEvents(
        (events, fromCache) => {
          if (
            fromCache &&
            events.length === 0 &&
            hasUsableEventsRef.current
          ) {
            setEventSyncReady(true);
            setEventSyncError("");
            return;
          }

          hasUsableEventsRef.current =
            events.length > 0;

          setEventStore(
            (currentStore) => ({
              ...currentStore,
              events,
            })
          );

          try {
            localStorage.setItem(
              EVENTS_STORAGE_KEY,
              JSON.stringify(
                events
              )
            );
          } catch (error) {
            console.warn(
              "イベントのローカル保存に失敗しました。",
              error
            );
          }

          setEventSyncReady(
            true
          );

          setEventSyncError(
            ""
          );
        },

        (error) => {
          setEventSyncReady(
            true
          );

          setEventSyncError(
            hasUsableEventsRef.current ||
            navigator.onLine === false
              ? ""
              : error.message
          );
        }
      );

    const unsubscribeCurrentEvent =
      subscribeToCurrentEventId(
        (
          currentEventId,
          fromCache
        ) => {
          if (
            fromCache &&
            currentEventId === null &&
            hasCurrentEventRef.current
          ) {
            return;
          }

          hasCurrentEventRef.current =
            currentEventId !== null;

          setEventStore(
            (currentStore) => ({
              ...currentStore,
              currentEventId,
            })
          );

          try {
            if (
              currentEventId ===
              null
            ) {
              localStorage.removeItem(
                CURRENT_EVENT_ID_STORAGE_KEY
              );
            } else {
              localStorage.setItem(
                CURRENT_EVENT_ID_STORAGE_KEY,
                currentEventId
              );
            }
          } catch (error) {
            console.warn(
              "現在のイベントIDのローカル保存に失敗しました。",
              error
            );
          }
        },

        (error) => {
          setEventSyncError(
            hasUsableEventsRef.current ||
            navigator.onLine === false
              ? ""
              : error.message
          );
        }
      );

    return () => {
      unsubscribeEvents();
      unsubscribeCurrentEvent();
    };
  }, []);

  /*
    従来の画面との互換性のため、
    現在のイベントをlocalStorageにも保存します。

    正式な共有元はFirestoreです。
  */
  useEffect(() => {
    const currentEvent =
      eventStore.events.find(
        (event) =>
          event.id ===
          eventStore.currentEventId
      );

    try {
      if (
        currentEvent ===
        undefined
      ) {
        localStorage.removeItem(
          LEGACY_CURRENT_EVENT_KEY
        );

        return;
      }

      localStorage.setItem(
        LEGACY_CURRENT_EVENT_KEY,
        JSON.stringify(
          currentEvent
        )
      );
    } catch (error) {
      console.warn(
        "現在のイベントのローカル保存に失敗しました。",
        error
      );
    }
  }, [
    eventStore.events,
    eventStore.currentEventId,
  ]);

  const currentEvent =
    eventStore.events.find(
      (event) =>
        event.id ===
        eventStore.currentEventId
    ) ?? null;

  useEffect(() => {
    const eventName =
      currentEvent?.name ?? "";

    if (eventName.trim() === "") {
      return;
    }

    const handleCacheError = (
      error: Error
    ) => {
      if (navigator.onLine) {
        console.warn(
          "オフライン受付データの準備に失敗しました。",
          error
        );
      }
    };

    const unsubscribeTickets =
      subscribeToTickets(
        eventName,
        () => {
          // チケットを端末へ保存します。
        },
        handleCacheError
      );

    const unsubscribeCards =
      subscribeToMemberCards(
        () => {
          // 部員QR台帳を端末へ保存します。
        },
        handleCacheError
      );

    const unsubscribeMembers =
      subscribeToEventMembers(
        eventName,
        () => {
          // 部員の入退室状態を端末へ保存します。
        },
        handleCacheError
      );

    return () => {
      unsubscribeTickets();
      unsubscribeCards();
      unsubscribeMembers();
    };
  }, [
    currentEvent?.name,
  ]);

  const currentEventStatus =
    currentEvent === null
      ? null
      : getRuntimeStatus(
          currentEvent
        );

  const eventConfigured =
    currentEvent !== null &&
    currentEventStatus !==
      "ended";

  /*
    開催終了時刻を過ぎたイベントを
    Firestore上で自動終了します。
  */
  useEffect(() => {
    const checkEndedEvents =
      async () => {
        const now =
          Date.now();

        const eventsToEnd =
          eventStore.events.filter(
            (event) => {
              if (
                event.status ===
                  "ended" ||
                typeof event.endedAt ===
                  "string" ||
                endingEventIdsRef.current.has(
                  event.id
                )
              ) {
                return false;
              }

              const endDate =
                createEventDateTime(
                  event.date,
                  event.endTime
                );

              return (
                endDate !== null &&
                now >=
                  endDate.getTime()
              );
            }
          );

        for (
          const event of
          eventsToEnd
        ) {
          endingEventIdsRef.current.add(
            event.id
          );

          const endDate =
            createEventDateTime(
              event.date,
              event.endTime
            );

          const endedAt =
            endDate?.toISOString() ??
            new Date().toISOString();

          try {
            /*
              チケット・部員はまだlocalStorage版なので、
              現時点ではこの端末内の退出処理です。

              次の作業でFirestore共有へ移します。
            */
            forceEveryoneToExit(
              event.name,
              endedAt
            );

            await saveEventToFirestore({
              ...event,
              status:
                "ended",
              endedAt,
            });

            if (
              eventStore.currentEventId ===
              event.id
            ) {
              await setCurrentEventIdInFirestore(
                null
              );
            }
          } catch (error) {
            console.error(
              `${event.name}の自動終了に失敗しました。`,
              error
            );

            endingEventIdsRef.current.delete(
              event.id
            );
          }
        }
      };

    void checkEndedEvents();

    const timer =
      window.setInterval(
        () => {
          void checkEndedEvents();
        },
        1000
      );

    return () => {
      window.clearInterval(
        timer
      );
    };
  }, [
    eventStore.events,
    eventStore.currentEventId,
  ]);

  const changePage = (
    newPage: string
  ) => {
    if (
      newPage === "admin" &&
      page === "home"
    ) {
      setAdminOrigin(
        "home"
      );
    }

    setPage(
      newPage as Page
    );
  };

  const openAdminAuth = (
    origin:
      | "entry"
      | "exit"
  ) => {
    setAdminOrigin(
      origin
    );

    setPage(
      "admin-auth"
    );
  };

  const returnFromAdmin =
    () => {
      if (
        adminOrigin ===
        "entry"
      ) {
        setPage(
          "entry"
        );

        return;
      }

      if (
        adminOrigin ===
        "exit"
      ) {
        setPage(
          "exit"
        );

        return;
      }

      setPage(
        "home"
      );
    };

  const createEvent = (
    newEventData:
      NewEventData
  ) => {
    const runCreateEvent =
      async () => {
        const newEvent:
          EventData = {
          id:
            createSafeRandomId(),

          ...newEventData,

          status:
            "scheduled",
        };

        try {
          await createEventInFirestore(
            newEvent
          );
        } catch (error) {
          console.error(
            "イベントの作成に失敗しました。",
            error
          );

          alert(
            "イベントを作成できませんでした。\n通信状態を確認してください。"
          );
        }
      };

    void runCreateEvent();
  };

  const selectCurrentEvent =
    (
      eventId: string
    ) => {
      const runSelectEvent =
        async () => {
          const selectedEvent =
            eventStore.events.find(
              (event) =>
                event.id ===
                eventId
            );

          if (
            selectedEvent ===
            undefined
          ) {
            alert(
              "イベントが見つかりません。"
            );

            return;
          }

          if (
            getRuntimeStatus(
              selectedEvent
            ) === "ended"
          ) {
            alert(
              "終了したイベントは現在のイベントに設定できません。"
            );

            return;
          }

          try {
            await setCurrentEventIdInFirestore(
              eventId
            );
          } catch (error) {
            console.error(
              "現在のイベントの変更に失敗しました。",
              error
            );

            alert(
              "現在のイベントを変更できませんでした。\n通信状態を確認してください。"
            );
          }
        };

      void runSelectEvent();
    };

  const forceEndEvent = (
    eventId: string
  ) => {
    const runForceEndEvent =
      async () => {
        const targetEvent =
          eventStore.events.find(
            (event) =>
              event.id ===
              eventId
          );

        if (
          targetEvent ===
          undefined
        ) {
          alert(
            "終了するイベントが見つかりません。"
          );

          return;
        }

        if (
          targetEvent.status ===
            "ended" ||
          typeof targetEvent.endedAt ===
            "string"
        ) {
          return;
        }

        const endedAt =
          new Date().toISOString();

        try {
          forceEveryoneToExit(
            targetEvent.name,
            endedAt
          );

          await saveEventToFirestore({
            ...targetEvent,

            status:
              "ended",

            endedAt,
          });

          if (
            eventStore.currentEventId ===
            eventId
          ) {
            await setCurrentEventIdInFirestore(
              null
            );
          }
        } catch (error) {
          console.error(
            "イベントの終了に失敗しました。",
            error
          );

          alert(
            "イベントを終了できませんでした。\n通信状態を確認してください。"
          );
        }
      };

    void runForceEndEvent();
  };

  const deleteEvent = (
    eventId: string
  ) => {
    const runDeleteEvent =
      async () => {
        try {
          await deleteEventFromFirestore(
            eventId,
            eventStore.currentEventId ===
              eventId
          );
        } catch (error) {
          console.error(
            "イベントの削除に失敗しました。",
            error
          );

          alert(
            "イベントを削除できませんでした。\n通信状態を確認してください。"
          );
        }
      };

    void runDeleteEvent();
  };

  const resetAllData =
    () => {
      const runResetAllData =
        async () => {
          try {
            /*
              現在Firestoreに移したイベント情報を削除します。
              チケット・部員・履歴はまだlocalStorage版です。
            */
            await Promise.all(
              eventStore.events.map(
                (event) =>
                  deleteEventFromFirestore(
                    event.id,
                    false
                  )
              )
            );

            await setCurrentEventIdInFirestore(
              null
            );

            const keysToDelete:
              string[] = [];

            for (
              let index = 0;
              index <
              localStorage.length;
              index += 1
            ) {
              const key =
                localStorage.key(
                  index
                );

              if (
                key !== null &&
                key.startsWith(
                  "qr-management-"
                )
              ) {
                keysToDelete.push(
                  key
                );
              }
            }

            keysToDelete.forEach(
              (key) => {
                localStorage.removeItem(
                  key
                );
              }
            );

            setAdminOrigin(
              "home"
            );

            setPage(
              "home"
            );

            alert(
              "QR管理システムのデータを初期化しました。"
            );
          } catch (error) {
            console.error(
              "データの初期化に失敗しました。",
              error
            );

            alert(
              "データを初期化できませんでした。\n通信状態を確認してください。"
            );
          }
        };

      void runResetAllData();
    };

  if (
    !eventSyncReady
  ) {
    return (
      <div
        style={{
          minHeight:
            "100vh",

          display:
            "grid",

          placeItems:
            "center",

          background:
            "#f4f4f4",

          color:
            "#222",

          fontSize:
            "28px",

          fontWeight:
            "bold",
        }}
      >
        Firebaseからイベント情報を読み込んでいます…
      </div>
    );
  }

  if (
    eventSyncError !== ""
  ) {
    return (
      <div
        style={{
          minHeight:
            "100vh",

          display:
            "grid",

          placeItems:
            "center",

          padding:
            "30px",

          boxSizing:
            "border-box",

          background:
            "#f4f4f4",

          color:
            "#222",
        }}
      >
        <div
          style={{
            maxWidth:
              "800px",

            padding:
              "30px",

            borderRadius:
              "20px",

            background:
              "#ffffff",

            textAlign:
              "center",
          }}
        >
          <h1>
            Firebaseに接続できません
          </h1>

          <p
            style={{
              fontSize:
                "22px",
            }}
          >
            インターネット接続とFirestoreの設定を確認してください。
          </p>

          <p>
            {eventSyncError}
          </p>

          <button
            type="button"
            onClick={() =>
              window.location.reload()
            }
            style={{
              minHeight:
                "60px",

              padding:
                "10px 26px",

              border:
                "none",

              borderRadius:
                "12px",

              background:
                "#9966ee",

              color:
                "#ffffff",

              fontSize:
                "22px",

              fontWeight:
                "bold",

              cursor:
                "pointer",
            }}
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }

  switch (page) {
    case "entry":
      return (
        <EntryPage
          setPage={
            changePage
          }
          openAdminAuth={() =>
            openAdminAuth(
              "entry"
            )
          }
        />
      );

    case "exit":
      return (
        <ExitPage
          setPage={
            changePage
          }
          openAdminAuth={() =>
            openAdminAuth(
              "exit"
            )
          }
        />
      );

    case "admin-auth":
      return (
        <AdminAuthPage
          setPage={
            changePage
          }
          eventName={
            currentEvent?.name ??
            ""
          }
          returnPage={
            adminOrigin
          }
        />
      );

    case "admin":
      return (
        <AdminPage
          setPage={
            changePage
          }
          eventConfigured={
            eventConfigured
          }
          eventName={
            currentEvent?.name ??
            ""
          }
          adminOrigin={
            adminOrigin
          }
          onReturn={
            returnFromAdmin
          }
        />
      );

    case "events":
      return (
        <EventManagementPage
          setPage={
            changePage
          }
          events={
            eventStore.events
          }
          currentEventId={
            eventStore.currentEventId
          }
          onSelectCurrentEvent={
            selectCurrentEvent
          }
          onDeleteEvent={
            deleteEvent
          }
          onForceEndEvent={
            forceEndEvent
          }
        />
      );

    case "create-event":
      return (
        <CreateEventPage
          setPage={
            changePage
          }
          onCreateEvent={
            createEvent
          }
        />
      );

    case "members":
      return (
        <MembersPage
          setPage={
            changePage
          }
          eventName={
            currentEvent?.name ??
            ""
          }
        />
      );

    case "tickets":
      return (
        <TicketsPage
          setPage={
            changePage
          }
          eventName={
            currentEvent?.name ??
            ""
          }
        />
      );

    case "analysis":
      return (
        <AnalysisPage
          setPage={
            changePage
          }
          eventData={
            currentEvent
          }
        />
      );

    case "past-data":
      return (
        <PastDataPage
          setPage={
            changePage
          }
          events={
            eventStore.events
          }
        />
      );

    case "settings":
      return (
        <SettingsPage
          setPage={
            changePage
          }
          eventName={
            currentEvent?.name ??
            ""
          }
          onResetAllData={
            resetAllData
          }
        />
      );

    case "firebase-test":
      return (
        <FirebaseTestPage
          setPage={
            changePage
          }
        />
      );

    default:
      return (
        <HomePage
          setPage={
            changePage
          }
          eventConfigured={
            eventConfigured
          }
          eventName={
            currentEvent?.name ??
            ""
          }
        />
      );
  }
}

export default App;
