import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

import "./control-assist.css";

type ReceptionMode = "entry" | "exit";
type CameraState = "starting" | "ready" | "error";
type AdviceLevel = "normal" | "watch" | "warning" | "critical";

type AssistDevice = {
  id: string;
  mode: ReceptionMode;
  name: string;
  lastSeenAt: number;
  pendingCount: number;
  firebaseLatencyMs: number;
  downloadMbps: number;
  cameraState: CameraState;
  receptionPaused: boolean;
};

type DeviceProfile = {
  device: AssistDevice;
  age: number;
  stale: boolean;
  criticalStale: boolean;
  networkDegraded: boolean;
  networkSevere: boolean;
  pending: boolean;
  cameraError: boolean;
  score: number;
  evidence: string[];
};

type LabAdvice = {
  key: string;
  level: AdviceLevel;
  score: number;
  title: string;
  summary: string;
  recommendation: string;
  evidence: string[];
};

const ASSIST_STORAGE_KEY = "qr-control-assist-enabled-v2";
const OLD_PROFILE_PREFIX = "qr-control-personalization-v2:uid:";
const OLD_ASSIST_PREFIX = "qr-control-personalized-assist-enabled-v1:uid:";
const OLD_OPERATOR_KEY = "qr-control-active-operator-v1";
const NOTICE_LIFETIME_MS = 14_000;
const SAME_NOTICE_COOLDOWN_MS = 3 * 60 * 1000;

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
    ? Math.max(0, value)
    : 0;
}

function readDevice(id: string, data: DocumentData): AssistDevice | null {
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
    receptionPaused: data.receptionPaused === true,
  };
}

function profileDevice(device: AssistDevice, now: number): DeviceProfile {
  const age = device.lastSeenAt > 0 ? Math.max(0, now - device.lastSeenAt) : 60_000;
  const stale = age > 15_000;
  const criticalStale = age > 45_000;
  const highLatency = device.firebaseLatencyMs >= 900;
  const severeLatency = device.firebaseLatencyMs >= 1_500;
  const slowDownload = device.downloadMbps > 0 && device.downloadMbps < 3;
  const verySlowDownload = device.downloadMbps > 0 && device.downloadMbps < 1;
  const pending = device.pendingCount > 0;
  const cameraError = device.cameraState === "error";
  const evidence: string[] = [];
  let score = 0;

  if (criticalStale) {
    score += 60;
    evidence.push(`${device.name}: 最終応答 ${Math.floor(age / 1000)}秒前`);
  } else if (stale) {
    score += 22;
    evidence.push(`${device.name}: 最終応答 ${Math.floor(age / 1000)}秒前`);
  }

  if (cameraError) {
    score += 36;
    evidence.push(`${device.name}: カメラエラー`);
  }

  if (device.pendingCount >= 5) {
    score += 28;
    evidence.push(`${device.name}: 同期待ち ${device.pendingCount}件`);
  } else if (pending) {
    score += Math.min(20, 6 + device.pendingCount * 4);
    evidence.push(`${device.name}: 同期待ち ${device.pendingCount}件`);
  }

  if (severeLatency) {
    score += 28;
    evidence.push(`${device.name}: Firebase ${device.firebaseLatencyMs}ms`);
  } else if (highLatency) {
    score += 18;
    evidence.push(`${device.name}: Firebase ${device.firebaseLatencyMs}ms`);
  }

  if (verySlowDownload) {
    score += 20;
    evidence.push(`${device.name}: 下り ${device.downloadMbps.toFixed(1)}Mbps`);
  } else if (slowDownload) {
    score += 9;
    evidence.push(`${device.name}: 下り ${device.downloadMbps.toFixed(1)}Mbps`);
  }

  if (device.receptionPaused) {
    evidence.push(`${device.name}: 受付一時停止中`);
  }

  return {
    device,
    age,
    stale,
    criticalStale,
    networkDegraded: highLatency || slowDownload,
    networkSevere: severeLatency || verySlowDownload,
    pending,
    cameraError,
    score: Math.min(100, Math.round(score)),
    evidence,
  };
}

