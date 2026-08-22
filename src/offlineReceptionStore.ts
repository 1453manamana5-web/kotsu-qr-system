import {
  getEventDataId,
} from "./firestorePaths";

export type CachedTicketStatus =
  | "未使用"
  | "入場中"
  | "使用済み"
  | "無効";

export type CachedMemberStatus =
  | "未入室"
  | "入室中"
  | "退出済み";

export type CachedTicket = {
  id: string;
  qrNumber: string;
  authToken: string;
  status: CachedTicketStatus;
  createdAt: string;
};

export type CachedMemberCard = {
  id: string;
  qrNumber: string;
  authToken: string;
};

export type CachedEventMember = {
  qrNumber: string;
  name: string;
  status: CachedMemberStatus;
};

export type PendingTicketReception = {
  version: 2;
  id: string;
  kind: "ticket";
  eventName: string;
  eventDataId?: string;
  qrNumber: string;
  authToken: string;
  action: "entry" | "exit";
  nextStatus: "入場中" | "使用済み";
  isReEntry: boolean;
  capturedAt: string;
};

export type PendingMemberReception = {
  version: 2;
  id: string;
  kind: "member";
  eventName: string;
  eventDataId?: string;
  qrNumber: string;
  authToken: string;
  action: "entry" | "exit";
  nextStatus: "入室中" | "退出済み";
  memberName: string;
  capturedAt: string;
};

export type PendingReceptionOperation =
  | PendingTicketReception
  | PendingMemberReception;

type EventReceptionCache = {
  tickets: Record<string, CachedTicket>;
  members: Record<string, CachedEventMember>;
  updatedAt: string;
};

type ReceptionCache = {
  version: 2;
  memberCards: Record<string, CachedMemberCard>;
  events: Record<string, EventReceptionCache>;
};

export type OfflineTicketReceptionResult =
  | {
      success: true;
      ticket: CachedTicket;
      isReEntry: boolean;
    }
  | {
      success: false;
      reason:
        | "not-cached"
        | "invalid-token"
        | "invalid"
        | "duplicate"
        | "storage-failed";
    };

export type OfflineMemberReceptionResult =
  | {
      success: true;
      member: CachedMemberCard &
        CachedEventMember;
      action: "entry" | "exit";
    }
  | {
      success: false;
      reason:
        | "not-cached"
        | "invalid-token"
        | "duplicate"
        | "storage-failed";
    };

const CACHE_STORAGE_KEY =
  "qr-management-offline-reception-cache-v2";

const QUEUE_STORAGE_KEY =
  "qr-management-offline-reception-queue-v2";

const QUEUE_CHANGE_EVENT =
  "qr-management-reception-queue-change";

const DUPLICATE_WINDOW_MILLISECONDS =
  8 * 1000;

const emptyCache = (): ReceptionCache => ({
  version: 2,
  memberCards: {},
  events: {},
});

function getEventKey(eventName: string) {
  return getEventDataId(
    eventName
  );
}

function createOperationId() {
  try {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
  } catch (error) {
    console.warn(
      "オフライン受付IDを生成できませんでした。",
      error
    );
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function readCache(): ReceptionCache {
  try {
    const saved = localStorage.getItem(
      CACHE_STORAGE_KEY
    );

    if (saved === null) {
      return emptyCache();
    }

    const parsed = JSON.parse(saved) as
      Partial<ReceptionCache>;

    if (parsed.version !== 2) {
      return emptyCache();
    }

    return {
      version: 2,
      memberCards:
        parsed.memberCards ?? {},
      events:
        parsed.events ?? {},
    };
  } catch (error) {
    console.warn(
      "端末内のオフライン受付データを読み込めませんでした。",
      error
    );

    return emptyCache();
  }
}

function writeCache(cache: ReceptionCache) {
  try {
    localStorage.setItem(
      CACHE_STORAGE_KEY,
      JSON.stringify(cache)
    );

    return true;
  } catch (error) {
    console.error(
      "オフライン受付データを端末へ保存できませんでした。",
      error
    );

    return false;
  }
}

function isPendingOperation(
  value: unknown
): value is PendingReceptionOperation {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const operation = value as
    Partial<PendingReceptionOperation>;

  return (
    operation.version === 2 &&
    typeof operation.id === "string" &&
    typeof operation.eventName ===
      "string" &&
    (operation.eventDataId ===
      undefined ||
      typeof operation.eventDataId ===
        "string") &&
    typeof operation.qrNumber ===
      "string" &&
    typeof operation.authToken ===
      "string" &&
    typeof operation.capturedAt ===
      "string" &&
    (operation.kind === "ticket" ||
      operation.kind === "member") &&
    (operation.action === "entry" ||
      operation.action === "exit")
  );
}

export function getPendingReceptionOperations() {
  try {
    const saved = localStorage.getItem(
      QUEUE_STORAGE_KEY
    );

    if (saved === null) {
      return [];
    }

    const parsed = JSON.parse(saved) as
      unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter(isPendingOperation)
      .sort((first, second) =>
        first.capturedAt.localeCompare(
          second.capturedAt
        )
      );
  } catch (error) {
    console.warn(
      "同期待ちの受付データを読み込めませんでした。",
      error
    );

    return [];
  }
}

function notifyQueueChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(
      QUEUE_CHANGE_EVENT,
      {
        detail: {
          pendingCount:
            getPendingReceptionOperations()
              .length,
        },
      }
    )
  );
}

