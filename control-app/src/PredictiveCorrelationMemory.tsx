import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import type { CameraState, ReceptionDevice, ReceptionMode } from "./types";

type CorrelationScope = "shared" | "entry" | "exit" | "system";
type CorrelationSeverity = "normal" | "watch" | "warning" | "critical";
type CauseKey =
  | "normal"
  | "shared-network"
  | "shared-connectivity"
  | "shared-sync"
  | "terminal-network"
  | "terminal-camera"
  | "terminal-sync"
  | "terminal-connectivity";

type EventIdentity = {
  id: string;
  name: string;
  dataDocumentId: string;
};

type DeviceProfile = {
  device: ReceptionDevice;
  score: number;
  age: number;
  networkDegraded: boolean;
  networkSevere: boolean;
  stale: boolean;
  criticalStale: boolean;
  pending: boolean;
  cameraError: boolean;
  signature: string[];
  evidence: string[];
};

type CorrelationDiagnosis = {
  causeKey: CauseKey;
  scope: CorrelationScope;
  severity: CorrelationSeverity;
  score: number;
  title: string;
  summary: string;
  evidence: string[];
  signature: string[];
  recommendation: string;
};

type StoredIncident = {
  id: string;
  eventId: string;
  eventName: string;
  recordedAt: number;
  causeKey: CauseKey;
  scope: CorrelationScope;
  severity: "warning" | "critical";
  score: number;
  signature: string[];
  summary: string;
  evidence: string[];
  recommendation: string;
};

type HistoricalMatch = {
  incident: StoredIncident;
  similarity: number;
};

type MemoryMessage = {
  id: string;
  role: "operator" | "copilot";
  text: string;
  evidence: string[];
};

const MEMORY_DOCUMENT = "predictive-incident-memory";
const MAX_MEMORY_RECORDS = 60;
const STABLE_BEFORE_STORE_MS = 20_000;
const SAME_PATTERN_COOLDOWN_MS = 10 * 60 * 1000;

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

function profileDevice(device: ReceptionDevice, now: number): DeviceProfile {
  const age = device.lastSeenAt > 0 ? Math.max(0, now - device.lastSeenAt) : 60_000;
  const highLatency = device.firebaseLatencyMs >= 900;
  const severeLatency = device.firebaseLatencyMs >= 1_500;
  const slowDownload = device.downloadMbps > 0 && device.downloadMbps < 3;
  const verySlowDownload = device.downloadMbps > 0 && device.downloadMbps < 1;
  const networkDegraded = highLatency || slowDownload;
  const networkSevere = severeLatency || verySlowDownload;
  const stale = age > 15_000;
  const criticalStale = age > 45_000;
  const pending = device.pendingCount > 0;
  const cameraError = device.cameraState === "error";
  const signature: string[] = [];
  const evidence: string[] = [];
  let score = 0;

  if (highLatency) {
    signature.push(severeLatency ? "latency-severe" : "latency-high");
    evidence.push(`${device.deviceName}: Firebase ${device.firebaseLatencyMs}ms`);
    score += severeLatency ? 32 : 18;
  }
  if (slowDownload) {
    signature.push(verySlowDownload ? "download-severe" : "download-low");
    evidence.push(`${device.deviceName}: 下り ${device.downloadMbps.toFixed(1)}Mbps`);
    score += verySlowDownload ? 24 : 12;
  }
  if (pending) {
    signature.push(device.pendingCount >= 5 ? "pending-many" : "pending");
    evidence.push(`${device.deviceName}: 同期待ち ${device.pendingCount}件`);
    score += Math.min(28, 8 + device.pendingCount * 4);
  }
  if (cameraError) {
    signature.push("camera-error");
    evidence.push(`${device.deviceName}: カメラエラー`);
    score += 36;
  }
  if (stale) {
    signature.push(criticalStale ? "heartbeat-lost" : "heartbeat-late");
    evidence.push(`${device.deviceName}: 最終応答 ${Math.floor(age / 1000)}秒前`);
    score += criticalStale ? 60 : 22;
  }

  return {
    device,
    score: Math.min(100, score),
    age,
    networkDegraded,
    networkSevere,
    stale,
    criticalStale,
    pending,
    cameraError,
    signature,
    evidence,
  };
}

function severityFor(score: number): CorrelationSeverity {
  if (score >= 80) return "critical";
  if (score >= 50) return "warning";
  if (score >= 25) return "watch";
  return "normal";
}

