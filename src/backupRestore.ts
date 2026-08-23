import {
  Timestamp,
  collection,
  doc,
  getDocsFromServer,
  writeBatch,
  type DocumentData,
  type DocumentReference,
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
  MEMBER_CARDS_COLLECTION,
  SYSTEM_COLLECTION,
  TICKETS_COLLECTION,
  createSafeEventId,
} from "./firestorePaths";

const BACKUP_FORMAT =
  "kotsu-qr-system-full-backup";

const BACKUP_SCHEMA_VERSION =
  2 as const;

const MAX_BACKUP_DOCUMENTS =
  25_000;

const BATCH_OPERATION_LIMIT =
  400;

const BACKED_UP_EVENT_COLLECTIONS = [
  TICKETS_COLLECTION,
  EVENT_MEMBERS_COLLECTION,
  ACTIVITY_COLLECTION,
  ANALYTICS_COLLECTION,
] as const;

const VOLATILE_LOCAL_STORAGE_KEYS =
  new Set([
    "qr-management-offline-reception-cache-v2",
    "qr-management-offline-reception-queue-v2",
  ]);

/*
  端末の承認情報はバックアップ／復元の対象外です。
  復元によって部員端末が全滅したり、古い権限が復活したり
  しないよう、現在の端末管理データを必ず保持します。
*/
const PROTECTED_SYSTEM_DOCUMENT_IDS =
  new Set([
    "device-access",
  ]);

type SerializedValue =
  | null
  | boolean
  | number
  | string
  | SerializedValue[]
  | {
      [key: string]:
        SerializedValue;
    };

type StoredDocument = {
  id: string;
  data: {
    [key: string]:
      SerializedValue;
  };
};

type EventDataSnapshot = {
  eventId?: string;
  eventName: string;
  eventDocumentId: string;
  tickets: StoredDocument[];
  members: StoredDocument[];
  activity: StoredDocument[];
  analytics?: StoredDocument[];
};

export type FullBackupFile = {
  format:
    typeof BACKUP_FORMAT;
  schemaVersion:
    typeof BACKUP_SCHEMA_VERSION;
  appName: string;
  appVersion: string;
  exportedAt: string;
  firestore: {
    events: StoredDocument[];
    system: StoredDocument[];
    memberCards: StoredDocument[];
    eventData:
      EventDataSnapshot[];
  };
  localStorage: Record<
    string,
    string
  >;
};

export type BackupSummary = {
  events: number;
  tickets: number;
  members: number;
  activityLogs: number;
  memberCards: number;
  localSettings: number;
  totalDocuments: number;
};

type WriteOperation =
  | {
      type: "delete";
      reference:
        DocumentReference;
    }
  | {
      type: "set";
      reference:
        DocumentReference;
      data: DocumentData;
    };

function isRecord(
  value: unknown
): value is Record<
  string,
  unknown
> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isValidDocumentId(
  value: unknown
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1_500 &&
    !value.includes("/")
  );
}

function serializeFirestoreValue(
  value: unknown
): SerializedValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (
    typeof value === "number"
  ) {
    if (
      !Number.isFinite(value)
    ) {
      throw new Error(
        "数値として保存できないFirestoreデータがあります。"
      );
    }

    return value;
  }

  if (
    value instanceof Timestamp
  ) {
    return {
      __qrBackupType:
        "firestore-timestamp",
      seconds:
        value.seconds,
      nanoseconds:
        value.nanoseconds,
    };
  }

  if (
    value instanceof Date
  ) {
    return {
      __qrBackupType:
        "date",
      value:
        value.toISOString(),
    };
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      serializeFirestoreValue
    );
  }

  if (
    isRecord(value)
  ) {
    const serialized:
      Record<
        string,
        SerializedValue
      > = {};

    for (
      const [
        key,
        childValue,
      ] of Object.entries(value)
    ) {
      if (
        childValue !==
        undefined
      ) {
        serialized[key] =
          serializeFirestoreValue(
            childValue
          );
      }
    }

    return serialized;
  }

  throw new Error(
    "バックアップできないFirestoreデータ形式があります。"
  );
}

