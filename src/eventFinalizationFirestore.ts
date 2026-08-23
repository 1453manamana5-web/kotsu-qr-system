import {
  collection,
  doc,
  getDocsFromServer,
  increment,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import { db } from "./firebase";

import {
  ACTIVITY_COLLECTION,
  ANALYTICS_COLLECTION,
  ANALYTICS_SUMMARY_DOCUMENT,
  EVENT_DATA_COLLECTION,
  EVENT_MEMBERS_COLLECTION,
  EVENTS_COLLECTION,
  SYSTEM_COLLECTION,
  TICKETS_COLLECTION,
  createSafeRandomId,
  getEventDataId,
} from "./firestorePaths";

import {
  ANALYTICS_SCHEMA_VERSION,
  rebuildEventAnalyticsByDataId,
} from "./eventAnalyticsFirestore";

import {
  getPendingReceptionOperations,
} from "./offlineReceptionStore";

import type {
  EventData,
} from "./eventFirestore";

const CURRENT_EVENT_DOCUMENT_ID =
  "current-event";

const FINALIZATION_BATCH_SIZE =
  190;

const FINALIZATION_LEASE_MILLISECONDS =
  2 * 60 * 1000;

const FINALIZATION_WORKER_STORAGE_KEY =
  "qr-management-event-finalization-worker-id";

export type EventFinalizationErrorCode =
  | "offline"
  | "pending-reception"
  | "in-progress"
  | "event-not-found"
  | "operation-changed";

export class EventFinalizationError extends Error {
  readonly code:
    EventFinalizationErrorCode;

  constructor(
    code: EventFinalizationErrorCode,
    message: string
  ) {
    super(message);
    this.name =
      "EventFinalizationError";
    this.code = code;
  }
}

export type EventFinalizationResult = {
  ticketCount: number;
  memberCount: number;
  endedAt: string;
  alreadyEnded: boolean;
};

type FinalizationContext = {
  operationId: string;
  workerId: string;
  endedAt: string;
  ticketCount: number;
  memberCount: number;
  alreadyEnded: boolean;
};

function readNonNegativeInteger(
  value: unknown
) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  )
    ? Math.floor(value)
    : 0;
}

function getFinalizationWorkerId() {
  if (typeof window === "undefined") {
    return createSafeRandomId();
  }

  const storedWorkerId =
    window.sessionStorage.getItem(
      FINALIZATION_WORKER_STORAGE_KEY
    );

  if (storedWorkerId) {
    return storedWorkerId;
  }

  const workerId =
    createSafeRandomId();

  window.sessionStorage.setItem(
    FINALIZATION_WORKER_STORAGE_KEY,
    workerId
  );

  return workerId;
}

function hasPendingReception(
  eventData: EventData,
  eventDataId: string
) {
  return getPendingReceptionOperations().some(
    (operation) =>
      operation.eventDataId ===
        eventDataId ||
      operation.eventName.trim() ===
        eventData.name.trim()
  );
}

