import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type QuerySnapshot,
  type Unsubscribe,
} from "firebase/firestore";

import {
  db,
} from "./firebase";

import {
  EVENTS_COLLECTION,
  SYSTEM_COLLECTION,
  registerEventDataId,
} from "./firestorePaths";

import {
  forceEveryoneToExitInFirestore,
  type EventEndResult,
} from "./eventEndFirestore";

export type EventStatus =
  | "scheduled"
  | "active"
  | "ended";

export type EventData = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  status?: EventStatus;
  endedAt?: string;
  dataDocumentId?: string;
};

export type EventStore = {
  events: EventData[];

  currentEventId:
    | string
    | null;
};

const CURRENT_EVENT_DOCUMENT_ID =
  "current-event";

function isEventStatus(
  value: unknown
): value is EventStatus {
  return (
    value ===
      "scheduled" ||
    value ===
      "active" ||
    value ===
      "ended"
  );
}

function convertEventDocument(
  documentId: string,
  data: DocumentData
): EventData | null {
  if (
    typeof data.name !==
      "string" ||
    typeof data.date !==
      "string" ||
    typeof data.startTime !==
      "string" ||
    typeof data.endTime !==
      "string"
  ) {
    return null;
  }

  const eventData:
    EventData = {
    id:
      documentId,

    name:
      data.name,

    date:
      data.date,

    startTime:
      data.startTime,

    endTime:
      data.endTime,
  };

  if (
    isEventStatus(
      data.status
    )
  ) {
    eventData.status =
      data.status;
  }

  if (
    typeof data.endedAt ===
      "string"
  ) {
    eventData.endedAt =
      data.endedAt;
  }

  if (
    typeof data.dataDocumentId ===
      "string" &&
    data.dataDocumentId.trim() !==
      "" &&
    data.dataDocumentId.length <=
      1_500 &&
    !data.dataDocumentId.includes(
      "/"
    )
  ) {
    eventData.dataDocumentId =
      data.dataDocumentId;

    registerEventDataId(
      eventData.name,
      data.dataDocumentId
    );
  }

  return eventData;
}

function convertEventSnapshot(
  snapshot:
    QuerySnapshot<DocumentData>
) {
  return snapshot.docs
    .map(
      (
        documentSnapshot
      ) =>
        convertEventDocument(
          documentSnapshot.id,
          documentSnapshot.data()
        )
    )
    .filter(
      (
        event
      ): event is EventData =>
        event !== null
    );
}

export function subscribeToEvents(
  onEventsChanged: (
    events: EventData[],
    fromCache: boolean
  ) => void,

  onError?: (
    error: Error
  ) => void
): Unsubscribe {
  const eventsCollection =
    collection(
      db,
      EVENTS_COLLECTION
    );

  return onSnapshot(
    eventsCollection,

    {
      includeMetadataChanges:
        true,
    },

    (
      snapshot
    ) => {
      const events =
        convertEventSnapshot(
          snapshot
        );

      onEventsChanged(
        events,
        snapshot.metadata.fromCache
      );
    },

    (
      error
    ) => {
      console.error(
        "Firestoreのイベント一覧を読み込めませんでした。",
        error
      );

      onError?.(
        error
      );
    }
  );
}

export function subscribeToCurrentEventId(
  onCurrentEventIdChanged: (
    currentEventId:
      | string
      | null,
    fromCache: boolean
  ) => void,

  onError?: (
    error: Error
  ) => void
): Unsubscribe {
  const currentEventDocument =
    doc(
      db,
      SYSTEM_COLLECTION,
      CURRENT_EVENT_DOCUMENT_ID
    );

  return onSnapshot(
    currentEventDocument,

    (
      snapshot
    ) => {
      if (
        !snapshot.exists()
      ) {
        onCurrentEventIdChanged(
          null,
          snapshot.metadata.fromCache
        );

        return;
      }

      const data =
        snapshot.data();

      const currentEventId =
        typeof data.eventId ===
          "string"
          ? data.eventId
          : null;

      onCurrentEventIdChanged(
        currentEventId,
        snapshot.metadata.fromCache
      );
    },

    (
      error
    ) => {
      console.error(
        "現在のイベントを読み込めませんでした。",
        error
      );

      onError?.(
        error
      );
    }
  );
}

export async function saveEventToFirestore(
  eventData: EventData
): Promise<
  EventEndResult |
  null
> {
  const eventDocument =
    doc(
      db,
      EVENTS_COLLECTION,
      eventData.id
    );

  let eventToSave =
    eventData;

  let eventEndResult:
    EventEndResult |
    null =
    null;

  if (
    eventData.status ===
    "ended"
  ) {
    const endedAt =
      eventData.endedAt ??
      new Date().toISOString();

    eventToSave = {
      ...eventData,
      endedAt,
    };

    /*
      イベントを「終了」に確定する前に、
      Firestore上の入場中チケット・入室中部員を
      すべて退出状態へ更新して履歴と集計を確定します。

      この処理が失敗した場合はイベント自体も終了扱いにせず、
      次回もう一度安全にやり直せるようにします。
    */
    eventEndResult =
      await forceEveryoneToExitInFirestore(
        eventToSave,
        endedAt
      );
  }

  await setDoc(
    eventDocument,
    {
      id:
        eventToSave.id,

      name:
        eventToSave.name,

      date:
        eventToSave.date,

      startTime:
        eventToSave.startTime,

      endTime:
        eventToSave.endTime,

      status:
        eventToSave.status ??
        "scheduled",

      endedAt:
        eventToSave.endedAt ??
        null,

      ...(eventToSave.dataDocumentId ===
        undefined
        ? {}
        : {
            dataDocumentId:
              eventToSave.dataDocumentId,
          }),

      updatedAt:
        serverTimestamp(),
    },
    {
      merge:
        true,
    }
  );

  return eventEndResult;
}

export async function setCurrentEventIdInFirestore(
  eventId:
    | string
    | null
) {
  const currentEventDocument =
    doc(
      db,
      SYSTEM_COLLECTION,
      CURRENT_EVENT_DOCUMENT_ID
    );

  await setDoc(
    currentEventDocument,
    {
      eventId,

      updatedAt:
        serverTimestamp(),
    },
    {
      merge:
        true,
    }
  );
}

export async function createEventInFirestore(
  eventData: EventData
) {
  /*
    新しいイベントは一覧へ追加するだけにします。

    すでに設定されている現在のイベントは
    変更しません。

    現在のイベントを変更するときは、
    イベント管理画面から明示的に設定します。
  */
  await saveEventToFirestore({
    ...eventData,

    status:
      eventData.status ??
      "scheduled",
  });
}

export async function endEventInFirestore(
  eventData: EventData,
  endedAt: string
) {
  const eventEndResult =
    await saveEventToFirestore({
      ...eventData,

      status:
        "ended",

      endedAt,
    });

  const currentEventDocument =
    doc(
      db,
      SYSTEM_COLLECTION,
      CURRENT_EVENT_DOCUMENT_ID
    );

  await setDoc(
    currentEventDocument,
    {
      eventId:
        null,

      updatedAt:
        serverTimestamp(),
    },
    {
      merge:
        true,
    }
  );

  return eventEndResult;
}

export async function deleteEventFromFirestore(
  eventId: string,
  isCurrentEvent: boolean
) {
  const eventDocument =
    doc(
      db,
      EVENTS_COLLECTION,
      eventId
    );

  await deleteDoc(
    eventDocument
  );

  if (
    isCurrentEvent
  ) {
    await setCurrentEventIdInFirestore(
      null
    );
  }
}
