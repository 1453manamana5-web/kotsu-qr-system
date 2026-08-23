import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  type Transaction,
  type Unsubscribe,
} from "firebase/firestore";

import { db } from "./firebase";

import {
  ACTIVITY_COLLECTION,
  ANALYTICS_COLLECTION,
  ANALYTICS_SUMMARY_DOCUMENT,
  EVENT_DATA_COLLECTION,
  EVENT_MEMBERS_COLLECTION,
  TICKETS_COLLECTION,
  getEventDataId,
} from "./firestorePaths";

import type {
  ActivityLog,
  ActivityType,
} from "./activityFirestore";

export const ANALYTICS_SCHEMA_VERSION = 1;
const REBUILD_RETRY_LIMIT = 4;

export type AnalyticsHourData = {
  label: string;
  count: number;
};

export type EventAnalyticsSummary = {
  schemaVersion: number;
  revision: number;
  totalVisitors: number;
  currentInside: number;
  currentMembersInside: number;
  reEntryCount: number;
  ticketCount: number;
  activityCount: number;
  totalStayMilliseconds: number;
  completedStayCount: number;
  averageStayMinutes: number | null;
  hourlyEntryCounts: Record<string, number>;
  needsRebuild: false;
};

type AnalyticsActivity = {
  type: ActivityType;
  timestamp: string;
  isReEntry?: boolean;
  previousEntryAt?: string;
};

type AnalyticsSnapshot =
  DocumentSnapshot<DocumentData>;

class AnalyticsRevisionChangedError extends Error {}

const rebuildPromises = new Map<
  string,
  Promise<EventAnalyticsSummary>
>();

function isFiniteNonNegativeNumber(
  value: unknown
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function readHourlyEntryCounts(
  value: unknown
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  const counts: Record<string, number> = {};

  for (const [key, count] of Object.entries(value)) {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(key) ||
      !isFiniteNonNegativeNumber(count)
    ) {
      return null;
    }

    counts[key] = Math.floor(count);
  }

  return counts;
}

function convertAnalyticsSummary(
  data: DocumentData
): EventAnalyticsSummary | null {
  const hourlyEntryCounts =
    readHourlyEntryCounts(data.hourlyEntryCounts);

  if (
    data.schemaVersion !== ANALYTICS_SCHEMA_VERSION ||
    data.needsRebuild === true ||
    !isFiniteNonNegativeNumber(data.revision) ||
    !isFiniteNonNegativeNumber(data.totalVisitors) ||
    !isFiniteNonNegativeNumber(data.currentInside) ||
    !isFiniteNonNegativeNumber(data.currentMembersInside) ||
    !isFiniteNonNegativeNumber(data.reEntryCount) ||
    !isFiniteNonNegativeNumber(data.ticketCount) ||
    !isFiniteNonNegativeNumber(data.activityCount) ||
    !isFiniteNonNegativeNumber(data.totalStayMilliseconds) ||
    !isFiniteNonNegativeNumber(data.completedStayCount) ||
    hourlyEntryCounts === null
  ) {
    return null;
  }

  const averageStayMinutes =
    data.completedStayCount === 0
      ? null
      : Math.round(
          data.totalStayMilliseconds /
            data.completedStayCount /
            1000 /
            60
        );

  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    revision: Math.floor(data.revision),
    totalVisitors: Math.floor(data.totalVisitors),
    currentInside: Math.floor(data.currentInside),
    currentMembersInside: Math.floor(data.currentMembersInside),
    reEntryCount: Math.floor(data.reEntryCount),
    ticketCount: Math.floor(data.ticketCount),
    activityCount: Math.floor(data.activityCount),
    totalStayMilliseconds: data.totalStayMilliseconds,
    completedStayCount: Math.floor(data.completedStayCount),
    averageStayMinutes,
    hourlyEntryCounts,
    needsRebuild: false,
  };
}

export function getEventAnalyticsDocumentByDataId(
  eventDataId: string
) {
  return doc(
    db,
    EVENT_DATA_COLLECTION,
    eventDataId,
    ANALYTICS_COLLECTION,
    ANALYTICS_SUMMARY_DOCUMENT
  );
}

export function getEventAnalyticsDocument(
  eventName: string
) {
  return getEventAnalyticsDocumentByDataId(
    getEventDataId(eventName)
  );
}