function deserializeFirestoreValue(
  value: SerializedValue
): unknown {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return value;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      deserializeFirestoreValue
    );
  }

  if (
    value.__qrBackupType ===
      "firestore-timestamp" &&
    typeof value.seconds ===
      "number" &&
    typeof value.nanoseconds ===
      "number"
  ) {
    return new Timestamp(
      value.seconds,
      value.nanoseconds
    );
  }

  if (
    value.__qrBackupType ===
      "date" &&
    typeof value.value ===
      "string"
  ) {
    return new Date(
      value.value
    );
  }

  const restored:
    Record<string, unknown> =
      {};

  for (
    const [
      key,
      childValue,
    ] of Object.entries(value)
  ) {
    restored[key] =
      deserializeFirestoreValue(
        childValue
      );
  }

  return restored;
}

function getCollectionReference(
  pathSegments: string[]
) {
  const [
    firstSegment,
    ...remainingSegments
  ] = pathSegments;

  if (
    firstSegment ===
    undefined
  ) {
    throw new Error(
      "コレクションの場所が指定されていません。"
    );
  }

  return collection(
    db,
    firstSegment,
    ...remainingSegments
  );
}

async function readCollection(
  pathSegments: string[]
): Promise<StoredDocument[]> {
  const snapshot =
    await getDocsFromServer(
      getCollectionReference(
        pathSegments
      )
    );

  return snapshot.docs.map(
    (documentSnapshot) => ({
      id:
        documentSnapshot.id,
      data:
        serializeFirestoreValue(
          documentSnapshot.data()
        ) as StoredDocument["data"],
    })
  );
}

function readSafeLocalStorage() {
  const saved:
    Record<string, string> =
      {};

  for (
    let index = 0;
    index <
    localStorage.length;
    index += 1
  ) {
    const key =
      localStorage.key(index);

    if (
      key === null ||
      !key.startsWith(
        "qr-management-"
      ) ||
      key.startsWith(
        "qr-management-reception-device-"
      ) ||
      VOLATILE_LOCAL_STORAGE_KEYS.has(
        key
      )
    ) {
      continue;
    }

    const value =
      localStorage.getItem(
        key
      );

    if (
      value !== null
    ) {
      saved[key] = value;
    }
  }

  return saved;
}