function scopeForMode(mode: ReceptionMode): CorrelationScope {
  return mode === "entry" ? "entry" : "exit";
}

function diagnose(devices: ReceptionDevice[], now: number): CorrelationDiagnosis {
  const newestByMode = (["entry", "exit"] as const)
    .map((mode) => devices
      .filter((device) => device.mode === mode)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0])
    .filter((device): device is ReceptionDevice => device !== undefined);
  const profiles = newestByMode.map((device) => profileDevice(device, now));
  const entry = profiles.find((profile) => profile.device.mode === "entry") ?? null;
  const exit = profiles.find((profile) => profile.device.mode === "exit") ?? null;

  if (entry !== null && exit !== null) {
    if (entry.stale && exit.stale) {
      const score = Math.min(100, 78 + (entry.criticalStale ? 8 : 0) + (exit.criticalStale ? 8 : 0));
      return {
        causeKey: "shared-connectivity",
        scope: "shared",
        severity: severityFor(score),
        score,
        title: "入口・出口で同時に通信途絶傾向",
        summary: "2台が同じ時間帯に応答を失っているため、端末2台の個別故障より共通ネットワークや接続経路を優先して疑います。",
        evidence: [...entry.evidence, ...exit.evidence].slice(0, 5),
        signature: ["shared", "connectivity", ...entry.signature, ...exit.signature],
        recommendation: "まず共通Wi-FiとFirebase到達性を確認し、両端末を個別再起動する前に共通障害か切り分けてください。",
      };
    }

    if (entry.networkDegraded && exit.networkDegraded) {
      const bothSevere = entry.networkSevere && exit.networkSevere;
      const bothPending = entry.pending && exit.pending;
      const score = Math.min(100, 72 + (bothSevere ? 14 : 0) + (bothPending ? 8 : 0));
      return {
        causeKey: "shared-network",
        scope: "shared",
        severity: severityFor(score),
        score,
        title: "共通通信経路の悪化を推定",
        summary: "入口と出口で同時に通信品質が低下しています。個別端末より、Wi-Fi・学校回線・Firebase側など共通部分の影響と整合します。",
        evidence: [...entry.evidence, ...exit.evidence].slice(0, 6),
        signature: ["shared", "network", ...entry.signature, ...exit.signature],
        recommendation: "両端末を触る前に共通回線を確認してください。片方だけ回復する場合は端末固有へ切り替えて診断します。",
      };
    }

    if (entry.pending && exit.pending && (entry.networkDegraded || exit.networkDegraded)) {
      const score = 68;
      return {
        causeKey: "shared-sync",
        scope: "shared",
        severity: "warning",
        score,
        title: "同期経路の共通詰まりを推定",
        summary: "入口・出口の両方で同期待ちが発生し、通信低下も重なっています。端末個別より同期先または共通通信経路を疑う状態です。",
        evidence: [...entry.evidence, ...exit.evidence].slice(0, 6),
        signature: ["shared", "sync", ...entry.signature, ...exit.signature],
        recommendation: "共通通信を確認したうえで再同期してください。両端末を同時に連打せず、片方ずつ結果を確認すると切り分けしやすくなります。",
      };
    }
  }

  const highest = [...profiles].sort((a, b) => b.score - a.score)[0];
  if (highest === undefined || highest.score < 25) {
    return {
      causeKey: "normal",
      scope: "system",
      severity: "normal",
      score: highest?.score ?? 0,
      title: "共通異常は見つかっていません",
      summary: "現在の入口・出口データに、原因を共通化できる強い兆候はありません。",
      evidence: highest?.evidence.length ? highest.evidence.slice(0, 4) : ["通信・同期・カメラに目立った異常なし"],
      signature: ["normal"],
      recommendation: "通常監視を継続してください。",
    };
  }

  const scope = scopeForMode(highest.device.mode);
  if (highest.cameraError) {
    const score = Math.max(55, highest.score);
    return {
      causeKey: "terminal-camera",
      scope,
      severity: severityFor(score),
      score,
      title: `${highest.device.deviceName}固有のカメラ異常を推定`,
      summary: "もう一方の端末に同じ症状がないため、共通回線より対象端末のカメラ系統を優先して疑います。",
      evidence: highest.evidence.slice(0, 5),
      signature: [scope, "camera", ...highest.signature],
      recommendation: "対象端末のカメラ再起動を試し、改善しなければ端末側の権限・カメラ状態を確認してください。",
    };
  }
  if (highest.networkDegraded) {
    const score = Math.max(50, highest.score);
    return {
      causeKey: "terminal-network",
      scope,
      severity: severityFor(score),
      score,
      title: `${highest.device.deviceName}固有の通信悪化を推定`,
      summary: "同時刻にもう一方の受付で同じ悪化が確認できないため、端末位置・Wi-Fi接続・端末固有の通信を優先して疑います。",
      evidence: highest.evidence.slice(0, 5),
      signature: [scope, "network", ...highest.signature],
      recommendation: "対象端末のWi-Fi状態と設置位置を確認し、もう一方との差が続くか監視してください。",
    };
  }
  if (highest.pending) {
    const score = Math.max(50, highest.score);
    return {
      causeKey: "terminal-sync",
      scope,
      severity: severityFor(score),
      score,
      title: `${highest.device.deviceName}の同期詰まりを推定`,
      summary: "同期待ちが対象端末側に偏っているため、現時点では端末固有の同期失敗として扱います。",
      evidence: highest.evidence.slice(0, 5),
      signature: [scope, "sync", ...highest.signature],
      recommendation: "対象端末だけ再同期し、同期待ちが減るか確認してください。",
    };
  }
  if (highest.stale) {
    const score = Math.max(50, highest.score);
    return {
      causeKey: "terminal-connectivity",
      scope,
      severity: severityFor(score),
      score,
      title: `${highest.device.deviceName}の通信途絶を推定`,
      summary: "片側だけ応答が遅れているため、現時点では共通障害より対象端末固有の接続問題と判断します。",
      evidence: highest.evidence.slice(0, 5),
      signature: [scope, "connectivity", ...highest.signature],
      recommendation: "対象端末の画面・Wi-Fiを現地確認してください。意図的に受付を終了した端末は分析対象に含めません。",
    };
  }

  return {
    causeKey: "normal",
    scope: "system",
    severity: "watch",
    score: highest.score,
    title: "軽い兆候を観測中",
    summary: "原因を一つに絞るにはまだ材料が不足しています。",
    evidence: highest.evidence.slice(0, 5),
    signature: [scope, ...highest.signature],
    recommendation: "数分間の推移を監視してください。",
  };
}

