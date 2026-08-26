import { useEffect, useMemo, useRef, useState } from "react";
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

type NotificationItem = ActiveAlert & {
  id: string;
  deviceId: string;
  createdAt: number;
};

const NOTICE_LIFETIME_MS = 7_000;

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

export default function AnomalyNotificationBridge({ database }: { database: Firestore }) {
  const [eventDataId, setEventDataId] = useState<string | null>(null);
  const [devices, setDevices] = useState<TelemetryDevice[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
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
      previousAlertsRef.current = {};
      baselineReadyRef.current = false;

      if (eventId === "") return;
      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        if (!eventSnapshot.exists()) return;
        const data = eventSnapshot.data();
        const name = typeof data.name === "string" ? data.name.trim() : "event-not-set";
        setEventDataId(
          typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
            ? data.dataDocumentId
            : encodeURIComponent(name || "event-not-set")
        );
      });
    });

    return () => {
      unsubscribeCurrent();
      unsubscribeEvent?.();
    };
  }, [database]);

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
    for (const device of devices) {
      currentSets[device.id] = new Set((alertsByDevice[device.id] ?? []).map((alert) => alert.key));
    }

    if (!baselineReadyRef.current) {
      previousAlertsRef.current = currentSets;
      baselineReadyRef.current = true;
      return undefined;
    }

    const nextNotices: NotificationItem[] = [];
    for (const device of devices) {
      const previous = previousAlertsRef.current[device.id];
      if (previous === undefined) continue;
      const newAlerts = (alertsByDevice[device.id] ?? []).filter((alert) => !previous.has(alert.key));
      const highest = newAlerts.sort((a, b) => severityRank(b.level) - severityRank(a.level))[0];
      if (highest === undefined) continue;
      nextNotices.push({
        ...highest,
        id: `${device.id}-${highest.key}-${Date.now()}`,
        deviceId: device.id,
        createdAt: Date.now(),
      });
    }

    previousAlertsRef.current = currentSets;
    if (nextNotices.length === 0) return undefined;

    const scheduled = window.setTimeout(() => {
      setNotifications((current) => [
        ...nextNotices.sort((a, b) => severityRank(b.level) - severityRank(a.level)),
        ...current,
      ].slice(0, 3));
    }, 0);
    return () => window.clearTimeout(scheduled);
  }, [alertsByDevice, devices, eventDataId]);

  if (notifications.length === 0) return null;

  return (
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
            onClick={() => navigateTo(item.destination)}
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
  );
}
