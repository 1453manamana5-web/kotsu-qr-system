import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";

import {
  db,
} from "./firebase";

export type TicketStatus =
  | "未使用"
  | "入場中"
  | "使用済み"
  | "無効";

export type Ticket = {
  id: string;
  qrNumber: string;
  authToken: string;
  status: TicketStatus;
  createdAt: string;
};

export type ActivityType =
  | "ticket-entry"
  | "ticket-exit"
  | "member-entry"
  | "member-exit";

export type ActivityLog = {
  id: string;
  type: ActivityType;
  qrNumber: string;
  timestamp: string;
  isReEntry?: boolean;
  source?:
    | "scanner"
    | "manual";
};

export type TicketReceptionResult =
  | {
      success: true;
      ticket: Ticket;
      isReEntry?: boolean;
    }
  | {
      success: false;
      reason:
        | "not-found"
        | "invalid-token"
        | "invalid"
        | "already-inside"
        | "not-entered"
        | "already-exited";
    };

const EVENT_DATA_COLLECTION =
  "event-data";

const TICKETS_COLLECTION =
  "tickets";

const ACTIVITY_COLLECTION =
  "activity";

function createSafeEventId(
  eventName: string
) {
  const normalizedName =
    eventName.trim();

  return normalizedName === ""
    ? "event-not-set"
    : encodeURIComponent(
        normalizedName
      );
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

function isTicketStatus(
  value: unknown
): value is TicketStatus {
  return (
    value === "未使用" ||
    value === "入場中" ||
    value === "使用済み" ||
    value === "無効"
  );
}

function convertTicketDocument(
  documentId: string,
  data: DocumentData
): Ticket | null {
  if (
    typeof data.qrNumber !==
      "string" ||
    typeof data.authToken !==
      "string" ||
    typeof data.createdAt !==
      "string" ||
    !isTicketStatus(
      data.status
    )
  ) {
    return null;
  }

  return {
    id:
      typeof data.id ===
        "string"
        ? data.id
        : documentId,

    qrNumber:
      data.qrNumber,

    authToken:
      data.authToken,

    status:
      data.status,

    createdAt:
      data.createdAt,
  };
}

function getTicketsCollection(
  eventName: string
) {
  return collection(
    db,
    EVENT_DATA_COLLECTION,
    createSafeEventId(
      eventName
    ),
    TICKETS_COLLECTION
  );
}

function getTicketDocument(
  eventName: string,
  qrNumber: string
) {
  return doc(
    db,
    EVENT_DATA_COLLECTION,
    createSafeEventId(
      eventName
    ),
    TICKETS_COLLECTION,
    qrNumber
  );
}

function getActivityDocument(
  eventName: string,
  activityId: string
) {
  return doc(
    db,
    EVENT_DATA_COLLECTION,
    createSafeEventId(
      eventName
    ),
    ACTIVITY_COLLECTION,
    activityId
  );
}

export function subscribeToTickets(
  eventName: string,
  onTicketsChanged: (
    tickets: Ticket[]
  ) => void,
  onError?: (
    error: Error
  ) => void
): Unsubscribe {
  if (
    eventName.trim() === ""
  ) {
    onTicketsChanged([]);

    return () => {
      // イベント未設定時は解除処理なし
    };
  }

  return onSnapshot(
    getTicketsCollection(
      eventName
    ),

    (snapshot) => {
      const tickets =
        snapshot.docs
          .map(
            (
              documentSnapshot
            ) =>
              convertTicketDocument(
                documentSnapshot.id,
                documentSnapshot.data()
              )
          )
          .filter(
            (
              ticket
            ): ticket is Ticket =>
              ticket !== null
          )
          .sort(
            (
              firstTicket,
              secondTicket
            ) =>
              firstTicket.qrNumber.localeCompare(
                secondTicket.qrNumber,
                "ja-JP",
                {
                  numeric: true,
                }
              )
          );

      onTicketsChanged(
        tickets
      );
    },

    (error) => {
      console.error(
        "チケット一覧の同期に失敗しました。",
        error
      );

      onError?.(
        error
      );
    }
  );
}

export async function createTicketsInFirestore(
  eventName: string,
  tickets: Ticket[]
) {
  if (
    eventName.trim() === ""
  ) {
    throw new Error(
      "イベントが設定されていません。"
    );
  }

  /*
    Firestoreの一括書き込み数には上限があるため、
    450件ずつに分割して保存します。
  */
  const chunkSize =
    450;

  for (
    let startIndex = 0;
    startIndex <
    tickets.length;
    startIndex += chunkSize
  ) {
    const currentChunk =
      tickets.slice(
        startIndex,
        startIndex +
          chunkSize
      );

    const batch =
      writeBatch(db);

    currentChunk.forEach(
      (ticket) => {
        const ticketDocument =
          getTicketDocument(
            eventName,
            ticket.qrNumber
          );

        batch.set(
          ticketDocument,
          {
            id:
              ticket.id,

            qrNumber:
              ticket.qrNumber,

            authToken:
              ticket.authToken,

            status:
              ticket.status,

            createdAt:
              ticket.createdAt,

            updatedAt:
              serverTimestamp(),
          }
        );
      }
    );

    await batch.commit();
  }
}

export async function deleteTicketFromFirestore(
  eventName: string,
  qrNumber: string
) {
  await deleteDoc(
    getTicketDocument(
      eventName,
      qrNumber
    )
  );
}

export async function updateTicketStatusInFirestore(
  eventName: string,
  ticket: Ticket,
  newStatus: TicketStatus
) {
  const ticketDocument =
    getTicketDocument(
      eventName,
      ticket.qrNumber
    );

  const activityId =
    createSafeRandomId();

  const activityDocument =
    getActivityDocument(
      eventName,
      activityId
    );

  await runTransaction(
    db,
    async (
      transaction
    ) => {
      const ticketSnapshot =
        await transaction.get(
          ticketDocument
        );

      if (
        !ticketSnapshot.exists()
      ) {
        throw new Error(
          "対象のチケットが見つかりません。"
        );
      }

      const currentTicket =
        convertTicketDocument(
          ticketSnapshot.id,
          ticketSnapshot.data()
        );

      if (
        currentTicket === null
      ) {
        throw new Error(
          "チケット情報が壊れています。"
        );
      }

      if (
        currentTicket.status ===
        newStatus
      ) {
        return;
      }

      transaction.update(
        ticketDocument,
        {
          status:
            newStatus,

          updatedAt:
            serverTimestamp(),
        }
      );

      let activity:
        Omit<
          ActivityLog,
          "timestamp"
        > | null =
        null;

      if (
        currentTicket.status ===
          "未使用" &&
        newStatus ===
          "入場中"
      ) {
        activity = {
          id:
            activityId,

          type:
            "ticket-entry",

          qrNumber:
            currentTicket.qrNumber,

          isReEntry:
            false,

          source:
            "manual",
        };
      } else if (
        currentTicket.status ===
          "使用済み" &&
        newStatus ===
          "入場中"
      ) {
        activity = {
          id:
            activityId,

          type:
            "ticket-entry",

          qrNumber:
            currentTicket.qrNumber,

          isReEntry:
            true,

          source:
            "manual",
        };
      } else if (
        currentTicket.status ===
          "入場中" &&
        newStatus ===
          "使用済み"
      ) {
        activity = {
          id:
            activityId,

          type:
            "ticket-exit",

          qrNumber:
            currentTicket.qrNumber,

          source:
            "manual",
        };
      }

      if (
        activity !== null
      ) {
        transaction.set(
          activityDocument,
          {
            ...activity,

            timestamp:
              new Date().toISOString(),

            createdAt:
              serverTimestamp(),
          }
        );
      }
    }
  );
}

export async function processTicketEntryInFirestore(
  eventName: string,
  qrNumber: string,
  authToken: string
): Promise<TicketReceptionResult> {
  const ticketDocument =
    getTicketDocument(
      eventName,
      qrNumber
    );

  const activityId =
    createSafeRandomId();

  const activityDocument =
    getActivityDocument(
      eventName,
      activityId
    );

  return runTransaction(
    db,
    async (
      transaction
    ) => {
      const ticketSnapshot =
        await transaction.get(
          ticketDocument
        );

      if (
        !ticketSnapshot.exists()
      ) {
        return {
          success:
            false,

          reason:
            "not-found",
        };
      }

      const ticket =
        convertTicketDocument(
          ticketSnapshot.id,
          ticketSnapshot.data()
        );

      if (
        ticket === null
      ) {
        return {
          success:
            false,

          reason:
            "not-found",
        };
      }

      if (
        ticket.authToken !==
        authToken
      ) {
        return {
          success:
            false,

          reason:
            "invalid-token",
        };
      }

      if (
        ticket.status ===
        "無効"
      ) {
        return {
          success:
            false,

          reason:
            "invalid",
        };
      }

      if (
        ticket.status ===
        "入場中"
      ) {
        return {
          success:
            false,

          reason:
            "already-inside",
        };
      }

      const isReEntry =
        ticket.status ===
        "使用済み";

      const updatedTicket:
        Ticket = {
        ...ticket,

        status:
          "入場中",
      };

      transaction.update(
        ticketDocument,
        {
          status:
            "入場中",

          updatedAt:
            serverTimestamp(),
        }
      );

      transaction.set(
        activityDocument,
        {
          id:
            activityId,

          type:
            "ticket-entry",

          qrNumber:
            ticket.qrNumber,

          timestamp:
            new Date().toISOString(),

          isReEntry,

          source:
            "scanner",

          createdAt:
            serverTimestamp(),
        }
      );

      return {
        success:
          true,

        ticket:
          updatedTicket,

        isReEntry,
      };
    }
  );
}

export async function processTicketExitInFirestore(
  eventName: string,
  qrNumber: string,
  authToken: string
): Promise<TicketReceptionResult> {
  const ticketDocument =
    getTicketDocument(
      eventName,
      qrNumber
    );

  const activityId =
    createSafeRandomId();

  const activityDocument =
    getActivityDocument(
      eventName,
      activityId
    );

  return runTransaction(
    db,
    async (
      transaction
    ) => {
      const ticketSnapshot =
        await transaction.get(
          ticketDocument
        );

      if (
        !ticketSnapshot.exists()
      ) {
        return {
          success:
            false,

          reason:
            "not-found",
        };
      }

      const ticket =
        convertTicketDocument(
          ticketSnapshot.id,
          ticketSnapshot.data()
        );

      if (
        ticket === null
      ) {
        return {
          success:
            false,

          reason:
            "not-found",
        };
      }

      if (
        ticket.authToken !==
        authToken
      ) {
        return {
          success:
            false,

          reason:
            "invalid-token",
        };
      }

      if (
        ticket.status ===
        "無効"
      ) {
        return {
          success:
            false,

          reason:
            "invalid",
        };
      }

      if (
        ticket.status ===
        "未使用"
      ) {
        return {
          success:
            false,

          reason:
            "not-entered",
        };
      }

      if (
        ticket.status ===
        "使用済み"
      ) {
        return {
          success:
            false,

          reason:
            "already-exited",
        };
      }

      const updatedTicket:
        Ticket = {
        ...ticket,

        status:
          "使用済み",
      };

      transaction.update(
        ticketDocument,
        {
          status:
            "使用済み",

          updatedAt:
            serverTimestamp(),
        }
      );

      transaction.set(
        activityDocument,
        {
          id:
            activityId,

          type:
            "ticket-exit",

          qrNumber:
            ticket.qrNumber,

          timestamp:
            new Date().toISOString(),

          source:
            "scanner",

          createdAt:
            serverTimestamp(),
        }
      );

      return {
        success:
          true,

        ticket:
          updatedTicket,
      };
    }
  );
}

export async function saveActivityLogToFirestore(
  eventName: string,
  activity: Omit<
    ActivityLog,
    "id" | "timestamp"
  >
) {
  const activityId =
    createSafeRandomId();

  await setDoc(
    getActivityDocument(
      eventName,
      activityId
    ),
    {
      ...activity,

      id:
        activityId,

      timestamp:
        new Date().toISOString(),

      createdAt:
        serverTimestamp(),
    }
  );
}