function replaceSafeLocalStorage(
  restoredStorage:
    Record<string, string>
) {
  const keysToRemove:
    string[] = [];

  for (
    let index = 0;
    index <
    localStorage.length;
    index += 1
  ) {
    const key =
      localStorage.key(index);

    if (
      key !== null &&
      key.startsWith(
        "qr-management-"
      ) &&
      !key.startsWith(
        "qr-management-reception-device-"
      ) &&
      !VOLATILE_LOCAL_STORAGE_KEYS.has(
        key
      )
    ) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach(
    (key) =>
      localStorage.removeItem(
        key
      )
  );

  Object.entries(
    restoredStorage
  ).forEach(
    ([key, value]) => {
      if (
        key.startsWith(
          "qr-management-"
        ) &&
        !key.startsWith(
          "qr-management-reception-device-"
        ) &&
        !VOLATILE_LOCAL_STORAGE_KEYS.has(
          key
        )
      ) {
        localStorage.setItem(
          key,
          value
        );
      }
    }
  );
}

function getEventName(
  eventDocument:
    StoredDocument
) {
  const name =
    eventDocument.data.name;

  return typeof name ===
    "string"
    ? name.trim()
    : "";
}

function getEventDataSnapshotLocation(
  eventDocument:
    StoredDocument
) {
  const eventName =
    getEventName(
      eventDocument
    );

  if (
    eventName === ""
  ) {
    return null;
  }

  const savedDataDocumentId =
    eventDocument.data
      .dataDocumentId;

  return {
    eventId:
      eventDocument.id,
    eventName,
    eventDocumentId:
      typeof savedDataDocumentId ===
        "string" &&
      isValidDocumentId(
        savedDataDocumentId
      )
        ? savedDataDocumentId
        : createSafeEventId(
            eventName
          ),
  };
}

export async function createFullBackup(
  appVersion: string
): Promise<FullBackupFile> {
  const [
    events,
    system,
    memberCards,
  ] = await Promise.all([
    readCollection([
      EVENTS_COLLECTION,
    ]),
    readCollection([
      SYSTEM_COLLECTION,
    ]),
    readCollection([
      MEMBER_CARDS_COLLECTION,
    ]),
  ]);

  const eventLocations =
    events
      .map(
        getEventDataSnapshotLocation
      )
      .filter(
        (
          eventLocation
        ): eventLocation is NonNullable<
          typeof eventLocation
        > =>
          eventLocation !== null
      );

  const eventData =
    await Promise.all(
      eventLocations.map(
        async (
          eventLocation
        ) => {
          const [
            tickets,
            members,
            activity,
            analytics,
          ] = await Promise.all(
            BACKED_UP_EVENT_COLLECTIONS.map(
              (collectionName) =>
                readCollection([
                  EVENT_DATA_COLLECTION,
                  eventLocation.eventDocumentId,
                  collectionName,
                ])
            )
          );

          return {
            ...eventLocation,
            tickets,
            members,
            activity,
            analytics,
          };
        }
      )
    );

  return {
    format:
      BACKUP_FORMAT,
    schemaVersion:
      BACKUP_SCHEMA_VERSION,
    appName:
      "交通研究部QRコード管理システム",
    appVersion,
    exportedAt:
      new Date().toISOString(),
    firestore: {
      events,
      system:
        system.filter(
          (storedDocument) =>
            !PROTECTED_SYSTEM_DOCUMENT_IDS.has(
              storedDocument.id
            )
        ),
      memberCards,
      eventData,
    },
    localStorage:
      readSafeLocalStorage(),
  };
}

function validateSerializedValue(
  value: unknown,
  depth = 0
): value is SerializedValue {
  if (
    depth > 30
  ) {
    return false;
  }

  if (
    value === null ||
    typeof value ===
      "string" ||
    typeof value ===
      "boolean"
  ) {
    return true;
  }

  if (
    typeof value ===
    "number"
  ) {
    return Number.isFinite(
      value
    );
  }

  if (
    Array.isArray(value)
  ) {
    return value.every(
      (childValue) =>
        validateSerializedValue(
          childValue,
          depth + 1
        )
    );
  }

  if (
    !isRecord(value)
  ) {
    return false;
  }

  return Object.entries(
    value
  ).every(
    ([key, childValue]) =>
      key.length <= 1_500 &&
      validateSerializedValue(
        childValue,
        depth + 1
      )
  );
}

function validateDocuments(
  value: unknown
): value is StoredDocument[] {
  if (
    !Array.isArray(value)
  ) {
    return false;
  }

  const documentIds =
    new Set<string>();

  return value.every(
    (documentValue) => {
      if (
        !isRecord(
          documentValue
        ) ||
        !isValidDocumentId(
          documentValue.id
        ) ||
        documentIds.has(
          documentValue.id
        ) ||
        !isRecord(
          documentValue.data
        ) ||
        !validateSerializedValue(
          documentValue.data
        )
      ) {
        return false;
      }

      documentIds.add(
        documentValue.id
      );

      return true;
    }
  );
}

function validateLocalStorage(
  value: unknown
): value is Record<
  string,
  string
> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, childValue]) =>
        key.startsWith(
          "qr-management-"
        ) &&
        typeof childValue ===
          "string"
    )
  );
}

export function parseFullBackup(
  fileText: string
): FullBackupFile {
  let parsed: unknown;

  try {
    parsed =
      JSON.parse(fileText);
  } catch (error) {
    throw new Error(
      "JSONファイルを読み取れませんでした。",
      {
        cause:
          error,
      }
    );
  }

  if (
    !isRecord(parsed) ||
    parsed.format !==
      BACKUP_FORMAT ||
    parsed.schemaVersion !==
      BACKUP_SCHEMA_VERSION ||
    typeof parsed.appName !==
      "string" ||
    typeof parsed.appVersion !==
      "string" ||
    typeof parsed.exportedAt !==
      "string" ||
    !Number.isFinite(
      Date.parse(
        parsed.exportedAt
      )
    ) ||
    !isRecord(
      parsed.firestore
    ) ||
    !validateDocuments(
      parsed.firestore.events
    ) ||
    !validateDocuments(
      parsed.firestore.system
    ) ||
    !validateDocuments(
      parsed.firestore.memberCards
    ) ||
    !Array.isArray(
      parsed.firestore.eventData
    ) ||
    !validateLocalStorage(
      parsed.localStorage
    )
  ) {
    throw new Error(
      "このファイルは完全バックアップ形式ではありません。"
    );
  }

  const eventNames =
    new Set<string>();

  const eventDocumentIds =
    new Set<string>();

  const storedEventIds =
    new Set(
      parsed.firestore.events.map(
        (eventDocument) =>
          eventDocument.id
      )
    );

  const eventDataIsValid =
    parsed.firestore.eventData.every(
      (eventValue) => {
        if (
          !isRecord(eventValue) ||
          typeof eventValue.eventName !==
            "string" ||
          eventNames.has(
            eventValue.eventName
          ) ||
          !isValidDocumentId(
            eventValue.eventDocumentId
          ) ||
          eventDocumentIds.has(
            eventValue.eventDocumentId
          )
        ) {
          return false;
        }

        eventNames.add(
          eventValue.eventName
        );

        eventDocumentIds.add(
          eventValue.eventDocumentId
        );

        return (
        isRecord(eventValue) &&
        typeof eventValue.eventName ===
          "string" &&
        eventValue.eventName.trim() !==
          "" &&
        (
          eventValue.eventId ===
            undefined
            ? eventValue.eventDocumentId ===
              createSafeEventId(
                eventValue.eventName
              )
            : isValidDocumentId(
                eventValue.eventId
              ) &&
              storedEventIds.has(
                eventValue.eventId
              ) &&
              (
                eventValue.eventDocumentId ===
                  eventValue.eventId ||
                eventValue.eventDocumentId ===
                  createSafeEventId(
                    eventValue.eventName
                  )
              )
        ) &&
        validateDocuments(
          eventValue.tickets
        ) &&
        validateDocuments(
          eventValue.members
        ) &&
        validateDocuments(
          eventValue.activity
        ) &&
        (
          eventValue.analytics ===
            undefined ||
          validateDocuments(
            eventValue.analytics
          )
        )
        );
      }
    );

  if (
    !eventDataIsValid
  ) {
    throw new Error(
      "イベント別データが正しくありません。"
    );
  }

  const backup =
    parsed as FullBackupFile;

  if (
    getBackupSummary(
      backup
    ).totalDocuments >
    MAX_BACKUP_DOCUMENTS
  ) {
    throw new Error(
      "バックアップ内のデータ件数が上限を超えています。"
    );
  }

  return backup;
}

