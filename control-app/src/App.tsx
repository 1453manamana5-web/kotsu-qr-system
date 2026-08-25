import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  collection,
  doc,
  getDocFromServer,
  onSnapshot,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import type {
  AnalyticsSummary,
  EventData,
  HealthSeverity,
  ReceptionDevice,
  ReceptionMode,
  SystemAlert,
} from "./types";

import {
  sendReceptionRemoteCommand,
  subscribeToReceptionRemoteCommands,
  type ReceptionRemoteCommand,
  type ReceptionRemoteCommandStatus,
  type ReceptionRemoteCommandType,
} from "../../src/receptionRemoteControlFirestore";

const AnalysisPage = lazy(() => import("../../src/pages/AnalysisPage"));
const PastDataPage = lazy(() => import("../../src/pages/PastDataPage"));

const CONTROL_VERSION = "1.0.0";
const EXPECTED_RECEPTION_VERSION = "2.8.0";
const WARNING_AFTER = 15_000;
const CRITICAL_AFTER = 45_000;

type View = "overview" | "analysis" | "past-data" | "devices" | "incidents" | "diagnostics";
type FirestoreHealth = "checking" | "online" | "error";

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
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function readEvent(id: string, data: DocumentData): EventData | null {
  if (
    typeof data.name !== "string" ||
    typeof data.date !== "string" ||
    typeof data.startTime !== "string" ||
    typeof data.endTime !== "string"
  ) {
    return null;
  }

  const status = data.status === "active" || data.status === "ended"
    ? data.status
    : "scheduled";

  return {
    id,
    name: data.name,
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    status,
    dataDocumentId:
      typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
        ? data.dataDocumentId
        : encodeURIComponent(data.name.trim() || "event-not-set"),
  };
}

function readAnalytics(data: DocumentData): AnalyticsSummary {
  const rawHourly = data.hourlyEntryCounts;
  const hourlyEntryCounts: Record<string, number> = {};

  if (typeof rawHourly === "object" && rawHourly !== null && !Array.isArray(rawHourly)) {
    for (const [key, value] of Object.entries(rawHourly)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        hourlyEntryCounts[key] = Math.max(0, Math.floor(value));
      }
    }
  }

  return {
    totalVisitors: readNumber(data.totalVisitors),
    currentInside: readNumber(data.currentInside),
    currentMembersInside: readNumber(data.currentMembersInside),
    reEntryCount: readNumber(data.reEntryCount),
    ticketCount: readNumber(data.ticketCount),
    activityCount: readNumber(data.activityCount),
    hourlyEntryCounts,
  };
}

function readReceptionDevice(id: string, data: DocumentData): ReceptionDevice | null {
  if (data.mode !== "entry" && data.mode !== "exit") return null;

  const cameraState = data.cameraState === "ready" || data.cameraState === "error"
    ? data.cameraState
    : "starting";
  const serverSeenAt = timestampToMilliseconds(data.updatedAt);

  return {
    id,
    registeredDeviceId: typeof data.registeredDeviceId === "string" ? data.registeredDeviceId : "",
    deviceName: typeof data.deviceName === "string" ? data.deviceName : `${data.mode === "entry" ? "入口" : "出口"}受付端末`,
    deviceType: typeof data.deviceType === "string" ? data.deviceType : "unknown",
    role: typeof data.role === "string" ? data.role : "reception",
    mode: data.mode,
    appVersion: typeof data.appVersion === "string" ? data.appVersion : "不明",
    lastSeenAt: serverSeenAt || readNumber(data.lastSeenAt),
    lastSuccessfulSyncAt: timestampToMilliseconds(data.lastSuccessfulSyncAt),
    pendingCount: readNumber(data.pendingCount),
    cameraState,
    receptionPaused: data.receptionPaused === true,
    screen: typeof data.screen === "string" ? data.screen : "",
    sessionStartedAt: typeof data.sessionStartedAt === "string" ? data.sessionStartedAt : "",
    lastScanAt: typeof data.lastScanAt === "string" ? data.lastScanAt : "",
  };
}

