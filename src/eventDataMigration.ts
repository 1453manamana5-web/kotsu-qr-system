import {
  collection,
  doc,
  getDocsFromServer,
  serverTimestamp,
  setDoc,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";

import {
  db,
} from "./firebase";

import {
  ACTIVITY_COLLECTION,
  ANALYTICS_COLLECTION,
  EVENT_DATA_COLLECTION,
  EVENT_MEMBERS_COLLECTION,
  EVENTS_COLLECTION,
  TICKETS_COLLECTION,
  createSafeEventId,
  registerEventDataId,
} from "./firestorePaths";

import {
  migrateOfflineReceptionEvent,
} from "./offlineReceptionStore";

import type {
  EventData,
} from "./eventFirestore";

const MIGRATED_SCHEMA_VERSION =
  2;

const BATCH_LIMIT =
  400;

const MIGRATED_COLLECTIONS = [
  TICKETS_COLLECTION,
  EVENT_MEMBERS_COLLECTION,
  ACTIVITY_COLLECTION,
  ANALYTICS_COLLECTION,
] as const;

const migrationPromises =
  new Map<
    string,
    Promise<EventData>
  >();

function migrateLegacyLocalStorage(
  eventName: string,
  eventId: string
) {
  const legacyId =
    createSafeEventId(
      eventName
    );

  const keyPrefixes = [
    "qr-management-event-tickets-",
    "qr-management-event-members-",
    "qr-management-event-activity-",
  ];

  try {
    keyPrefixes.forEach(
      (prefix) => {
        const legacyKey =
          `${prefix}${legacyId}`;

        const eventIdKey =
          `${prefix}${eventId}`;

        if (
          localStorage.getItem(
            eventIdKey
          ) === null
        ) {
          const legacyValue =
            localStorage.getItem(
              legacyKey
            );

          if (
            legacyValue !== null
          ) {
            localStorage.setItem(
              eventIdKey,
              legacyValue
            );
          }
        }
      }
    );
  } catch (error) {
    console.warn(
      "イベント別の端末データをID形式へ移行できませんでした。",
      error
    );
  }

  migrateOfflineReceptionEvent(
    eventName,
    eventId
  );
}

async function copyCollection(
  sourceEventDataId: string,
  targetEventDataId: string,
  collectionName: string
) {
  const sourceCollection =
    collection(
      db,
      EVENT_DATA_COLLECTION,
      sourceEventDataId,
      collectionName
    );

  const targetCollection =
    collection(
      db,
      EVENT_DATA_COLLECTION,
      targetEventDataId,
      collectionName
    );

  const sourceSnapshot =
    await getDocsFromServer(
      sourceCollection
    );

  const documentsToCopy =
    sourceSnapshot.docs;

  for (
    let startIndex = 0;
    startIndex <
      documentsToCopy.length;
    startIndex += BATCH_LIMIT
  ) {
    const batch =
      writeBatch(db);

    documentsToCopy
      .slice(
        startIndex,
        startIndex +
          BATCH_LIMIT
      )
      .forEach(
        (documentSnapshot) => {
          batch.set(
            doc(
              targetCollection,
              documentSnapshot.id
            ),
            documentSnapshot.data() as DocumentData
          );
        }
      );

    await batch.commit();
  }

  const verifiedSnapshot =
    await getDocsFromServer(
      targetCollection
    );

  const verifiedIds =
    new Set(
      verifiedSnapshot.docs.map(
        (documentSnapshot) =>
          documentSnapshot.id
      )
    );

  if (
    sourceSnapshot.docs.some(
      (documentSnapshot) =>
        !verifiedIds.has(
          documentSnapshot.id
        )
    )
  ) {
    throw new Error(
      `${collectionName}の移行確認に失敗しました。`
    );
  }
}

async function migrateEventData(
  event: EventData
): Promise<EventData> {
  if (
    event.dataDocumentId ===
    event.id
  ) {
    registerEventDataId(
      event.name,
      event.id
    );

    migrateLegacyLocalStorage(
      event.name,
      event.id
    );

    return event;
  }

  if (
    navigator.onLine ===
    false
  ) {
    if (
      event.dataDocumentId !==
      undefined
    ) {
      registerEventDataId(
        event.name,
        event.dataDocumentId
      );
    }

    return event;
  }

  const sourceEventDataId =
    event.dataDocumentId ??
    createSafeEventId(
      event.name
    );

  if (
    sourceEventDataId !==
    event.id
  ) {
    for (
      const collectionName of
      MIGRATED_COLLECTIONS
    ) {
      await copyCollection(
        sourceEventDataId,
        event.id,
        collectionName
      );
    }
  }

  await setDoc(
    doc(
      db,
      EVENT_DATA_COLLECTION,
      event.id
    ),
    {
      eventId:
        event.id,
      eventName:
        event.name,
      schemaVersion:
        MIGRATED_SCHEMA_VERSION,
      migratedFrom:
        sourceEventDataId,
      migratedAt:
        serverTimestamp(),
    },
    {
      merge:
        true,
    }
  );

  await setDoc(
    doc(
      db,
      EVENTS_COLLECTION,
      event.id
    ),
    {
      dataDocumentId:
        event.id,
      dataSchemaVersion:
        MIGRATED_SCHEMA_VERSION,
      dataMigratedAt:
        serverTimestamp(),
    },
    {
      merge:
        true,
    }
  );

  registerEventDataId(
    event.name,
    event.id
  );

  migrateLegacyLocalStorage(
    event.name,
    event.id
  );

  return {
    ...event,
    dataDocumentId:
      event.id,
  };
}

export function migrateEventDataToId(
  event: EventData
) {
  const existingPromise =
    migrationPromises.get(
      event.id
    );

  if (
    existingPromise !==
    undefined
  ) {
    return existingPromise;
  }

  const migrationPromise =
    migrateEventData(event)
      .finally(() => {
        migrationPromises.delete(
          event.id
        );
      });

  migrationPromises.set(
    event.id,
    migrationPromise
  );

  return migrationPromise;
}

export async function migrateAllEventDataToIds(
  events: EventData[]
) {
  const migratedEvents:
    EventData[] = [];

  let changed =
    false;

  for (
    const event of events
  ) {
    const migratedEvent =
      await migrateEventDataToId(
        event
      );

    migratedEvents.push(
      migratedEvent
    );

    changed ||=
      migratedEvent.dataDocumentId !==
      event.dataDocumentId;
  }

  return {
    events:
      migratedEvents,
    changed,
  };
}
