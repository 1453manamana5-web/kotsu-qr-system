import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import type { CameraState, ReceptionDevice, ReceptionMode } from "./types";

type DeviceSample = {
  recordedAt: number;
  lastSeenAt: number;
  pendingCount: number;
  firebaseLatencyMs: number;
  downloadMbps: number;
  cameraState: CameraState;
};

type RiskLevel = "normal" | "watch" | "warning" | "critical";

type DeviceRisk = {
  device: ReceptionDevice;
  score: number;
  level: RiskLevel;
  label: string;
  headline: string;
  evidence: string[];
  recommendation: string;
};

const HISTORY_WINDOW_MS = 5 * 60 * 1000;
const MAX_HISTORY_SAMPLES = 72;

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

function readDevice(id: string, data: DocumentData): ReceptionDevice | null {
  if (data.mode !== "entry" && data.mode !== "exit") return null;

  const mode: ReceptionMode = data.mode;
  const cameraState: CameraState = data.cameraState === "ready" || data.cameraState === "error"
    ? data.cameraState
    : "starting";
  const serverSeenAt = timestampToMilliseconds(data.updatedAt);

  return {
    id,
    registeredDeviceId: typeof data.registeredDeviceId === "string" ? data.registeredDeviceId : "",
    deviceName: typeof data.deviceName === "string" ? data.deviceName : `${mode === "entry" ? "入口" : "出口"}受付端末`,
    deviceType: typeof data.deviceType === "string" ? data.deviceType : "unknown",
    role: typeof data.role === "string" ? data.role : "reception",
    mode,
    appVersion: typeof data.appVersion === "string" ? data.appVersion : "不明",
    lastSeenAt: serverSeenAt || readNumber(data.lastSeenAt),
    lastSuccessfulSyncAt: timestampToMilliseconds(data.lastSuccessfulSyncAt),
    pendingCount: Math.floor(readNumber(data.pendingCount)),
    cameraState,
    receptionPaused: data.receptionPaused === true,
    firebaseLatencyMs: Math.round(readNumber(data.firebaseLatencyMs)),
    downloadMbps: Math.round(readNumber(data.downloadMbps) * 10) / 10,
    networkMeasuredAt: typeof data.networkMeasuredAt === "string" ? data.networkMeasuredAt : "",
    screen: typeof data.screen === "string" ? data.screen : "",
    sessionStartedAt: typeof data.sessionStartedAt === "string" ? data.sessionStartedAt : "",
    lastScanAt: typeof data.lastScanAt === "string" ? data.lastScanAt : "",
  };
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function riskLevel(score: number): Pick<DeviceRisk, "level" | "label"> {
  if (score >= 75) return { level: "critical", label: "危険" };
  if (score >= 50) return { level: "warning", label: "注意" };
  if (score >= 25) return { level: "watch", label: "要観察" };
  return { level: "normal", label: "正常" };
}

function calculateRisk(device: ReceptionDevice, history: DeviceSample[], now: number): DeviceRisk {
  let score = 0;
  const evidence: string[] = [];
  const samples = history.slice(-12);
  const recentLatencies = samples.map((sample) => sample.firebaseLatencyMs).filter((value) => value > 0);
  const recentDownloads = samples.map((sample) => sample.downloadMbps).filter((value) => value > 0);
  const age = Math.max(0, now - device.lastSeenAt);

  if (device.lastSeenAt <= 0 || age > 45_000) {
    score += 75;
    evidence.push("端末のハートビートが45秒以上途絶えています");
  } else if (age > 15_000) {
    score += 25;
    evidence.push(`最終応答が${Math.floor(age / 1000)}秒前まで遅れています`);
  }

  if (device.cameraState === "error") {
    score += 35;
    evidence.push("カメラがエラー状態です");
  } else if (device.cameraState === "starting" && age > 10_000) {
    score += 8;
    evidence.push("カメラ準備状態が長く続いています");
  }

  if (device.pendingCount >= 5) {
    score += 28;
    evidence.push(`同期待ちが${device.pendingCount}件まで増えています`);
  } else if (device.pendingCount > 0) {
    score += Math.min(20, 5 + device.pendingCount * 4);
    evidence.push(`同期待ちが${device.pendingCount}件あります`);
  }

  if (device.firebaseLatencyMs >= 1_500) {
    score += 28;
    evidence.push(`Firebase応答が${device.firebaseLatencyMs}msまで悪化しています`);
  } else if (device.firebaseLatencyMs >= 900) {
    score += 18;
    evidence.push(`Firebase応答が${device.firebaseLatencyMs}msと高めです`);
  } else if (device.firebaseLatencyMs >= 500) {
    score += 8;
    evidence.push(`Firebase応答が${device.firebaseLatencyMs}msです`);
  }

  if (recentLatencies.length >= 4) {
    const split = Math.max(2, Math.floor(recentLatencies.length / 2));
    const before = average(recentLatencies.slice(0, split));
    const after = average(recentLatencies.slice(split));
    const rise = after - before;
    if (rise >= 500) {
      score += 20;
      evidence.push(`通信遅延が短時間で約${Math.round(rise)}ms上昇しています`);
    } else if (rise >= 250) {
      score += 12;
      evidence.push(`通信遅延が上昇傾向です（+約${Math.round(rise)}ms）`);
    } else if (rise >= 100) {
      score += 5;
      evidence.push("通信遅延に弱い上昇傾向があります");
    }
  }

  if (device.downloadMbps > 0 && device.downloadMbps < 1) {
    score += 20;
    evidence.push(`下り速度が${device.downloadMbps.toFixed(1)}Mbpsまで低下しています`);
  } else if (device.downloadMbps > 0 && device.downloadMbps < 3) {
    score += 9;
    evidence.push(`下り速度が${device.downloadMbps.toFixed(1)}Mbpsと低めです`);
  }

  if (recentDownloads.length >= 4) {
    const split = Math.max(2, Math.floor(recentDownloads.length / 2));
    const before = average(recentDownloads.slice(0, split));
    const after = average(recentDownloads.slice(split));
    const dropRatio = before > 0 ? (before - after) / before : 0;
    if (dropRatio >= 0.6) {
      score += 16;
      evidence.push("通信速度が直近で60%以上低下しています");
    } else if (dropRatio >= 0.35) {
      score += 8;
      evidence.push("通信速度が継続的に低下しています");
    }
  }

  if (samples.length >= 5) {
    const heartbeatIntervals = samples
      .slice(1)
      .map((sample, index) => sample.lastSeenAt - samples[index].lastSeenAt)
      .filter((interval) => interval > 0 && interval < 60_000);
    const jitter = standardDeviation(heartbeatIntervals);
    const maxGap = heartbeatIntervals.length > 0 ? Math.max(...heartbeatIntervals) : 0;
    if (maxGap > 18_000) {
      score += 12;
      evidence.push("端末の応答間隔に大きな空白が発生しています");
    } else if (jitter > 4_000) {
      score += 7;
      evidence.push("端末のハートビート間隔が不安定です");
    }
  }

  const pendingHistory = samples.map((sample) => sample.pendingCount);
  if (pendingHistory.length >= 4) {
    const first = pendingHistory[0] ?? 0;
    const last = pendingHistory[pendingHistory.length - 1] ?? 0;
    if (last >= first + 3) {
      score += 12;
      evidence.push(`同期待ちが観測中に${last - first}件増加しています`);
    }
  }

  if (device.receptionPaused) {
    evidence.push("受付は現在一時停止中です（意図した操作なら異常ではありません）");
  }

  score = Math.min(100, Math.round(score));
  const state = riskLevel(score);
  const modeLabel = device.mode === "entry" ? "入口" : "出口";

  let recommendation = "監視を継続してください。現時点で予兆は小さい状態です。";
  if (score >= 75) {
    recommendation = device.pendingCount > 0
      ? "通信と端末状態を確認し、まず再同期を検討してください。"
      : "端末状態をすぐ確認し、必要ならカメラ再起動または受付切替を検討してください。";
  } else if (score >= 50) {
    recommendation = "通信品質と同期待ちの変化を確認し、悪化が続く場合は早めに端末確認を推奨します。";
  } else if (score >= 25) {
    recommendation = "軽い悪化傾向があります。数分間の推移を重点監視してください。";
  }

  return {
    device,
    score,
    level: state.level,
    label: state.label,
    headline: `${modeLabel}端末 ${state.label}・リスク ${score}`,
    evidence: evidence.length > 0 ? evidence.slice(0, 5) : ["通信・同期・カメラに目立った悪化傾向はありません"],
    recommendation,
  };
}

function RiskGauge({ risk }: { risk: DeviceRisk }) {
  return (
    <article className={`predictive-risk-card ${risk.level}`}>
      <div className="predictive-risk-head">
        <div>
          <small>{risk.device.mode === "entry" ? "ENTRY TERMINAL" : "EXIT TERMINAL"}</small>
          <h3>{risk.device.deviceName}</h3>
        </div>
        <span className={`predictive-risk-state ${risk.level}`}>{risk.label}</span>
      </div>
      <div className="predictive-score-row">
        <div className="predictive-score-ring" style={{ "--risk": `${risk.score * 3.6}deg` } as React.CSSProperties}>
          <strong>{risk.score}</strong><small>/100</small>
        </div>
        <div className="predictive-score-copy">
          <b>{risk.score < 25 ? "安定" : risk.score < 50 ? "兆候を検出" : risk.score < 75 ? "悪化傾向" : "高リスク"}</b>
          <p>{risk.recommendation}</p>
        </div>
      </div>
      <ul className="predictive-evidence-list">
        {risk.evidence.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </article>
  );
}

function RadarPanel({ risks, collecting }: { risks: DeviceRisk[]; collecting: boolean }) {
  const highest = risks[0];
  const averageRisk = risks.length === 0
    ? 0
    : Math.round(risks.reduce((total, risk) => total + risk.score, 0) / risks.length);

  return (
    <section className="predictive-radar-panel">
      <div className="predictive-panel-heading">
        <div><small>PREDICTIVE ANOMALY RADAR</small><h2>異常予兆レーダー</h2></div>
        <span className={highest?.level ?? "normal"}>{collecting ? "トレンド学習中" : highest === undefined ? "待機中" : `最大リスク ${highest.score}`}</span>
      </div>
      <div className="predictive-radar-hero">
        <div className="predictive-radar-visual" aria-hidden="true">
          <i /><i /><i /><span>{averageRisk}</span>
        </div>
        <div>
          <small>EARLY WARNING ENGINE</small>
          <strong>{highest === undefined ? "受付端末の信号を待っています" : highest.score < 25 ? "現在、強い異常予兆はありません" : `${highest.device.deviceName}で兆候を検出`}</strong>
          <p>現在値だけでなく、直近約5分の通信遅延・速度・同期待ち・応答間隔の変化を組み合わせて判定します。</p>
        </div>
      </div>
      {risks.length === 0 ? (
        <p className="predictive-empty">現在イベントの受付端末データを受信すると分析を開始します。</p>
      ) : (
        <div className="predictive-risk-grid">
          {risks.map((risk) => <RiskGauge key={risk.device.id} risk={risk} />)}
        </div>
      )}
      <p className="predictive-disclaimer">このスコアは故障確率ではなく、観測値の悪化傾向をまとめた運用上の注意指標です。</p>
    </section>
  );
}

function CommandCenterPanel({ risks }: { risks: DeviceRisk[] }) {
  const highest = risks[0];
  const criticalCount = risks.filter((risk) => risk.score >= 75).length;
  const watchCount = risks.filter((risk) => risk.score >= 25).length;

  return (
    <section className="predictive-command-center">
      <div className="predictive-panel-heading">
        <div><small>AI OPERATIONS COMMAND</small><h2>AI作戦司令室</h2></div>
        <span className={highest?.level ?? "normal"}>予兆インテリジェンス接続</span>
      </div>
      <div className="predictive-command-grid">
        <article className="predictive-command-brief">
          <small>LIVE BRIEFING</small>
          <strong>{highest === undefined
            ? "端末データを待機しています"
            : highest.score < 25
              ? "全受付端末は安定しています"
              : `${highest.device.deviceName}を優先監視してください`}</strong>
          <p>{highest?.recommendation ?? "現在イベントが始まると予兆分析を開始します。"}</p>
          {highest !== undefined && (
            <ul>{highest.evidence.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul>
          )}
        </article>
        <article className="predictive-command-status">
          <div><span>最高リスク</span><strong>{highest?.score ?? 0}</strong></div>
          <div><span>要観察以上</span><strong>{watchCount}</strong></div>
          <div><span>危険判定</span><strong>{criticalCount}</strong></div>
        </article>
      </div>
      <div className="predictive-command-prompts" aria-label="AI管制で使える質問例">
        <span>AI管制への質問例</span>
        <b>「今一番危ない端末は？」</b>
        <b>「異常の前兆はある？」</b>
        <b>「今やるべき操作は？」</b>
      </div>
    </section>
  );
}

export default function PredictiveOpsOverlay({ database }: { database: Firestore }) {
  const [eventDataId, setEventDataId] = useState<string | null>(null);
  const [devices, setDevices] = useState<ReceptionDevice[]>([]);
  const [history, setHistory] = useState<Record<string, DeviceSample[]>>({});
  const [now, setNow] = useState(Date.now());
  const [labTarget, setLabTarget] = useState<Element | null>(null);
  const [copilotTarget, setCopilotTarget] = useState<Element | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let unsubscribeEvent: (() => void) | null = null;
    const unsubscribeCurrent = onSnapshot(doc(database, "system", "current-event"), (snapshot) => {
      const eventId = snapshot.exists() && typeof snapshot.data().eventId === "string"
        ? snapshot.data().eventId as string
        : null;

      unsubscribeEvent?.();
      unsubscribeEvent = null;
      setEventDataId(null);
      setDevices([]);
      setHistory({});

      if (eventId === null || eventId === "") return;
      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        if (!eventSnapshot.exists()) {
          setEventDataId(null);
          return;
        }
        const data = eventSnapshot.data();
        const fallbackName = typeof data.name === "string" ? data.name.trim() : "event-not-set";
        setEventDataId(
          typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
            ? data.dataDocumentId
            : encodeURIComponent(fallbackName || "event-not-set")
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
      const nextDevices = snapshot.docs
        .map((item) => readDevice(item.id, item.data()))
        .filter((device): device is ReceptionDevice => device !== null);
      setDevices(nextDevices);
      setHistory((current) => {
        const next: Record<string, DeviceSample[]> = { ...current };
        const observedAt = Date.now();

        for (const device of nextDevices) {
          const existing = next[device.id] ?? [];
          const last = existing[existing.length - 1];
          if (last?.lastSeenAt === device.lastSeenAt && last.pendingCount === device.pendingCount && last.cameraState === device.cameraState) continue;

          const sample: DeviceSample = {
            recordedAt: observedAt,
            lastSeenAt: device.lastSeenAt,
            pendingCount: device.pendingCount,
            firebaseLatencyMs: device.firebaseLatencyMs,
            downloadMbps: device.downloadMbps,
            cameraState: device.cameraState,
          };
          next[device.id] = [...existing, sample]
            .filter((item) => observedAt - item.recordedAt <= HISTORY_WINDOW_MS)
            .slice(-MAX_HISTORY_SAMPLES);
        }
        return next;
      });
    });
  }, [database, eventDataId]);

  useEffect(() => {
    const updateTargets = () => {
      setLabTarget((current) => {
        const next = document.querySelector(".lab-page");
        return current === next ? current : next;
      });
      setCopilotTarget((current) => {
        const next = document.querySelector(".copilot-page");
        return current === next ? current : next;
      });
    };

    updateTargets();
    const observer = new MutationObserver(updateTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const risks = useMemo(
    () => devices
      .map((device) => calculateRisk(device, history[device.id] ?? [], now))
      .sort((a, b) => b.score - a.score),
    [devices, history, now]
  );

  const collecting = risks.length > 0 && risks.some((risk) => (history[risk.device.id]?.length ?? 0) < 4);

  return (
    <>
      {labTarget !== null && createPortal(<RadarPanel risks={risks} collecting={collecting} />, labTarget)}
      {copilotTarget !== null && createPortal(<CommandCenterPanel risks={risks} />, copilotTarget)}
    </>
  );
}