async function beginFinalization(
  eventData: EventData,
  requestedEndedAt: string
): Promise<FinalizationContext> {
  const eventDocument = doc(
    db,
    EVENTS_COLLECTION,
    eventData.id
  );

  const workerId =
    getFinalizationWorkerId();

  return runTransaction(
    db,
    async (transaction) => {
      const eventSnapshot =
        await transaction.get(
          eventDocument
        );

      if (!eventSnapshot.exists()) {
        throw new EventFinalizationError(
          "event-not-found",
          "終了するイベントが見つかりません。"
        );
      }

      const eventValue =
        eventSnapshot.data();

      const existingEndedAt =
        typeof eventValue.endedAt ===
          "string"
          ? eventValue.endedAt
          : requestedEndedAt;

      const ticketCount =
        readNonNegativeInteger(
          eventValue.finalizedTicketCount
        );

      const memberCount =
        readNonNegativeInteger(
          eventValue.finalizedMemberCount
        );

      if (
        eventValue.status ===
          "ended" ||
        typeof eventValue.endedAt ===
          "string"
      ) {
        return {
          operationId:
            typeof eventValue.finalizationOperationId ===
              "string"
              ? eventValue.finalizationOperationId
              : "already-ended",
          workerId,
          endedAt:
            existingEndedAt,
          ticketCount,
          memberCount,
          alreadyEnded:
            true,
        };
      }

      const existingOperationId =
        typeof eventValue.finalizationOperationId ===
          "string"
          ? eventValue.finalizationOperationId
          : null;

      const leaseExpiresAt =
        typeof eventValue.finalizationLeaseExpiresAt ===
          "string"
          ? Date.parse(
              eventValue.finalizationLeaseExpiresAt
            )
          : Number.NaN;

      const existingWorkerId =
        typeof eventValue.finalizationWorkerId ===
          "string"
          ? eventValue.finalizationWorkerId
          : null;

      if (
        eventValue.finalizationStatus ===
          "processing" &&
        existingWorkerId !==
          workerId &&
        Number.isFinite(
          leaseExpiresAt
        ) &&
        leaseExpiresAt >
          Date.now()
      ) {
        throw new EventFinalizationError(
          "in-progress",
          "別の端末でイベント終了処理を実行中です。"
        );
      }

      const operationId =
        existingOperationId ??
        createSafeRandomId();

      const endedAt =
        typeof eventValue.finalizationEndedAt ===
          "string"
          ? eventValue.finalizationEndedAt
          : requestedEndedAt;

      const nextLeaseExpiresAt =
        new Date(
          Date.now() +
            FINALIZATION_LEASE_MILLISECONDS
        ).toISOString();

      transaction.set(
        eventDocument,
        {
          finalizationStatus:
            "processing",
          finalizationOperationId:
            operationId,
          finalizationWorkerId:
            workerId,
          finalizationEndedAt:
            endedAt,
          finalizationLeaseExpiresAt:
            nextLeaseExpiresAt,
          finalizedTicketCount:
            existingOperationId ===
              null
              ? 0
              : ticketCount,
          finalizedMemberCount:
            existingOperationId ===
              null
              ? 0
              : memberCount,
          finalizationStartedAt:
            serverTimestamp(),
          updatedAt:
            serverTimestamp(),
        },
        { merge: true }
      );

      return {
        operationId,
        workerId,
        endedAt,
        ticketCount:
          existingOperationId ===
            null
            ? 0
            : ticketCount,
        memberCount:
          existingOperationId ===
            null
            ? 0
            : memberCount,
        alreadyEnded:
          false,
      };
    }
  );
}

function addAnalyticsInvalidation(
  batch: ReturnType<
    typeof writeBatch
  >,
  eventDataId: string
) {
  batch.set(
    doc(
      db,
      EVENT_DATA_COLLECTION,
      eventDataId,
      ANALYTICS_COLLECTION,
      ANALYTICS_SUMMARY_DOCUMENT
    ),
    {
      schemaVersion:
        ANALYTICS_SCHEMA_VERSION,
      revision:
        increment(1),
      needsRebuild:
        true,
      updatedAt:
        serverTimestamp(),
    },
    { merge: true }
  );
}

