import {
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "./firebase";

import {
  getPendingReceptionOperations,
  isTransientReceptionError,
  removePendingReceptionOperation,
  subscribeToPendingReceptionCount,
  type PendingReceptionOperation,
} from "./offlineReceptionStore";

const EVENT_DATA_COLLECTION =
  "event-data";

const TICKETS_COLLECTION =
  "tickets";

const MEMBER_CARDS_COLLECTION =
  "member-cards";

const EVENT_MEMBERS_COLLECTION =
  "members";

const ACTIVITY_COLLECTION =
  "activity";

const RETRY_INTERVAL_MILLISECONDS =
  15 * 1000;

let syncInProgress = false;
let syncStarted = false;

function createSafeEventId(
  eventName: string
) {
  const normalized = eventName.trim();

  return normalized === ""
    ? "event-not-set"
    : encodeURIComponent(normalized);
}

function getActivityDocument(
  operation: PendingReceptionOperation
) {
  return doc(
    db,
    EVENT_DATA_COLLECTION,
    createSafeEventId(
      operation.eventName
    ),
    ACTIVITY_COLLECTION,
    operation.id
  );
}

function shouldApplyStatus(
  currentLastReceptionAt: unknown,
  capturedAt: string
) {
  if (
    typeof currentLastReceptionAt !==
      "string" ||
    currentLastReceptionAt === ""
  ) {
    return true;
  }

  return (
    capturedAt.localeCompare(
      currentLastReceptionAt
    ) >= 0
  );
}

async function syncTicketOperation(
  operation: Extract<
    PendingReceptionOperation,
    { kind: "ticket" }
  >
) {
  const eventId = createSafeEventId(
    operation.eventName
  );

  const ticketDocument = doc(
    db,
    EVENT_DATA_COLLECTION,
    eventId,
    TICKETS_COLLECTION,
    operation.qrNumber
  );

  const activityDocument =
    getActivityDocument(operation);

  await runTransaction(
    db,
    async (transaction) => {
      const [
        activitySnapshot,
        ticketSnapshot,
      ] = await Promise.all([
        transaction.get(
          activityDocument
        ),
        transaction.get(
          ticketDocument
        ),
      ]);

      if (activitySnapshot.exists()) {
        return;
      }

      if (!ticketSnapshot.exists()) {
        throw new Error(
          `同期待ちチケット ${operation.qrNumber} が見つかりません。`
        );
      }

      const ticketData =
        ticketSnapshot.data();

      if (
        ticketData.authToken !==
        operation.authToken
      ) {
        throw new Error(
          `同期待ちチケット ${operation.qrNumber} の認証情報が一致しません。`
        );
      }

      if (
        shouldApplyStatus(
          ticketData.lastReceptionAt,
          operation.capturedAt
        )
      ) {
        transaction.update(
          ticketDocument,
          {
            status:
              operation.nextStatus,
            lastReceptionAt:
              operation.capturedAt,
            lastReceptionOperationId:
              operation.id,
            updatedAt:
              serverTimestamp(),
          }
        );
      }

      transaction.set(
        activityDocument,
        {
          id: operation.id,
          type:
            operation.action ===
            "entry"
              ? "ticket-entry"
              : "ticket-exit",
          qrNumber:
            operation.qrNumber,
          timestamp:
            operation.capturedAt,
          ...(operation.action ===
          "entry"
            ? {
                isReEntry:
                  operation.isReEntry,
              }
            : {}),
          source: "scanner",
          offline: true,
          createdAt:
            serverTimestamp(),
        }
      );
    }
  );
}

async function syncMemberOperation(
  operation: Extract<
    PendingReceptionOperation,
    { kind: "member" }
  >
) {
  const eventId = createSafeEventId(
    operation.eventName
  );

  const cardDocument = doc(
    db,
    MEMBER_CARDS_COLLECTION,
    operation.qrNumber
  );

  const memberDocument = doc(
    db,
    EVENT_DATA_COLLECTION,
    eventId,
    EVENT_MEMBERS_COLLECTION,
    operation.qrNumber
  );

  const activityDocument =
    getActivityDocument(operation);

  await runTransaction(
    db,
    async (transaction) => {
      const [
        activitySnapshot,
        cardSnapshot,
        memberSnapshot,
      ] = await Promise.all([
        transaction.get(
          activityDocument
        ),
        transaction.get(
          cardDocument
        ),
        transaction.get(
          memberDocument
        ),
      ]);

      if (activitySnapshot.exists()) {
        return;
      }

      if (!cardSnapshot.exists()) {
        throw new Error(
          `同期待ち部員QR ${operation.qrNumber} が見つかりません。`
        );
      }

      const cardData =
        cardSnapshot.data();

      if (
        cardData.authToken !==
        operation.authToken
      ) {
        throw new Error(
          `同期待ち部員QR ${operation.qrNumber} の認証情報が一致しません。`
        );
      }

      const memberData =
        memberSnapshot.exists()
          ? memberSnapshot.data()
          : {};

      if (
        shouldApplyStatus(
          memberData.lastReceptionAt,
          operation.capturedAt
        )
      ) {
        transaction.set(
          memberDocument,
          {
            qrNumber:
              operation.qrNumber,
            name:
              typeof memberData.name ===
              "string"
                ? memberData.name
                : operation.memberName,
            status:
              operation.nextStatus,
            lastReceptionAt:
              operation.capturedAt,
            lastReceptionOperationId:
              operation.id,
            updatedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          }
        );
      }

      transaction.set(
        activityDocument,
        {
          id: operation.id,
          type:
            operation.action ===
            "entry"
              ? "member-entry"
              : "member-exit",
          qrNumber:
            operation.qrNumber,
          timestamp:
            operation.capturedAt,
          source: "scanner",
          offline: true,
          createdAt:
            serverTimestamp(),
        }
      );
    }
  );
}

async function syncOperation(
  operation: PendingReceptionOperation
) {
  if (operation.kind === "ticket") {
    await syncTicketOperation(operation);
    return;
  }

  await syncMemberOperation(operation);
}

export async function syncPendingReceptionOperations() {
  if (
    syncInProgress ||
    typeof navigator === "undefined" ||
    !navigator.onLine
  ) {
    return;
  }

  syncInProgress = true;

  try {
    const operations =
      getPendingReceptionOperations();

    for (const operation of operations) {
      if (!navigator.onLine) {
        break;
      }

      try {
        await syncOperation(operation);

        removePendingReceptionOperation(
          operation.id
        );
      } catch (error) {
        console.warn(
          `受付データ ${operation.id} の同期を次回へ延期します。`,
          error
        );

        if (
          isTransientReceptionError(
            error
          ) ||
          !navigator.onLine
        ) {
          break;
        }

        /*
          認証不一致や削除済みデータなどは
          自動的に捨てず、管理者が確認できるよう
          端末内に残して次回も再試行します。
          後続の正常な受付は止めません。
        */
        continue;
      }
    }
  } finally {
    syncInProgress = false;
  }
}

export function startOfflineReceptionSync() {
  if (
    syncStarted ||
    typeof window === "undefined"
  ) {
    return;
  }

  syncStarted = true;

  const requestSync = () => {
    if (!navigator.onLine) {
      return;
    }

    void syncPendingReceptionOperations();
  };

  window.addEventListener(
    "online",
    requestSync
  );

  subscribeToPendingReceptionCount(
    () => {
      requestSync();
    }
  );

  window.setInterval(
    requestSync,
    RETRY_INTERVAL_MILLISECONDS
  );

  window.setTimeout(
    requestSync,
    0
  );
}