function writeQueue(
  operations: PendingReceptionOperation[]
) {
  try {
    localStorage.setItem(
      QUEUE_STORAGE_KEY,
      JSON.stringify(operations)
    );

    notifyQueueChanged();

    return true;
  } catch (error) {
    console.error(
      "受付データを同期キューへ保存できませんでした。",
      error
    );

    return false;
  }
}

function appendOperation(
  operation: PendingReceptionOperation
) {
  const operations =
    getPendingReceptionOperations();

  return writeQueue([
    ...operations,
    operation,
  ]);
}

export function removePendingReceptionOperation(
  operationId: string
) {
  const operations =
    getPendingReceptionOperations();

  return writeQueue(
    operations.filter(
      (operation) =>
        operation.id !== operationId
    )
  );
}

export function getPendingReceptionCount() {
  return getPendingReceptionOperations()
    .length;
}

export function subscribeToPendingReceptionCount(
  listener: (pendingCount: number) => void
) {
  const handleChange = () => {
    listener(
      getPendingReceptionCount()
    );
  };

  window.addEventListener(
    QUEUE_CHANGE_EVENT,
    handleChange
  );

  window.addEventListener(
    "storage",
    handleChange
  );

  handleChange();

  return () => {
    window.removeEventListener(
      QUEUE_CHANGE_EVENT,
      handleChange
    );

    window.removeEventListener(
      "storage",
      handleChange
    );
  };
}

function getOrCreateEventCache(
  cache: ReceptionCache,
  eventName: string
) {
  const eventKey = getEventKey(
    eventName
  );

  const eventCache =
    cache.events[eventKey] ?? {
      tickets: {},
      members: {},
      updatedAt:
        new Date().toISOString(),
    };

  cache.events[eventKey] = eventCache;

  return eventCache;
}

function applyPendingOperations(
  eventName: string,
  eventCache: EventReceptionCache
) {
  getPendingReceptionOperations()
    .filter(
      (operation) =>
        operation.eventDataId ===
          getEventKey(
            eventName
          ) ||
        (
          operation.eventDataId ===
            undefined &&
          operation.eventName ===
            eventName
        )
    )
    .forEach((operation) => {
      if (operation.kind === "ticket") {
        const ticket =
          eventCache.tickets[
            operation.qrNumber
          ];

        if (ticket !== undefined) {
          ticket.status =
            operation.nextStatus;
        }

        return;
      }

      const member =
        eventCache.members[
          operation.qrNumber
        ];

      eventCache.members[
        operation.qrNumber
      ] = {
        qrNumber:
          operation.qrNumber,
        name:
          member?.name ??
          operation.memberName,
        status:
          operation.nextStatus,
      };
    });
}

export function cacheTicketsForOffline(
  eventName: string,
  tickets: CachedTicket[]
) {
  if (eventName.trim() === "") {
    return;
  }

  const cache = readCache();
  const eventCache =
    getOrCreateEventCache(
      cache,
      eventName
    );

  eventCache.tickets =
    Object.fromEntries(
      tickets.map((ticket) => [
        ticket.qrNumber,
        { ...ticket },
      ])
    );

  eventCache.updatedAt =
    new Date().toISOString();

  applyPendingOperations(
    eventName,
    eventCache
  );

  writeCache(cache);
}

