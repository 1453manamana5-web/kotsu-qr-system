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
};

export type EventStore = {
  events: EventData[];

  currentEventId:
    | string
    | null;
};

const EVENTS_COLLECTION_NAME =
  "events";

const SYSTEM_COLLECTION_NAME =
  "system";

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
      EVENTS_COLLECTION_NAME
    );

  return onSnapshot(
    eventsCollection,

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
      SYSTEM_COLLECTION_NAME,
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
) {
  const eventDocument =
    doc(
      db,
      EVENTS_COLLECTION_NAME,
      eventData.id
    );

  await setDoc(
    eventDocument,
    {
      id:
        eventData.id,

      name:
        eventData.name,

      date:
        eventData.date,

      startTime:
        eventData.startTime,

      endTime:
        eventData.endTime,

      status:
        eventData.status ??
        "scheduled",

      endedAt:
        eventData.endedAt ??
        null,

      updatedAt:
        serverTimestamp(),
    },
    {
      merge:
        true,
    }
  );
}

export async function setCurrentEventIdInFirestore(
  eventId:
    | string
    | null
) {
  const currentEventDocument =
    doc(
      db,
      SYSTEM_COLLECTION_NAME,
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
  await saveEventToFirestore({
    ...eventData,

    status:
      "ended",

    endedAt,
  });

  const currentEventDocument =
    doc(
      db,
      SYSTEM_COLLECTION_NAME,
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
}

export async function deleteEventFromFirestore(
  eventId: string,
  isCurrentEvent: boolean
) {
  const eventDocument =
    doc(
      db,
      EVENTS_COLLECTION_NAME,
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
