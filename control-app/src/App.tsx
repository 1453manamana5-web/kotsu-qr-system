import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import type {
  AnalyticsSummary,
  EventData,
  HealthSeverity,
  LiveActivity,
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
const DEFAULT_CAPACITY = 200;
const ACTIVITY_HISTORY_LIMIT = 240;
const HISTORICAL_EVENT_LIMIT = 5;
const HISTORICAL_ACTIVITY_LIMIT = 2_000;

type View = "overview" | "analysis" | "past-data" | "devices" | "incidents" | "diagnostics" | "lab";
type FirestoreHealth = "checking" | "online" | "error";
type AutopilotLevel = 0 | 1 | 2 | 3;
type NetworkQualitySample = {
  recordedAt: number;
  firebaseLatencyMs: number;
  downloadMbps: number;
  networkMeasuredAt: string;
};
type OccupancyPoint = {
  label: string;
  value: number;
  predicted: boolean;
};
type MinuteFlow = {
  label: string;
  entries: number;
  exits: number;
};
type HistoricalEventFlow = {
  eventId: string;
  eventName: string;
  startAt: number;
  endAt: number;
  activities: LiveActivity[];
};
type HybridForecast = {
  minutes: 5 | 10 | 15;
  value: number;
  lower: number;
  upper: number;
  confidence: number;
  liveDelta: number;
  historicalDelta: number | null;
  historyWeight: number;
  historicalSamples: number;
};
type AutopilotSuggestion = {
  id: string;
  severity: HealthSeverity;
  title: string;
  detail: string;
  buttonLabel: string;
  device?: ReceptionDevice;
  command?: ReceptionRemoteCommandType;
  destination?: "devices" | "forecast";
};

const AUTOPILOT_LEVELS: ReadonlyArray<{
  level: AutopilotLevel;
  label: string;
  name: string;
  description: string;
}> = [
  { level: 0, label: "OFF", name: "停止", description: "自動運転の監視・提案・操作を停止します。" },
  { level: 1, label: "Lv.1", name: "支援", description: "異常を監視し、必要な対応だけを提案します。" },
  { level: 2, label: "Lv.2", name: "半自動", description: "提案を確認し、人が承認した操作を実行します。" },
  { level: 3, label: "Lv.3", name: "自動", description: "安全な復旧操作を自動実行し、結果まで確認します。" },
];

function readAutopilotLevel(value: unknown): AutopilotLevel {
  return value === 0 || value === 1 || value === 2 || value === 3 ? value : 2;
}

function autopilotLevelLabel(level: AutopilotLevel) {
  const setting = AUTOPILOT_LEVELS.find((item) => item.level === level);
  return setting === undefined ? "Lv.2 半自動" : `${setting.label} ${setting.name}`;
}

function isSafeAutomaticCommand(command: ReceptionRemoteCommandType | undefined) {
  return command === "restart-camera" || command === "sync-pending";
}

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

function readDecimal(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value * 10) / 10)
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
    capacity: readNumber(data.capacity) || DEFAULT_CAPACITY,
  };
}