function readStoredIncidents(data: DocumentData | undefined): StoredIncident[] {
  if (data === undefined || !Array.isArray(data.records)) return [];
  return data.records.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const value = item as Record<string, unknown>;
    const causeKey = typeof value.causeKey === "string" ? value.causeKey as CauseKey : "normal";
    const scope = value.scope === "shared" || value.scope === "entry" || value.scope === "exit" || value.scope === "system"
      ? value.scope
      : "system";
    const severity = value.severity === "critical" ? "critical" : "warning";
    if (typeof value.id !== "string" || typeof value.eventId !== "string" || causeKey === "normal") return [];
    return [{
      id: value.id,
      eventId: value.eventId,
      eventName: typeof value.eventName === "string" ? value.eventName : "過去イベント",
      recordedAt: readNumber(value.recordedAt),
      causeKey,
      scope,
      severity,
      score: Math.min(100, Math.round(readNumber(value.score))),
      signature: Array.isArray(value.signature) ? value.signature.filter((tag): tag is string => typeof tag === "string").slice(0, 20) : [],
      summary: typeof value.summary === "string" ? value.summary : "障害パターンを記録",
      evidence: Array.isArray(value.evidence) ? value.evidence.filter((item): item is string => typeof item === "string").slice(0, 6) : [],
      recommendation: typeof value.recommendation === "string" ? value.recommendation : "記録を確認してください。",
    }];
  });
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function findHistoricalMatch(
  diagnosis: CorrelationDiagnosis,
  records: StoredIncident[],
  currentEventId: string | null
): HistoricalMatch | null {
  if (diagnosis.causeKey === "normal") return null;
  const currentTags = unique(diagnosis.signature);
  const candidates = records
    .filter((record) => record.eventId !== currentEventId)
    .map((incident) => {
      const tags = unique(incident.signature);
      const union = unique([...currentTags, ...tags]);
      const intersection = currentTags.filter((tag) => tags.includes(tag));
      let similarity = union.length === 0 ? 0 : intersection.length / union.length;
      if (incident.causeKey === diagnosis.causeKey) similarity += 0.2;
      if (incident.scope === diagnosis.scope) similarity += 0.1;
      return { incident, similarity: Math.min(1, similarity) };
    })
    .sort((a, b) => b.similarity - a.similarity);
  return candidates[0] !== undefined && candidates[0].similarity >= 0.45
    ? candidates[0]
    : null;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\u3000。、！？!?「」『』（）()]/g, "");
}

