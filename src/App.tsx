import {
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import "./App.css";

import HomePage from "./pages/HomePage";

const loadEntryPage = () =>
  import("./pages/EntryPage");

const loadExitPage = () =>
  import("./pages/ExitPage");

const EntryPage = lazy(
  loadEntryPage
);

const ExitPage = lazy(
  loadExitPage
);

const AdminPage = lazy(() =>
  import("./pages/AdminPage")
);

const AdminAuthPage = lazy(() =>
  import("./pages/AdminAuthPage")
);

const EventManagementPage = lazy(() =>
  import("./pages/EventManagementPage")
);

const CreateEventPage = lazy(() =>
  import("./pages/CreateEventPage")
);

const MembersPage = lazy(() =>
  import("./pages/MembersPage")
);

const TicketsPage = lazy(() =>
  import("./pages/TicketsPage")
);

const AnalysisPage = lazy(() =>
  import("./pages/AnalysisPage")
);

const PastDataPage = lazy(() =>
  import("./pages/PastDataPage")
);

const SettingsPage = lazy(() =>
  import("./pages/SettingsPage")
);

const FirebaseTestPage = lazy(() =>
  import("./pages/FirebaseTestPage")
);

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

import {
  getEventDataId,
  createSafeRandomId,
  registerEventDataId,
} from "./firestorePaths";

import {
  migrateAllEventDataToIds,
} from "./eventDataMigration";

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
    ) &&
    (
      event.dataDocumentId ===
        undefined ||
      typeof event.dataDocumentId ===
        "string"
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

    events.forEach(
      (event) => {
        if (
          event.dataDocumentId !==
          undefined
        ) {
          registerEventDataId(
            event.name,
            event.dataDocumentId
          );
        }
      }
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

function createTicketStorageKey(
  eventName: string
) {
  return `qr-management-event-tickets-${getEventDataId(
    eventName
  )}`;
}

function createMemberStorageKey(
  eventName: string
) {
  return `qr-management-event-members-${getEventDataId(
    eventName
  )}`;
}

function createActivityStorageKey(
  eventName: string
) {
  return `qr-management-event-activity-${getEventDataId(
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

function findClosestSelectableEvent(
  events: EventData[]
) {
  const today =
    new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  const todayTime =
    today.getTime();

  return (
    events
      .filter(
        (event) =>
          getRuntimeStatus(
            event
          ) !== "ended"
      )
      .map((event) => {
        const eventDate =
          createEventDateTime(
            event.date,
            "00:00"
          );

        return {
          event,
          eventTime:
            eventDate?.getTime() ??
            Number.NaN,
        };
      })
      .filter(
        ({ eventTime }) =>
          Number.isFinite(
            eventTime
          )
      )
      .sort(
        (
          first,
          second
        ) => {
          const firstDistance =
            Math.abs(
              first.eventTime -
                todayTime
            );

          const secondDistance =
            Math.abs(
              second.eventTime -
                todayTime
            );

          if (
            firstDistance !==
            secondDistance
          ) {
            return (
              firstDistance -
              secondDistance
            );
          }

          const firstIsFuture =
            first.eventTime >=
            todayTime;

          const secondIsFuture =
            second.eventTime >=
            todayTime;

          if (
            firstIsFuture !==
            secondIsFuture
          ) {
            return firstIsFuture
              ? -1
              : 1;
          }

          if (
            first.eventTime !==
            second.eventTime
          ) {
            return (
              first.eventTime -
              second.eventTime
            );
          }

          const timeOrder =
            first.event.startTime.localeCompare(
              second.event.startTime
            );

          return timeOrder !== 0
            ? timeOrder
            : first.event.id.localeCompare(
                second.event.id
              );
        }
      )[0]?.event ??
    null
  );
}

function App() {
  useEffect(() => {
    const preloadTimer =
      window.setTimeout(
        () => {
          void Promise.all([
            loadEntryPage(),
            loadExitPage(),
          ]);
        },
        1200
      );

    return () => {
      window.clearTimeout(
        preloadTimer
      );
    };
  }, []);

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

  const allowEventDataMigrationRef =
    useRef(
      navigator.onLine
    );

  const needsInitialEventDataMigrationRef =
    useRef(
      eventStore.events.some(
        (event) =>
          event.dataDocumentId !==
          event.id
      )
    );

  const autoSelectingEventIdRef =
    useRef<
      string |
      null
    >(
      null
    );

  const [
    currentEventSyncReady,
    setCurrentEventSyncReady,
  ] = useState(
    () =>
      navigator.onLine === false
  );

  const [
    page,
    setPage,
  ] = useState<Page>(
    "home"
  );

  /*
    受付で使う3画面・管理メニュー・イベント管理は、
    ブラウザ全体がスクロールしないよう表示領域に固定します。
    イベント一覧など、必要な場所だけ内側でスクロールします。
  */
  useEffect(() => {
    const shouldLockViewport =
      page === "home" ||
      page === "entry" ||
      page === "exit" ||
      page === "admin" ||
      page === "events";

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
      navigator.onLine === false ||
      (
        eventStore.events.length > 0 &&
        eventStore.events.every(
          (event) =>
            event.dataDocumentId ===
            event.id
        )
      )
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
    let active =
      true;

    let migrationQueue =
      Promise.resolve();

    const applyEvents = (
      events: EventData[]
    ) => {
      if (!active) {
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
    };

    const unsubscribeEvents =
      subscribeToEvents(
        (events, fromCache) => {
          if (
            fromCache &&
            events.length === 0 &&
            hasUsableEventsRef.current
          ) {
            if (
              !allowEventDataMigrationRef.current ||
              !needsInitialEventDataMigrationRef.current
            ) {
              setEventSyncReady(
                true
              );
            }

            setEventSyncError("");
            return;
          }

          const needsMigration =
            events.some(
              (event) =>
                event.dataDocumentId !==
                event.id
            );

          if (
            fromCache &&
            allowEventDataMigrationRef.current &&
            navigator.onLine &&
            needsMigration
          ) {
            hasUsableEventsRef.current =
              events.length > 0;

            return;
          }

          if (
            fromCache ||
            navigator.onLine ===
              false ||
            !allowEventDataMigrationRef.current
          ) {
            applyEvents(events);

            return;
          }

          migrationQueue =
            migrationQueue.then(
              async () => {
                try {
                  const migration =
                    await migrateAllEventDataToIds(
                      events
                    );

                  applyEvents(
                    migration.events
                  );

                  if (
                    migration.changed &&
                    active
                  ) {
                    window.setTimeout(
                      () => {
                        window.location.reload();
                      },
                      100
                    );
                  }
                } catch (error) {
                  console.error(
                    "イベントデータをID形式へ移行できませんでした。旧形式のまま継続します。",
                    error
                  );

                  applyEvents(events);
                }
              }
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

          setCurrentEventSyncReady(
            true
          );

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
          setCurrentEventSyncReady(
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

    return () => {
      active = false;

      unsubscribeEvents();
      unsubscribeCurrentEvent();
    };
  }, []);

  const eventsById =
    useMemo(
      () =>
        new Map(
          eventStore.events.map(
            (event) => [
              event.id,
              event,
            ]
          )
        ),
      [eventStore.events]
    );

  const currentEvent =
    eventStore.currentEventId ===
    null
      ? null
      : eventsById.get(
          eventStore.currentEventId
        ) ?? null;

  /*
    現在のイベントが未設定・削除済み・終了済みの場合は、
    今日に最も近い未終了イベントを自動設定します。

    手動で有効なイベントを選択した場合は、
    その選択を維持します。
  */
  useEffect(() => {
    if (
      !eventSyncReady ||
      !currentEventSyncReady ||
      eventStore.events.length ===
        0
    ) {
      return;
    }

    if (
      currentEvent !==
        null &&
      getRuntimeStatus(
        currentEvent
      ) !== "ended"
    ) {
      autoSelectingEventIdRef.current =
        null;

      return;
    }

    const closestEvent =
      findClosestSelectableEvent(
        eventStore.events
      );

    if (
      closestEvent ===
        null ||
      closestEvent.id ===
        eventStore.currentEventId ||
      autoSelectingEventIdRef.current ===
        closestEvent.id
    ) {
      return;
    }

    autoSelectingEventIdRef.current =
      closestEvent.id;

    const selectClosestEvent =
      async () => {
        try {
          await setCurrentEventIdInFirestore(
            closestEvent.id
          );
        } catch (error) {
          console.error(
            "日付が最も近いイベントの自動設定に失敗しました。",
            error
          );
        } finally {
          if (
            autoSelectingEventIdRef.current ===
            closestEvent.id
          ) {
            autoSelectingEventIdRef.current =
              null;
          }
        }
      };

    void selectClosestEvent();
  }, [
    currentEvent,
    currentEventSyncReady,
    eventStore.currentEventId,
    eventStore.events,
    eventSyncReady,
  ]);

  /*
    従来の画面との互換性のため、
    現在のイベントをlocalStorageにも保存します。

    正式な共有元はFirestoreです。
  */
  useEffect(() => {
    try {
      if (
        currentEvent ===
        null
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
    currentEvent,
  ]);

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
        const eventId =
          createSafeRandomId();

        const newEvent:
          EventData = {
          id:
            eventId,

          dataDocumentId:
            eventId,

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
            eventsById.get(
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
          eventsById.get(
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
