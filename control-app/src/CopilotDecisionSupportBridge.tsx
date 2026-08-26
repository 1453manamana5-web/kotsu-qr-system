import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

type EventIdentity = {
  id: string;
  name: string;
  dataDocumentId: string;
  capacity: number;
};

type LiveSummary = {
  totalVisitors: number;
  currentInside: number;
  currentMembersInside: number;
};

type LiveDevice = {
  id: string;
  name: string;
  mode: "entry" | "exit";
  lastSeenAt: number;
  pendingCount: number;
  cameraState: string;
  firebaseLatencyMs: number;
  downloadMbps: number;
  receptionPaused: boolean;
};

type LiveActivity = {
  type: "ticket-entry" | "ticket-exit" | "member-entry" | "member-exit";
  timestamp: number;
};

type Destination = "overview" | "devices" | "incidents" | "diagnostics";

type DecisionMessage = {
  id: string;
  role: "operator" | "copilot";
  text: string;
  evidence: string[];
  action?: { label: string; destination: Destination };
};

type DecisionIntent = "brief" | "priority" | "forecast" | "compare" | "response";

const ACTIVE_AFTER_MS = 25_000;

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
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

function readDevice(id: string, data: DocumentData): LiveDevice | null {
  if (data.mode !== "entry" && data.mode !== "exit") return null;
  return {
    id,
    name: typeof data.deviceName === "string" && data.deviceName.trim() !== ""
      ? data.deviceName.trim()
      : data.mode === "entry" ? "入口端末" : "出口端末",
    mode: data.mode,
    lastSeenAt: timestampToMilliseconds(data.updatedAt) || readNumber(data.lastSeenAt),
    pendingCount: Math.floor(readNumber(data.pendingCount)),
    cameraState: typeof data.cameraState === "string" ? data.cameraState : "starting",
    firebaseLatencyMs: Math.round(readNumber(data.firebaseLatencyMs)),
    downloadMbps: Math.round(readNumber(data.downloadMbps) * 10) / 10,
    receptionPaused: data.receptionPaused === true,
  };
}

function readActivity(data: DocumentData): LiveActivity | null {
  if (
    data.type !== "ticket-entry" &&
    data.type !== "ticket-exit" &&
    data.type !== "member-entry" &&
    data.type !== "member-exit"
  ) return null;
  if (typeof data.timestamp !== "string") return null;
  const timestamp = new Date(data.timestamp).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return { type: data.type, timestamp };
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\u3000。、！？!?「」『』（）()・]/g, "");
}

function detectIntent(question: string): DecisionIntent | null {
  const value = normalize(question);
  if (/(30秒|短く|簡単に|ざっくり).*(ブリーフ|まとめ|状況)|ブリーフィング|管制ブリーフ|30秒ブリーフ/.test(value)) return "brief";
  if (/(今|次).*(何すれば|なにすれば|何したら|なにしたら|やるべき|見るべき)|優先順位|最優先|まず何|まずなに/.test(value)) return "priority";
  if (/(このあと|これから|5分後|10分後|15分後|もうすぐ).*(混|人数|どう|増|減)|混みそう|混雑しそう/.test(value)) return "forecast";
  if (/(入口.*出口|出口.*入口|両方|2台|二台).*(どっち|比較|悪|危|遅|不安|状態)|どっち.*(端末|悪|危|遅)/.test(value)) return "compare";
  if (/(どう対応|対応どう|対処|手順|何をすれば|直し方|復旧手順|対応方法)/.test(value)) return "response";
  return null;
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function clickNavigation(destination: Destination) {
  const labels: Record<Destination, string[]> = {
    overview: ["ライブ運行"],
    devices: ["端末"],
    incidents: ["障害履歴"],
    diagnostics: ["通信診断"],
  };
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".sidebar nav button")];
  const button = buttons.find((candidate) => labels[destination].some((label) => candidate.textContent?.includes(label)));
  button?.click();
}

function ratePerMinute(activities: LiveActivity[], now: number, minutes: number, entry: boolean) {
  const cutoff = now - minutes * 60_000;
  const count = activities.filter((activity) =>
    activity.timestamp >= cutoff &&
    (entry
      ? activity.type === "ticket-entry" || activity.type === "member-entry"
      : activity.type === "ticket-exit" || activity.type === "member-exit")
  ).length;
  return count / minutes;
}