function readLiveActivity(id: string, data: DocumentData): LiveActivity | null {
  if (
    data.type !== "ticket-entry" &&
    data.type !== "ticket-exit" &&
    data.type !== "member-entry" &&
    data.type !== "member-exit"
  ) return null;

  if (typeof data.timestamp !== "string") return null;
  const timestamp = new Date(data.timestamp).getTime();
  if (!Number.isFinite(timestamp)) return null;

  return { id, type: data.type, timestamp };
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
    firebaseLatencyMs: readNumber(data.firebaseLatencyMs),
    downloadMbps: readDecimal(data.downloadMbps),
    networkMeasuredAt: typeof data.networkMeasuredAt === "string" ? data.networkMeasuredAt : "",
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

function isEntryActivity(activity: LiveActivity) {
  return activity.type === "ticket-entry" || activity.type === "member-entry";
}

function activityRate(
  activities: LiveActivity[],
  now: number,
  startMinutesAgo: number,
  endMinutesAgo: number,
  predicate: (activity: LiveActivity) => boolean
) {
  const start = now - startMinutesAgo * 60_000;
  const end = now - endMinutesAgo * 60_000;
  const minutes = Math.max(1, startMinutesAgo - endMinutesAgo);
  return activities.filter((activity) => (
    activity.timestamp > start && activity.timestamp <= end && predicate(activity)
  )).length / minutes;
}

function eventDateTime(event: EventData, time: string) {
  const timestamp = new Date(`${event.date}T${time}`).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function netChangeBetween(activities: LiveActivity[], start: number, end: number) {
  return activities
    .filter((activity) => activity.timestamp > start && activity.timestamp <= end)
    .reduce((total, activity) => total + (isEntryActivity(activity) ? 1 : -1), 0);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function createHybridForecast(
  minutes: 5 | 10 | 15,
  current: number,
  liveNetRate: number,
  recentActivityCount: number,
  historicalFlows: HistoricalEventFlow[],
  currentStartAt: number,
  now: number
): HybridForecast {
  const elapsed = Math.max(0, now - currentStartAt);
  const historicalDeltas = currentStartAt <= 0 ? [] : historicalFlows.flatMap((historical) => {
    const start = historical.startAt + elapsed;
    const end = start + minutes * 60_000;
    if (start < historical.startAt || end > historical.endAt) return [];
    return [netChangeBetween(historical.activities, start, end)];
  });
  const historicalDelta = historicalDeltas.length === 0
    ? null
    : historicalDeltas.reduce((total, value) => total + value, 0) / historicalDeltas.length;
  const liveEvidence = clamp(recentActivityCount / 10, 0, 1);
  const historyWeight = historicalDelta === null
    ? 0
    : clamp(0.15 + historicalDeltas.length * 0.08 + (1 - liveEvidence) * 0.22, 0.18, 0.55);
  const liveDelta = liveNetRate * minutes;
  const blendedDelta = historicalDelta === null
    ? liveDelta
    : liveDelta * (1 - historyWeight) + historicalDelta * historyWeight;
  const historicalAverage = historicalDelta ?? 0;
  const variance = historicalDeltas.length < 2
    ? 0
    : historicalDeltas.reduce((total, value) => total + (value - historicalAverage) ** 2, 0) / historicalDeltas.length;
  const consistency = historicalDeltas.length === 0
    ? 0
    : historicalDeltas.length === 1
      ? 0.5
      : 1 - clamp(Math.sqrt(variance) / (Math.abs(historicalAverage) + 5), 0, 1);
  const historyEvidence = clamp(historicalDeltas.length / 3, 0, 1);
  const confidence = Math.round(clamp(
    30 + liveEvidence * 35 + historyEvidence * 20 + consistency * 15,
    25,
    94
  ));
  const disagreement = historicalDelta === null ? 0 : Math.abs(liveDelta - historicalDelta);
  const uncertainty = Math.max(2, Math.round(
    2 + (100 - confidence) / 100 * minutes * 0.35 + disagreement * 0.45 + Math.abs(blendedDelta) * 0.18
  ));
  const value = Math.max(0, Math.round(current + blendedDelta));

  return {
    minutes,
    value,
    lower: Math.max(0, value - uncertainty),
    upper: value + uncertainty,
    confidence,
    liveDelta,
    historicalDelta,
    historyWeight,
    historicalSamples: historicalDeltas.length,
  };
}

function buildOccupancyPoints(
  activities: LiveActivity[],
  current: number,
  forecasts: HybridForecast[],
  now: number
): OccupancyPoint[] {
  const history = [30, 25, 20, 15, 10, 5, 0].map((minutesAgo) => {
    const cutoff = now - minutesAgo * 60_000;
    const netAfter = activities
      .filter((activity) => activity.timestamp > cutoff && activity.timestamp <= now)
      .reduce((total, activity) => total + (isEntryActivity(activity) ? 1 : -1), 0);

    return {
      label: minutesAgo === 0 ? "現在" : `${minutesAgo}分前`,
      value: Math.max(0, current - netAfter),
      predicted: false,
    };
  });

  return [
    ...history,
    ...forecasts.map((forecast) => ({
      label: `+${forecast.minutes}分`,
      value: forecast.value,
      predicted: true,
    })),
  ];
}

function buildMinuteFlow(activities: LiveActivity[], now: number): MinuteFlow[] {
  return Array.from({ length: 10 }, (_, index) => {
    const start = now - (10 - index) * 60_000;
    const end = start + 60_000;
    const bucket = activities.filter((activity) => activity.timestamp > start && activity.timestamp <= end);

    return {
      label: `${10 - index}分前`,
      entries: bucket.filter(isEntryActivity).length,
      exits: bucket.filter((activity) => !isEntryActivity(activity)).length,
    };
  });
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
          : kind === "lab"
            ? "⌬"
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
          <div><dt>Firebase応答</dt><dd>{device.firebaseLatencyMs > 0 ? `${device.firebaseLatencyMs}ms` : "測定中"}</dd></div>
          <div><dt>下り速度</dt><dd>{device.downloadMbps > 0 ? `${device.downloadMbps.toFixed(1)}Mbps` : "測定中"}</dd></div>
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

function MetricChart({ label, unit, values, color }: {
  label: string;
  unit: string;
  values: number[];
  color: string;
}) {
  const measuredValues = values.filter((value) => Number.isFinite(value) && value > 0);
  const currentValue = measuredValues[measuredValues.length - 1] ?? 0;
  const maximumValue = Math.max(1, ...measuredValues);
  const averageValue = measuredValues.length === 0
    ? 0
    : measuredValues.reduce((total, value) => total + value, 0) / measuredValues.length;
  const chartPoints = measuredValues.map((value, index) => {
    const x = measuredValues.length === 1 ? 300 : 20 + index / (measuredValues.length - 1) * 560;
    const y = 145 - value / maximumValue * 115;
    return { x, y };
  });
  const points = chartPoints.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const lastPoint = chartPoints[chartPoints.length - 1];

  return (
    <article className="metric-chart-card">
      <div className="metric-chart-heading">
        <div><small>{label}</small><strong>{currentValue > 0 ? currentValue.toFixed(unit === "Mbps" ? 1 : 0) : "—"}<em>{unit}</em></strong></div>
        <span>平均 {averageValue > 0 ? averageValue.toFixed(unit === "Mbps" ? 1 : 0) : "—"}／最大 {measuredValues.length > 0 ? maximumValue.toFixed(unit === "Mbps" ? 1 : 0) : "—"}</span>
      </div>
      {measuredValues.length < 2 ? (
        <div className="metric-chart-empty">測定データを集めています</div>
      ) : (
        <svg viewBox="0 0 600 170" preserveAspectRatio="none" role="img" aria-label={`${label}の直近5分グラフ`}>
          {[30, 68, 106, 145].map((y) => <line key={y} x1="20" y1={y} x2="580" y2={y} className="metric-grid-line" />)}
          <polyline points={points} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <circle cx={lastPoint?.x ?? 0} cy={lastPoint?.y ?? 0} r="6" fill={color} />
        </svg>
      )}
      <div className="metric-chart-axis"><span>測定開始</span><span>現在</span></div>
    </article>
  );
}

function LiveTerminalNode({ device, mode, now, onOpen }: {
  device: ReceptionDevice | null;
  mode: ReceptionMode;
  now: number;
  onOpen?: () => void;
}) {
  const label = mode === "entry" ? "入口端末" : "出口端末";

  if (device === null) {
    return (
      <article className="live-terminal-node missing">
        <small>{mode === "entry" ? "ENTRY" : "EXIT"}</small>
        <strong>{label}</strong>
        <span className="live-node-status critical">通信なし</span>
        <p>端末が見つかりません</p>
      </article>
    );
  }

  const status = receptionOperatingStatus(device, now);
  return (
    <button type="button" className={`live-terminal-node ${status.severity}`} onClick={onOpen}>
      <small>{mode === "entry" ? "ENTRY" : "EXIT"}</small>
      <strong>{device.deviceName}</strong>
      <span className={`live-node-status ${status.severity}`}>{status.label}</span>
      <dl>
        <div><dt>応答</dt><dd>{device.firebaseLatencyMs > 0 ? `${device.firebaseLatencyMs}ms` : "測定中"}</dd></div>
        <div><dt>下り</dt><dd>{device.downloadMbps > 0 ? `${device.downloadMbps.toFixed(1)}Mbps` : "測定中"}</dd></div>
      </dl>
      <p>タップして遠隔操作</p>
    </button>
  );
}

function ForecastChart({ points, capacity }: { points: OccupancyPoint[]; capacity: number }) {
  const maximum = Math.max(capacity, ...points.map((point) => point.value), 1);
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: 42 + index / Math.max(1, points.length - 1) * 616,
    y: 174 - point.value / maximum * 132,
  }));
  const actual = chartPoints.filter((point) => !point.predicted);
  const forecast = chartPoints.slice(Math.max(0, actual.length - 1));
  const actualLine = actual.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const forecastLine = forecast.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const capacityY = 174 - capacity / maximum * 132;

  return (
    <div className="forecast-chart" aria-label="室内人数の推移と15分予測">
      <svg viewBox="0 0 700 220" role="img">
        {[42, 86, 130, 174].map((y) => <line key={y} x1="42" y1={y} x2="658" y2={y} className="forecast-grid-line" />)}
        <line x1="42" y1={capacityY} x2="658" y2={capacityY} className="capacity-line" />
        <text x="48" y={Math.max(13, capacityY - 6)} className="capacity-label">定員 {capacity}人</text>
        {actualLine !== "" && <polyline points={actualLine} className="actual-line" />}
        {forecastLine !== "" && <polyline points={forecastLine} className="prediction-line" />}
        {chartPoints.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="5" className={point.predicted ? "prediction-dot" : "actual-dot"} />
            <text x={point.x} y="205" textAnchor="middle" className="forecast-axis-label">{point.label}</text>
          </g>
        ))}
      </svg>
      <div className="forecast-legend"><span className="actual">実績</span><span className="prediction">予測</span></div>
    </div>
  );
}