function getRevision(snapshot: AnalyticsSnapshot) {
  if (!snapshot.exists()) {
    return 0;
  }

  const revision = snapshot.data().revision;

  return isFiniteNonNegativeNumber(revision)
    ? Math.floor(revision)
    : 0;
}

function createHourBucket(timestamp: string) {
  const date = new Date(timestamp);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  return `${String(date.getFullYear()).padStart(4, "0")}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}-${String(date.getDate()).padStart(
    2,
    "0"
  )}T${String(date.getHours()).padStart(2, "0")}`;
}

function isActivityType(value: unknown): value is ActivityType {
  return (
    value === "ticket-entry" ||
    value === "ticket-exit" ||
    value === "member-entry" ||
    value === "member-exit"
  );
}

function convertActivity(
  documentId: string,
  data: DocumentData
): ActivityLog | null {
  if (
    !isActivityType(data.type) ||
    typeof data.qrNumber !== "string" ||
    typeof data.timestamp !== "string"
  ) {
    return null;
  }

  return {
    id: typeof data.id === "string" ? data.id : documentId,
    type: data.type,
    qrNumber: data.qrNumber,
    timestamp: data.timestamp,
    ...(typeof data.isReEntry === "boolean"
      ? { isReEntry: data.isReEntry }
      : {}),
    ...(typeof data.forcedExit === "boolean"
      ? { forcedExit: data.forcedExit }
      : {}),
    ...(data.source === "scanner" || data.source === "manual"
      ? { source: data.source }
      : {}),
  };
}

function calculateSummary(
  revision: number,
  ticketDocuments: QueryDocumentSnapshot<DocumentData>[],
  memberDocuments: QueryDocumentSnapshot<DocumentData>[],
  activityDocuments: QueryDocumentSnapshot<DocumentData>[]
): EventAnalyticsSummary {
  const logs = activityDocuments
    .map((snapshot) =>
      convertActivity(snapshot.id, snapshot.data())
    )
    .filter((log): log is ActivityLog => log !== null)
    .sort(
      (first, second) =>
        Date.parse(first.timestamp) - Date.parse(second.timestamp)
    );

  const firstEntryQrNumbers = new Set(
    logs
      .filter(
        (log) =>
          log.type === "ticket-entry" &&
          log.isReEntry !== true
      )
      .map((log) => log.qrNumber)
  );

  const visitorCountFromStatus = ticketDocuments.filter(
    (snapshot) => {
      const status = snapshot.data().status;
      return status === "入場中" || status === "使用済み";
    }
  ).length;

  const currentInside = ticketDocuments.filter(
    (snapshot) => snapshot.data().status === "入場中"
  ).length;

  const currentMembersInside = memberDocuments.filter(
    (snapshot) => snapshot.data().status === "入室中"
  ).length;

  const entryTimes = new Map<string, number>();
  const hourlyEntryCounts: Record<string, number> = {};
  let totalStayMilliseconds = 0;
  let completedStayCount = 0;

  logs.forEach((log) => {
    const timestamp = Date.parse(log.timestamp);

    if (!Number.isFinite(timestamp)) {
      return;
    }

    if (log.type === "ticket-entry") {
      entryTimes.set(log.qrNumber, timestamp);

      const bucket = createHourBucket(log.timestamp);

      if (bucket !== null) {
        hourlyEntryCounts[bucket] =
          (hourlyEntryCounts[bucket] ?? 0) + 1;
      }

      return;
    }

    if (
      log.type !== "ticket-exit" ||
      log.forcedExit === true
    ) {
      return;
    }

    const entryTime = entryTimes.get(log.qrNumber);

    if (entryTime === undefined || timestamp < entryTime) {
      return;
    }

    totalStayMilliseconds += timestamp - entryTime;
    completedStayCount += 1;
    entryTimes.delete(log.qrNumber);
  });

  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    revision,
    totalVisitors: Math.max(
      firstEntryQrNumbers.size,
      visitorCountFromStatus
    ),
    currentInside,
    currentMembersInside,
    reEntryCount: logs.filter(
      (log) =>
        log.type === "ticket-entry" && log.isReEntry === true
    ).length,
    ticketCount: ticketDocuments.length,
    activityCount: logs.length,
    totalStayMilliseconds,
    completedStayCount,
    averageStayMinutes:
      completedStayCount === 0
        ? null
        : Math.round(
            totalStayMilliseconds /
              completedStayCount /
              1000 /
              60
          ),
    hourlyEntryCounts,
    needsRebuild: false,
  };
}