function deviceScore(device: LiveDevice | null, now: number) {
  if (device === null) return { score: 100, reasons: ["通信中の端末が見つかりません"] };
  const reasons: string[] = [];
  let score = 0;
  const age = now - device.lastSeenAt;
  if (age > ACTIVE_AFTER_MS) {
    score += 60;
    reasons.push("最終通信が途切れています");
  } else if (age > 12_000) {
    score += 25;
    reasons.push("通信間隔が伸びています");
  }
  if (device.cameraState === "error") {
    score += 45;
    reasons.push("カメラエラー");
  }
  if (device.pendingCount > 0) {
    score += Math.min(30, 8 + device.pendingCount * 3);
    reasons.push(`同期待ち${device.pendingCount}件`);
  }
  if (device.firebaseLatencyMs >= 1_000) {
    score += 25;
    reasons.push(`Firebase応答${device.firebaseLatencyMs}ms`);
  } else if (device.firebaseLatencyMs >= 500) {
    score += 12;
    reasons.push(`Firebase応答${device.firebaseLatencyMs}ms`);
  }
  if (device.downloadMbps > 0 && device.downloadMbps < 1) {
    score += 20;
    reasons.push(`下り${device.downloadMbps.toFixed(1)}Mbps`);
  }
  if (device.receptionPaused) {
    score += 8;
    reasons.push("受付一時停止中");
  }
  return { score: Math.min(100, score), reasons: reasons.length > 0 ? reasons : ["大きな異常なし"] };
}