export function cacheMemberCardsForOffline(
  cards: CachedMemberCard[]
) {
  const cache = readCache();

  cache.memberCards =
    Object.fromEntries(
      cards.map((card) => [
        card.qrNumber,
        { ...card },
      ])
    );

  writeCache(cache);
}

export function cacheEventMembersForOffline(
  eventName: string,
  members: CachedEventMember[]
) {
  if (eventName.trim() === "") {
    return;
  }

  const cache = readCache();
  const eventCache =
    getOrCreateEventCache(
      cache,
      eventName
    );

  eventCache.members =
    Object.fromEntries(
      members.map((member) => [
        member.qrNumber,
        { ...member },
      ])
    );

  eventCache.updatedAt =
    new Date().toISOString();

  applyPendingOperations(
    eventName,
    eventCache
  );

  writeCache(cache);
}

function isRecentDuplicate(
  eventName: string,
  kind: "ticket" | "member",
  qrNumber: string,
  action: "entry" | "exit",
  capturedAt: string
) {
  const capturedTime =
    new Date(capturedAt).getTime();

  return getPendingReceptionOperations()
    .some((operation) => {
      const sameEvent =
        operation.eventDataId ===
          undefined
          ? operation.eventName ===
            eventName
          : operation.eventDataId ===
            getEventKey(
              eventName
            );

      if (
        !sameEvent ||
        operation.kind !== kind ||
        operation.qrNumber !==
          qrNumber ||
        operation.action !== action
      ) {
        return false;
      }

      const operationTime =
        new Date(
          operation.capturedAt
        ).getTime();

      return (
        Number.isFinite(operationTime) &&
        capturedTime - operationTime <
          DUPLICATE_WINDOW_MILLISECONDS
      );
    });
}

export function acceptTicketReceptionOffline(
  eventName: string,
  qrNumber: string,
  authToken: string,
  action: "entry" | "exit",
  receptionIdentity?: {
    id: string;
    capturedAt: string;
  }
): OfflineTicketReceptionResult {
  const cache = readCache();
  const eventCache =
    cache.events[
      getEventKey(eventName)
    ];

  const ticket =
    eventCache?.tickets[
      qrNumber
    ];

  if (ticket === undefined) {
    return {
      success: false,
      reason: "not-cached",
    };
  }

  if (ticket.authToken !== authToken) {
    return {
      success: false,
      reason: "invalid-token",
    };
  }

  if (ticket.status === "無効") {
    return {
      success: false,
      reason: "invalid",
    };
  }

  const capturedAt =
    receptionIdentity?.capturedAt ??
    new Date().toISOString();

  if (
    isRecentDuplicate(
      eventName,
      "ticket",
      qrNumber,
      action,
      capturedAt
    )
  ) {
    return {
      success: false,
      reason: "duplicate",
    };
  }

  const isReEntry =
    action === "entry" &&
    ticket.status !== "未使用";

  const nextStatus =
    action === "entry"
      ? "入場中"
      : "使用済み";

  const operation: PendingTicketReception = {
    version: 2,
    id:
      receptionIdentity?.id ??
      createOperationId(),
    kind: "ticket",
    eventName,
    eventDataId:
      getEventKey(
        eventName
      ),
    qrNumber,
    authToken,
    action,
    nextStatus,
    isReEntry,
    capturedAt,
  };

  if (!appendOperation(operation)) {
    return {
      success: false,
      reason: "storage-failed",
    };
  }

  ticket.status = nextStatus;
  eventCache.updatedAt = capturedAt;
  writeCache(cache);

  return {
    success: true,
    ticket: { ...ticket },
    isReEntry,
  };
}