function levelForScore(score: number): AdviceLevel {
  if (score >= 80) return "critical";
  if (score >= 50) return "warning";
  if (score >= 25) return "watch";
  return "normal";
}

function buildLabAdvice(devices: AssistDevice[], now: number): LabAdvice {
  const newestByMode = (["entry", "exit"] as const)
    .map((mode) => devices
      .filter((device) => device.mode === mode)
      .sort((first, second) => second.lastSeenAt - first.lastSeenAt)[0])
    .filter((device): device is AssistDevice => device !== undefined);

  const profiles = newestByMode.map((device) => profileDevice(device, now));
  const entry = profiles.find((profile) => profile.device.mode === "entry") ?? null;
  const exit = profiles.find((profile) => profile.device.mode === "exit") ?? null;

  if (entry !== null && exit !== null && entry.stale && exit.stale) {
    const score = Math.min(
      100,
      78 + (entry.criticalStale ? 8 : 0) + (exit.criticalStale ? 8 : 0)
    );
    return {
      key: `shared-connectivity:${levelForScore(score)}`,
      level: levelForScore(score),
      score,
      title: "入口・出口で同時に通信が遅れています",
      summary: "2台が同じ時間帯に応答を失っているため、端末個別より共通経路を先に疑います。",
      recommendation: "両端末を再起動する前に、共通Wi-FiとFirebaseへの接続を確認してください。",
      evidence: [...entry.evidence, ...exit.evidence].slice(0, 4),
    };
  }

  if (
    entry !== null &&
    exit !== null &&
    entry.networkDegraded &&
    exit.networkDegraded
  ) {
    const bothSevere = entry.networkSevere && exit.networkSevere;
    const score = Math.min(100, 72 + (bothSevere ? 14 : 0));
    return {
      key: `shared-network:${levelForScore(score)}`,
      level: levelForScore(score),
      score,
      title: "入口・出口で共通の通信悪化を検知",
      summary: "両方の受付端末で同時に通信品質が落ちています。",
      recommendation: "端末を個別に触る前に、共通Wi-Fi・学校回線側を確認してください。",
      evidence: [...entry.evidence, ...exit.evidence].slice(0, 4),
    };
  }

  if (
    entry !== null &&
    exit !== null &&
    entry.pending &&
    exit.pending
  ) {
    return {
      key: "shared-sync:warning",
      level: "warning",
      score: 68,
      title: "入口・出口の両方で同期待ちがあります",
      summary: "両端末で未送信データが発生しているため、共通の同期経路を優先して確認します。",
      recommendation: "通信状態を確認したあと、片方ずつ再同期して件数が減るか確認してください。",
      evidence: [...entry.evidence, ...exit.evidence].slice(0, 4),
    };
  }

  const highest = [...profiles].sort((first, second) => second.score - first.score)[0];

  if (highest === undefined || highest.score < 25) {
    return {
      key: "stable",
      level: "normal",
      score: highest?.score ?? 0,
      title: "現在、優先して対応する項目はありません",
      summary: "入口・出口の通信・同期・カメラに強い異常は見つかっていません。",
      recommendation: "通常監視を継続してください。",
      evidence: [],
    };
  }

  const level = levelForScore(highest.score);
  const modeLabel = highest.device.mode === "entry" ? "入口" : "出口";

  if (highest.cameraError) {
    return {
      key: `${highest.device.id}:camera:${level}`,
      level,
      score: Math.max(55, highest.score),
      title: `${modeLabel}端末のカメラ異常を検知`,
      summary: "もう一方に同じ症状がなければ、対象端末固有のカメラ系統を優先して確認します。",
      recommendation: "対象端末のカメラ再起動を試し、改善しなければカメラ権限と端末状態を確認してください。",
      evidence: highest.evidence.slice(0, 4),
    };
  }

  if (highest.pending) {
    return {
      key: `${highest.device.id}:sync:${level}`,
      level,
      score: Math.max(50, highest.score),
      title: `${modeLabel}端末の同期待ちを検知`,
      summary: "未送信データがこの端末側に偏っています。",
      recommendation: "まず対象端末だけ再同期し、同期待ち件数が減るか確認してください。",
      evidence: highest.evidence.slice(0, 4),
    };
  }

  if (highest.networkDegraded) {
    return {
      key: `${highest.device.id}:network:${level}`,
      level,
      score: Math.max(50, highest.score),
      title: `${modeLabel}端末の通信悪化を検知`,
      summary: "もう一方に同じ悪化がなければ、対象端末のWi-Fiや設置位置を優先して疑います。",
      recommendation: "対象端末のWi-Fi状態を確認し、もう一方との差が続くか数分間監視してください。",
      evidence: highest.evidence.slice(0, 4),
    };
  }

  if (highest.stale) {
    return {
      key: `${highest.device.id}:connectivity:${level}`,
      level,
      score: Math.max(50, highest.score),
      title: `${modeLabel}端末の通信途絶傾向を検知`,
      summary: "片側だけ応答が遅れているため、対象端末固有の接続問題を優先して確認します。",
      recommendation: "対象端末の画面とWi-Fiを現地確認してください。",
      evidence: highest.evidence.slice(0, 4),
    };
  }

  return {
    key: `${highest.device.id}:watch:${level}`,
    level,
    score: highest.score,
    title: `${modeLabel}端末に軽い悪化傾向があります`,
    summary: "まだ原因を一つに絞るには材料が不足しています。",
    recommendation: "数分間の推移を重点監視してください。",
    evidence: highest.evidence.slice(0, 4),
  };
}

