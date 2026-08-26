import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

type ReceptionMode = "entry" | "exit";
type CameraState = "starting" | "ready" | "error";
type NoticeLevel = "watch" | "warning" | "critical";
type NoticeDestination = "devices" | "diagnostics";
type CenterFilter = "all" | "unread" | "active";

type TelemetryDevice = {
  id: string;
  mode: ReceptionMode;
  name: string;
  lastSeenAt: number;
  pendingCount: number;
  firebaseLatencyMs: number;
  downloadMbps: number;
  cameraState: CameraState;
};

type ActiveAlert = {
  key: string;
  level: NoticeLevel;
  title: string;
  detail: string;
  destination: NoticeDestination;
};

type NotificationHistoryItem = ActiveAlert & {
  id: string;
  occurrenceKey: string;
  deviceId: string;
  deviceName: string;
  mode: ReceptionMode;
  createdAt: number;
  resolvedAt: number | null;
  read: boolean;
};

type NotificationItem = ActiveAlert & {
  id: string;
  historyId: string;
  occurrenceKey: string;
  deviceId: string;
  createdAt: number;
};

const NOTICE_LIFETIME_MS = 7_000;
const MAX_HISTORY_ITEMS = 60;
const HISTORY_STORAGE_PREFIX = "qr-control-anomaly-center-v1:";

function timestampToMilliseconds(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }
  return 0;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function readDevice(id: string, data: DocumentData): TelemetryDevice | null {
  if (data.mode !== "entry" && data.mode !== "exit") return null;
  const mode: ReceptionMode = data.mode;
  const cameraState: CameraState = data.cameraState === "ready" || data.cameraState === "error"
    ? data.cameraState
    : "starting";

  return {
    id,
    mode,
    name: typeof data.deviceName === "string" && data.deviceName.trim() !== ""
      ? data.deviceName.trim()
      : `${mode === "entry" ? "入口" : "出口"}受付端末`,
    lastSeenAt: timestampToMilliseconds(data.updatedAt) || readNumber(data.lastSeenAt),
    pendingCount: Math.floor(readNumber(data.pendingCount)),
    firebaseLatencyMs: Math.round(readNumber(data.firebaseLatencyMs)),
    downloadMbps: Math.round(readNumber(data.downloadMbps) * 10) / 10,
    cameraState,
  };
}

function modeLabel(mode: ReceptionMode) {
  return mode === "entry" ? "入口" : "出口";
}

function severityRank(level: NoticeLevel) {
  return level === "critical" ? 3 : level === "warning" ? 2 : 1;
}

function levelLabel(level: NoticeLevel) {
  return level === "critical" ? "緊急" : level === "warning" ? "異常" : "要観察";
}

function activeAlerts(device: TelemetryDevice, now: number): ActiveAlert[] {
  const alerts: ActiveAlert[] = [];
  const label = modeLabel(device.mode);
  const age = device.lastSeenAt <= 0 ? 60_000 : Math.max(0, now - device.lastSeenAt);

  if (age > 45_000) {
    alerts.push({
      key: "heartbeat-critical",
      level: "critical",
      title: `${label}端末の応答が途絶えています`,
      detail: "45秒以上ハートビートを受信していません。通信または端末状態を確認してください。",
      destination: "diagnostics",
    });
  } else if (age > 15_000) {
    alerts.push({
      key: "heartbeat-watch",
      level: "watch",
      title: `${label}端末の応答が遅れています`,
      detail: `最終応答から${Math.floor(age / 1000)}秒経過しています。`,
      destination: "diagnostics",
    });
  }

  if (device.cameraState === "error") {
    alerts.push({
      key: "camera-error",
      level: "warning",
      title: `${label}カメラで異常を検知`,
      detail: `${device.name}のカメラがエラー状態です。端末状態を確認してください。`,
      destination: "devices",
    });
  }

  if (device.pendingCount >= 5) {
    alerts.push({
      key: "pending-warning",
      level: "warning",
      title: `${label}端末で同期待ちが増えています`,
      detail: `未送信データが${device.pendingCount}件あります。再同期が必要か確認してください。`,
      destination: "devices",
    });
  } else if (device.pendingCount > 0) {
    alerts.push({
      key: "pending-watch",
      level: "watch",
      title: `${label}端末に同期待ちがあります`,
      detail: `未送信データが${device.pendingCount}件あります。`,
      destination: "devices",
    });
  }

  if (device.firebaseLatencyMs >= 1_500) {
    alerts.push({
      key: "latency-high",
      level: "warning",
      title: `${label}端末の通信応答が大きく悪化`,
      detail: `Firebase応答が${device.firebaseLatencyMs}msです。通信状態を確認してください。`,
      destination: "diagnostics",
    });
  } else if (device.firebaseLatencyMs >= 900) {
    alerts.push({
      key: "latency-warning",
      level: "warning",
      title: `${label}端末の通信が遅くなっています`,
      detail: `Firebase応答が${device.firebaseLatencyMs}msまで上昇しています。`,
      destination: "diagnostics",
    });
  } else if (device.firebaseLatencyMs >= 500) {
    alerts.push({
      key: "latency-watch",
      level: "watch",
      title: `${label}端末の通信を要観察`,
      detail: `Firebase応答が${device.firebaseLatencyMs}msです。`,
      destination: "diagnostics",
    });
  }

  if (device.downloadMbps > 0 && device.downloadMbps < 1) {
    alerts.push({
      key: "download-low",
      level: "warning",
      title: `${label}端末の回線速度が低下`,
      detail: `下り速度が${device.downloadMbps.toFixed(1)}Mbpsです。`,
      destination: "diagnostics",
    });
  } else if (device.downloadMbps > 0 && device.downloadMbps < 3) {
    alerts.push({
      key: "download-watch",
      level: "watch",
      title: `${label}端末の回線速度を要観察`,
      detail: `下り速度が${device.downloadMbps.toFixed(1)}Mbpsです。`,
      destination: "diagnostics",
    });
  }

  return alerts.sort((a, b) => severityRank(b.level) - severityRank(a.level));
}

