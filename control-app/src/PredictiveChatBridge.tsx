import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  evidence: string[];
  recommendation: string;
};

type BridgeMessage = {
  id: string;
  role: "operator" | "copilot";
  text: string;
  evidence: string[];
};

type GeneratedReply = {
  text: string;
  evidence: string[];
  focusDeviceId: string | null;
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

function levelFor(score: number): Pick<DeviceRisk, "level" | "label"> {
  if (score >= 75) return { level: "critical", label: "危険" };
  if (score >= 50) return { level: "warning", label: "注意" };
  if (score >= 25) return { level: "watch", label: "要観察" };
  return { level: "normal", label: "正常" };
}

function calculateRisk(device: ReceptionDevice, history: DeviceSample[], now: number): DeviceRisk {
  let score = 0;
  const evidence: string[] = [];
  const samples = history.slice(-12);
  const latencies = samples.map((sample) => sample.firebaseLatencyMs).filter((value) => value > 0);
  const downloads = samples.map((sample) => sample.downloadMbps).filter((value) => value > 0);
  const age = device.lastSeenAt > 0 ? Math.max(0, now - device.lastSeenAt) : 60_000;

  if (age > 45_000) {
    score += 75;
    evidence.push("ハートビートが45秒以上途絶えています");
  } else if (age > 15_000) {
    score += 25;
    evidence.push(`最終応答が${Math.floor(age / 1000)}秒前です`);
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
    evidence.push(`同期待ちが${device.pendingCount}件あります`);
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

  if (latencies.length >= 4) {
    const split = Math.max(2, Math.floor(latencies.length / 2));
    const rise = average(latencies.slice(split)) - average(latencies.slice(0, split));
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

  if (downloads.length >= 4) {
    const split = Math.max(2, Math.floor(downloads.length / 2));
    const before = average(downloads.slice(0, split));
    const after = average(downloads.slice(split));
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
    const intervals = samples
      .slice(1)
      .map((sample, index) => sample.lastSeenAt - samples[index].lastSeenAt)
      .filter((value) => value > 0 && value < 60_000);
    const maxGap = intervals.length > 0 ? Math.max(...intervals) : 0;
    const jitter = standardDeviation(intervals);
    if (maxGap > 18_000) {
      score += 12;
      evidence.push("端末の応答間隔に大きな空白があります");
    } else if (jitter > 4_000) {
      score += 7;
      evidence.push("ハートビート間隔が不安定です");
    }
  }

  if (samples.length >= 4) {
    const firstPending = samples[0]?.pendingCount ?? 0;
    const lastPending = samples[samples.length - 1]?.pendingCount ?? 0;
    if (lastPending >= firstPending + 3) {
      score += 12;
      evidence.push(`同期待ちが観測中に${lastPending - firstPending}件増加しています`);
    }
  }

  score = Math.min(100, Math.round(score));
  const state = levelFor(score);
  let recommendation = "現時点では操作不要です。監視を継続してください。";
  if (score >= 75) {
    recommendation = device.pendingCount > 0
      ? "まず再同期を検討し、通信と端末状態をすぐ確認してください。"
      : device.cameraState === "error"
        ? "カメラ再起動を検討し、改善しなければ受付端末を確認してください。"
        : "端末状態をすぐ確認し、通信復旧または受付切替を検討してください。";
  } else if (score >= 50) {
    recommendation = device.pendingCount > 0
      ? "再同期を検討し、数分間の通信推移を重点監視してください。"
      : "通信品質の悪化が続くか確認し、早めの端末確認を推奨します。";
  } else if (score >= 25) {
    recommendation = "軽い悪化傾向があります。数分間の推移を重点監視してください。";
  }

  return {
    device,
    score,
    level: state.level,
    label: state.label,
    evidence: evidence.length > 0 ? evidence.slice(0, 5) : ["通信・同期・カメラに目立った悪化傾向はありません"],
    recommendation,
  };
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\u3000。、！？!?「」『』（）()]/g, "");
}

function shouldHandleQuestion(question: string, hasFocus: boolean) {
  const value = normalize(question);
  const predictiveWords = [
    "危ない", "危険", "リスク", "前兆", "予兆", "兆候", "壊れ", "故障",
    "怪しい", "要観察", "悪化", "異常", "大丈夫", "問題ある", "問題ない",
    "やるべき", "何すれば", "どうすれば", "どうしたら", "原因", "理由",
    "なんで", "なぜ", "どうして", "一番", "どっち",
  ];
  if (predictiveWords.some((word) => value.includes(word))) return true;
  if ((value.includes("入口") || value.includes("出口")) && (value.includes("状態") || value.endsWith("は"))) return true;
  if (!hasFocus) return false;
  return ["それ", "そっち", "詳しく", "もっと", "じゃあ", "で", "今は", "対応は"].some((word) => value.includes(word));
}

function explicitMode(question: string): ReceptionMode | null {
  const value = normalize(question);
  if (value.includes("入口")) return "entry";
  if (value.includes("出口")) return "exit";
  return null;
}

function pickTarget(question: string, risks: DeviceRisk[], focusDeviceId: string | null) {
  const mode = explicitMode(question);
  if (mode !== null) return risks.find((risk) => risk.device.mode === mode) ?? null;
  const value = normalize(question);
  const followUp = ["なんで", "なぜ", "どうして", "原因", "理由", "詳しく", "どうすれば", "どうしたら", "何すれば", "対応"].some((word) => value.includes(word));
  if (followUp && focusDeviceId !== null) {
    return risks.find((risk) => risk.device.id === focusDeviceId) ?? risks[0] ?? null;
  }
  return risks[0] ?? null;
}

function generateReply(question: string, risks: DeviceRisk[], focusDeviceId: string | null): GeneratedReply {
  if (risks.length === 0) {
    return {
      text: "まだ受付端末のライブデータを受信できていません。イベントと端末接続を確認してください。",
      evidence: ["異常予兆レーダー: データ待機中"],
      focusDeviceId: null,
    };
  }

  const value = normalize(question);
  const target = pickTarget(question, risks, focusDeviceId);
  const highest = risks[0];
  const second = risks[1];
  const watchCount = risks.filter((risk) => risk.score >= 25).length;

  if (value.includes("どっち") || value.includes("一番")) {
    const comparison = second === undefined
      ? "比較対象の端末は現在1台だけです。"
      : `${second.device.deviceName}は${second.score}なので、差は${Math.max(0, highest.score - second.score)}ポイントです。`;
    return {
      text: `今もっとも注意したいのは${highest.device.deviceName}です。リスクスコアは${highest.score}/100（${highest.label}）。${comparison} ${highest.recommendation}`,
      evidence: highest.evidence.slice(0, 4),
      focusDeviceId: highest.device.id,
    };
  }

  if (value.includes("前兆") || value.includes("予兆") || value.includes("兆候") || value.includes("怪しい")) {
    if (highest.score < 25) {
      return {
        text: `今のところ強い異常予兆はありません。最高リスクは${highest.device.deviceName}の${highest.score}/100で、判定は${highest.label}です。`,
        evidence: highest.evidence.slice(0, 4),
        focusDeviceId: highest.device.id,
      };
    }
    return {
      text: `あります。${highest.device.deviceName}で${highest.label}レベルの兆候を検出しています。リスクは${highest.score}/100です。${highest.recommendation}`,
      evidence: highest.evidence.slice(0, 4),
      focusDeviceId: highest.device.id,
    };
  }

  if (value.includes("なんで") || value.includes("なぜ") || value.includes("どうして") || value.includes("原因") || value.includes("理由") || value.includes("詳しく")) {
    if (target === null) {
      return { text: "対象端末を特定できませんでした。入口か出口を指定してください。", evidence: [], focusDeviceId };
    }
    return {
      text: `${target.device.deviceName}を${target.label}と判定しているのは、単一の値ではなく直近約5分の変化を合わせて見ているからです。現在のリスクは${target.score}/100です。`,
      evidence: target.evidence.slice(0, 5),
      focusDeviceId: target.device.id,
    };
  }

  if (value.includes("やるべき") || value.includes("何すれば") || value.includes("どうすれば") || value.includes("どうしたら") || value.includes("対応") || value.includes("対処")) {
    if (target === null) {
      return { text: "対象端末を特定できませんでした。入口か出口を指定してください。", evidence: [], focusDeviceId };
    }
    return {
      text: `${target.device.deviceName}については、${target.recommendation} 現在のリスクは${target.score}/100（${target.label}）です。`,
      evidence: target.evidence.slice(0, 4),
      focusDeviceId: target.device.id,
    };
  }

  if (value.includes("大丈夫") || value.includes("問題ある") || value.includes("問題ない") || value.includes("異常")) {
    if (watchCount === 0) {
      return {
        text: `現時点では全${risks.length}台とも要観察未満です。最高でも${highest.device.deviceName}の${highest.score}/100で、強い異常予兆はありません。`,
        evidence: highest.evidence.slice(0, 4),
        focusDeviceId: highest.device.id,
      };
    }
    return {
      text: `完全に問題なしとは言えません。要観察以上が${watchCount}台あり、最優先は${highest.device.deviceName}の${highest.score}/100（${highest.label}）です。${highest.recommendation}`,
      evidence: highest.evidence.slice(0, 4),
      focusDeviceId: highest.device.id,
    };
  }

  if (target !== null) {
    return {
      text: `${target.device.deviceName}はリスク${target.score}/100、判定は${target.label}です。${target.recommendation}`,
      evidence: target.evidence.slice(0, 4),
      focusDeviceId: target.device.id,
    };
  }

  return {
    text: `最高リスクは${highest.device.deviceName}の${highest.score}/100（${highest.label}）です。${highest.recommendation}`,
    evidence: highest.evidence.slice(0, 4),
    focusDeviceId: highest.device.id,
  };
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function BridgeMessages({ messages, thinking }: { messages: BridgeMessage[]; thinking: boolean }) {
  return (
    <>
      {messages.map((message) => (
        <article key={message.id} className={`copilot-message ${message.role} predictive-chat-message`}>
          <div className="copilot-avatar" aria-hidden="true">{message.role === "copilot" ? "AI" : "管"}</div>
          <div className="copilot-bubble">
            <small>{message.role === "copilot" ? "PREDICTIVE INTELLIGENCE" : "OPERATOR"}</small>
            <p>{message.text}</p>
            {message.evidence.length > 0 && (
              <ul>{message.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            )}
          </div>
        </article>
      ))}
      {thinking && (
        <article className="copilot-message copilot is-thinking predictive-chat-message">
          <div className="copilot-avatar" aria-hidden="true">AI</div>
          <div className="copilot-bubble"><small>PREDICTIVE INTELLIGENCE</small><p><span /><span /><span /></p></div>
        </article>
      )}
    </>
  );
}

export default function PredictiveChatBridge({ database }: { database: Firestore }) {
  const [eventDataId, setEventDataId] = useState<string | null>(null);
  const [devices, setDevices] = useState<ReceptionDevice[]>([]);
  const [history, setHistory] = useState<Record<string, DeviceSample[]>>({});
  const [now, setNow] = useState(0);
  const [messageTarget, setMessageTarget] = useState<Element | null>(null);
  const [messages, setMessages] = useState<BridgeMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const focusDeviceIdRef = useRef<string | null>(null);
  const risksRef = useRef<DeviceRisk[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
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
      focusDeviceIdRef.current = null;

      if (eventId === null || eventId === "") return;
      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        if (!eventSnapshot.exists()) return;
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
          if (
            last?.lastSeenAt === device.lastSeenAt &&
            last.pendingCount === device.pendingCount &&
            last.cameraState === device.cameraState &&
            last.firebaseLatencyMs === device.firebaseLatencyMs &&
            last.downloadMbps === device.downloadMbps
          ) continue;
          next[device.id] = [
            ...existing,
            {
              recordedAt: observedAt,
              lastSeenAt: device.lastSeenAt,
              pendingCount: device.pendingCount,
              firebaseLatencyMs: device.firebaseLatencyMs,
              downloadMbps: device.downloadMbps,
              cameraState: device.cameraState,
            },
          ].filter((sample) => observedAt - sample.recordedAt <= HISTORY_WINDOW_MS).slice(-MAX_HISTORY_SAMPLES);
        }
        return next;
      });
    });
  }, [database, eventDataId]);

  const risks = useMemo(
    () => devices
      .map((device) => calculateRisk(device, history[device.id] ?? [], now))
      .sort((a, b) => b.score - a.score),
    [devices, history, now]
  );

  useEffect(() => {
    risksRef.current = risks;
  }, [risks]);

  const askPredictiveAI = useCallback((question: string) => {
    const trimmed = question.trim();
    if (trimmed === "") return;
    const stamp = Date.now();
    setMessages((current) => [
      ...current,
      { id: `predictive-operator-${stamp}-${current.length}`, role: "operator", text: trimmed, evidence: [] },
    ]);
    setThinking(true);

    const reply = generateReply(trimmed, risksRef.current, focusDeviceIdRef.current);
    focusDeviceIdRef.current = reply.focusDeviceId;

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setThinking(false);
      setMessages((current) => [
        ...current,
        {
          id: `predictive-ai-${Date.now()}-${current.length}`,
          role: "copilot",
          text: reply.text,
          evidence: reply.evidence,
        },
      ]);
      window.setTimeout(() => {
        document.querySelector(".copilot-messages")?.scrollTo({ top: 999999, behavior: "smooth" });
      }, 0);
    }, 420);
  }, []);

  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.classList.contains("copilot-input")) return;
      const input = form.querySelector<HTMLInputElement>('input[type="text"]');
      const question = input?.value.trim() ?? "";
      if (question === "" || !shouldHandleQuestion(question, focusDeviceIdRef.current !== null)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (input !== null) setControlledInputValue(input, "");
      askPredictiveAI(question);
    };

    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, [askPredictiveAI]);

  useEffect(() => {
    const updateTarget = () => {
      setMessageTarget((current) => {
        const next = document.querySelector(".copilot-messages");
        return current === next ? current : next;
      });
    };
    updateTarget();
    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  if (messageTarget === null) return null;
  return createPortal(<BridgeMessages messages={messages} thinking={thinking} />, messageTarget);
}