export function getBackupSummary(
  backup: FullBackupFile
): BackupSummary {
  const tickets =
    backup.firestore.eventData.reduce(
      (total, eventData) =>
        total +
        eventData.tickets.length,
      0
    );

  const members =
    backup.firestore.eventData.reduce(
      (total, eventData) =>
        total +
        eventData.members.length,
      0
    );

  const activityLogs =
    backup.firestore.eventData.reduce(
      (total, eventData) =>
        total +
        eventData.activity.length,
      0
    );

  const analyticsDocuments =
    backup.firestore.eventData.reduce(
      (total, eventData) =>
        total +
        (eventData.analytics?.length ??
          0),
      0
    );

  return {
    events:
      backup.firestore.events.length,
    tickets,
    members,
    activityLogs,
    memberCards:
      backup.firestore.memberCards.length,
    localSettings:
      Object.keys(
        backup.localStorage
      ).length,
    totalDocuments:
      backup.firestore.events.length +
      backup.firestore.system.length +
      backup.firestore.memberCards.length +
      tickets +
      members +
      activityLogs +
      analyticsDocuments,
  };
}

async function createReplaceOperations(
  pathSegments: string[],
  restoredDocuments:
    StoredDocument[],
  protectedDocumentIds =
    new Set<string>()
) {
  const snapshot =
    await getDocsFromServer(
      getCollectionReference(
        pathSegments
      )
    );

  const restoredIds =
    new Set(
      [
        ...restoredDocuments.map(
          (storedDocument) =>
            storedDocument.id
        ),
        ...protectedDocumentIds,
      ]
    );

  const deleteOperations =
    snapshot.docs
      .filter(
        (documentSnapshot) =>
          !restoredIds.has(
            documentSnapshot.id
          )
      )
      .map(
        (
          documentSnapshot
        ): WriteOperation => ({
          type: "delete",
          reference:
            documentSnapshot.ref,
        })
      );

  const setOperations =
    restoredDocuments
      .filter(
        (storedDocument) =>
          !protectedDocumentIds.has(
            storedDocument.id
          )
      )
      .map(
        (storedDocument):
          WriteOperation => ({
          type: "set",
          reference:
            doc(
              getCollectionReference(
                pathSegments
              ),
              storedDocument.id
            ),
          data:
            deserializeFirestoreValue(
              storedDocument.data
            ) as DocumentData,
        })
      );

  return [
    ...setOperations,
    ...deleteOperations,
  ];
}

