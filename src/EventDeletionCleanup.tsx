import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  writeBatch,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
} from "firebase/firestore";
import { useEffect, useRef } from "react";

import { useDeviceAccess } from "./deviceAccessContext";
import { db } from "./firebase";

type KnownEvent = {
  id: string;
  dataDocumentId: string;
};

const INCIDENT_MEMORY_DOCUMENT = "predictive-incident-memory";
const DELETE_BATCH_SIZE = 400;

function readKnownEvents(
  documents: Array<{
    id: string;
    data: () => DocumentData;
  }>
) {
  return new Map<string, KnownEvent>(
    documents.map((snapshot) => {
      const data = snapshot.data();
      const dataDocumentId =
        typeof data.dataDocumentId === "string" &&
        data.dataDocumentId.trim() !== ""
          ? data.dataDocumentId
          : snapshot.id;

      return [
        snapshot.id,
        {
          id: snapshot.id,
          dataDocumentId,
        },
      ];
    })
  );
}

async function deleteDocumentReferences(
  references: DocumentReference<DocumentData>[]
) {
  for (
    let offset = 0;
    offset < references.length;
    offset += DELETE_BATCH_SIZE
  ) {
    const batch = writeBatch(db);
    for (const reference of references.slice(offset, offset + DELETE_BATCH_SIZE)) {
      batch.delete(reference);
    }
    await batch.commit();
  }
}

async function deleteCollectionDocuments(
  reference: CollectionReference<DocumentData>
) {
  const snapshot = await getDocs(reference);
  await deleteDocumentReferences(snapshot.docs.map((item) => item.ref));
}

async function deleteReceptionDevices(eventDataId: string) {
  const deviceCollection = collection(
    db,
    "event-data",
    eventDataId,
    "reception-devices"
  );
  const deviceSnapshot = await getDocs(deviceCollection);

  for (const device of deviceSnapshot.docs) {
    await deleteCollectionDocuments(
      collection(
        db,
        "event-data",
        eventDataId,
        "reception-devices",
        device.id,
        "commands"
      )
    );
  }

  await deleteDocumentReferences(deviceSnapshot.docs.map((item) => item.ref));
}

async function deleteEventData(eventDataId: string) {
  await deleteReceptionDevices(eventDataId);

  for (const collectionName of [
    "tickets",
    "members",
    "activity",
    "analytics",
  ]) {
    await deleteCollectionDocuments(
      collection(db, "event-data", eventDataId, collectionName)
    );
  }

  // event-data の親ドキュメントを使っていないイベントでも deleteDoc は安全です。
  await deleteDoc(doc(db, "event-data", eventDataId));
}

async function removeDeletedEventsFromIncidentMemory(validEventIds: Set<string>) {
  const memoryReference = doc(db, "system", INCIDENT_MEMORY_DOCUMENT);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(memoryReference);
    if (!snapshot.exists()) return;

    const data = snapshot.data();
    if (!Array.isArray(data.records)) return;

    const nextRecords = data.records.filter((item: unknown) => {
      if (typeof item !== "object" || item === null) return false;
      const eventId = (item as Record<string, unknown>).eventId;
      return typeof eventId === "string" && validEventIds.has(eventId);
    });

    if (nextRecords.length === data.records.length) return;

    transaction.update(memoryReference, {
      records: nextRecords,
    });
  });
}

export default function EventDeletionCleanup() {
  const { isMemberDevice } = useDeviceAccess();
  const previousEventsRef = useRef<Map<string, KnownEvent> | null>(null);
  const deletingEventIdsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!isMemberDevice) {
      previousEventsRef.current = null;
      return undefined;
    }

    return onSnapshot(
      collection(db, "events"),
      { includeMetadataChanges: true },
      (snapshot) => {
        const nextEvents = readKnownEvents(snapshot.docs);
        const previousEvents = previousEventsRef.current;
        previousEventsRef.current = nextEvents;

        // AI障害メモリはイベント一覧を正として常に孤児レコードを掃除します。
        if (!snapshot.metadata.fromCache) {
          void removeDeletedEventsFromIncidentMemory(
            new Set(nextEvents.keys())
          ).catch((error) => {
            console.warn("削除済みイベントのAI障害メモリを整理できませんでした。", error);
          });
        }

        if (previousEvents === null) return;

        for (const [eventId, deletedEvent] of previousEvents) {
          if (nextEvents.has(eventId) || deletingEventIdsRef.current.has(eventId)) {
            continue;
          }

          deletingEventIdsRef.current.add(eventId);
          void deleteEventData(deletedEvent.dataDocumentId)
            .catch((error) => {
              console.error(
                `削除済みイベント ${eventId} の関連データを削除できませんでした。`,
                error
              );
            })
            .finally(() => {
              deletingEventIdsRef.current.delete(eventId);
            });
        }
      },
      (error) => {
        console.warn("イベント削除後の関連データ監視を開始できませんでした。", error);
      }
    );
  }, [isMemberDevice]);

  return null;
}
