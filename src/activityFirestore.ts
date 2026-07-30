import {
  collection,
  onSnapshot,
  query,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";

import {
  db,
} from "./firebase";

export type ActivityType =
  | "ticket-entry"
  | "ticket-exit"
  | "member-entry"
  | "member-exit";

export type ActivitySource =
  | "scanner"
  | "manual";

export type ActivityLog = {
  id: string;
  type: ActivityType;
  qrNumber: string;
  timestamp: string;
  isReEntry?: boolean;
  source?: ActivitySource;
};

const EVENT_DATA_COLLECTION =
  "event-data";

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

function isActivityType(
  value: unknown
): value is ActivityType {
  return (
    value ===
      "ticket-entry" ||
    value ===
      "ticket-exit" ||
    value ===
      "member-entry" ||
    value ===
      "member-exit"
  );
}

function isActivitySource(
  value: unknown
): value is ActivitySource {
  return (
    value ===
      "scanner" ||
    value ===
      "manual"
  );
}

function convertActivityDocument(
  documentId: string,
  data: DocumentData
): ActivityLog | null {
  if (
    !isActivityType(
      data.type
    ) ||
    typeof data.qrNumber !==
      "string" ||
    typeof data.timestamp !==
      "string"
  ) {
    return null;
  }

  const activity:
    ActivityLog = {
    id:
      typeof data.id ===
        "string"
        ? data.id
        : documentId,

    type:
      data.type,

    qrNumber:
      data.qrNumber,

    timestamp:
      data.timestamp,
  };

  if (
    typeof data.isReEntry ===
      "boolean"
  ) {
    activity.isReEntry =
      data.isReEntry;
  }

  if (
    isActivitySource(
      data.source
    )
  ) {
    activity.source =
      data.source;
  }

  return activity;
}

function getActivityCollection(
  eventName: string
) {
  return collection(
    db,
    EVENT_DATA_COLLECTION,
    createSafeEventId(
      eventName
    ),
    ACTIVITY_COLLECTION
  );
}

export function subscribeToActivityLogs(
  eventName: string,
  onLogsChanged: (
    logs: ActivityLog[]
  ) => void,
  onError?: (
    error: Error
  ) => void
): Unsubscribe {
  if (
    eventName.trim() ===
    ""
  ) {
    onLogsChanged([]);

    return () => {
      // イベント未設定時は解除処理なし
    };
  }

  const activityQuery =
    query(
      getActivityCollection(
        eventName
      )
    );

  return onSnapshot(
    activityQuery,

    (snapshot) => {
      const logs =
        snapshot.docs
          .map(
            (
              documentSnapshot
            ) =>
              convertActivityDocument(
                documentSnapshot.id,
                documentSnapshot.data()
              )
          )
          .filter(
            (
              log
            ): log is ActivityLog =>
              log !== null
          )
          .sort(
            (
              firstLog,
              secondLog
            ) => {
              const firstTime =
                new Date(
                  firstLog.timestamp
                ).getTime();

              const secondTime =
                new Date(
                  secondLog.timestamp
                ).getTime();

              if (
                !Number.isFinite(
                  firstTime
                ) &&
                !Number.isFinite(
                  secondTime
                )
              ) {
                return 0;
              }

              if (
                !Number.isFinite(
                  firstTime
                )
              ) {
                return 1;
              }

              if (
                !Number.isFinite(
                  secondTime
                )
              ) {
                return -1;
              }

              return (
                firstTime -
                secondTime
              );
            }
          );

      onLogsChanged(
        logs
      );
    },

    (error) => {
      console.error(
        "受付履歴の同期に失敗しました。",
        error
      );

      onError?.(
        error
      );
    }
  );
}