function MinuteFlowChart({ values }: { values: MinuteFlow[] }) {
  const maximum = Math.max(1, ...values.flatMap((value) => [value.entries, value.exits]));
  return (
    <div className="minute-flow-chart" aria-label="直近10分の入退場数">
      <div className="flow-bars">
        {values.map((value) => (
          <div className="flow-bar-column" key={value.label} title={`${value.label}: 入場${value.entries}人・退場${value.exits}人`}>
            <div className="flow-bar-stack">
              <span className="entry" style={{ height: `${Math.max(value.entries > 0 ? 5 : 0, value.entries / maximum * 100)}%` }} />
              <span className="exit" style={{ height: `${Math.max(value.exits > 0 ? 5 : 0, value.exits / maximum * 100)}%` }} />
            </div>
            <small>{value.label === "10分前" || value.label === "5分前" || value.label === "1分前" ? value.label.replace("分前", "") : ""}</small>
          </div>
        ))}
      </div>
      <div className="flow-legend"><span className="entry">入場</span><span className="exit">退場</span></div>
    </div>
  );
}

function DeviceDetail({ eventDataId, device, networkSamples, now, onClose }: {
  eventDataId: string;
  device: ReceptionDevice;
  networkSamples: NetworkQualitySample[];
  now: number;
  onClose: () => void;
}) {
  const [commands, setCommands] = useState<ReceptionRemoteCommand[]>([]);
  const [sending, setSending] = useState<ReceptionRemoteCommandType | null>(null);
  const [commandError, setCommandError] = useState("");
  const online = now - device.lastSeenAt <= CRITICAL_AFTER;
  const operatingStatus = receptionOperatingStatus(device, now);
  const latencyHistory = networkSamples.map((sample) => sample.firebaseLatencyMs);
  const networkMeasuredAt = new Date(device.networkMeasuredAt).getTime();
  const downloadHistory = networkSamples
    .filter((sample, index) => sample.downloadMbps > 0 && (
      index === 0 || sample.networkMeasuredAt !== networkSamples[index - 1]?.networkMeasuredAt
    ))
    .map((sample) => sample.downloadMbps);

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
            <div><dt>Firebase応答</dt><dd>{device.firebaseLatencyMs > 0 ? `${device.firebaseLatencyMs}ms` : "測定中"}</dd></div>
            <div><dt>下り速度</dt><dd>{device.downloadMbps > 0 ? `${device.downloadMbps.toFixed(1)}Mbps` : "測定中"}</dd></div>
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

      <article className="network-quality-panel">
        <div className="network-quality-heading">
          <div><small>NETWORK QUALITY</small><h3>受付端末の通信品質</h3></div>
          <span>{device.networkMeasuredAt === "" || !Number.isFinite(networkMeasuredAt) ? "下り速度を測定中" : `速度測定 ${formatAge(networkMeasuredAt, now)}`}</span>
        </div>
        <div className="network-chart-grid">
          <MetricChart label="FIREBASE RESPONSE" unit="ms" values={latencyHistory} color="#7a58d6" />
          <MetricChart label="DOWNLOAD SPEED" unit="Mbps" values={downloadHistory} color="#137f75" />
        </div>
        <p className="network-quality-note">Firebase応答は5秒ごと、下りMbpsは受付への負荷を抑えるため256KBのデータで30秒ごとに測定します。グラフは管制を開いてから直近約5分です。</p>
      </article>

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
  const [activities, setActivities] = useState<LiveActivity[]>([]);
  const [historicalFlows, setHistoricalFlows] = useState<HistoricalEventFlow[]>([]);
  const [historyLoadState, setHistoryLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [devices, setDevices] = useState<ReceptionDevice[]>([]);
  const [networkHistory, setNetworkHistory] = useState<Record<string, NetworkQualitySample[]>>({});
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [now, setNow] = useState(
    () => Date.now()
  );
  const [firestoreHealth, setFirestoreHealth] = useState<FirestoreHealth>("checking");
  const [lastHealthCheck, setLastHealthCheck] = useState(0);
  const [streamError, setStreamError] = useState("");
  const [capacitySaving, setCapacitySaving] = useState(false);
  const [autopilotSending, setAutopilotSending] = useState<string | null>(null);
  const [autopilotFeedback, setAutopilotFeedback] = useState("");
  const [autopilotLevel, setAutopilotLevel] = useState<AutopilotLevel>(2);
  const [autopilotLevelSaving, setAutopilotLevelSaving] = useState(false);
  const [autopilotUpdatedAt, setAutopilotUpdatedAt] = useState(0);
  const autoExecutedSuggestionIds = useRef(new Set<string>());

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
    let cancelled = false;

    const loadHistoricalFlows = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setHistoryLoadState("loading");

      const historicalEvents = events
        .filter((event) => event.id !== currentEvent?.id)
        .map((event) => ({
          event,
          startAt: eventDateTime(event, event.startTime),
          endAt: eventDateTime(event, event.endTime),
        }))
        .filter(({ event, startAt, endAt }) => (
          startAt > 0 &&
          endAt > startAt &&
          (event.status === "ended" || endAt < Date.now())
        ))
        .sort((a, b) => b.startAt - a.startAt)
        .slice(0, HISTORICAL_EVENT_LIMIT);

      if (historicalEvents.length === 0) {
        if (!cancelled) {
          setHistoricalFlows([]);
          setHistoryLoadState("ready");
        }
        return;
      }

      const loaded = await Promise.all(historicalEvents.map(async ({ event, startAt, endAt }) => {
        try {
          const snapshot = await getDocs(query(
            collection(database, "event-data", event.dataDocumentId, "activity"),
            orderBy("timestamp", "asc"),
            limit(HISTORICAL_ACTIVITY_LIMIT)
          ));
          const historicalActivities = snapshot.docs
            .map((item) => readLiveActivity(item.id, item.data()))
            .filter((activity): activity is LiveActivity => activity !== null);
          if (historicalActivities.length === 0) return null;
          return {
            eventId: event.id,
            eventName: event.name,
            startAt,
            endAt,
            activities: historicalActivities,
          } satisfies HistoricalEventFlow;
        } catch (error) {
          console.warn(`${event.name}の過去履歴を予測へ読み込めませんでした。`, error);
          return null;
        }
      }));

      if (cancelled) return;
      const successful = loaded.filter((flow): flow is HistoricalEventFlow => flow !== null);
      setHistoricalFlows(successful);
      setHistoryLoadState(successful.length === 0 ? "error" : "ready");
    };

    void loadHistoricalFlows();
    return () => {
      cancelled = true;
    };
  }, [currentEvent?.id, database, events]);

  useEffect(() => {
    if (currentEvent === null) {
      return undefined;
    }

    const basePath = ["event-data", currentEvent.dataDocumentId] as const;
    const unsubscribeControlSettings = onSnapshot(doc(database, ...basePath), (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() : {};
      setAutopilotLevel(readAutopilotLevel(data.autopilotLevel));
      setAutopilotUpdatedAt(timestampToMilliseconds(data.autopilotUpdatedAt));
    }, (error) => {
      console.error("管制ラボ設定を取得できませんでした。", error);
      setAutopilotFeedback("管制ラボ設定を取得できませんでした。通信状態を確認してください。");
    });
    const unsubscribeAnalytics = onSnapshot(doc(database, ...basePath, "analytics", "summary"), (snapshot) => {
      setAnalytics(snapshot.exists() ? readAnalytics(snapshot.data()) : null);
    }, (error) => {
      console.error("集計情報を取得できませんでした。", error);
      setStreamError("集計情報を取得できませんでした");
    });

    const unsubscribeDevices = onSnapshot(collection(database, ...basePath, "reception-devices"), (snapshot) => {
      const nextDevices = snapshot.docs.map((item) => readReceptionDevice(item.id, item.data())).filter((device): device is ReceptionDevice => device !== null);
      setDevices(nextDevices);
      setNetworkHistory((currentHistory) => {
        const nextHistory: Record<string, NetworkQualitySample[]> = {};

        for (const device of nextDevices) {
          const historyKey = `${currentEvent.dataDocumentId}:${device.id}`;
          const existingSamples = currentHistory[historyKey] ?? [];
          const latestSample = existingSamples[existingSamples.length - 1];

          if (device.lastSeenAt <= 0 || latestSample?.recordedAt === device.lastSeenAt) {
            nextHistory[historyKey] = existingSamples;
            continue;
          }

          nextHistory[historyKey] = [
            ...existingSamples,
            {
              recordedAt: device.lastSeenAt,
              firebaseLatencyMs: device.firebaseLatencyMs,
              downloadMbps: device.downloadMbps,
              networkMeasuredAt: device.networkMeasuredAt,
            },
          ].filter((sample) => device.lastSeenAt - sample.recordedAt <= 5 * 60 * 1000).slice(-60);
        }

        return nextHistory;
      });
    }, (error) => {
      console.error("受付端末情報を取得できませんでした。", error);
      setStreamError("受付端末情報を取得できませんでした");
    });

    const activityQuery = query(
      collection(database, ...basePath, "activity"),
      orderBy("timestamp", "desc"),
      limit(ACTIVITY_HISTORY_LIMIT)
    );
    const unsubscribeActivities = onSnapshot(activityQuery, (snapshot) => {
      setActivities(snapshot.docs
        .map((item) => readLiveActivity(item.id, item.data()))
        .filter((activity): activity is LiveActivity => activity !== null));
    }, (error) => {
      console.error("入退場履歴を取得できませんでした。", error);
      setStreamError("入退場履歴を取得できませんでした");
    });

    return () => {
      unsubscribeControlSettings();
      unsubscribeAnalytics();
      unsubscribeDevices();
      unsubscribeActivities();
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

  const observedActivities = useMemo(
    () => currentEvent === null ? [] : activities,
    [activities, currentEvent]
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
  const currentOccupancy = (observedAnalytics?.currentInside ?? 0) + (observedAnalytics?.currentMembersInside ?? 0);
  const capacity = currentEvent?.capacity ?? DEFAULT_CAPACITY;
  const entryRate = activityRate(observedActivities, now, 5, 0, isEntryActivity);
  const exitRate = activityRate(observedActivities, now, 5, 0, (activity) => !isEntryActivity(activity));
  const previousEntryRate = activityRate(observedActivities, now, 10, 5, isEntryActivity);
  const netRate1 = activityRate(observedActivities, now, 1, 0, isEntryActivity)
    - activityRate(observedActivities, now, 1, 0, (activity) => !isEntryActivity(activity));
  const netRate5 = entryRate - exitRate;
  const netRate10 = activityRate(observedActivities, now, 10, 0, isEntryActivity)
    - activityRate(observedActivities, now, 10, 0, (activity) => !isEntryActivity(activity));
  const netRate = netRate1 * 0.5 + netRate5 * 0.35 + netRate10 * 0.15;
  const recentActivityCount = observedActivities.filter((activity) => activity.timestamp > now - 10 * 60_000 && activity.timestamp <= now).length;
  const currentEventStartAt = currentEvent === null ? 0 : eventDateTime(currentEvent, currentEvent.startTime);
  const deviceConfidencePenalty = (entryDevice === null || exitDevice === null ? 15 : 0) + (streamError === "" ? 0 : 15);
  const hybridForecasts = useMemo(
    () => ([5, 10, 15] as const).map((minutes) => {
      const forecast = createHybridForecast(
        minutes,
        currentOccupancy,
        netRate,
        recentActivityCount,
        historicalFlows,
        currentEventStartAt,
        now
      );
      return {
        ...forecast,
        confidence: Math.max(20, forecast.confidence - deviceConfidencePenalty),
      };
    }),
    [currentEventStartAt, currentOccupancy, deviceConfidencePenalty, historicalFlows, netRate, now, recentActivityCount]
  );
  const forecast5 = hybridForecasts[0];
  const forecast10 = hybridForecasts[1];
  const forecast15 = hybridForecasts[2];
  const predicted5 = forecast5?.value ?? currentOccupancy;
  const predicted10 = forecast10?.value ?? currentOccupancy;
  const predicted15 = forecast15?.value ?? currentOccupancy;
  const occupancyRate = capacity > 0 ? Math.round(currentOccupancy / capacity * 100) : 0;
  const occupancyPoints = useMemo(
    () => buildOccupancyPoints(observedActivities, currentOccupancy, hybridForecasts, now),
    [currentOccupancy, hybridForecasts, now, observedActivities]
  );
  const minuteFlow = useMemo(
    () => buildMinuteFlow(observedActivities, now),
    [now, observedActivities]
  );
  const predictionReasons = useMemo(() => {
    const reasons: string[] = [];
    const historicalSamples = forecast15?.historicalSamples ?? 0;
    const historyWeight = forecast15?.historyWeight ?? 0;

    if (historicalSamples > 0) {
      reasons.push(`過去${historicalSamples}イベントの同じ経過時間を${Math.round(historyWeight * 100)}%反映`);
    } else if (historyLoadState === "loading") {
      reasons.push("過去イベントの傾向を読み込み中");
    } else if (historyLoadState === "error") {
      reasons.push("過去履歴を取得できないためライブデータ中心");
    } else {
      reasons.push("比較できる過去履歴がないためライブデータ中心");
    }

    reasons.push("直近1・5・10分の流れを、新しい動きほど強く反映");
    if (entryRate >= previousEntryRate * 1.25 && entryRate >= 1) {
      reasons.push(`入場ペースが前の5分より上昇（毎分${entryRate.toFixed(1)}人）`);
    } else if (entryRate <= previousEntryRate * 0.75 && previousEntryRate >= 1) {
      reasons.push("入場ペースが前の5分より低下");
    } else {
      reasons.push("入退場ペースは大きく変化していません");
    }
    return reasons;
  }, [entryRate, forecast15, historyLoadState, previousEntryRate]);

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

  const autopilotSuggestions = useMemo<AutopilotSuggestion[]>(() => {
    const suggestions: AutopilotSuggestion[] = [];
    const forecastRatio = capacity > 0 ? predicted15 / capacity : 0;
    const forecastUpperRatio = capacity > 0 ? (forecast15?.upper ?? predicted15) / capacity : 0;
    const forecastConfidence = forecast15?.confidence ?? 20;

    if (forecastRatio >= 1 && entryDevice !== null) {
      suggestions.push({
        id: "forecast-capacity",
        severity: "critical",
        title: "15分以内に定員へ達する予測です",
        detail: `${predicted15}人（${forecast15?.lower ?? predicted15}〜${forecast15?.upper ?? predicted15}人、信頼度${forecastConfidence}%）の予測です。`,
        buttonLabel: "入口を一時停止",
        device: entryDevice,
        command: "pause-reception",
      });
    } else if (forecastRatio >= 0.8 || forecastUpperRatio >= 1) {
      suggestions.push({
        id: "forecast-warning",
        severity: "warning",
        title: forecastUpperRatio >= 1 ? "予測範囲が定員へ達する可能性があります" : "会場が混雑する見込みです",
        detail: `15分後は${predicted15}人、予測範囲は${forecast15?.lower ?? predicted15}〜${forecast15?.upper ?? predicted15}人です。`,
        buttonLabel: "予測を確認",
        destination: "forecast",
      });
    }

    for (const device of [entryDevice, exitDevice]) {
      if (device === null) continue;
      const label = device.mode === "entry" ? "入口端末" : "出口端末";

      if (device.cameraState === "error") {
        suggestions.push({
          id: `${device.id}-camera`,
          severity: "critical",
          title: `${label}のカメラに異常があります`,
          detail: "カメラ部分だけを安全に再起動できます。",
          buttonLabel: "カメラを再起動",
          device,
          command: "restart-camera",
        });
      } else if (device.receptionPaused) {
        suggestions.push({
          id: `${device.id}-paused`,
          severity: "warning",
          title: `${label}が一時停止中です`,
          detail: "意図した停止でなければ、受付を遠隔で再開できます。",
          buttonLabel: "受付を再開",
          device,
          command: "resume-reception",
        });
      }

      if (device.pendingCount > 0) {
        suggestions.push({
          id: `${device.id}-pending`,
          severity: "warning",
          title: `${label}に同期待ちがあります`,
          detail: `${device.pendingCount}件のデータをもう一度送信できます。`,
          buttonLabel: "再同期する",
          device,
          command: "sync-pending",
        });
      }

      if (device.firebaseLatencyMs > 1_000 || (device.downloadMbps > 0 && device.downloadMbps < 1)) {
        suggestions.push({
          id: `${device.id}-network`,
          severity: "warning",
          title: `${label}の通信が不安定です`,
          detail: `応答 ${device.firebaseLatencyMs || "—"}ms／下り ${device.downloadMbps > 0 ? device.downloadMbps.toFixed(1) : "—"}Mbpsです。`,
          buttonLabel: "端末を確認",
          device,
          destination: "devices",
        });
      }
    }

    if (entryDevice === null || exitDevice === null) {
      suggestions.push({
        id: "terminal-missing",
        severity: "critical",
        title: "通信中の受付端末が不足しています",
        detail: `${entryDevice === null ? "入口" : "出口"}端末が見つかりません。`,
        buttonLabel: "端末一覧を確認",
        destination: "devices",
      });
    }

    if (entryRate >= 2 && entryRate >= Math.max(1, previousEntryRate * 1.5)) {
      suggestions.push({
        id: "entry-spike",
        severity: "warning",
        title: "入場ペースが急に上がっています",
        detail: `直近5分は毎分${entryRate.toFixed(1)}人です。混雑予測を確認してください。`,
        buttonLabel: "予測を確認",
        destination: "forecast",
      });
    }

    const severityOrder: Record<HealthSeverity, number> = { critical: 0, warning: 1, normal: 2 };
    return suggestions
      .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
      .slice(0, 3);
  }, [capacity, entryDevice, entryRate, exitDevice, forecast15, predicted15, previousEntryRate]);
  const autopilotSeverity: HealthSeverity = autopilotSuggestions.some((suggestion) => suggestion.severity === "critical")
    ? "critical"
    : autopilotSuggestions.length > 0 ? "warning" : "normal";
  const displayedAutopilotSeverity: HealthSeverity = autopilotLevel === 0 ? "normal" : autopilotSeverity;

  const changeCapacity = async () => {
    if (currentEvent === null || capacitySaving) return;
    const value = window.prompt("会場の定員を入力してください", String(capacity));
    if (value === null) return;
    const nextCapacity = Number(value);

    if (!Number.isInteger(nextCapacity) || nextCapacity < 1 || nextCapacity > 5_000) {
      setAutopilotFeedback("定員は1〜5000人の整数で入力してください。");
      return;
    }

    setCapacitySaving(true);
    setAutopilotFeedback("");
    try {
      await updateDoc(doc(database, "events", currentEvent.id), { capacity: nextCapacity });
      setAutopilotFeedback(`定員を${nextCapacity}人に更新しました。`);
    } catch (error) {
      console.error("定員を更新できませんでした。", error);
      setAutopilotFeedback("定員を更新できませんでした。端末権限と通信を確認してください。");
    } finally {
      setCapacitySaving(false);
    }
  };

  const changeAutopilotLevel = async (nextLevel: AutopilotLevel) => {
    if (currentEvent === null || autopilotLevelSaving || nextLevel === autopilotLevel) return;
    if (
      nextLevel === 3 &&
      !window.confirm("Lv.3では、カメラ再起動と未送信データの再同期を自動実行します。Lv.3へ切り替えますか？")
    ) return;

    setAutopilotLevelSaving(true);
    setAutopilotFeedback("");
    try {
      await setDoc(doc(database, "event-data", currentEvent.dataDocumentId), {
        autopilotLevel: nextLevel,
        autopilotUpdatedAt: serverTimestamp(),
      }, { merge: true });
      setAutopilotLevel(nextLevel);
      if (nextLevel === 0) autoExecutedSuggestionIds.current.clear();
      setAutopilotFeedback(`自動運転を「${autopilotLevelLabel(nextLevel)}」へ切り替えました。`);
    } catch (error) {
      console.error("自動運転レベルを保存できませんでした。", error);
      setAutopilotFeedback("自動運転レベルを保存できませんでした。端末権限と通信を確認してください。");
    } finally {
      setAutopilotLevelSaving(false);
    }
  };

  const executeAutopilotSuggestion = async (suggestion: AutopilotSuggestion) => {
    if (autopilotSending !== null) return;

    if (suggestion.destination === "forecast") {
      setView("overview");
      window.setTimeout(() => {
        document.getElementById("live-prediction-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
      return;
    }

    if (suggestion.destination === "devices" && suggestion.command === undefined) {
      if (suggestion.device !== undefined) {
        openDevice(suggestion.device);
      } else {
        setSelectedDeviceId(null);
        setView("devices");
      }
      return;
    }

    if (suggestion.device === undefined || suggestion.command === undefined || currentEvent === null) return;
    if (autopilotLevel <= 1) {
      setAutopilotFeedback(autopilotLevel === 0
        ? "自動運転は停止中です。管制ラボでレベルを変更してください。"
        : "Lv.1は提案のみです。操作する場合はLv.2へ切り替えてください。");
      return;
    }
    if (
      (suggestion.command === "pause-reception" || suggestion.command === "resume-reception") &&
      !window.confirm(`${suggestion.device.deviceName}で「${remoteCommandLabel(suggestion.command)}」を実行しますか？`)
    ) return;

    setAutopilotSending(suggestion.id);
    setAutopilotFeedback("");
    try {
      await sendReceptionRemoteCommand(currentEvent.dataDocumentId, suggestion.device.id, suggestion.command);
      setAutopilotFeedback(`${suggestion.device.deviceName}へ「${remoteCommandLabel(suggestion.command)}」を送信しました。`);
    } catch (error) {
      console.error("オートパイロット提案を実行できませんでした。", error);
      setAutopilotFeedback("操作を送信できませんでした。端末の通信状態を確認してください。");
    } finally {
      setAutopilotSending(null);
    }
  };

  useEffect(() => {
    const activeSuggestionIds = new Set(autopilotSuggestions.map((suggestion) => suggestion.id));
    for (const suggestionId of autoExecutedSuggestionIds.current) {
      if (!activeSuggestionIds.has(suggestionId)) autoExecutedSuggestionIds.current.delete(suggestionId);
    }
  }, [autopilotSuggestions]);

  useEffect(() => {
    if (autopilotLevel !== 3 || currentEvent === null || autopilotSending !== null) return;
    const suggestion = autopilotSuggestions.find((item) => (
      item.device !== undefined &&
      isSafeAutomaticCommand(item.command) &&
      !autoExecutedSuggestionIds.current.has(item.id)
    ));
    if (suggestion?.device === undefined || suggestion.command === undefined) return;

    const automaticDevice = suggestion.device;
    const automaticCommand = suggestion.command;
    autoExecutedSuggestionIds.current.add(suggestion.id);
    setAutopilotSending(suggestion.id);
    setAutopilotFeedback(`${automaticDevice.deviceName}の異常に対して、自動復旧を開始しました。`);

    void sendReceptionRemoteCommand(
      currentEvent.dataDocumentId,
      automaticDevice.id,
      automaticCommand
    ).then(() => {
      setAutopilotFeedback(`${automaticDevice.deviceName}へ「${remoteCommandLabel(automaticCommand)}」を自動送信しました。状態の回復を監視しています。`);
    }).catch((error: unknown) => {
      console.error("自動復旧コマンドを送信できませんでした。", error);
      setAutopilotFeedback("自動復旧を送信できませんでした。再実行は停止し、人による確認へ切り替えました。");
    }).finally(() => {
      setAutopilotSending(null);
    });
  }, [autopilotLevel, autopilotSending, autopilotSuggestions, currentEvent]);

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
          {(["overview", "analysis", "devices", "incidents", "diagnostics", "lab"] as const).map((item) => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => {
              setView(item);
              if (item !== "devices") setSelectedDeviceId(null);
            }}>
              <NavIcon kind={item} />
              {item === "overview" ? "ライブ運行" : item === "analysis" ? "分析" : item === "devices" ? "端末" : item === "incidents" ? "障害履歴" : item === "diagnostics" ? "通信診断" : "管制ラボ"}
              {item === "incidents" && alerts.length > 0 && <b>{alerts.length}</b>}
              {item === "lab" && autopilotLevel > 0 && autopilotSuggestions.length > 0 && <b>{autopilotSuggestions.length}</b>}
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
                <article><span className="summary-icon green">人</span><div><small>現在の会場内</small><strong>{currentOccupancy}<em>人</em></strong></div></article>
                <article><span className="summary-icon blue">予</span><div><small>5分後の予測</small><strong>{predicted5}<em>人</em></strong></div></article>
                <article><span className="summary-icon amber">%</span><div><small>現在の混雑度</small><strong>{occupancyRate}<em>%</em></strong></div></article>
                <article><span className="summary-icon violet">端</span><div><small>稼働端末</small><strong>{activeDevices.length}<em>/ 2台</em></strong></div></article>
              </section>

              <section className="live-operations-grid">
                <article className="live-map-panel">
                  <div className="live-panel-heading">
                    <div><small>LIVE VENUE MAP</small><h2>会場ライブ運行</h2></div>
                    <span className={`firebase-chip ${firestoreHealth}`}>Firebase {firestoreHealth === "online" ? "接続中" : firestoreHealth === "checking" ? "確認中" : "接続不可"}</span>
                  </div>
                  <div className="live-route">
                    <LiveTerminalNode device={entryDevice} mode="entry" now={now} onOpen={entryDevice === null ? undefined : () => openDevice(entryDevice)} />
                    <div className="live-flow-lane entry"><span>→</span><strong>{entryRate.toFixed(1)}人/分</strong><small>入場ペース</small></div>
                    <article className="venue-core">
                      <div className="venue-crowd" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div>
                      <small>EXHIBITION ROOM</small>
                      <h3>展示会場</h3>
                      <div className="occupancy-gauge" style={{ "--occupancy": `${Math.min(100, occupancyRate)}%` } as CSSProperties}>
                        <strong>{currentOccupancy}</strong><span>/ {capacity}人</span>
                      </div>
                      <button type="button" onClick={() => void changeCapacity()} disabled={capacitySaving}>{capacitySaving ? "保存中" : "定員を変更"}</button>
                    </article>
                    <div className="live-flow-lane exit"><span>→</span><strong>{exitRate.toFixed(1)}人/分</strong><small>退場ペース</small></div>
                    <LiveTerminalNode device={exitDevice} mode="exit" now={now} onOpen={exitDevice === null ? undefined : () => openDevice(exitDevice)} />
                  </div>
                  <div className="live-map-footer"><span>現在の増減 <strong className={netRate > 0 ? "warning-text" : "ok-text"}>{netRate >= 0 ? "+" : ""}{netRate.toFixed(1)}人/分</strong></span><span>同期待ち <strong className={totalPending > 0 ? "warning-text" : "ok-text"}>{totalPending}件</strong></span><span>最終診断 <strong>{lastHealthCheck === 0 ? "確認中" : formatTime(lastHealthCheck)}</strong></span></div>
                </article>

                <section className={`autopilot-home-alert ${displayedAutopilotSeverity}`}>
                  <span aria-hidden="true">{autopilotLevel === 0 ? "—" : displayedAutopilotSeverity === "critical" ? "!" : displayedAutopilotSeverity === "warning" ? "△" : "✓"}</span>
                  <div>
                    <small>OPERATIONS AUTOPILOT · {autopilotLevelLabel(autopilotLevel)}</small>
                    <strong>{autopilotLevel === 0 ? "自動運転は停止中です" : displayedAutopilotSeverity === "critical" ? "異常を検知しました" : displayedAutopilotSeverity === "warning" ? "確認が必要な項目があります" : "現在、異常はありません"}</strong>
                    <p>{autopilotLevel === 0 ? "通常の端末監視は継続しています。自動運転は管制ラボから再開できます。" : autopilotSuggestions.length > 0 ? `${autopilotSuggestions.length}件の判断対象があります。管制ラボで内容を確認してください。` : "端末・通信・混雑予測を自動監視しています。"}</p>
                  </div>
                  <button type="button" onClick={() => setView("lab")}>管制ラボを開く<span aria-hidden="true">→</span></button>
                </section>
              </section>

              <section className="live-forecast-grid" id="live-prediction-panel">
                <article className="panel forecast-panel">
                  <div className="live-panel-heading"><div><small>HYBRID OCCUPANCY FORECAST</small><h2>会場人数・学習型15分予測</h2></div><div className="forecast-values"><span>+5分 <strong>{predicted5}人</strong><em>{forecast5?.lower ?? predicted5}〜{forecast5?.upper ?? predicted5}</em></span><span>+10分 <strong>{predicted10}人</strong><em>{forecast10?.lower ?? predicted10}〜{forecast10?.upper ?? predicted10}</em></span><span>+15分 <strong>{predicted15}人</strong><em>{forecast15?.lower ?? predicted15}〜{forecast15?.upper ?? predicted15}</em></span></div></div>
                  <ForecastChart points={occupancyPoints} capacity={capacity} />
                  <div className="forecast-explanation">
                    <div className={`forecast-confidence ${(forecast15?.confidence ?? 20) >= 75 ? "high" : (forecast15?.confidence ?? 20) >= 50 ? "medium" : "low"}`}>
                      <span>予測信頼度</span><strong>{forecast15?.confidence ?? 20}%</strong><small>{(forecast15?.confidence ?? 20) >= 75 ? "高" : (forecast15?.confidence ?? 20) >= 50 ? "中" : "低"}</small>
                    </div>
                    <div className="forecast-reasons"><strong>この予測の根拠</strong><ul>{predictionReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>
                  </div>
                </article>
                <article className="panel flow-panel">
                  <div className="live-panel-heading"><div><small>LIVE FLOW</small><h2>直近10分の入退場</h2></div><b className={netRate > 0 ? "warning-text" : "ok-text"}>{netRate >= 0 ? "+" : ""}{netRate.toFixed(1)}人/分</b></div>
                  <MinuteFlowChart values={minuteFlow} />
                </article>
              </section>
            </>
          )}

          {view === "devices" && selectedDevice !== null && currentEvent !== null && (
            <DeviceDetail
              eventDataId={currentEvent.dataDocumentId}
              device={selectedDevice}
              networkSamples={networkHistory[`${currentEvent.dataDocumentId}:${selectedDevice.id}`] ?? []}
              now={now}
              onClose={() => setSelectedDeviceId(null)}
            />
          )}

          {view === "devices" && selectedDevice === null && <section className="page-panel"><div className="page-heading"><div><small>TERMINALS</small><h2>受付端末一覧</h2></div><span>{activeDevices.length}台が稼働中</span></div><div className="all-device-grid">{activeDevices.length === 0 ? <p className="empty-state">稼働中の受付端末が見つかりません</p> : [...activeDevices].sort((a, b) => b.lastSeenAt - a.lastSeenAt).map((device) => <DeviceCard key={device.id} device={device} mode={device.mode} now={now} onOpen={() => openDevice(device)} />)}</div></section>}

          {view === "incidents" && <section className="page-panel"><div className="page-heading"><div><small>INCIDENTS</small><h2>現在の異常・注意</h2></div><span>{alerts.length}件</span></div><div className="alert-list">{alerts.length === 0 ? <div className="empty-state success">現在、異常はありません</div> : alerts.map((alert) => <article key={alert.id} className={alert.severity}><span>!</span><div><strong>{alert.title}</strong><p>{alert.detail}</p></div></article>)}</div></section>}

          {view === "lab" && (
            <section className="page-panel lab-page">
              <div className="page-heading lab-page-heading">
                <div><small>CONTROL LABORATORY</small><h2>管制ラボ</h2></div>
                <span>実験システム 01 · 運用オートパイロット</span>
              </div>

              <div className={`lab-status-hero level-${autopilotLevel}`}>
                <div className="lab-status-orbit" aria-hidden="true"><span>{autopilotLevel}</span></div>
                <div className="lab-status-copy">
                  <small>CURRENT AUTOMATION LEVEL</small>
                  <h3>{autopilotLevelLabel(autopilotLevel)}</h3>
                  <p>{AUTOPILOT_LEVELS.find((item) => item.level === autopilotLevel)?.description}</p>
                </div>
                <dl>
                  <div><dt>監視状態</dt><dd>{autopilotLevel === 0 ? "停止中" : "稼働中"}</dd></div>
                  <div><dt>判断対象</dt><dd>{autopilotLevel === 0 ? 0 : autopilotSuggestions.length}件</dd></div>
                  <div><dt>設定同期</dt><dd>{autopilotUpdatedAt === 0 ? "初期設定" : formatTime(autopilotUpdatedAt)}</dd></div>
                </dl>
                <button type="button" className="lab-emergency-stop" onClick={() => void changeAutopilotLevel(0)} disabled={autopilotLevel === 0 || autopilotLevelSaving}>緊急停止</button>
              </div>

              <div className="autopilot-level-grid" aria-label="自動運転レベル">
                {AUTOPILOT_LEVELS.map((setting) => (
                  <button
                    type="button"
                    key={setting.level}
                    className={`${autopilotLevel === setting.level ? "active" : ""} level-${setting.level}`}
                    onClick={() => void changeAutopilotLevel(setting.level)}
                    disabled={currentEvent === null || autopilotLevelSaving}
                    aria-pressed={autopilotLevel === setting.level}
                  >
                    <span>{setting.label}</span>
                    <strong>{setting.name}</strong>
                    <p>{setting.description}</p>
                    <small>{autopilotLevel === setting.level ? "現在の設定" : "このレベルへ切替"}</small>
                  </button>
                ))}
              </div>

              <aside className="autopilot-panel autopilot-lab-panel">
                <div className="autopilot-summary">
                  <div className="autopilot-heading"><div><small>LIVE DECISION ENGINE</small><h2>現在の判断</h2></div><span>{autopilotLevelLabel(autopilotLevel)}</span></div>
                  <p className="autopilot-intro">Lv.3でも受付停止・再開は自動化せず、人の承認を待ちます。自動処理は同じ異常に対して1回だけ実行します。</p>
                  {autopilotFeedback !== "" && <p className="autopilot-feedback" role="status">{autopilotFeedback}</p>}
                </div>
                <div className="autopilot-list">
                  {autopilotLevel === 0 ? (
                    <article className="autopilot-clear is-stopped"><span>—</span><div><strong>自動運転は停止しています</strong><p>レベルを選択すると判断エンジンが再開します。</p></div></article>
                  ) : autopilotSuggestions.length === 0 ? (
                    <article className="autopilot-clear"><span>✓</span><div><strong>対応が必要な項目はありません</strong><p>端末と会場の流れは安定しています。</p></div></article>
                  ) : autopilotSuggestions.map((suggestion) => (
                    <article key={suggestion.id} className={suggestion.severity}>
                      <span>{suggestion.severity === "critical" ? "!" : "△"}</span>
                      <div><strong>{suggestion.title}</strong><p>{suggestion.detail}</p></div>
                      <button
                        type="button"
                        onClick={() => void executeAutopilotSuggestion(suggestion)}
                        disabled={
                          autopilotSending !== null ||
                          (suggestion.command !== undefined && autopilotLevel <= 1) ||
                          (autopilotLevel === 3 && isSafeAutomaticCommand(suggestion.command))
                        }
                      >
                        {autopilotSending === suggestion.id
                          ? autopilotLevel === 3 && isSafeAutomaticCommand(suggestion.command) ? "自動送信中…" : "送信中…"
                          : suggestion.command !== undefined && autopilotLevel === 1
                            ? "提案のみ"
                            : autopilotLevel === 3 && isSafeAutomaticCommand(suggestion.command)
                              ? "自動実行対象"
                              : suggestion.buttonLabel}
                      </button>
                    </article>
                  ))}
                </div>
                <button type="button" className="autopilot-incidents" onClick={() => setView("incidents")}>障害履歴を確認</button>
              </aside>

              <div className="lab-guardrail-grid">
                <article><span>自</span><div><small>AUTOMATIC</small><strong>自動実行できる操作</strong><p>カメラ再起動、未送信データの再同期</p></div></article>
                <article><span>認</span><div><small>APPROVAL REQUIRED</small><strong>人の承認が必要</strong><p>受付停止、受付再開、定員やイベント設定の変更</p></div></article>
                <article><span>限</span><div><small>SYSTEM LIMIT</small><strong>遠隔操作できない状態</strong><p>端末が完全に通信切断している場合は現地確認が必要</p></div></article>
              </div>
            </section>
          )}

          {view === "diagnostics" && (
            <section className="page-panel diagnostics">
              <div className="page-heading"><div><small>COMMUNICATION DIAGNOSTICS</small><h2>通信・システム診断</h2></div><button onClick={() => void runHealthCheck()} disabled={firestoreHealth === "checking"}>再診断</button></div>

              <div className="diagnostic-grid"><article><small>ブラウザ通信</small><strong className={navigator.onLine ? "ok-text" : "error-text"}>{navigator.onLine ? "オンライン" : "オフライン"}</strong><p>端末がネットワークを認識しているか</p></article><article><small>Firestore実通信</small><strong className={firestoreHealth === "online" ? "ok-text" : firestoreHealth === "error" ? "error-text" : "warning-text"}>{firestoreHealth === "online" ? "正常" : firestoreHealth === "error" ? "接続不可" : "確認中"}</strong><p>キャッシュではなくサーバーへ直接確認</p></article><article><small>リアルタイム監視</small><strong className={streamError === "" ? "ok-text" : "error-text"}>{streamError === "" ? "受信中" : "停止"}</strong><p>{streamError || "イベント・集計・端末状態を受信中"}</p></article><article><small>受付推奨バージョン</small><strong>{EXPECTED_RECEPTION_VERSION}</strong><p>入口・出口の一致を確認します</p></article></div>
              <div className="diagnostic-note"><strong>通信不能時について</strong><p>受付iPadが完全にオフラインになると、管制側では最後に受信した状態までしか確認できません。端末内の未送信データは受付iPadに保持されます。</p></div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