async function finalizeTickets(
  eventData: EventData,
  eventDataId: string,
  context: FinalizationContext
) {
  const ticketsSnapshot =
    await getDocsFromServer(
      collection(
        db,
        EVENT_DATA_COLLECTION,
        eventDataId,
        TICKETS_COLLECTION
      )
    );

  const insideTickets =
    ticketsSnapshot.docs.filter(
      (snapshot) =>
        snapshot.data().status ===
        "入場中"
    );

  let processedCount = 0;

  for (
    let startIndex = 0;
    startIndex <
      insideTickets.length;
    startIndex +=
      FINALIZATION_BATCH_SIZE
  ) {
    const currentChunk =
      insideTickets.slice(
        startIndex,
        startIndex +
          FINALIZATION_BATCH_SIZE
      );

    const batch =
      writeBatch(db);

    currentChunk.forEach(
      (ticketSnapshot) => {
        const activityId =
          createSafeRandomId();

        const ticketData =
          ticketSnapshot.data();

        const qrNumber =
          typeof ticketData.qrNumber ===
            "string"
            ? ticketData.qrNumber
            : ticketSnapshot.id;

        batch.update(
          ticketSnapshot.ref,
          {
            status:
              "使用済み",
            lastReceptionAt:
              context.endedAt,
            lastReceptionOperationId:
              activityId,
            updatedAt:
              serverTimestamp(),
          }
        );

        batch.set(
          doc(
            db,
            EVENT_DATA_COLLECTION,
            eventDataId,
            ACTIVITY_COLLECTION,
            activityId
          ),
          {
            id:
              activityId,
            type:
              "ticket-exit",
            qrNumber,
            timestamp:
              context.endedAt,
            source:
              "manual",
            forcedExit:
              true,
            finalizationOperationId:
              context.operationId,
            createdAt:
              serverTimestamp(),
          }
        );
      }
    );

    batch.set(
      doc(
        db,
        EVENTS_COLLECTION,
        eventData.id
      ),
      {
        finalizedTicketCount:
          increment(
            currentChunk.length
          ),
        finalizationLeaseExpiresAt:
          new Date(
            Date.now() +
              FINALIZATION_LEASE_MILLISECONDS
          ).toISOString(),
        updatedAt:
          serverTimestamp(),
      },
      { merge: true }
    );

    addAnalyticsInvalidation(
      batch,
      eventDataId
    );

    await batch.commit();
    processedCount +=
      currentChunk.length;
  }

  return processedCount;
}

async function finalizeMembers(
  eventData: EventData,
  eventDataId: string,
  context: FinalizationContext
) {
  const membersSnapshot =
    await getDocsFromServer(
      collection(
        db,
        EVENT_DATA_COLLECTION,
        eventDataId,
        EVENT_MEMBERS_COLLECTION
      )
    );

  const insideMembers =
    membersSnapshot.docs.filter(
      (snapshot) =>
        snapshot.data().status ===
        "入室中"
    );

  let processedCount = 0;

  for (
    let startIndex = 0;
    startIndex <
      insideMembers.length;
    startIndex +=
      FINALIZATION_BATCH_SIZE
  ) {
    const currentChunk =
      insideMembers.slice(
        startIndex,
        startIndex +
          FINALIZATION_BATCH_SIZE
      );

    const batch =
      writeBatch(db);

    currentChunk.forEach(
      (memberSnapshot) => {
        const activityId =
          createSafeRandomId();

        const memberData =
          memberSnapshot.data();

        const qrNumber =
          typeof memberData.qrNumber ===
            "string"
            ? memberData.qrNumber
            : memberSnapshot.id;

        batch.update(
          memberSnapshot.ref,
          {
            status:
              "退出済み",
            lastReceptionAt:
              context.endedAt,
            lastReceptionOperationId:
              activityId,
            updatedAt:
              serverTimestamp(),
          }
        );

        batch.set(
          doc(
            db,
            EVENT_DATA_COLLECTION,
            eventDataId,
            ACTIVITY_COLLECTION,
            activityId
          ),
          {
            id:
              activityId,
            type:
              "member-exit",
            qrNumber,
            timestamp:
              context.endedAt,
            source:
              "manual",
            forcedExit:
              true,
            finalizationOperationId:
              context.operationId,
            createdAt:
              serverTimestamp(),
          }
        );
      }
    );

    batch.set(
      doc(
        db,
        EVENTS_COLLECTION,
        eventData.id
      ),
      {
        finalizedMemberCount:
          increment(
            currentChunk.length
          ),
        finalizationLeaseExpiresAt:
          new Date(
            Date.now() +
              FINALIZATION_LEASE_MILLISECONDS
          ).toISOString(),
        updatedAt:
          serverTimestamp(),
      },
      { merge: true }
    );

    addAnalyticsInvalidation(
      batch,
      eventDataId
    );

    await batch.commit();
    processedCount +=
      currentChunk.length;
  }

  return processedCount;
}