function levelLabel(level: AdviceLevel) {
  if (level === "critical") return "緊急提案";
  if (level === "warning") return "対応推奨";
  if (level === "watch") return "確認推奨";
  return "正常";
}

function navigateToLab() {
  const direct = document.querySelector<HTMLButtonElement>(
    '.sidebar nav button[data-nav-key="lab"]'
  );
  if (direct !== null) {
    direct.click();
    return;
  }

  const fallback = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".sidebar nav button")
  ).find((button) => (button.textContent ?? "").includes("管制ラボ"));
  fallback?.click();
}

function clearOldAssistStorage() {
  try {
    const targets: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (
        key !== null &&
        (key.startsWith(OLD_PROFILE_PREFIX) || key.startsWith(OLD_ASSIST_PREFIX))
      ) {
        targets.push(key);
      }
    }
    targets.forEach((key) => window.localStorage.removeItem(key));
    window.localStorage.removeItem(OLD_OPERATOR_KEY);
  } catch {
    // Local storage is a convenience only. The new assist works without cleanup.
  }
}

function readAssistEnabled() {
  try {
    return window.localStorage.getItem(ASSIST_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function ControlAssistBridge({ database }: { database: Firestore }) {
  const [enabled, setEnabled] = useState(readAssistEnabled);
  const [eventDataId, setEventDataId] = useState<string | null>(null);
  const [devices, setDevices] = useState<AssistDevice[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [topbarTarget, setTopbarTarget] = useState<Element | null>(null);
  const [notice, setNotice] = useState<LabAdvice | null>(null);
  const lastNoticeRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const previousAdviceRef = useRef<LabAdvice | null>(null);

  useEffect(() => {
    clearOldAssistStorage();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshTarget = () => {
      const next = document.querySelector(".topbar-meta");
      setTopbarTarget((current) => current === next ? current : next);
    };

    const first = window.setTimeout(refreshTarget, 0);
    const observer = new MutationObserver(refreshTarget);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(first);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let unsubscribeEvent: (() => void) | null = null;

    const unsubscribeCurrent = onSnapshot(
      doc(database, "system", "current-event"),
      (snapshot) => {
        const eventId = snapshot.exists() && typeof snapshot.data().eventId === "string"
          ? snapshot.data().eventId as string
          : "";

        unsubscribeEvent?.();
        unsubscribeEvent = null;
        setEventDataId(null);
        setDevices([]);
        setNotice(null);
        previousAdviceRef.current = null;
        lastNoticeRef.current = { key: "", at: 0 };

        if (eventId === "") return;

        unsubscribeEvent = onSnapshot(
          doc(database, "events", eventId),
          (eventSnapshot) => {
            if (!eventSnapshot.exists()) return;
            const data = eventSnapshot.data();
            const name = typeof data.name === "string" ? data.name.trim() : "event-not-set";
            const nextDataId = typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
              ? data.dataDocumentId
              : encodeURIComponent(name || "event-not-set");
            setEventDataId(nextDataId);
          }
        );
      }
    );

    return () => {
      unsubscribeCurrent();
      unsubscribeEvent?.();
    };
  }, [database]);

  useEffect(() => {
    if (eventDataId === null) return undefined;

    return onSnapshot(
      collection(database, "event-data", eventDataId, "reception-devices"),
      (snapshot) => {
        setDevices(
          snapshot.docs
            .map((item) => readDevice(item.id, item.data()))
            .filter((item): item is AssistDevice => item !== null)
        );
      }
    );
  }, [database, eventDataId]);

  const advice = useMemo(
    () => buildLabAdvice(devices, now),
    [devices, now]
  );

  useEffect(() => {
    const previous = previousAdviceRef.current;
    previousAdviceRef.current = advice;

    if (!enabled || advice.level === "normal") return;

    const severityChanged = previous !== null && previous.level !== advice.level;
    const adviceChanged = previous === null || previous.key !== advice.key;
    const stamp = Date.now();
    const cooldownElapsed =
      lastNoticeRef.current.key !== advice.key ||
      stamp - lastNoticeRef.current.at >= SAME_NOTICE_COOLDOWN_MS;

    if (!adviceChanged && !severityChanged && !cooldownElapsed) return;

    lastNoticeRef.current = { key: advice.key, at: stamp };
    setNotice(advice);
  }, [advice, enabled]);

  useEffect(() => {
    if (notice === null) return undefined;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_LIFETIME_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleAssist = () => {
    setEnabled((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(ASSIST_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Keep the current session setting even if storage is unavailable.
      }
      if (!next) setNotice(null);
      return next;
    });
  };

  return (
    <>
      {topbarTarget !== null && createPortal(
        <button
          type="button"
          className={`control-assist-toggle${enabled ? " enabled" : ""}`}
          aria-pressed={enabled}
          title={enabled
            ? "管制ラボの判断から対応提案を通知します"
            : "ONにすると管制ラボから対応提案を通知します"}
          onClick={toggleAssist}
        >
          <span className="control-assist-toggle-indicator" aria-hidden="true" />
          <span className="control-assist-toggle-copy">
            <small>管制アシスト</small>
            <strong>{enabled ? "ON" : "OFF"}</strong>
          </span>
        </button>,
        topbarTarget
      )}

      {enabled && notice !== null && createPortal(
        <aside
          className={`control-assist-notice ${notice.level}`}
          aria-live="assertive"
        >
          <div className="control-assist-notice-head">
            <div>
              <small>CONTROL LAB ASSIST</small>
              <span>{levelLabel(notice.level)} · 指標 {notice.score}/100</span>
            </div>
            <button
              type="button"
              className="control-assist-notice-close"
              aria-label="通知を閉じる"
              onClick={() => setNotice(null)}
            >
              ×
            </button>
          </div>

          <h3>{notice.title}</h3>
          <p className="control-assist-notice-summary">{notice.summary}</p>

          <div className="control-assist-recommendation">
            <small>管制ラボの提案</small>
            <strong>{notice.recommendation}</strong>
          </div>

          {notice.evidence.length > 0 && (
            <ul>
              {notice.evidence.slice(0, 3).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}

          <div className="control-assist-notice-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                navigateToLab();
                setNotice(null);
              }}
            >
              管制ラボで確認
            </button>
            <button type="button" onClick={() => setNotice(null)}>
              閉じる
            </button>
          </div>

          <span className="control-assist-notice-timer" aria-hidden="true" />
        </aside>,
        document.body
      )}
    </>
  );
}
