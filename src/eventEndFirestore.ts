import {
  collection,
  doc,
  getDocsFromServer,
  serverTimestamp,
  writeBatch,
  type DocumentReference,
} from "firebase/firestore";

import {
  db,
} from "./firebase";

import {
  ACTIVITY_COLLECTION,
  EVENT_DATA_COLLECTION,
  EVENT_MEMBERS_COLLECTION,
  TICKETS_COLLECTION,
  createSafeRandomId,
  getEventDataId,
  registerEventDataId,
} from "./firestorePaths";

import {
  rebuildEventAnalyticsByDataId,
} from "./eventAnalyticsFirestore";

import {
  getPendingReceptionOperations,
  updateCachedMemberStatus,
  updateCachedTicketStatus,
} from "./offlineReceptionStore";

import type {
  EventData,
} from "./eventFirestore";

export type EventEndResult = {
  ticketCount: number;
  memberCount: number;
};

type ForcedExitWrite = {
  targetDocument:
    DocumentReference;
  activityDocument:
    DocumentReference;
  qrNumber: string;
  kind:
    | "ticket"
    | "member";
  memberName?: string;
};

function getEventDataIdForEvent(
  eventData: EventData
) {
  const explicitDataId =
    eventData.dataDocumentId?.trim() ??
    "";

  if (
    explicitDataId !== ""
  ) {
    registerEventDataId(
      eventData.name,
      explicitDataId
    );

    return explicitDataId;
  }

  return getEventDataId(
    eventData.name
  );
}

function hasPendingReceptionForEvent(
  eventData: EventData,
  eventDataId: string
) {
  return getPendingReceptionOperations()
    .some((operation) => {
      if (
        operation.eventDataId !==
          undefined
      ) {
        return (
          operation.eventDataId ===
          eventDataId
        );
      }

      return (
        operation.eventName ===
        eventData.name
      );
    });
}

export async function forceEveryoneToExitInFirestore(
  eventData: EventData,
  endedAt: string
): Promise<EventEndResult> {
  const eventName =
    eventData.name.trim();

  if (
    eventName === ""
  ) {
    throw new Error(
      "イベント名が設定されていません。"
    );
  }

  if (
    typeof navigator !==
      "undefined" &&
    navigator.onLine ===
      false
  ) {
    throw new Error(
      "イベント終了にはオンライン接続が必要です。"
    );
  }

  const eventDataId =
    getEventDataIdForEvent(
      eventData
    );

  /*
    この端末に未同期の受付が残っている状態で終了すると、
    あとから受付状態が戻る可能性があります。
    そのため同期待ちがなくなってから終了します。
  */
  if (
    hasPendingReceptionForEvent(
      eventData,
      eventDataId
    )
  ) {
    throw new Error(
      "このイベントの同期待ち受付データが残っています。オンライン状態で同期が完了してから、もう一度終了してください。"
    );
  }

  const [
    ticketsSnapshot,
    membersSnapshot,
  ] = await Promise.all([
    getDocsFromServer(
      collection(
        db,
        EVENT_DATA_COLLECTION,
        eventDataId,
        TICKETS_COLLECTION
      )
    ),
    getDocsFromServer(
      collection(
        db,
        EVENT_DATA_COLLECTION,
        eventDataId,
        EVENT_MEMBERS_COLLECTION
      )
    ),
  ]);

  const forcedExitWrites:
    ForcedExitWrite[] = [];

  ticketsSnapshot.docs
    .filter(
      (snapshot) =>
        snapshot.data().status ===
        "入場中"
    )
    .forEach((snapshot) => {
      const data =
        snapshot.data();

      const qrNumber =
        typeof data.qrNumber ===
          "string"
          ? data.qrNumber
          : snapshot.id;

      const activityId =
        createSafeRandomId();

      forcedExitWrites.push({
        targetDocument:
          snapshot.ref,
        activityDocument:
          doc(
            db,
            EVENT_DATA_COLLECTION,
            eventDataId,
            ACTIVITY_COLLECTION,
            activityId
          ),
        qrNumber,
        kind:
          "ticket",
      });
    });

  membersSnapshot.docs
    .filter(
      (snapshot) =>
        snapshot.data().status ===
        "入室中"
    )
    .forEach((snapshot) => {
      const data =
        snapshot.data();

      const qrNumber =
        typeof data.qrNumber ===
          "string"
          ? data.qrNumber
          : snapshot.id;

      const activityId =
        createSafeRandomId();

      forcedExitWrites.push({
        targetDocument:
          snapshot.ref,
        activityDocument:
          doc(
            db,
            EVENT_DATA_COLLECTION,
            eventDataId,
            ACTIVITY_COLLECTION,
            activityId
          ),
        qrNumber,
        kind:
          "member",
        memberName:
          typeof data.name ===
            "string"
            ? data.name
            : "",
      });
    });

  /*
    1人につき「状態更新」と「受付履歴追加」の2書き込みです。
    200人ずつ処理して、1バッチを400書き込み以内にします。
  */
  const chunkSize =
    200;

  for (
    let startIndex = 0;
    startIndex <
    forcedExitWrites.length;
    startIndex += chunkSize
  ) {
    const currentChunk =
      forcedExitWrites.slice(
        startIndex,
        startIndex +
          chunkSize
      );

    const batch =
      writeBatch(db);

    currentChunk.forEach(
      (forcedExit) => {
        const activityId =
          forcedExit.activityDocument.id;

        batch.update(
          forcedExit.targetDocument,
          {
            status:
              forcedExit.kind ===
                "ticket"
                ? "使用済み"
                : "退出済み",
            lastReceptionAt:
              endedAt,
            lastReceptionOperationId:
              activityId,
            updatedAt:
              serverTimestamp(),
          }
        );

        batch.set(
          forcedExit.activityDocument,
          {
            id:
              activityId,
            type:
              forcedExit.kind ===
                "ticket"
                ? "ticket-exit"
                : "member-exit",
            qrNumber:
              forcedExit.qrNumber,
            timestamp:
              endedAt,
            source:
              "manual",
            forcedExit:
              true,
            exitReason:
              "event-end",
            createdAt:
              serverTimestamp(),
          }
        );
      }
    );

    await batch.commit();
  }

  const ticketForcedExits =
    forcedExitWrites.filter(
      (forcedExit) =>
        forcedExit.kind ===
        "ticket"
    );

  const memberForcedExits =
    forcedExitWrites.filter(
      (forcedExit) =>
        forcedExit.kind ===
        "member"
    );

  ticketForcedExits.forEach(
    (forcedExit) => {
      updateCachedTicketStatus(
        eventName,
        forcedExit.qrNumber,
        "使用済み"
      );
    }
  );

  memberForcedExits.forEach(
    (forcedExit) => {
      updateCachedMemberStatus(
        eventName,
        {
          qrNumber:
            forcedExit.qrNumber,
          name:
            forcedExit.memberName ??
            "",
          status:
            "退出済み",
        }
      );
    }
  );

  /*
    強制退出履歴を含む最新のFirestoreデータから集計を作り直します。
    forcedExit=true の退出は平均滞在時間には含めません。
  */
  await rebuildEventAnalyticsByDataId(
    eventDataId
  );

  return {
    ticketCount:
      ticketForcedExits.length,
    memberCount:
      memberForcedExits.length,
  };
}