function navigateTo(destination: NoticeDestination) {
  const direct = document.querySelector<HTMLButtonElement>(`.sidebar nav button[data-nav-key="${destination}"]`);
  if (direct !== null) {
    direct.click();
    return;
  }

  const targetText = destination === "devices" ? "端末" : "通信診断";
  const fallback = [...document.querySelectorAll<HTMLButtonElement>(".sidebar nav button")]
    .find((button) => (button.textContent ?? "").includes(targetText));
  fallback?.click();
}

function historyStorageKey(eventDataId: string) {
  return `${HISTORY_STORAGE_PREFIX}${eventDataId}`;
}

function isHistoryItem(value: unknown): value is NotificationHistoryItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<NotificationHistoryItem>;
  return (
    typeof item.id === "string" &&
    typeof item.occurrenceKey === "string" &&
    typeof item.deviceId === "string" &&
    typeof item.deviceName === "string" &&
    (item.mode === "entry" || item.mode === "exit") &&
    (item.level === "watch" || item.level === "warning" || item.level === "critical") &&
    typeof item.title === "string" &&
    typeof item.detail === "string" &&
    (item.destination === "devices" || item.destination === "diagnostics") &&
    typeof item.createdAt === "number" &&
    (item.resolvedAt === null || typeof item.resolvedAt === "number") &&
    typeof item.read === "boolean"
  );
}