export function acceptMemberReceptionOffline(
  eventName: string,
  qrNumber: string,
  authToken: string,
  receptionIdentity?: {
    id: string;
    capturedAt: string;
  }
): OfflineMemberReceptionResult {
  const cache = readCache();
  const card =
    cache.memberCards[qrNumber];

  if (card === undefined) {
    return {
      success: false,
      reason: "not-cached",
    };
  }

  if (card.authToken !== authToken) {
    return {
      success: false,
      reason: "invalid-token",
    };
  }

  const eventCache =
    getOrCreateEventCache(
      cache,
      eventName
    );

  const currentMember =
    eventCache.members[qrNumber] ?? {
      qrNumber,
      name: "",
      status:
        "未入室" as CachedMemberStatus,
    };

  const nextStatus =
    currentMember.status === "入室中"
      ? "退出済み"
      : "入室中";

  const action =
    nextStatus === "入室中"
      ? "entry"
      : "exit";

  const capturedAt =
    receptionIdentity?.capturedAt ??
    new Date().toISOString();

  if (
    isRecentDuplicate(
      eventName,
      "member",
      qrNumber,
      "entry",
      capturedAt
    ) ||
    isRecentDuplicate(
      eventName,
      "member",
      qrNumber,
      "exit",
      capturedAt
    )
  ) {
    return {
      success: false,
      reason: "duplicate",
    };
  }

  const operation: PendingMemberReception = {
    version: 2,
    id:
      receptionIdentity?.id ??
      createOperationId(),
    kind: "member",
    eventName,
    eventDataId:
      getEventKey(
        eventName
      ),
    qrNumber,
    authToken,
    action,
    nextStatus,
    memberName:
      currentMember.name,
    capturedAt,
  };

  if (!appendOperation(operation)) {
    return {
      success: false,
      reason: "storage-failed",
    };
  }

  const member: CachedEventMember = {
    ...currentMember,
    status: nextStatus,
  };

  eventCache.members[qrNumber] =
    member;
  eventCache.updatedAt = capturedAt;
  writeCache(cache);

  return {
    success: true,
    member: {
      ...card,
      ...member,
    },
    action,
  };
}

export function updateCachedTicketStatus(
  eventName: string,
  qrNumber: string,
  status: CachedTicketStatus
) {
  const cache = readCache();
  const eventCache =
    cache.events[
      getEventKey(eventName)
    ];

  const ticket =
    eventCache?.tickets[qrNumber];

  if (ticket === undefined) {
    return;
  }

  ticket.status = status;
  eventCache.updatedAt =
    new Date().toISOString();
  writeCache(cache);
}

export function updateCachedMemberStatus(
  eventName: string,
  member: CachedEventMember
) {
  const cache = readCache();
  const eventCache =
    getOrCreateEventCache(
      cache,
      eventName
    );

  eventCache.members[
    member.qrNumber
  ] = { ...member };
  eventCache.updatedAt =
    new Date().toISOString();
  writeCache(cache);
}

export function isTransientReceptionError(
  error: unknown
) {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error)
  ) {
    return false;
  }

  const code = String(
    error.code
  ).replace("firestore/", "");

  return [
    "unavailable",
    "deadline-exceeded",
    "aborted",
    "cancelled",
    "internal",
    "unknown",
    "failed-precondition",
  ].includes(code);
}

export function migrateOfflineReceptionEvent(
  eventName: string,
  eventDataId: string
) {
  const legacyEventKey =
    encodeURIComponent(
      eventName.trim() === ""
        ? "event-not-set"
        : eventName.trim()
    );

  try {
    const cache =
      readCache();

    const legacyCache =
      cache.events[
        legacyEventKey
      ];

    const currentCache =
      cache.events[
        eventDataId
      ];

    if (
      legacyCache !==
      undefined &&
      legacyEventKey !==
        eventDataId
    ) {
      cache.events[
        eventDataId
      ] = {
        tickets: {
          ...legacyCache.tickets,
          ...currentCache?.tickets,
        },
        members: {
          ...legacyCache.members,
          ...currentCache?.members,
        },
        updatedAt:
          currentCache?.updatedAt ??
          legacyCache.updatedAt,
      };

      writeCache(cache);
    }

    const operations =
      getPendingReceptionOperations();

    const migratedOperations =
      operations.map(
        (operation) =>
          operation.eventName ===
          eventName
            ? {
                ...operation,
                eventDataId,
              }
            : operation
      );

    if (
      migratedOperations.some(
        (operation, index) =>
          operation !==
          operations[index]
      )
    ) {
      writeQueue(
        migratedOperations
      );
    }
  } catch (error) {
    console.warn(
      "オフライン受付データをイベントID形式へ移行できませんでした。",
      error
    );
  }
}