async function commitOperations(
  operations:
    WriteOperation[],
  onProgress?: (
    completed: number,
    total: number
  ) => void
) {
  for (
    let startIndex = 0;
    startIndex <
    operations.length;
    startIndex +=
      BATCH_OPERATION_LIMIT
  ) {
    const operationBatch =
      operations.slice(
        startIndex,
        startIndex +
          BATCH_OPERATION_LIMIT
      );

    const batch =
      writeBatch(db);

    operationBatch.forEach(
      (operation) => {
        if (
          operation.type ===
          "delete"
        ) {
          batch.delete(
            operation.reference
          );
        } else {
          batch.set(
            operation.reference,
            operation.data
          );
        }
      }
    );

    await batch.commit();

    onProgress?.(
      Math.min(
        startIndex +
          operationBatch.length,
        operations.length
      ),
      operations.length
    );
  }
}

async function replaceFirestoreData(
  backup: FullBackupFile,
  additionalEventDocumentIds:
    string[],
  onProgress?: (
    completed: number,
    total: number
  ) => void
) {
  const eventDocumentIds =
    Array.from(
      new Set([
        ...additionalEventDocumentIds,
        ...backup.firestore.eventData.map(
          (eventData) =>
            eventData.eventDocumentId
        ),
      ])
    );

  const eventDataByDocumentId =
    new Map(
      backup.firestore.eventData.map(
        (eventData) => [
          eventData.eventDocumentId,
          eventData,
        ])
    );

  const operationGroups =
    await Promise.all([
      createReplaceOperations(
        [EVENTS_COLLECTION],
        backup.firestore.events
      ),
      createReplaceOperations(
        [SYSTEM_COLLECTION],
        backup.firestore.system,
        PROTECTED_SYSTEM_DOCUMENT_IDS
      ),
      createReplaceOperations(
        [MEMBER_CARDS_COLLECTION],
        backup.firestore.memberCards
      ),
      ...eventDocumentIds.flatMap(
        (eventDocumentId) => {
          const restoredEventData =
            eventDataByDocumentId.get(
              eventDocumentId
            );

          return [
            createReplaceOperations(
              [
                EVENT_DATA_COLLECTION,
                eventDocumentId,
                TICKETS_COLLECTION,
              ],
              restoredEventData?.tickets ??
                []
            ),
            createReplaceOperations(
              [
                EVENT_DATA_COLLECTION,
                eventDocumentId,
                EVENT_MEMBERS_COLLECTION,
              ],
              restoredEventData?.members ??
                []
            ),
            createReplaceOperations(
              [
                EVENT_DATA_COLLECTION,
                eventDocumentId,
                ACTIVITY_COLLECTION,
              ],
              restoredEventData?.activity ??
                []
            ),
            createReplaceOperations(
              [
                EVENT_DATA_COLLECTION,
                eventDocumentId,
                ANALYTICS_COLLECTION,
              ],
              restoredEventData?.analytics ??
                []
            ),
          ];
        }
      ),
    ]);

  await commitOperations(
    operationGroups.flat(),
    onProgress
  );
}

export async function restoreFullBackup(
  backup: FullBackupFile,
  currentBackup: FullBackupFile,
  onProgress?: (
    message: string
  ) => void
) {
  const affectedEventDocumentIds =
    Array.from(
      new Set([
        ...backup.firestore.eventData.map(
          (eventData) =>
            eventData.eventDocumentId
        ),
        ...currentBackup.firestore.eventData.map(
          (eventData) =>
            eventData.eventDocumentId
        ),
      ])
    );

  try {
    onProgress?.(
      "Firestoreのデータを復元しています…"
    );

    await replaceFirestoreData(
      backup,
      affectedEventDocumentIds
    );

    onProgress?.(
      "端末設定とデザインを復元しています…"
    );

    replaceSafeLocalStorage(
      backup.localStorage
    );
  } catch (restoreError) {
    console.error(
      "バックアップの復元に失敗しました。元のデータへ戻します。",
      restoreError
    );

    onProgress?.(
      "復元に失敗したため、元のデータへ戻しています…"
    );

    try {
      await replaceFirestoreData(
        currentBackup,
        affectedEventDocumentIds
      );

      replaceSafeLocalStorage(
        currentBackup.localStorage
      );
    } catch (rollbackError) {
      console.error(
        "元のデータへのロールバックにも失敗しました。",
        rollbackError
      );

      throw new Error(
        "復元と自動ロールバックの両方に失敗しました。復元前に自動保存されたバックアップを使って、通信が安定してから再度復元してください。",
        {
          cause:
            rollbackError,
        }
      );
    }

    throw new Error(
      "復元に失敗したため、データを復元前の状態へ戻しました。通信状態を確認してください。",
      {
        cause:
          restoreError,
      }
    );
  }
}