function readStoredHistory(eventDataId: string) {
  try {
    const raw = window.localStorage.getItem(historyStorageKey(eventDataId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isHistoryItem).slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function formatHistoryTime(value: number) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export default function AnomalyNotificationBridge({ database }: { database: Firestore }) {
  const [eventDataId, setEventDataId] = useState<string | null>(null);
  const [devices, setDevices] = useState<TelemetryDevice[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [history, setHistory] = useState<NotificationHistoryItem[]>([]);
  const [centerOpen, setCenterOpen] = useState(false);
  const [filter, setFilter] = useState<CenterFilter>("all");
  const [bellTarget, setBellTarget] = useState<Element | null>(null);
  const previousAlertsRef = useRef<Record<string, Set<string>>>({});
  const baselineReadyRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    const cleaner = window.setInterval(() => {
      const current = Date.now();
      setNotifications((items) => items.filter((item) => current - item.createdAt < NOTICE_LIFETIME_MS));
    }, 500);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(cleaner);
    };
  }, []);

  useEffect(() => {
    const updateTarget = () => {
      const next = document.querySelector(".topbar-meta");
      setBellTarget((current) => current === next ? current : next);
    };
    const first = window.setTimeout(updateTarget, 0);
    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(first);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let unsubscribeEvent: (() => void) | null = null;
    const unsubscribeCurrent = onSnapshot(doc(database, "system", "current-event"), (snapshot) => {
      const eventId = snapshot.exists() && typeof snapshot.data().eventId === "string"
        ? snapshot.data().eventId as string
        : "";

      unsubscribeEvent?.();
      unsubscribeEvent = null;
      setEventDataId(null);
      setDevices([]);
      setNotifications([]);
      setHistory([]);
      setCenterOpen(false);
      previousAlertsRef.current = {};
      baselineReadyRef.current = false;

      if (eventId === "") return;
      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        if (!eventSnapshot.exists()) return;
        const data = eventSnapshot.data();
        const name = typeof data.name === "string" ? data.name.trim() : "event-not-set";
        const nextDataId = typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
          ? data.dataDocumentId
          : encodeURIComponent(name || "event-not-set");
        setEventDataId(nextDataId);
        setHistory(readStoredHistory(nextDataId));
      });
    });

    return () => {
      unsubscribeCurrent();
      unsubscribeEvent?.();
    };
  }, [database]);

  useEffect(() => {
    if (eventDataId === null) return;
    try {
      window.localStorage.setItem(
        historyStorageKey(eventDataId),
        JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS))
      );
    } catch {
      // Notification history is a convenience feature; live alerts still work if storage is unavailable.
    }
  }, [eventDataId, history]);

  useEffect(() => {
    if (eventDataId === null) return undefined;
    return onSnapshot(collection(database, "event-data", eventDataId, "reception-devices"), (snapshot) => {
      setDevices(snapshot.docs
        .map((item) => readDevice(item.id, item.data()))
        .filter((item): item is TelemetryDevice => item !== null));
    });
  }, [database, eventDataId]);

  const alertsByDevice = useMemo(() => {
    const result: Record<string, ActiveAlert[]> = {};
    for (const device of devices) result[device.id] = activeAlerts(device, now);
    return result;
  }, [devices, now]);

  useEffect(() => {
    if (eventDataId === null || devices.length === 0) return undefined;

    const currentSets: Record<string, Set<string>> = {};
    const activeRecords = new Map<string, NotificationHistoryItem>();
    const stamp = Date.now();
    let sequence = 0;

    for (const device of devices) {
      const alerts = alertsByDevice[device.id] ?? [];
      currentSets[device.id] = new Set(alerts.map((alert) => alert.key));
      for (const alert of alerts) {
        const occurrenceKey = `${device.id}:${alert.key}`;
        activeRecords.set(occurrenceKey, {
          ...alert,
          id: `${device.id}-${alert.key}-${stamp}-${sequence++}`,
          occurrenceKey,
          deviceId: device.id,
          deviceName: device.name,
          mode: device.mode,
          createdAt: stamp,
          resolvedAt: null,
          read: false,
        });
      }
    }

    const baseline = !baselineReadyRef.current;
    const nextNotices: NotificationItem[] = [];

    if (!baseline) {
      for (const device of devices) {
        const previous = previousAlertsRef.current[device.id];
        if (previous === undefined) continue;
        const newAlerts = (alertsByDevice[device.id] ?? [])
          .filter((alert) => !previous.has(alert.key))
          .sort((a, b) => severityRank(b.level) - severityRank(a.level));
        const highest = newAlerts[0];
        if (highest === undefined) continue;
        const occurrenceKey = `${device.id}:${highest.key}`;
        const record = activeRecords.get(occurrenceKey);
        if (record === undefined) continue;
        nextNotices.push({
          ...highest,
          id: `banner-${record.id}`,
          historyId: record.id,
          occurrenceKey,
          deviceId: device.id,
          createdAt: stamp,
        });
      }
    }

    previousAlertsRef.current = currentSets;
    baselineReadyRef.current = true;

    const scheduled = window.setTimeout(() => {
      setHistory((current) => {
        let next = current.map((item) => {
          if (item.resolvedAt !== null) return item;
          const active = activeRecords.get(item.occurrenceKey);
          if (active === undefined) return { ...item, resolvedAt: stamp };
          return {
            ...item,
            level: active.level,
            title: active.title,
            detail: active.detail,
            destination: active.destination,
            deviceName: active.deviceName,
            mode: active.mode,
          };
        });

        const additions: NotificationHistoryItem[] = [];
        for (const active of activeRecords.values()) {
          const alreadyActive = next.some((item) => item.occurrenceKey === active.occurrenceKey && item.resolvedAt === null);
          if (!alreadyActive) additions.push(active);
        }

        if (additions.length > 0) {
          next = [
            ...additions.sort((a, b) => severityRank(b.level) - severityRank(a.level)),
            ...next,
          ];
        }
        return next.slice(0, MAX_HISTORY_ITEMS);
      });

      if (nextNotices.length > 0) {
        setNotifications((current) => [
          ...nextNotices.sort((a, b) => severityRank(b.level) - severityRank(a.level)),
          ...current,
        ].slice(0, 3));
      }
    }, 0);

    return () => window.clearTimeout(scheduled);
  }, [alertsByDevice, devices, eventDataId]);

  const unreadCount = useMemo(() => history.filter((item) => !item.read).length, [history]);
  const activeCount = useMemo(() => history.filter((item) => item.resolvedAt === null).length, [history]);
  const filteredHistory = useMemo(() => history.filter((item) => {
    if (filter === "unread") return !item.read;
    if (filter === "active") return item.resolvedAt === null;
    return true;
  }), [filter, history]);

  const markRead = (historyId: string) => {
    setHistory((current) => current.map((item) => item.id === historyId ? { ...item, read: true } : item));
  };

  const openHistoryItem = (item: NotificationHistoryItem) => {
    markRead(item.id);
    setCenterOpen(false);
    navigateTo(item.destination);
  };

  const openBannerItem = (item: NotificationItem) => {
    markRead(item.historyId);
    setNotifications((current) => current.filter((notice) => notice.id !== item.id));
    navigateTo(item.destination);
  };

  const bell = (
    <button
      type="button"
      className={`control-notification-bell${centerOpen ? " active" : ""}`}
      onClick={() => setCenterOpen((current) => !current)}
      aria-label={`通知センター。未確認${unreadCount}件`}
      aria-expanded={centerOpen}
      title="通知センター"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
      {unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}
    </button>
  );

  return (
    <>
      {bellTarget !== null && createPortal(bell, bellTarget)}

      {notifications.length > 0 && (
        <div className="anomaly-notification-stack" aria-live="polite" aria-label="異常通知">
          {notifications.map((item) => (
            <article className={`anomaly-notification ${item.level}`} key={item.id}>
              <div className="anomaly-notification-icon" aria-hidden="true">
                {item.level === "critical" ? "!" : item.level === "warning" ? "!" : "i"}
              </div>
              <div className="anomaly-notification-copy">
                <small>{item.level === "critical" ? "緊急確認" : item.level === "warning" ? "異常通知" : "要観察"}</small>
                <strong>{item.title}</strong>
                <p>{item.detail}</p>
              </div>
              <button
                type="button"
                className="anomaly-notification-open"
                onClick={() => openBannerItem(item)}
              >
                確認
              </button>
              <button
                type="button"
                className="anomaly-notification-close"
                onClick={() => setNotifications((current) => current.filter((notice) => notice.id !== item.id))}
                aria-label="通知を閉じる"
              >
                ×
              </button>
              <span className="anomaly-notification-timer" aria-hidden="true" />
            </article>
          ))}
        </div>
      )}

      {centerOpen && bellTarget !== null && (
        <aside className="notification-center-panel" aria-label="通知センター">
          <div className="notification-center-heading">
            <div>
              <small>NOTIFICATION CENTER</small>
              <strong>通知センター</strong>
              <span>{activeCount > 0 ? `継続中 ${activeCount}件` : "現在の継続通知なし"}</span>
            </div>
            <button type="button" onClick={() => setCenterOpen(false)} aria-label="通知センターを閉じる">×</button>
          </div>

          <div className="notification-center-toolbar">
            <div className="notification-center-filters" aria-label="通知の絞り込み">
              <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>すべて</button>
              <button type="button" className={filter === "unread" ? "active" : ""} onClick={() => setFilter("unread")}>未確認 {unreadCount}</button>
              <button type="button" className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}>継続中 {activeCount}</button>
            </div>
            {unreadCount > 0 && (
              <button
                type="button"
                className="notification-center-read-all"
                onClick={() => setHistory((current) => current.map((item) => ({ ...item, read: true })))}
              >
                すべて確認済み
              </button>
            )}
          </div>

          <div className="notification-center-list">
            {filteredHistory.length === 0 ? (
              <div className="notification-center-empty">
                <span aria-hidden="true">✓</span>
                <strong>{filter === "unread" ? "未確認の通知はありません" : filter === "active" ? "継続中の通知はありません" : "通知履歴はありません"}</strong>
                <p>新しい異常や注意項目が発生すると、ここに記録されます。</p>
              </div>
            ) : filteredHistory.map((item) => (
              <article className={`notification-center-item ${item.level}${item.read ? " is-read" : " is-unread"}`} key={item.id}>
                <span className="notification-center-item-icon" aria-hidden="true">{item.level === "watch" ? "i" : "!"}</span>
                <div className="notification-center-item-copy">
                  <div>
                    <span className={`notification-level ${item.level}`}>{levelLabel(item.level)}</span>
                    <span className={`notification-state ${item.resolvedAt === null ? "active" : "resolved"}`}>{item.resolvedAt === null ? "継続中" : "復旧済み"}</span>
                    {!item.read && <i>未確認</i>}
                  </div>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                  <small>{modeLabel(item.mode)} · {item.deviceName} · {formatHistoryTime(item.createdAt)}{item.resolvedAt === null ? "" : ` → ${formatHistoryTime(item.resolvedAt)} 復旧`}</small>
                </div>
                <button type="button" onClick={() => openHistoryItem(item)}>確認</button>
              </article>
            ))}
          </div>
        </aside>
      )}
    </>
  );
}