function DecisionMessages({ messages }: { messages: DecisionMessage[] }) {
  return (
    <>
      {messages.map((message) => (
        <article key={message.id} className={`copilot-message ${message.role} decision-support-message`}>
          <div className="copilot-avatar" aria-hidden="true">{message.role === "copilot" ? "AI" : "管"}</div>
          <div className="copilot-bubble">
            <small>{message.role === "copilot" ? "AI管制 · 判断支援" : "OPERATOR"}</small>
            <p>{message.text}</p>
            {message.evidence.length > 0 && <ul>{message.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
            {message.action !== undefined && (
              <button type="button" className="copilot-action" onClick={() => clickNavigation(message.action!.destination)}>
                {message.action.label}
              </button>
            )}
          </div>
        </article>
      ))}
    </>
  );
}

export default function CopilotDecisionSupportBridge({ database }: { database: Firestore }) {
  const [currentEvent, setCurrentEvent] = useState<EventIdentity | null>(null);
  const [summary, setSummary] = useState<LiveSummary | null>(null);
  const [devices, setDevices] = useState<LiveDevice[]>([]);
  const [activities, setActivities] = useState<LiveActivity[]>([]);
  const [messageTarget, setMessageTarget] = useState<Element | null>(null);
  const [messages, setMessages] = useState<DecisionMessage[]>([]);
  const eventRef = useRef<EventIdentity | null>(null);
  const summaryRef = useRef<LiveSummary | null>(null);
  const devicesRef = useRef<LiveDevice[]>([]);
  const activitiesRef = useRef<LiveActivity[]>([]);

  useEffect(() => {
    let unsubscribeEvent: (() => void) | null = null;
    const unsubscribeCurrent = onSnapshot(doc(database, "system", "current-event"), (snapshot) => {
      const eventId = snapshot.exists() && typeof snapshot.data().eventId === "string" ? snapshot.data().eventId as string : "";
      unsubscribeEvent?.();
      unsubscribeEvent = null;
      eventRef.current = null;
      setCurrentEvent(null);
      if (eventId === "") return;
      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        if (!eventSnapshot.exists()) return;
        const data = eventSnapshot.data();
        const name = typeof data.name === "string" && data.name.trim() !== "" ? data.name.trim() : "イベント";
        const next: EventIdentity = {
          id: eventId,
          name,
          dataDocumentId: typeof data.dataDocumentId === "string" && data.dataDocumentId !== "" ? data.dataDocumentId : eventId,
          capacity: Math.max(1, Math.floor(readNumber(data.capacity) || 80)),
        };
        eventRef.current = next;
        setCurrentEvent(next);
      });
    });
    return () => {
      unsubscribeCurrent();
      unsubscribeEvent?.();
    };
  }, [database]);

  useEffect(() => {
    summaryRef.current = null;
    devicesRef.current = [];
    activitiesRef.current = [];
    setSummary(null);
    setDevices([]);
    setActivities([]);
    if (currentEvent === null) return undefined;

    const base = ["event-data", currentEvent.dataDocumentId] as const;
    const unsubscribeSummary = onSnapshot(doc(database, ...base, "analytics", "summary"), (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() : {};
      const next = snapshot.exists() ? {
        totalVisitors: Math.floor(readNumber(data.totalVisitors)),
        currentInside: Math.floor(readNumber(data.currentInside)),
        currentMembersInside: Math.floor(readNumber(data.currentMembersInside)),
      } : null;
      summaryRef.current = next;
      setSummary(next);
    });
    const unsubscribeDevices = onSnapshot(collection(database, ...base, "reception-devices"), (snapshot) => {
      const next = snapshot.docs.map((item) => readDevice(item.id, item.data())).filter((item): item is LiveDevice => item !== null);
      devicesRef.current = next;
      setDevices(next);
    });
    const activityQuery = query(collection(database, ...base, "activity"), orderBy("timestamp", "desc"), limit(180));
    const unsubscribeActivities = onSnapshot(activityQuery, (snapshot) => {
      const next = snapshot.docs.map((item) => readActivity(item.data())).filter((item): item is LiveActivity => item !== null);
      activitiesRef.current = next;
      setActivities(next);
    });
    return () => {
      unsubscribeSummary();
      unsubscribeDevices();
      unsubscribeActivities();
    };
  }, [currentEvent, database]);

  useEffect(() => {
    const updateTarget = () => {
      const next = document.querySelector(".copilot-messages");
      setMessageTarget((current) => current === next ? current : next);
    };
    const first = window.setTimeout(updateTarget, 0);
    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(first);
      observer.disconnect();
    };
  }, []);

  const buildReply = useCallback((intent: DecisionIntent): Omit<DecisionMessage, "id" | "role"> => {
    const now = Date.now();
    const event = eventRef.current;
    const live = summaryRef.current;
    const currentDevices = devicesRef.current;
    const currentActivities = activitiesRef.current;
    const occupancy = live === null ? 0 : live.currentInside + live.currentMembersInside;
    const capacity = event?.capacity ?? 80;
    const occupancyRate = Math.round(occupancy / Math.max(1, capacity) * 100);
    const entryRate = ratePerMinute(currentActivities, now, 5, true);
    const exitRate = ratePerMinute(currentActivities, now, 5, false);
    const netRate = entryRate - exitRate;
    const predicted5 = Math.max(0, Math.round(occupancy + netRate * 5));
    const predicted15 = Math.max(0, Math.round(occupancy + netRate * 15));
    const active = currentDevices.filter((device) => now - device.lastSeenAt <= ACTIVE_AFTER_MS);
    const entry = [...currentDevices].filter((device) => device.mode === "entry").sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] ?? null;
    const exit = [...currentDevices].filter((device) => device.mode === "exit").sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] ?? null;
    const entryRisk = deviceScore(entry, now);
    const exitRisk = deviceScore(exit, now);
    const issueCount = [entryRisk.score >= 25, exitRisk.score >= 25].filter(Boolean).length;

    if (event === null || live === null) {
      return {
        text: "ライブデータをまだ受信できていません。現在のイベント設定と通信を確認してください。",
        evidence: [event === null ? "イベント: 未設定" : `イベント: ${event.name}`, "ライブ集計: 読み込み待ち"],
        action: { label: "通信診断を開く", destination: "diagnostics" },
      };
    }

    if (intent === "compare") {
      const difference = Math.abs(entryRisk.score - exitRisk.score);
      const worse = entryRisk.score === exitRisk.score ? null : entryRisk.score > exitRisk.score ? "入口" : "出口";
      return {
        text: worse === null
          ? "入口と出口は、今のところほぼ同じ状態です。"
          : `${worse}端末の方を先に確認するのがおすすめです。リスク差は${difference}点です。`,
        evidence: [
          `入口: ${entryRisk.score}/100 · ${entryRisk.reasons.join("、")}`,
          `出口: ${exitRisk.score}/100 · ${exitRisk.reasons.join("、")}`,
        ],
        action: { label: "端末一覧を開く", destination: "devices" },
      };
    }

    if (intent === "forecast") {
      const trend = netRate >= 0.35 ? "増える流れ" : netRate <= -0.35 ? "減る流れ" : "ほぼ横ばい";
      const warning = predicted15 >= capacity || predicted15 / capacity >= 0.8;
      return {
        text: warning
          ? `このままの流れなら混雑に注意です。15分後は約${predicted15}人と見ています。`
          : `今のペースでは急激な混雑は見えていません。15分後は約${predicted15}人の見込みです。`,
        evidence: [
          `現在: ${occupancy}人（定員の${occupancyRate}%）`,
          `5分後: 約${predicted5}人`,
          `15分後: 約${predicted15}人`,
          `直近5分: 入場${entryRate.toFixed(1)}人/分・退場${exitRate.toFixed(1)}人/分 → ${trend}`,
        ],
        action: { label: "ライブ運行を見る", destination: "overview" },
      };
    }

    const priorities: string[] = [];
    if (entryRisk.score >= 25) priorities.push(`入口端末を確認（${entryRisk.reasons[0]}）`);
    if (exitRisk.score >= 25) priorities.push(`出口端末を確認（${exitRisk.reasons[0]}）`);
    if (predicted15 / capacity >= 0.8) priorities.push(`混雑見通しを確認（15分後 約${predicted15}人）`);
    if (priorities.length === 0) priorities.push("緊急対応は不要。通常監視を継続");

    if (intent === "response") {
      return {
        text: issueCount > 0
          ? `対応はこの順がおすすめです。① ${priorities[0]}${priorities[1] ? `、② ${priorities[1]}` : ""}。まず端末状態を確認してから操作してください。`
          : predicted15 / capacity >= 0.8
            ? "端末異常は見えていません。まず混雑予測を確認し、入口運用を早めに判断してください。"
            : "今は復旧操作が必要な異常は見えていません。通常監視を続ければ大丈夫です。",
        evidence: priorities.slice(0, 3),
        action: { label: issueCount > 0 ? "端末を確認" : "ライブ運行を見る", destination: issueCount > 0 ? "devices" : "overview" },
      };
    }

    if (intent === "priority") {
      return {
        text: priorities[0] === "緊急対応は不要。通常監視を継続"
          ? "今すぐ対応する項目はありません。通常監視を続けてください。"
          : `最優先は「${priorities[0]}」です。`,
        evidence: [
          ...priorities.slice(0, 3),
          `現在${occupancy}人・15分後約${predicted15}人`,
          `稼働端末${active.length}台`,
        ],
        action: { label: issueCount > 0 ? "確認を始める" : "ライブ運行を見る", destination: issueCount > 0 ? "devices" : "overview" },
      };
    }

    return {
      text: priorities[0] === "緊急対応は不要。通常監視を継続"
        ? `現在${occupancy}人、15分後は約${predicted15}人。受付端末${active.length}台が通信中で、今すぐの対応はありません。`
        : `現在${occupancy}人、15分後は約${predicted15}人。いま優先して見るのは「${priorities[0]}」です。`,
      evidence: [
        `来場者累計: ${live.totalVisitors}人`,
        `会場内: ${occupancy}人 / 定員${capacity}人`,
        `入口リスク: ${entryRisk.score}/100`,
        `出口リスク: ${exitRisk.score}/100`,
      ],
      action: { label: priorities[0] === "緊急対応は不要。通常監視を継続" ? "ライブ運行を見る" : "端末を確認", destination: priorities[0] === "緊急対応は不要。通常監視を継続" ? "overview" : "devices" },
    };
  }, []);

  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.classList.contains("copilot-input")) return;
      const input = form.querySelector<HTMLInputElement>('input[type="text"]');
      const question = input?.value.trim() ?? "";
      const intent = detectIntent(question);
      if (question === "" || intent === null) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (input !== null) setControlledInputValue(input, "");
      const stamp = Date.now();
      const reply = buildReply(intent);
      setMessages((current) => [
        ...current,
        { id: `decision-user-${stamp}-${current.length}`, role: "operator", text: question, evidence: [] },
        { ...reply, id: `decision-ai-${stamp}-${current.length + 1}`, role: "copilot" },
      ]);
      window.setTimeout(() => {
        document.querySelector(".copilot-messages")?.scrollTo({ top: 999999, behavior: "smooth" });
      }, 0);
    };
    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, [buildReply]);

  const statusFingerprint = useMemo(() => `${currentEvent?.id ?? ""}:${summary?.currentInside ?? 0}:${summary?.currentMembersInside ?? 0}:${devices.length}:${activities.length}`, [activities.length, currentEvent?.id, devices.length, summary?.currentInside, summary?.currentMembersInside]);
  void statusFingerprint;

  return messageTarget === null ? null : createPortal(<DecisionMessages messages={messages} />, messageTarget);
}