async function completeFinalization(
  eventData: EventData,
  context: FinalizationContext,
  ticketCount: number,
  memberCount: number
) {
  const eventDocument = doc(
    db,
    EVENTS_COLLECTION,
    eventData.id
  );

  const currentEventDocument = doc(
    db,
    SYSTEM_COLLECTION,
    CURRENT_EVENT_DOCUMENT_ID
  );

  await runTransaction(
    db,
    async (transaction) => {
      const [
        eventSnapshot,
        currentEventSnapshot,
      ] = await Promise.all([
        transaction.get(
          eventDocument
        ),
        transaction.get(
          currentEventDocument
        ),
      ]);

      if (!eventSnapshot.exists()) {
        throw new EventFinalizationError(
          "event-not-found",
          "終了するイベントが見つかりません。"
        );
      }

      const eventValue =
        eventSnapshot.data();

      if (
        eventValue.finalizationOperationId !==
        context.operationId ||
        eventValue.finalizationWorkerId !==
        context.workerId
      ) {
        throw new EventFinalizationError(
          "operation-changed",
          "イベント終了処理が別の端末へ引き継がれました。"
        );
      }

      transaction.set(
        eventDocument,
        {
          status:
            "ended",
          endedAt:
            context.endedAt,
          finalizationStatus:
            "completed",
          finalizationLeaseExpiresAt:
            null,
          finalizedTicketCount:
            ticketCount,
          finalizedMemberCount:
            memberCount,
          finalizationCompletedAt:
            serverTimestamp(),
          updatedAt:
            serverTimestamp(),
        },
        { merge: true }
      );

      if (
        currentEventSnapshot.exists() &&
        currentEventSnapshot.data().eventId ===
          eventData.id
      ) {
        transaction.set(
          currentEventDocument,
          {
            eventId:
              null,
            updatedAt:
              serverTimestamp(),
          },
          { merge: true }
        );
      }
    }
  );
}

export async function finalizeEventInFirestore(
  eventData: EventData,
  requestedEndedAt =
    new Date().toISOString()
): Promise<EventFinalizationResult> {
  if (
    typeof navigator !==
      "undefined" &&
    !navigator.onLine
  ) {
    throw new EventFinalizationError(
      "offline",
      "オフライン中はイベントを終了できません。"
    );
  }

  const eventDataId =
    eventData.dataDocumentId ??
    getEventDataId(
      eventData.name
    );

  if (
    hasPendingReception(
      eventData,
      eventDataId
    )
  ) {
    throw new EventFinalizationError(
      "pending-reception",
      "同期待ちの受付データがあります。"
    );
  }

  const context =
    await beginFinalization(
      eventData,
      requestedEndedAt
    );

  if (context.alreadyEnded) {
    return {
      ticketCount:
        context.ticketCount,
      memberCount:
        context.memberCount,
      endedAt:
        context.endedAt,
      alreadyEnded:
        true,
    };
  }

  const ticketCount =
    context.ticketCount +
    await finalizeTickets(
      eventData,
      eventDataId,
      context
    );

  const memberCount =
    context.memberCount +
    await finalizeMembers(
      eventData,
      eventDataId,
      context
    );

  await rebuildEventAnalyticsByDataId(
    eventDataId
  );

  await completeFinalization(
    eventData,
    context,
    ticketCount,
    memberCount
  );

  return {
    ticketCount,
    memberCount,
    endedAt:
      context.endedAt,
    alreadyEnded:
      false,
  };
}