function shouldHandleQuestion(question: string) {
  const value = normalize(question);
  return [
    "共通", "両方", "同時", "相関", "原因", "全体", "回線", "wifi", "firebase側",
    "過去", "前回", "以前", "似て", "似た", "再発", "覚え", "記憶", "履歴", "障害メモリ",
  ].some((word) => value.includes(word));
}

function buildMemoryReply(
  question: string,
  diagnosis: CorrelationDiagnosis,
  match: HistoricalMatch | null,
  records: StoredIncident[]
) {
  const value = normalize(question);
  const asksHistory = ["過去", "前回", "以前", "似て", "似た", "再発", "覚え", "記憶", "履歴", "障害メモリ"]
    .some((word) => value.includes(word));

  if (asksHistory) {
    if (records.length === 0) {
      return {
        text: "まだ保存済みの障害パターンはありません。注意以上の状態が約20秒続くと、症状の組み合わせを障害メモリへ記録します。",
        evidence: ["障害メモリ: 0件", "一瞬の通信揺れは記憶しません"],
      };
    }
    if (match === null) {
      return {
        text: `過去障害を${records.length}件記憶していますが、現在の状態と十分に似たパターンは見つかりません。今回は別原因の可能性があります。`,
        evidence: [diagnosis.title, ...diagnosis.evidence.slice(0, 3)],
      };
    }
    const similarity = Math.round(match.similarity * 100);
    return {
      text: `あります。現在の状態は「${match.incident.eventName}」で記録した障害パターンと類似度${similarity}/100です。前回は「${match.incident.summary}」として記録しています。`,
      evidence: [
        `現在の推定: ${diagnosis.title}`,
        `過去の推定: ${match.incident.summary}`,
        ...match.incident.evidence.slice(0, 3),
      ],
    };
  }

  const historicalText = match === null
    ? "過去メモリには十分近い事例がありません。"
    : `過去の「${match.incident.eventName}」の記録と類似度${Math.round(match.similarity * 100)}/100です。`;
  return {
    text: `${diagnosis.title}。${diagnosis.summary} 原因推定の一致度は${diagnosis.score}/100です。${historicalText}`,
    evidence: [...diagnosis.evidence.slice(0, 4), `推奨: ${diagnosis.recommendation}`],
  };
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function CorrelationPanel({ diagnosis, match, memoryCount }: {
  diagnosis: CorrelationDiagnosis;
  match: HistoricalMatch | null;
  memoryCount: number;
}) {
  const similarity = match === null ? 0 : Math.round(match.similarity * 100);
  return (
    <section className={`correlation-panel ${diagnosis.severity}`}>
      <div className="correlation-heading">
        <div><small>CROSS-TERMINAL CORRELATION</small><h2>異常相関分析</h2></div>
        <span>{diagnosis.causeKey === "normal" ? "共通原因なし" : `一致度 ${diagnosis.score}/100`}</span>
      </div>
      <div className="correlation-main">
        <div className="correlation-topology" aria-hidden="true">
          <i className="entry-node">入</i><b /><i className="core-node">推</i><b /><i className="exit-node">出</i>
        </div>
        <div className="correlation-copy">
          <strong>{diagnosis.title}</strong>
          <p>{diagnosis.summary}</p>
          <ul>{diagnosis.evidence.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      </div>
      <div className="correlation-memory-row">
        <div><small>INCIDENT MEMORY</small><strong>{memoryCount}件を記憶</strong><p>注意以上が20秒続いたパターンだけ保存</p></div>
        <div className={match === null ? "no-match" : "matched"}>
          <small>HISTORICAL MATCH</small>
          <strong>{match === null ? "類似事例なし" : `${match.incident.eventName} · ${similarity}/100`}</strong>
          <p>{match === null ? "新しい症状として監視します" : match.incident.summary}</p>
        </div>
      </div>
      <p className="correlation-note">意図的にホームへ戻って終了した受付端末は、端末消失だけを理由に異常原因へ含めません。</p>
    </section>
  );
}

function MemoryPanel({ diagnosis, match, records }: {
  diagnosis: CorrelationDiagnosis;
  match: HistoricalMatch | null;
  records: StoredIncident[];
}) {
  return (
    <section className="copilot-memory-panel">
      <div><small>INCIDENT MEMORY & CORRELATION</small><h3>AI障害メモリ</h3></div>
      <dl>
        <div><dt>現在の原因推定</dt><dd>{diagnosis.title}</dd></div>
        <div><dt>保存パターン</dt><dd>{records.length}件</dd></div>
        <div><dt>過去類似</dt><dd>{match === null ? "なし" : `${match.incident.eventName} ${Math.round(match.similarity * 100)}/100`}</dd></div>
      </dl>
      <p>「両方遅いのはなぜ？」「前回と似てる？」のように聞くと、端末横断分析と過去障害を使って回答します。</p>
    </section>
  );
}

function MemoryMessages({ messages, thinking }: { messages: MemoryMessage[]; thinking: boolean }) {
  return (
    <>
      {messages.map((message) => (
        <article key={message.id} className={`copilot-message ${message.role} correlation-chat-message`}>
          <div className="copilot-avatar" aria-hidden="true">{message.role === "copilot" ? "AI" : "管"}</div>
          <div className="copilot-bubble">
            <small>{message.role === "copilot" ? "CORRELATION MEMORY" : "OPERATOR"}</small>
            <p>{message.text}</p>
            {message.evidence.length > 0 && <ul>{message.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
          </div>
        </article>
      ))}
      {thinking && (
        <article className="copilot-message copilot is-thinking correlation-chat-message">
          <div className="copilot-avatar" aria-hidden="true">AI</div>
          <div className="copilot-bubble"><small>CORRELATION MEMORY</small><p><span /><span /><span /></p></div>
        </article>
      )}
    </>
  );
}

export default function PredictiveCorrelationMemory({ database }: { database: Firestore }) {
  const [currentEvent, setCurrentEvent] = useState<EventIdentity | null>(null);
  const [devices, setDevices] = useState<ReceptionDevice[]>([]);
  const [records, setRecords] = useState<StoredIncident[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [labTarget, setLabTarget] = useState<Element | null>(null);
  const [copilotTarget, setCopilotTarget] = useState<Element | null>(null);
  const [messageTarget, setMessageTarget] = useState<Element | null>(null);
  const [messages, setMessages] = useState<MemoryMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const recordsRef = useRef<StoredIncident[]>([]);
  const candidateRef = useRef<{ key: string; since: number } | null>(null);
  const writeInFlightRef = useRef(false);
  const lastStoredRef = useRef("");
  const replyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let unsubscribeEvent: (() => void) | null = null;
    const unsubscribeCurrent = onSnapshot(doc(database, "system", "current-event"), (snapshot) => {
      const eventId = snapshot.exists() && typeof snapshot.data().eventId === "string"
        ? snapshot.data().eventId as string
        : "";
      unsubscribeEvent?.();
      unsubscribeEvent = null;
      if (eventId === "") {
        setCurrentEvent(null);
        setDevices([]);
        return;
      }
      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        if (!eventSnapshot.exists()) {
          setCurrentEvent(null);
          return;
        }
        const data = eventSnapshot.data();
        const name = typeof data.name === "string" ? data.name.trim() : "イベント";
        const dataDocumentId = typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
          ? data.dataDocumentId
          : encodeURIComponent(name || "event-not-set");
        setCurrentEvent({ id: eventId, name: name || "イベント", dataDocumentId });
      });
    });
    return () => {
      unsubscribeCurrent();
      unsubscribeEvent?.();
    };
  }, [database]);

  useEffect(() => {
    if (currentEvent === null) {
      return undefined;
    }
    return onSnapshot(collection(database, "event-data", currentEvent.dataDocumentId, "reception-devices"), (snapshot) => {
      setDevices(snapshot.docs
        .map((item) => readDevice(item.id, item.data()))
        .filter((device): device is ReceptionDevice => device !== null));
    });
  }, [currentEvent, database]);

  useEffect(() => onSnapshot(doc(database, "system", MEMORY_DOCUMENT), (snapshot) => {
    const next = readStoredIncidents(snapshot.exists() ? snapshot.data() : undefined);
    recordsRef.current = next;
    setRecords(next);
  }), [database]);

  const diagnosis = useMemo(() => diagnose(devices, now), [devices, now]);
  const historicalMatch = useMemo(
    () => findHistoricalMatch(diagnosis, records, currentEvent?.id ?? null),
    [currentEvent?.id, diagnosis, records]
  );

  useEffect(() => {
    if (currentEvent === null || (diagnosis.severity !== "warning" && diagnosis.severity !== "critical")) {
      candidateRef.current = null;
      return;
    }
    const key = `${currentEvent.id}|${diagnosis.causeKey}|${diagnosis.scope}|${unique(diagnosis.signature).sort().join(",")}`;
    if (candidateRef.current?.key !== key) {
      candidateRef.current = { key, since: now };
      return;
    }
    if (now - candidateRef.current.since < STABLE_BEFORE_STORE_MS || writeInFlightRef.current) return;
    const duplicate = recordsRef.current.some((record) =>
      record.eventId === currentEvent.id &&
      record.causeKey === diagnosis.causeKey &&
      record.scope === diagnosis.scope &&
      now - record.recordedAt < SAME_PATTERN_COOLDOWN_MS
    );
    if (duplicate || lastStoredRef.current === key) return;

    const record: StoredIncident = {
      id: `incident-${currentEvent.id}-${now}`,
      eventId: currentEvent.id,
      eventName: currentEvent.name,
      recordedAt: now,
      causeKey: diagnosis.causeKey,
      scope: diagnosis.scope,
      severity: diagnosis.severity,
      score: diagnosis.score,
      signature: unique(diagnosis.signature).slice(0, 20),
      summary: diagnosis.summary,
      evidence: diagnosis.evidence.slice(0, 6),
      recommendation: diagnosis.recommendation,
    };
    const nextRecords = [record, ...recordsRef.current].slice(0, MAX_MEMORY_RECORDS);
    writeInFlightRef.current = true;
    lastStoredRef.current = key;
    void setDoc(doc(database, "system", MEMORY_DOCUMENT), {
      records: nextRecords,
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch((error) => {
      console.error("障害メモリを保存できませんでした。", error);
      lastStoredRef.current = "";
    }).finally(() => {
      writeInFlightRef.current = false;
    });
  }, [currentEvent, database, diagnosis, now]);

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
      setMessageTarget((current) => {
        const next = document.querySelector(".copilot-messages");
        return current === next ? current : next;
      });
    };
    const first = window.setTimeout(updateTargets, 0);
    const observer = new MutationObserver(updateTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(first);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.classList.contains("copilot-input")) return;
      const input = form.querySelector<HTMLInputElement>('input[type="text"]');
      const question = input?.value.trim() ?? "";
      if (question === "" || !shouldHandleQuestion(question)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (input !== null) setControlledInputValue(input, "");
      const stamp = Date.now();
      const reply = buildMemoryReply(question, diagnosis, historicalMatch, recordsRef.current);
      setMessages((current) => [
        ...current,
        { id: `correlation-operator-${stamp}-${current.length}`, role: "operator", text: question, evidence: [] },
      ]);
      setThinking(true);
      if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
      replyTimerRef.current = window.setTimeout(() => {
        setThinking(false);
        setMessages((current) => [
          ...current,
          { id: `correlation-ai-${Date.now()}-${current.length}`, role: "copilot", text: reply.text, evidence: reply.evidence },
        ]);
        window.setTimeout(() => {
          document.querySelector(".copilot-messages")?.scrollTo({ top: 999999, behavior: "smooth" });
        }, 0);
      }, 480);
    };
    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, [diagnosis, historicalMatch]);

  useEffect(() => () => {
    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
  }, []);

  return (
    <>
      {labTarget !== null && createPortal(
        <CorrelationPanel diagnosis={diagnosis} match={historicalMatch} memoryCount={records.length} />,
        labTarget
      )}
      {copilotTarget !== null && createPortal(
        <MemoryPanel diagnosis={diagnosis} match={historicalMatch} records={records} />,
        copilotTarget
      )}
      {messageTarget !== null && createPortal(
        <MemoryMessages messages={messages} thinking={thinking} />,
        messageTarget
      )}
    </>
  );
}