function formatTime(value: number | string) {
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "記録なし";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatAge(milliseconds: number, now: number) {
  if (milliseconds <= 0) return "記録なし";
  const seconds = Math.max(0, Math.floor((now - milliseconds) / 1000));
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}分前`;
}

function deviceSeverity(device: ReceptionDevice, now: number): HealthSeverity {
  const age = now - device.lastSeenAt;
  if (device.lastSeenAt <= 0 || age > CRITICAL_AFTER || device.cameraState === "error") return "critical";
  if (
    age > WARNING_AFTER ||
    device.pendingCount > 0 ||
    device.cameraState !== "ready" ||
    device.receptionPaused ||
    device.appVersion !== EXPECTED_RECEPTION_VERSION
  ) return "warning";
  return "normal";
}

function receptionOperatingStatus(device: ReceptionDevice, now: number): {
  label: string;
  severity: HealthSeverity;
} {
  const age = now - device.lastSeenAt;

  if (device.lastSeenAt <= 0 || age > CRITICAL_AFTER) {
    return { label: "通信なし", severity: "critical" };
  }

  if (device.cameraState === "error") {
    return { label: "カメラエラー", severity: "critical" };
  }

  if (device.receptionPaused) {
    return { label: "一時停止中", severity: "warning" };
  }

  if (age > WARNING_AFTER) {
    return { label: "状態確認中", severity: "warning" };
  }

  return { label: "受付中", severity: "normal" };
}

function severityLabel(severity: HealthSeverity) {
  if (severity === "normal") return "正常";
  if (severity === "warning") return "注意";
  return "通信なし";
}

function NavIcon({ kind }: { kind: View }) {
  const symbol = kind === "overview"
    ? "▦"
    : kind === "analysis" || kind === "past-data"
      ? "▥"
      : kind === "devices"
        ? "▣"
        : kind === "incidents"
          ? "△"
          : "⌁";
  return <span aria-hidden="true">{symbol}</span>;
}

function AnalysisLoading({ label }: { label: string }) {
  return (
    <main className="control-analysis-loading" aria-live="polite">
      <span className="access-spinner" aria-hidden="true" />
      <strong>{label}</strong>
    </main>
  );
}

function DeviceCard({ device, mode, now, onOpen }: {
  device: ReceptionDevice | null;
  mode: ReceptionMode;
  now: number;
  onOpen?: () => void;
}) {
  const label = mode === "entry" ? "入口受付" : "出口受付";

  if (device === null) {
    return (
      <article className="device-card is-critical">
        <div className="device-card-header">
          <h3><span className={`mode-icon ${mode}`}>{mode === "entry" ? "→" : "←"}</span>{label}</h3>
          <span className="status-badge critical">通信なし</span>
        </div>
        <div className="missing-device">稼働中の{label}端末が見つかりません</div>
      </article>
    );
  }

  const severity = deviceSeverity(device, now);
  const operatingStatus = receptionOperatingStatus(device, now);

  return (
    <article
      className={`device-card is-${severity} ${onOpen !== undefined ? "is-actionable" : ""}`}
      role={onOpen !== undefined ? "button" : undefined}
      tabIndex={onOpen !== undefined ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (
          onOpen !== undefined &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="device-card-header">
        <div>
          <small>{mode === "entry" ? "ENTRY TERMINAL" : "EXIT TERMINAL"}</small>
          <h3><span className={`mode-icon ${mode}`}>{mode === "entry" ? "→" : "←"}</span>{device.deviceName}</h3>
        </div>
        <span className={`status-badge ${severity}`}>{severityLabel(severity)}</span>
      </div>
      <div className="device-details">
        <dl>
          <div><dt>モード</dt><dd><span className={`mode-pill ${mode}`}>{mode === "entry" ? "入口" : "出口"}</span></dd></div>
          <div><dt>最終通信</dt><dd>{formatAge(device.lastSeenAt, now)}</dd></div>
          <div><dt>Firebase</dt><dd className={device.lastSuccessfulSyncAt > 0 ? "ok-text" : "muted-text"}>{device.lastSuccessfulSyncAt > 0 ? "接続確認済み" : "記録なし"}</dd></div>
          <div><dt>カメラ</dt><dd className={device.cameraState === "error" ? "error-text" : "ok-text"}>{device.cameraState === "ready" ? "正常" : device.cameraState === "error" ? "エラー" : "準備中"}</dd></div>
          <div><dt>受付状態</dt><dd className={operatingStatus.severity === "critical" ? "error-text" : operatingStatus.severity === "warning" ? "warning-text" : "ok-text"}>{operatingStatus.label}</dd></div>
          <div><dt>バージョン</dt><dd className={device.appVersion !== EXPECTED_RECEPTION_VERSION ? "warning-text" : ""}>{device.appVersion}</dd></div>
          <div><dt>同期待ち</dt><dd className={device.pendingCount > 0 ? "warning-text strong" : ""}>{device.pendingCount}件</dd></div>
          <div><dt>最終読取</dt><dd>{device.lastScanAt === "" ? "記録なし" : formatTime(device.lastScanAt)}</dd></div>
          <div><dt>端末種別</dt><dd>{device.deviceType}</dd></div>
        </dl>
      </div>
      {onOpen !== undefined && <div className="device-card-open">タップして端末を操作 <span aria-hidden="true">→</span></div>}
    </article>
  );
}

function remoteCommandLabel(type: ReceptionRemoteCommandType) {
  if (type === "pause-reception") return "受付を一時停止";
  if (type === "resume-reception") return "受付を再開";
  if (type === "restart-camera") return "カメラを再起動";
  if (type === "sync-pending") return "未送信データを再同期";
  if (type === "play-sound") return "確認音を鳴らす";
  return "受付アプリを再読み込み";
}

function remoteCommandStatusLabel(status: ReceptionRemoteCommandStatus) {
  if (status === "pending") return "送信中";
  if (status === "received") return "端末が実行中";
  if (status === "completed") return "完了";
  return "失敗";
}

function DeviceDetail({ eventDataId, device, now, onClose }: {
  eventDataId: string;
  device: ReceptionDevice;
  now: number;
  onClose: () => void;
}) {
  const [commands, setCommands] = useState<ReceptionRemoteCommand[]>([]);
  const [sending, setSending] = useState<ReceptionRemoteCommandType | null>(null);
  const [commandError, setCommandError] = useState("");
  const online = now - device.lastSeenAt <= CRITICAL_AFTER;
  const operatingStatus = receptionOperatingStatus(device, now);

  useEffect(() => {
    return subscribeToReceptionRemoteCommands(
      eventDataId,
      device.id,
      setCommands,
      () => setCommandError("遠隔操作履歴を読み込めませんでした。")
    );
  }, [device.id, eventDataId]);

  const sendCommand = async (type: ReceptionRemoteCommandType) => {
    if (!online || sending !== null) return;

    if (
      type === "reload-app" &&
      !window.confirm(`${device.deviceName}の受付アプリを再読み込みしますか？`)
    ) {
      return;
    }

    setSending(type);
    setCommandError("");

    try {
      await sendReceptionRemoteCommand(eventDataId, device.id, type);
    } catch (error) {
      console.error("受付端末へ遠隔操作を送信できませんでした。", error);
      setCommandError("遠隔操作を送信できませんでした。通信状態と端末権限を確認してください。");
    } finally {
      setSending(null);
    }
  };

  const actions: Array<{
    type: ReceptionRemoteCommandType;
    icon: string;
    description: string;
    danger?: boolean;
    disabled?: boolean;
  }> = [
    device.receptionPaused
      ? { type: "resume-reception", icon: "▶", description: "停止中のQR読み取りを再開します" }
      : { type: "pause-reception", icon: "Ⅱ", description: "QR読み取りを安全に一時停止します" },
    { type: "restart-camera", icon: "◉", description: "カメラ部分だけを再起動します", disabled: device.receptionPaused },
    { type: "sync-pending", icon: "↻", description: `端末内の同期待ち ${device.pendingCount}件を再送します` },
    { type: "play-sound", icon: "♪", description: "対象端末から確認音を鳴らします" },
    { type: "reload-app", icon: "⟳", description: "画面全体を再読み込みします", danger: true },
  ];

  return (
    <section className="page-panel device-detail-panel">
      <div className="device-detail-heading">
        <button type="button" className="device-detail-back" onClick={onClose}>← 端末一覧</button>
        <div>
          <small>{device.mode === "entry" ? "ENTRY TERMINAL" : "EXIT TERMINAL"}</small>
          <h2>{device.deviceName}</h2>
        </div>
        <span className={`status-badge ${operatingStatus.severity}`}>
          {operatingStatus.label}
        </span>
      </div>

      <div className="device-detail-layout">
        <article className="device-live-panel">
          <div className="device-live-title"><span className={`mode-icon ${device.mode}`}>{device.mode === "entry" ? "→" : "←"}</span><div><small>LIVE STATUS</small><strong>端末の現在状態</strong></div></div>
          <dl>
            <div><dt>最終通信</dt><dd>{formatAge(device.lastSeenAt, now)}</dd></div>
            <div><dt>受付モード</dt><dd>{device.mode === "entry" ? "入口受付" : "出口受付"}</dd></div>
            <div><dt>カメラ</dt><dd className={device.cameraState === "error" ? "error-text" : "ok-text"}>{device.cameraState === "ready" ? "正常" : device.cameraState === "error" ? "エラー" : "準備中"}</dd></div>
            <div><dt>Firebase</dt><dd className={device.lastSuccessfulSyncAt > 0 ? "ok-text" : "muted-text"}>{device.lastSuccessfulSyncAt > 0 ? "接続確認済み" : "記録なし"}</dd></div>
            <div><dt>同期待ち</dt><dd className={device.pendingCount > 0 ? "warning-text" : "ok-text"}>{device.pendingCount}件</dd></div>
            <div><dt>最終読取</dt><dd>{device.lastScanAt === "" ? "記録なし" : formatTime(device.lastScanAt)}</dd></div>
            <div><dt>バージョン</dt><dd>{device.appVersion}</dd></div>
            <div><dt>端末種別</dt><dd>{device.deviceType}</dd></div>
          </dl>
        </article>

        <article className="remote-control-panel">
          <div className="remote-control-heading"><div><small>REMOTE CONTROL</small><h3>遠隔操作</h3></div><span>{online ? "操作可能" : "端末オフライン"}</span></div>
          <div className="remote-action-grid">
            {actions.map((action) => (
              <button
                type="button"
                key={action.type}
                className={action.danger ? "remote-action danger" : "remote-action"}
                disabled={!online || sending !== null || action.disabled === true}
                onClick={() => void sendCommand(action.type)}
              >
                <span aria-hidden="true">{action.icon}</span>
                <strong>{sending === action.type ? "送信しています…" : remoteCommandLabel(action.type)}</strong>
                <small>{action.description}</small>
              </button>
            ))}
          </div>
          {!online && <p className="remote-control-note">通信が復旧すると操作できるようになります。古い命令の誤実行を防ぐため、オフライン中は予約送信しません。</p>}
          {commandError !== "" && <p className="remote-control-error" role="alert">{commandError}</p>}
        </article>
      </div>

      <article className="command-history-panel">
        <div className="command-history-heading"><div><small>COMMAND HISTORY</small><h3>遠隔操作の実行状況</h3></div><span>{commands.length}件</span></div>
        {commands.length === 0 ? (
          <p className="command-history-empty">この端末への遠隔操作はまだありません</p>
        ) : (
          <ul>
            {commands.map((command) => {
              const expired = command.status === "pending" && command.expiresAt > 0 && command.expiresAt < now;
              const displayStatus = expired ? "failed" : command.status;

              return (
                <li key={command.id}>
                  <span className={`command-state ${displayStatus}`} aria-hidden="true" />
                  <div><strong>{remoteCommandLabel(command.type)}</strong><small>{command.createdAt === 0 ? "送信時刻を確認中" : formatTime(command.createdAt)}</small></div>
                  <b className={displayStatus}>{expired ? "期限切れ" : remoteCommandStatusLabel(command.status)}</b>
                  {command.errorMessage !== "" && <p>{command.errorMessage}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </section>
  );
}

type AppProps = {
  database: Firestore;
  onReturn?: () => void;
};

export default function App({ database, onReturn }: AppProps) {
  const [view, setView] = useState<View>("overview");
  const [events, setEvents] = useState<EventData[]>([]);
  const [currentEventId, setCurrentEventId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsSummary | null>(null);
  const [devices, setDevices] = useState<ReceptionDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [now, setNow] = useState(
    () => Date.now()
  );
  const [firestoreHealth, setFirestoreHealth] = useState<FirestoreHealth>("checking");
  const [lastHealthCheck, setLastHealthCheck] = useState(0);
  const [streamError, setStreamError] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribeEvents = onSnapshot(collection(database, "events"), (snapshot) => {
      setEvents(snapshot.docs.map((item) => readEvent(item.id, item.data())).filter((event): event is EventData => event !== null));
      setStreamError("");
    }, (error) => {
      console.error("イベント情報を取得できませんでした。", error);
      setStreamError("イベント情報を取得できませんでした");
    });

    const unsubscribeCurrent = onSnapshot(doc(database, "system", "current-event"), (snapshot) => {
      const value = snapshot.exists() ? snapshot.data().eventId : null;
      setCurrentEventId(typeof value === "string" ? value : null);
    }, (error) => {
      console.error("現在イベントを取得できませんでした。", error);
      setStreamError("現在イベントを取得できませんでした");
    });

    return () => {
      unsubscribeEvents();
      unsubscribeCurrent();
    };
  }, [database]);

  const currentEvent = useMemo(
    () => events.find((event) => event.id === currentEventId) ?? null,
    [currentEventId, events]
  );

  useEffect(() => {
    if (currentEvent === null) {
      return undefined;
    }

    const basePath = ["event-data", currentEvent.dataDocumentId] as const;
    const unsubscribeAnalytics = onSnapshot(doc(database, ...basePath, "analytics", "summary"), (snapshot) => {
      setAnalytics(snapshot.exists() ? readAnalytics(snapshot.data()) : null);
    }, (error) => {
      console.error("集計情報を取得できませんでした。", error);
      setStreamError("集計情報を取得できませんでした");
    });

    const unsubscribeDevices = onSnapshot(collection(database, ...basePath, "reception-devices"), (snapshot) => {
      setDevices(snapshot.docs.map((item) => readReceptionDevice(item.id, item.data())).filter((device): device is ReceptionDevice => device !== null));
    }, (error) => {
      console.error("受付端末情報を取得できませんでした。", error);
      setStreamError("受付端末情報を取得できませんでした");
    });

    return () => {
      unsubscribeAnalytics();
      unsubscribeDevices();
    };
  }, [currentEvent, database]);

  const runHealthCheck = useCallback(async () => {
    setFirestoreHealth("checking");
    try {
      await getDocFromServer(doc(database, "system", "current-event"));
      setFirestoreHealth("online");
    } catch (error) {
      console.error("Firestore実通信確認に失敗しました。", error);
      setFirestoreHealth("error");
    } finally {
      setLastHealthCheck(Date.now());
    }
  }, [database]);

  useEffect(() => {
    const initialCheck =
      window.setTimeout(
        () => void runHealthCheck(),
        0
      );
    const timer = window.setInterval(() => void runHealthCheck(), 30_000);
    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(timer);
    };
  }, [runHealthCheck]);

  const observedAnalytics =
    currentEvent === null
      ? null
      : analytics;

  const observedDevices =
    useMemo(
      () =>
        currentEvent === null
          ? []
          : devices,
      [currentEvent, devices]
    );

  const activeDevices = useMemo(
    () => observedDevices.filter((device) => now - device.lastSeenAt <= CRITICAL_AFTER),
    [observedDevices, now]
  );

  const selectedDevice = useMemo(
    () => activeDevices.find((device) => device.id === selectedDeviceId) ?? null,
    [activeDevices, selectedDeviceId]
  );

  const openDevice = (device: ReceptionDevice) => {
    setSelectedDeviceId(device.id);
    setView("devices");
  };

  const latestDevice = (mode: ReceptionMode) =>
    activeDevices.filter((device) => device.mode === mode).sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] ?? null;

  const entryDevice = latestDevice("entry");
  const exitDevice = latestDevice("exit");
  const totalPending = activeDevices.reduce((total, device) => total + device.pendingCount, 0);

  const alerts = useMemo<SystemAlert[]>(() => {
    const result: SystemAlert[] = [];
    if (firestoreHealth === "error") result.push({ id: "firestore", severity: "critical", title: "この部員端末からFirebaseへ接続できません", detail: "この端末のネットワークと学校回線を確認してください" });
    if (streamError !== "") result.push({ id: "stream", severity: "critical", title: streamError, detail: "リアルタイム監視が停止している可能性があります" });
    if (currentEvent === null) result.push({ id: "event", severity: "critical", title: "現在のイベントが設定されていません", detail: "QR受付システムのイベント管理を確認してください" });

    for (const mode of ["entry", "exit"] as const) {
      const device = mode === "entry" ? entryDevice : exitDevice;
      const label = mode === "entry" ? "入口" : "出口";
      if (device === null || now - device.lastSeenAt > CRITICAL_AFTER) {
        result.push({ id: `${mode}-offline`, severity: "critical", title: `${label}端末から通信がありません`, detail: `${label}iPadでQR受付画面とWi-Fiを確認してください` });
        continue;
      }
      if (now - device.lastSeenAt > WARNING_AFTER) result.push({ id: `${mode}-slow`, severity: "warning", title: `${label}端末の通信が遅れています`, detail: `最終通信は${formatAge(device.lastSeenAt, now)}です` });
      if (device.pendingCount > 0) result.push({ id: `${mode}-pending`, severity: "warning", title: `${label}端末に同期待ちが${device.pendingCount}件あります`, detail: "通信復旧後に受付順で自動送信されます" });
      if (device.cameraState === "error") result.push({ id: `${mode}-camera`, severity: "critical", title: `${label}端末のカメラでエラーが発生しています`, detail: "カメラ権限と受付画面を確認してください" });
      if (device.receptionPaused) result.push({ id: `${mode}-paused`, severity: "warning", title: `${label}端末の受付が一時停止中です`, detail: "管制の端末画面から再開できます" });
      if (device.appVersion !== EXPECTED_RECEPTION_VERSION) result.push({ id: `${mode}-version`, severity: "warning", title: `${label}端末のバージョンが一致しません`, detail: `現在 ${device.appVersion}／推奨 ${EXPECTED_RECEPTION_VERSION}` });
    }

    if (activeDevices.filter((device) => device.mode === "entry").length > 1) result.push({ id: "entry-duplicate", severity: "warning", title: "入口モードの端末が複数稼働しています", detail: "意図した配置か確認してください" });
    if (activeDevices.filter((device) => device.mode === "exit").length > 1) result.push({ id: "exit-duplicate", severity: "warning", title: "出口モードの端末が複数稼働しています", detail: "意図した配置か確認してください" });
    return result;
  }, [activeDevices, currentEvent, entryDevice, exitDevice, firestoreHealth, now, streamError]);

  const overallSeverity: HealthSeverity = alerts.some((alert) => alert.severity === "critical")
    ? "critical"
    : alerts.length > 0 ? "warning" : "normal";

  const chartValues = Object.entries(observedAnalytics?.hourlyEntryCounts ?? {}).sort(([a], [b]) => a.localeCompare(b)).slice(-10);
  const chartMax = Math.max(1, ...chartValues.map(([, value]) => value));

  const handleAnalysisNavigation = (page: string) => {
    if (page === "past-data") {
      setView("past-data");
      return;
    }

    if (page === "analysis") {
      setView("analysis");
      return;
    }

    if (page === "events") {
      if (onReturn !== undefined) {
        onReturn();
      } else {
        window.location.assign("/qr-system/");
      }
      return;
    }

    setView("overview");
  };

  if (view === "analysis") {
    return (
      <Suspense fallback={<AnalysisLoading label="分析画面を読み込んでいます" />}>
        <AnalysisPage
          setPage={handleAnalysisNavigation}
          eventData={currentEvent}
        />
      </Suspense>
    );
  }

  if (view === "past-data") {
    return (
      <Suspense fallback={<AnalysisLoading label="過去データを読み込んでいます" />}>
        <PastDataPage
          setPage={handleAnalysisNavigation}
          events={events}
        />
      </Suspense>
    );
  }

  return (
    <div className="control-shell">
      <aside className="sidebar">
        <div className="brand"><span>QR</span><strong>管制</strong></div>
        <nav aria-label="管制メニュー">
          {(["overview", "analysis", "devices", "incidents", "diagnostics"] as const).map((item) => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => {
              setView(item);
              if (item !== "devices") setSelectedDeviceId(null);
            }}>
              <NavIcon kind={item} />
              {item === "overview" ? "概要" : item === "analysis" ? "分析" : item === "devices" ? "端末" : item === "incidents" ? "障害履歴" : "診断"}
              {item === "incidents" && alerts.length > 0 && <b>{alerts.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-version">CONTROL v{CONTROL_VERSION}</div>
      </aside>

      <div className="control-content">
        <header className="topbar">
          <div><small>TRAFFIC RESEARCH CLUB</small><h1>QR管理・管制システム</h1></div>
          <div className="topbar-meta">
            <button
              type="button"
              className="return-to-admin"
              onClick={() => onReturn?.() ?? window.location.assign("/qr-system/")}
            >
              受付管理へ戻る
            </button>
            <span>{currentEvent?.name ?? "イベント未設定"}</span>
            <time>{formatTime(now)}</time>
            <span className={`operation-pill ${overallSeverity}`}>{overallSeverity === "normal" ? "正常運用" : overallSeverity === "warning" ? "注意あり" : "異常検知"}</span>
          </div>
        </header>

        <main>
          {view === "overview" && (
            <>
              <section className="summary-grid" aria-label="現在の集計">
                <article><span className="summary-icon green">人</span><div><small>現在の室内人数</small><strong>{observedAnalytics?.currentInside ?? 0}<em>人</em></strong></div></article>
                <article><span className="summary-icon blue">計</span><div><small>総来場者数</small><strong>{observedAnalytics?.totalVisitors ?? 0}<em>人</em></strong></div></article>
                <article><span className="summary-icon amber">↻</span><div><small>同期待ち</small><strong>{totalPending}<em>件</em></strong></div></article>
                <article><span className="summary-icon violet">端</span><div><small>稼働端末</small><strong>{activeDevices.length}<em>台</em></strong></div></article>
              </section>

              <section className="device-grid">
                <DeviceCard device={entryDevice} mode="entry" now={now} onOpen={entryDevice === null ? undefined : () => openDevice(entryDevice)} />
                <DeviceCard device={exitDevice} mode="exit" now={now} onOpen={exitDevice === null ? undefined : () => openDevice(exitDevice)} />
              </section>

              {alerts.length > 0 ? (
                <section className={`primary-alert ${alerts[0].severity}`}><span>!</span><div><strong>{alerts[0].title}</strong><p>{alerts[0].detail}</p></div><button onClick={() => setView("incidents")}>すべて確認</button></section>
              ) : (
                <section className="primary-alert normal"><span>✓</span><div><strong>すべてのシステムが正常です</strong><p>入口・出口端末とFirebaseの通信を確認できています</p></div></section>
              )}

              <section className="lower-grid">
                <article className="panel recent-panel"><div className="panel-heading"><div><small>LIVE STATUS</small><h2>現在の状況</h2></div><span className={`firebase-chip ${firestoreHealth}`}>Firebase {firestoreHealth === "online" ? "接続中" : firestoreHealth === "checking" ? "確認中" : "接続不可"}</span></div>
                  <ul className="status-list">
                    <li><span className={entryDevice !== null && deviceSeverity(entryDevice, now) === "normal" ? "dot normal" : "dot warning"} /><strong>入口受付</strong><p>{entryDevice === null ? "通信なし" : `最終通信 ${formatAge(entryDevice.lastSeenAt, now)}`}</p></li>
                    <li><span className={exitDevice !== null && deviceSeverity(exitDevice, now) === "normal" ? "dot normal" : "dot warning"} /><strong>出口受付</strong><p>{exitDevice === null ? "通信なし" : `最終通信 ${formatAge(exitDevice.lastSeenAt, now)}`}</p></li>
                    <li><span className={firestoreHealth === "online" ? "dot normal" : "dot critical"} /><strong>Firebase実通信</strong><p>{lastHealthCheck === 0 ? "確認中" : `${formatTime(lastHealthCheck)}に確認`}</p></li>
                    <li><span className={totalPending === 0 ? "dot normal" : "dot warning"} /><strong>オフライン同期</strong><p>{totalPending === 0 ? "同期待ちなし" : `${totalPending}件が端末内で待機中`}</p></li>
                  </ul>
                </article>

                <article className="panel chart-panel"><div className="panel-heading"><div><small>VISITOR TREND</small><h2>時間帯別入場者</h2></div><b>現在 {observedAnalytics?.currentInside ?? 0}人</b></div>
                  <div className="bar-chart" aria-label="時間帯別入場者グラフ">
                    {chartValues.length === 0 ? <p className="empty-chart">集計データを待っています</p> : chartValues.map(([key, value]) => (
                      <div key={key} className="bar-column"><span style={{ height: `${Math.max(6, value / chartMax * 100)}%` }} title={`${value}人`} /><small>{key.slice(-2)}時</small></div>
                    ))}
                  </div>
                </article>
              </section>
            </>
          )}

          {view === "devices" && selectedDevice !== null && currentEvent !== null && (
            <DeviceDetail
              eventDataId={currentEvent.dataDocumentId}
              device={selectedDevice}
              now={now}
              onClose={() => setSelectedDeviceId(null)}
            />
          )}

          {view === "devices" && selectedDevice === null && <section className="page-panel"><div className="page-heading"><div><small>TERMINALS</small><h2>受付端末一覧</h2></div><span>{activeDevices.length}台が稼働中</span></div><div className="all-device-grid">{activeDevices.length === 0 ? <p className="empty-state">稼働中の受付端末が見つかりません</p> : [...activeDevices].sort((a, b) => b.lastSeenAt - a.lastSeenAt).map((device) => <DeviceCard key={device.id} device={device} mode={device.mode} now={now} onOpen={() => openDevice(device)} />)}</div></section>}

          {view === "incidents" && <section className="page-panel"><div className="page-heading"><div><small>INCIDENTS</small><h2>現在の異常・注意</h2></div><span>{alerts.length}件</span></div><div className="alert-list">{alerts.length === 0 ? <div className="empty-state success">現在、異常はありません</div> : alerts.map((alert) => <article key={alert.id} className={alert.severity}><span>!</span><div><strong>{alert.title}</strong><p>{alert.detail}</p></div></article>)}</div></section>}

          {view === "diagnostics" && <section className="page-panel diagnostics"><div className="page-heading"><div><small>DIAGNOSTICS</small><h2>通信診断</h2></div><button onClick={() => void runHealthCheck()} disabled={firestoreHealth === "checking"}>再診断</button></div><div className="diagnostic-grid"><article><small>ブラウザ通信</small><strong className={navigator.onLine ? "ok-text" : "error-text"}>{navigator.onLine ? "オンライン" : "オフライン"}</strong><p>端末がネットワークを認識しているか</p></article><article><small>Firestore実通信</small><strong className={firestoreHealth === "online" ? "ok-text" : firestoreHealth === "error" ? "error-text" : "warning-text"}>{firestoreHealth === "online" ? "正常" : firestoreHealth === "error" ? "接続不可" : "確認中"}</strong><p>キャッシュではなくサーバーへ直接確認</p></article><article><small>リアルタイム監視</small><strong className={streamError === "" ? "ok-text" : "error-text"}>{streamError === "" ? "受信中" : "停止"}</strong><p>{streamError || "イベント・集計・端末状態を受信中"}</p></article><article><small>受付推奨バージョン</small><strong>{EXPECTED_RECEPTION_VERSION}</strong><p>入口・出口の一致を確認します</p></article></div><div className="diagnostic-note"><strong>通信不能時について</strong><p>受付iPadが完全にオフラインになると、管制側では最後に受信した状態までしか確認できません。端末内の未送信データは受付iPadに保持されます。</p></div></section>}
        </main>
      </div>
    </div>
  );
}