async function rebuildByDataId(
  eventDataId: string
): Promise<EventAnalyticsSummary> {
  const summaryDocument = getEventAnalyticsDocumentByDataId(eventDataId);

  for (let attempt = 0; attempt < REBUILD_RETRY_LIMIT; attempt += 1) {
    const beforeSnapshot = await getDocFromServer(summaryDocument);
    const revision = getRevision(beforeSnapshot);

    const [ticketsSnapshot, membersSnapshot, activitySnapshot] =
      await Promise.all([
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
        getDocsFromServer(
          collection(
            db,
            EVENT_DATA_COLLECTION,
            eventDataId,
            ACTIVITY_COLLECTION
          )
        ),
      ]);

    const summary = calculateSummary(
      revision,
      ticketsSnapshot.docs,
      membersSnapshot.docs,
      activitySnapshot.docs
    );

    try {
      await runTransaction(db, async (transaction) => {
        const currentSnapshot = await transaction.get(summaryDocument);

        if (getRevision(currentSnapshot) !== revision) {
          throw new AnalyticsRevisionChangedError();
        }

        transaction.set(summaryDocument, {
          ...summary,
          rebuiltAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      return summary;
    } catch (error) {
      if (
        error instanceof AnalyticsRevisionChangedError &&
        attempt < REBUILD_RETRY_LIMIT - 1
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new Error("集計データの更新が続いているため再計算できませんでした。");
}

export function rebuildEventAnalyticsByDataId(
  eventDataId: string
) {
  const currentPromise = rebuildPromises.get(eventDataId);

  if (currentPromise !== undefined) {
    return currentPromise;
  }

  const promise = rebuildByDataId(eventDataId).finally(() => {
    rebuildPromises.delete(eventDataId);
  });

  rebuildPromises.set(eventDataId, promise);
  return promise;
}

export function rebuildEventAnalytics(eventName: string) {
  return rebuildEventAnalyticsByDataId(getEventDataId(eventName));
}

export async function ensureEventAnalytics(eventName: string) {
  const normalizedEventName = eventName.trim();

  if (normalizedEventName === "") {
    return null;
  }

  const snapshot = await getDocFromServer(
    getEventAnalyticsDocument(normalizedEventName)
  );

  if (snapshot.exists()) {
    const summary = convertAnalyticsSummary(snapshot.data());

    if (summary !== null) {
      return summary;
    }
  }

  return rebuildEventAnalytics(normalizedEventName);
}

export function subscribeToEventAnalytics(
  eventName: string,
  onSummaryChanged: (summary: EventAnalyticsSummary) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  if (eventName.trim() === "") {
    return () => {
      // イベント未設定時は解除処理なし
    };
  }

  let rebuilding = false;

  return onSnapshot(
    getEventAnalyticsDocument(eventName),
    (snapshot) => {
      const summary = snapshot.exists()
        ? convertAnalyticsSummary(snapshot.data())
        : null;

      if (summary !== null) {
        onSummaryChanged(summary);
        return;
      }

      if (rebuilding || snapshot.metadata.fromCache) {
        return;
      }

      rebuilding = true;

      void rebuildEventAnalytics(eventName)
        .catch((error: unknown) => {
          console.error("イベント集計を再計算できませんでした。", error);
          onError?.(
            error instanceof Error
              ? error
              : new Error("イベント集計を再計算できませんでした。")
          );
        })
        .finally(() => {
          rebuilding = false;
        });
    },
    (error) => {
      console.error("イベント集計を取得できませんでした。", error);
      onError?.(error);
    }
  );
}

export function getAnalyticsSnapshotForTransaction(
  transaction: Transaction,
  eventName: string
) {
  return transaction.get(getEventAnalyticsDocument(eventName));
}

export function markEventAnalyticsStaleInTransaction(
  transaction: Transaction,
  analyticsSnapshot: AnalyticsSnapshot
) {
  transaction.set(
    analyticsSnapshot.ref,
    {
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      revision: getRevision(analyticsSnapshot) + 1,
      needsRebuild: true,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function markEventAnalyticsStale(eventName: string) {
  const summaryDocument = getEventAnalyticsDocument(eventName);

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(summaryDocument);
    markEventAnalyticsStaleInTransaction(transaction, snapshot);
  });
}

export function applyActivityToAnalyticsTransaction(
  transaction: Transaction,
  analyticsSnapshot: AnalyticsSnapshot,
  activity: AnalyticsActivity
) {
  const summary = analyticsSnapshot.exists()
    ? convertAnalyticsSummary(analyticsSnapshot.data())
    : null;

  if (summary === null) {
    markEventAnalyticsStaleInTransaction(
      transaction,
      analyticsSnapshot
    );
    return;
  }

  let totalVisitors = summary.totalVisitors;
  let currentInside = summary.currentInside;
  let currentMembersInside = summary.currentMembersInside;
  let reEntryCount = summary.reEntryCount;
  let totalStayMilliseconds = summary.totalStayMilliseconds;
  let completedStayCount = summary.completedStayCount;
  const hourlyEntryCounts = { ...summary.hourlyEntryCounts };

  if (activity.type === "ticket-entry") {
    currentInside += 1;

    if (activity.isReEntry === true) {
      reEntryCount += 1;
    } else {
      totalVisitors += 1;
    }

    const bucket = createHourBucket(activity.timestamp);

    if (bucket !== null) {
      hourlyEntryCounts[bucket] =
        (hourlyEntryCounts[bucket] ?? 0) + 1;
    }
  } else if (activity.type === "ticket-exit") {
    currentInside = Math.max(0, currentInside - 1);

    const entryTime =
      typeof activity.previousEntryAt === "string"
        ? Date.parse(activity.previousEntryAt)
        : Number.NaN;
    const exitTime = Date.parse(activity.timestamp);

    if (
      Number.isFinite(entryTime) &&
      Number.isFinite(exitTime) &&
      exitTime >= entryTime
    ) {
      totalStayMilliseconds += exitTime - entryTime;
      completedStayCount += 1;
    }
  } else if (activity.type === "member-entry") {
    currentMembersInside += 1;
  } else {
    currentMembersInside = Math.max(0, currentMembersInside - 1);
  }

  transaction.set(analyticsSnapshot.ref, {
    ...summary,
    revision: summary.revision + 1,
    totalVisitors,
    currentInside,
    currentMembersInside,
    reEntryCount,
    activityCount: summary.activityCount + 1,
    totalStayMilliseconds,
    completedStayCount,
    averageStayMinutes:
      completedStayCount === 0
        ? null
        : Math.round(
            totalStayMilliseconds /
              completedStayCount /
              1000 /
              60
          ),
    hourlyEntryCounts,
    needsRebuild: false,
    updatedAt: serverTimestamp(),
  });
}

export function createHourDataFromAnalytics(
  summary: EventAnalyticsSummary,
  eventDate: string,
  startTime: string,
  endTime: string
): AnalyticsHourData[] {
  const startDate = new Date(`${eventDate}T${startTime}`);
  const endDate = new Date(`${eventDate}T${endTime}`);

  if (
    Number.isFinite(startDate.getTime()) &&
    Number.isFinite(endDate.getTime()) &&
    endDate.getTime() > startDate.getTime()
  ) {
    const currentHour = new Date(startDate);
    currentHour.setMinutes(0, 0, 0);

    const finalHour = new Date(endDate);
    finalHour.setMinutes(0, 0, 0);

    const hours: AnalyticsHourData[] = [];

    while (currentHour.getTime() <= finalHour.getTime()) {
      const key = `${String(currentHour.getFullYear()).padStart(
        4,
        "0"
      )}-${String(currentHour.getMonth() + 1).padStart(2, "0")}-${String(
        currentHour.getDate()
      ).padStart(2, "0")}T${String(currentHour.getHours()).padStart(
        2,
        "0"
      )}`;

      hours.push({
        label: `${String(currentHour.getHours()).padStart(2, "0")}:00`,
        count: summary.hourlyEntryCounts[key] ?? 0,
      });

      currentHour.setHours(currentHour.getHours() + 1);
    }

    return hours;
  }

  return Object.entries(summary.hourlyEntryCounts)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([key, count]) => ({
      label: `${key.slice(-2)}:00`,
      count,
    }));
}
