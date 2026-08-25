import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import {
  sendReceptionRemoteCommand,
  type ReceptionRemoteCommandType,
} from "../../src/receptionRemoteControlFirestore";
import type { CameraState, ReceptionDevice, ReceptionMode } from "./types";

type CurrentEvent = {
  id: string;
  name: string;
  dataDocumentId: string;
};

type CapabilityAnalytics = {
  totalVisitors: number;
  currentInside: number;
  currentMembersInside: number;
  reEntryCount: number;
  ticketCount: number;
  activityCount: number;
  averageStayMinutes: number | null;
  hourlyEntryCounts: Record<string, number>;
};

type CapabilityActivity = {
  id: string;
  type: "ticket-entry" | "ticket-exit" | "member-entry" | "member-exit";
  timestamp: number;
};

type Destination = "overview" | "analysis" | "devices" | "incidents" | "diagnostics" | "lab" | "copilot";

type CapabilityAction =
  | {
      id: string;
      label: string;
      kind: "remote";
      deviceIds: string[];
      command: ReceptionRemoteCommandType;
      confirmText?: string;
    }
  | {
      id: string;
      label: string;
      kind: "navigate";
      destination: Destination;
      deviceMode?: ReceptionMode;
    }
  | {
      id: string;
      label: string;
      kind: "diagnose";
    };

type CapabilityMessage = {
  id: string;
  role: "operator" | "copilot";
  text: string;
  evidence: string[];
  action?: CapabilityAction;
};

type CapabilityReply = {
  text: string;
  evidence: string[];
  action?: CapabilityAction;
};

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

function readAnalytics(data: DocumentData): CapabilityAnalytics {
  const hourlyEntryCounts: Record<string, number> = {};
  if (typeof data.hourlyEntryCounts === "object" && data.hourlyEntryCounts !== null && !Array.isArray(data.hourlyEntryCounts)) {
    for (const [key, value] of Object.entries(data.hourlyEntryCounts)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        hourlyEntryCounts[key] = Math.max(0, Math.floor(value));
      }
    }
  }

  const averageStayMinutes = typeof data.averageStayMinutes === "number" && Number.isFinite(data.averageStayMinutes)
    ? Math.max(0, Math.round(data.averageStayMinutes))
    : typeof data.totalStayMilliseconds === "number" &&
        Number.isFinite(data.totalStayMilliseconds) &&
        typeof data.completedStayCount === "number" &&
        data.completedStayCount > 0
      ? Math.round(data.totalStayMilliseconds / data.completedStayCount / 60_000)
      : null;

  return {
    totalVisitors: Math.floor(readNumber(data.totalVisitors)),
    currentInside: Math.floor(readNumber(data.currentInside)),
    currentMembersInside: Math.floor(readNumber(data.currentMembersInside)),
    reEntryCount: Math.floor(readNumber(data.reEntryCount)),
    ticketCount: Math.floor(readNumber(data.ticketCount)),
    activityCount: Math.floor(readNumber(data.activityCount)),
    averageStayMinutes,
    hourlyEntryCounts,
  };
}

function readActivity(id: string, data: DocumentData): CapabilityActivity | null {
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

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\u3000。、！？!?「」『』（）()]/g, "");
}

function explicitMode(question: string): ReceptionMode | null {
  const value = normalize(question);
  if (value.includes("入口")) return "entry";
  if (value.includes("出口")) return "exit";
  return null;
}

function isNavigationQuestion(question: string) {
  const value = normalize(question);
  if (!/(開いて|見せて|移動|行って|表示して|出して)/.test(value)) return false;
  return /(ライブ|運行|分析|端末|障害履歴|通信診断|診断画面|管制ラボ|ラボ|ai管制)/.test(value);
}

function isDiagnosticQuestion(question: string) {
  const value = normalize(question);
  return /(診断して|再診断|診断実行|全部診断|通信チェック)/.test(value);
}

function remoteCommandFromQuestion(question: string): ReceptionRemoteCommandType | null {
  const value = normalize(question);
  if (/音/.test(value) && /(鳴ら|再生|テスト)/.test(value)) return "play-sound";
  if (/(再読み込み|リロード|再起動してアプリ|アプリ再起動)/.test(value)) return "reload-app";
  if (/カメラ/.test(value) && /(再起動|直して|復旧)/.test(value)) return "restart-camera";
  if (/(同期|未送信)/.test(value) && /(再同期|送って|実行|やって)/.test(value)) return "sync-pending";
  if (/受付/.test(value) && /(一時停止|止めて|停止して)/.test(value)) return "pause-reception";
  if (/受付/.test(value) && /(再開|始めて|戻して)/.test(value)) return "resume-reception";
  return null;
}

function isExpandedRemoteQuestion(question: string) {
  const command = remoteCommandFromQuestion(question);
  if (command === null) return false;
  const value = normalize(question);
  return command === "play-sound" || command === "reload-app" || value.includes("両方") || value.includes("2台") || value.includes("全部");
}

function isAnalysisQuestion(question: string) {
  const value = normalize(question);
  if (isNavigationQuestion(question) || isDiagnosticQuestion(question) || isExpandedRemoteQuestion(question)) return false;
  return [
    "来場者", "再入場", "ピーク", "一番多い時間", "時間帯", "何時台", "チケット",
    "平均滞在", "滞在時間", "直近", "入場ペース", "退場ペース", "何人来た", "分析して",
  ].some((word) => value.includes(word)) || /\d{1,2}時.*\d{1,2}時/.test(value);
}

function shouldHandleQuestion(question: string) {
  return isNavigationQuestion(question) ||
    isDiagnosticQuestion(question) ||
    isExpandedRemoteQuestion(question) ||
    isAnalysisQuestion(question);
}

function destinationFromQuestion(question: string): { destination: Destination; deviceMode?: ReceptionMode } | null {
  const value = normalize(question);
  if (value.includes("通信診断") || value.includes("診断画面")) return { destination: "diagnostics" };
  if (value.includes("障害履歴")) return { destination: "incidents" };
  if (value.includes("管制ラボ") || value.includes("ラボ")) return { destination: "lab" };
  if (value.includes("ai管制")) return { destination: "copilot" };
  if (value.includes("分析")) return { destination: "analysis" };
  if (value.includes("端末")) return { destination: "devices", deviceMode: explicitMode(question) ?? undefined };
  if (value.includes("ライブ") || value.includes("運行")) return { destination: "overview" };
  return null;
}

const NAV_LABELS: Record<Destination, string> = {
  overview: "ライブ運行",
  analysis: "分析",
  devices: "端末",
  incidents: "障害履歴",
  diagnostics: "通信診断",
  lab: "管制ラボ",
  copilot: "AI管制",
};

function clickNavigation(destination: Destination) {
  const label = NAV_LABELS[destination];
  const button = [...document.querySelectorAll<HTMLButtonElement>(".sidebar nav button")]
    .find((item) => item.textContent?.includes(label));
  button?.click();
  return button !== undefined;
}

function openDeviceAfterNavigation(mode: ReceptionMode) {
  let attempts = 0;
  const tryOpen = () => {
    attempts += 1;
    const cards = [...document.querySelectorAll<HTMLElement>(".all-device-grid .device-card.is-actionable")];
    const marker = mode === "entry" ? "入口" : "出口";
    const card = cards.find((item) => item.textContent?.includes(marker));
    if (card !== undefined) {
      card.click();
      return;
    }
    if (attempts < 8) window.setTimeout(tryOpen, 100);
  };
  window.setTimeout(tryOpen, 80);
}

function runDiagnosticsFromUI() {
  clickNavigation("diagnostics");
  let attempts = 0;
  const tryRun = () => {
    attempts += 1;
    const button = [...document.querySelectorAll<HTMLButtonElement>(".diagnostics button")]
      .find((item) => item.textContent?.includes("再診断"));
    if (button !== undefined) {
      button.click();
      return;
    }
    if (attempts < 8) window.setTimeout(tryRun, 100);
  };
  window.setTimeout(tryRun, 80);
}

function hourCount(analytics: CapabilityAnalytics, hour: number) {
  const suffix = `T${String(hour).padStart(2, "0")}`;
  return Object.entries(analytics.hourlyEntryCounts)
    .filter(([key]) => key.endsWith(suffix))
    .reduce((total, [, count]) => total + count, 0);
}

function peakHour(analytics: CapabilityAnalytics) {
  const entries = Object.entries(analytics.hourlyEntryCounts);
  if (entries.length === 0) return null;
  const [key, count] = entries.sort((first, second) => second[1] - first[1])[0];
  const matched = key.match(/T(\d{2})$/);
  return matched === null ? null : { hour: Number(matched[1]), count };
}

function recentFlow(activities: CapabilityActivity[], minutes: number) {
  const cutoff = Date.now() - minutes * 60_000;
  const recent = activities.filter((activity) => activity.timestamp >= cutoff);
  const entries = recent.filter((activity) => activity.type === "ticket-entry" || activity.type === "member-entry").length;
  const exits = recent.length - entries;
  return { entries, exits };
}

function buildAnalysisReply(
  question: string,
  analytics: CapabilityAnalytics | null,
  activities: CapabilityActivity[]
): CapabilityReply {
  if (analytics === null) {
    return {
      text: "分析データをまだ受信できていません。現在のイベントとFirestore接続を確認してください。",
      evidence: ["分析サマリー: データ待機中"],
    };
  }

  const value = normalize(question);
  const hourMatches = [...value.matchAll(/(\d{1,2})時/g)].map((match) => Number(match[1])).filter((hour) => hour >= 0 && hour <= 23);
  if (hourMatches.length >= 2) {
    const firstHour = hourMatches[0];
    const secondHour = hourMatches[1];
    const firstCount = hourCount(analytics, firstHour);
    const secondCount = hourCount(analytics, secondHour);
    const difference = Math.abs(firstCount - secondCount);
    const comparison = firstCount === secondCount
      ? "同数です"
      : firstCount > secondCount
        ? `${firstHour}時台の方が${difference}人多いです`
        : `${secondHour}時台の方が${difference}人多いです`;
    return {
      text: `${firstHour}時台は${firstCount}人、${secondHour}時台は${secondCount}人で、${comparison}。`,
      evidence: [`${firstHour}時台: ${firstCount}人`, `${secondHour}時台: ${secondCount}人`],
    };
  }

  if (/(ピーク|一番多い時間|何時台|時間帯)/.test(value)) {
    const peak = peakHour(analytics);
    return peak === null
      ? { text: "時間帯別の入場データがまだありません。", evidence: ["時間帯集計: データ待機中"] }
      : {
          text: `今のところ入場が最も多いのは${peak.hour}時台で、${peak.count}人です。`,
          evidence: [`ピーク: ${peak.hour}時台`, `入場: ${peak.count}人`, `本日の来場者: ${analytics.totalVisitors}人`],
        };
  }

  if (/(平均滞在|滞在時間)/.test(value)) {
    return analytics.averageStayMinutes === null
      ? { text: "平均滞在時間は、退出済みデータがまだ十分でないため算出待ちです。", evidence: ["平均滞在: 算出待ち"] }
      : { text: `現在の平均滞在時間は約${analytics.averageStayMinutes}分です。`, evidence: [`平均滞在: ${analytics.averageStayMinutes}分`] };
  }

  if (value.includes("再入場")) {
    return {
      text: `これまでの再入場は${analytics.reEntryCount}回です。`,
      evidence: [`再入場: ${analytics.reEntryCount}回`, `本日の来場者: ${analytics.totalVisitors}人`],
    };
  }

  const recentMatch = value.match(/直近(\d{1,2})分/);
  if (recentMatch !== null || value.includes("入場ペース") || value.includes("退場ペース")) {
    const minutes = recentMatch === null ? 5 : Math.min(60, Math.max(1, Number(recentMatch[1])));
    const flow = recentFlow(activities, minutes);
    return {
      text: `直近${minutes}分は入場${flow.entries}人、退場${flow.exits}人です。1分あたりでは入場${(flow.entries / minutes).toFixed(1)}人、退場${(flow.exits / minutes).toFixed(1)}人です。`,
      evidence: [`直近${minutes}分 入場: ${flow.entries}人`, `直近${minutes}分 退場: ${flow.exits}人`],
    };
  }

  if (value.includes("チケット")) {
    return {
      text: `現在のチケット登録数は${analytics.ticketCount}枚です。本日の来場者は${analytics.totalVisitors}人です。`,
      evidence: [`チケット: ${analytics.ticketCount}枚`, `来場者: ${analytics.totalVisitors}人`],
    };
  }

  if (/(来場者|何人来た)/.test(value)) {
    return {
      text: `本日の来場者は${analytics.totalVisitors}人です。現在会場内には${analytics.currentInside}人います。`,
      evidence: [`累計来場者: ${analytics.totalVisitors}人`, `現在会場内: ${analytics.currentInside}人`, `再入場: ${analytics.reEntryCount}回`],
    };
  }

  const peak = peakHour(analytics);
  return {
    text: `現在は会場内${analytics.currentInside}人、本日の来場者${analytics.totalVisitors}人、再入場${analytics.reEntryCount}回です。${peak === null ? "" : `入場ピークは${peak.hour}時台の${peak.count}人です。`}`,
    evidence: [
      `来場者: ${analytics.totalVisitors}人`,
      `会場内: ${analytics.currentInside}人`,
      `部員入室中: ${analytics.currentMembersInside}人`,
      `記録済み活動: ${analytics.activityCount}件`,
    ],
  };
}

function commandLabel(command: ReceptionRemoteCommandType) {
  if (command === "pause-reception") return "受付を一時停止";
  if (command === "resume-reception") return "受付を再開";
  if (command === "restart-camera") return "カメラを再起動";
  if (command === "sync-pending") return "未送信データを再同期";
  if (command === "play-sound") return "確認音を鳴らす";
  return "受付アプリを再読み込み";
}

function newestDevicesByMode(devices: ReceptionDevice[]) {
  return (["entry", "exit"] as const)
    .map((mode) => devices.filter((device) => device.mode === mode).sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0])
    .filter((device): device is ReceptionDevice => device !== undefined);
}

function buildRemoteReply(question: string, devices: ReceptionDevice[]): CapabilityReply {
  const command = remoteCommandFromQuestion(question);
  if (command === null) return { text: "操作内容を特定できませんでした。", evidence: [] };
  const mode = explicitMode(question);
  const allRequested = /(両方|2台|全部)/.test(normalize(question));
  const candidates = newestDevicesByMode(devices);
  const targets = allRequested
    ? candidates
    : mode === null
      ? []
      : candidates.filter((device) => device.mode === mode);

  if (targets.length === 0) {
    return {
      text: mode === null && !allRequested
        ? "操作対象を特定できませんでした。「入口」「出口」または「両方」を含めてください。"
        : "対象の受付端末が現在見つかりません。",
      evidence: ["遠隔操作には受付端末の通信が必要です"],
    };
  }

  const label = commandLabel(command);
  const targetText = targets.length === 1 ? targets[0].deviceName : `${targets.length}台の受付端末`;
  const disruptive = command === "reload-app" || command === "pause-reception";
  return {
    text: `${targetText}への「${label}」を準備しました。実行ボタンを押すと送信します。`,
    evidence: targets.map((device) => `${device.mode === "entry" ? "入口" : "出口"}: ${device.deviceName}`),
    action: {
      id: `capability-remote-${Date.now()}`,
      label: targets.length === 1 ? `${label}を実行` : `両端末へ${label}`,
      kind: "remote",
      deviceIds: targets.map((device) => device.id),
      command,
      ...(disruptive ? { confirmText: `${targetText}へ「${label}」を実行しますか？` } : {}),
    },
  };
}

function buildNavigationReply(question: string): CapabilityReply {
  const target = destinationFromQuestion(question);
  if (target === null) return { text: "開く画面を特定できませんでした。", evidence: [] };
  const label = target.deviceMode === "entry"
    ? "入口端末の詳細"
    : target.deviceMode === "exit"
      ? "出口端末の詳細"
      : NAV_LABELS[target.destination];
  return {
    text: `${label}を開きます。`,
    evidence: [`画面移動: ${label}`],
    action: {
      id: `capability-nav-${Date.now()}`,
      label: `${label}を開く`,
      kind: "navigate",
      destination: target.destination,
      ...(target.deviceMode === undefined ? {} : { deviceMode: target.deviceMode }),
    },
  };
}

function buildReply(
  question: string,
  analytics: CapabilityAnalytics | null,
  activities: CapabilityActivity[],
  devices: ReceptionDevice[]
): CapabilityReply {
  if (isNavigationQuestion(question)) return buildNavigationReply(question);
  if (isDiagnosticQuestion(question)) {
    return {
      text: "通信・システム診断を開始できます。診断画面へ移動して再診断を実行します。",
      evidence: ["ブラウザ通信", "Firestore実通信", "リアルタイム監視", "受付バージョン"],
      action: { id: `capability-diagnose-${Date.now()}`, label: "診断を実行", kind: "diagnose" },
    };
  }
  if (isExpandedRemoteQuestion(question)) return buildRemoteReply(question, devices);
  return buildAnalysisReply(question, analytics, activities);
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function CapabilityMessages({
  messages,
  thinking,
  runningActionId,
  onAction,
}: {
  messages: CapabilityMessage[];
  thinking: boolean;
  runningActionId: string | null;
  onAction: (action: CapabilityAction) => void;
}) {
  return (
    <>
      {messages.map((message) => (
        <article key={message.id} className={`copilot-message ${message.role} capability-chat-message`}>
          <div className="copilot-avatar" aria-hidden="true">{message.role === "copilot" ? "AI" : "管"}</div>
          <div className="copilot-bubble">
            <small>{message.role === "copilot" ? "CONTROL CAPABILITY" : "OPERATOR"}</small>
            <p>{message.text}</p>
            {message.evidence.length > 0 && <ul>{message.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
            {message.action !== undefined && (
              <button
                type="button"
                className="capability-action-button"
                disabled={runningActionId !== null}
                onClick={() => onAction(message.action as CapabilityAction)}
              >
                {runningActionId === message.action.id ? "実行中…" : message.action.label}
              </button>
            )}
          </div>
        </article>
      ))}
      {thinking && (
        <article className="copilot-message copilot is-thinking capability-chat-message">
          <div className="copilot-avatar" aria-hidden="true">AI</div>
          <div className="copilot-bubble"><small>CONTROL CAPABILITY</small><p><span /><span /><span /></p></div>
        </article>
      )}
    </>
  );
}

function CapabilityPanel() {
  return (
    <section className="copilot-capability-panel">
      <div><small>EXPANDED CONTROL CAPABILITIES</small><h3>AI管制 能力拡張</h3></div>
      <div className="copilot-capability-grid">
        <article><span>析</span><div><strong>分析質問</strong><p>来場者・再入場・ピーク・時間帯比較</p></div></article>
        <article><span>移</span><div><strong>画面操作</strong><p>分析・端末・障害履歴・管制ラボへ移動</p></div></article>
        <article><span>診</span><div><strong>診断実行</strong><p>通信診断をAI管制から開始</p></div></article>
        <article><span>操</span><div><strong>端末操作</strong><p>両端末操作・確認音・アプリ再読込</p></div></article>
      </div>
    </section>
  );
}

export default function CopilotCapabilityBridge({ database }: { database: Firestore }) {
  const [currentEvent, setCurrentEvent] = useState<CurrentEvent | null>(null);
  const [analytics, setAnalytics] = useState<CapabilityAnalytics | null>(null);
  const [activities, setActivities] = useState<CapabilityActivity[]>([]);
  const [devices, setDevices] = useState<ReceptionDevice[]>([]);
  const [messageTarget, setMessageTarget] = useState<Element | null>(null);
  const [panelTarget, setPanelTarget] = useState<Element | null>(null);
  const [messages, setMessages] = useState<CapabilityMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const replyTimerRef = useRef<number | null>(null);
  const analyticsRef = useRef<CapabilityAnalytics | null>(null);
  const activitiesRef = useRef<CapabilityActivity[]>([]);
  const devicesRef = useRef<ReceptionDevice[]>([]);
  const currentEventRef = useRef<CurrentEvent | null>(null);

  useEffect(() => {
    let unsubscribeEvent: (() => void) | null = null;
    const unsubscribeCurrent = onSnapshot(doc(database, "system", "current-event"), (snapshot) => {
      const eventId = snapshot.exists() && typeof snapshot.data().eventId === "string"
        ? snapshot.data().eventId as string
        : "";
      unsubscribeEvent?.();
      unsubscribeEvent = null;
      setCurrentEvent(null);
      currentEventRef.current = null;
      if (eventId === "") return;

      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        if (!eventSnapshot.exists()) return;
        const data = eventSnapshot.data();
        const name = typeof data.name === "string" ? data.name.trim() : "イベント";
        const next = {
          id: eventId,
          name: name || "イベント",
          dataDocumentId: typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
            ? data.dataDocumentId
            : eventId,
        };
        currentEventRef.current = next;
        setCurrentEvent(next);
      });
    });
    return () => {
      unsubscribeCurrent();
      unsubscribeEvent?.();
    };
  }, [database]);

  useEffect(() => {
    analyticsRef.current = null;
    activitiesRef.current = [];
    devicesRef.current = [];
    setAnalytics(null);
    setActivities([]);
    setDevices([]);
    if (currentEvent === null) return undefined;

    const unsubscribeAnalytics = onSnapshot(
      doc(database, "event-data", currentEvent.dataDocumentId, "analytics", "summary"),
      (snapshot) => {
        const next = snapshot.exists() ? readAnalytics(snapshot.data()) : null;
        analyticsRef.current = next;
        setAnalytics(next);
      }
    );
    const unsubscribeActivity = onSnapshot(
      collection(database, "event-data", currentEvent.dataDocumentId, "activity"),
      (snapshot) => {
        const next = snapshot.docs
          .map((item) => readActivity(item.id, item.data()))
          .filter((item): item is CapabilityActivity => item !== null)
          .sort((a, b) => a.timestamp - b.timestamp);
        activitiesRef.current = next;
        setActivities(next);
      }
    );
    const unsubscribeDevices = onSnapshot(
      collection(database, "event-data", currentEvent.dataDocumentId, "reception-devices"),
      (snapshot) => {
        const next = snapshot.docs
          .map((item) => readDevice(item.id, item.data()))
          .filter((item): item is ReceptionDevice => item !== null);
        devicesRef.current = next;
        setDevices(next);
      }
    );

    return () => {
      unsubscribeAnalytics();
      unsubscribeActivity();
      unsubscribeDevices();
    };
  }, [currentEvent, database]);

  const capabilityCount = useMemo(() => {
    let count = 3;
    if (analytics !== null) count += 1;
    if (devices.length > 0) count += 1;
    if (activities.length > 0) count += 1;
    return count;
  }, [activities.length, analytics, devices.length]);

  const appendSystemMessage = useCallback((text: string, evidence: string[] = []) => {
    setMessages((current) => [
      ...current,
      { id: `capability-system-${Date.now()}-${current.length}`, role: "copilot", text, evidence },
    ]);
    window.setTimeout(() => {
      document.querySelector(".copilot-messages")?.scrollTo({ top: 999999, behavior: "smooth" });
    }, 0);
  }, []);

  const handleAction = useCallback((action: CapabilityAction) => {
    if (runningActionId !== null) return;
    if (action.kind === "navigate") {
      setRunningActionId(action.id);
      const opened = clickNavigation(action.destination);
      if (opened && action.destination === "devices" && action.deviceMode !== undefined) {
        openDeviceAfterNavigation(action.deviceMode);
      }
      setRunningActionId(null);
      return;
    }
    if (action.kind === "diagnose") {
      setRunningActionId(action.id);
      runDiagnosticsFromUI();
      setRunningActionId(null);
      return;
    }

    if (action.confirmText !== undefined && !window.confirm(action.confirmText)) return;
    const event = currentEventRef.current;
    if (event === null) {
      appendSystemMessage("現在のイベントが設定されていないため、遠隔操作できません。", ["操作中止"]);
      return;
    }

    setRunningActionId(action.id);
    void Promise.all(action.deviceIds.map((deviceId) =>
      sendReceptionRemoteCommand(event.dataDocumentId, deviceId, action.command)
    )).then(() => {
      appendSystemMessage(
        `${action.deviceIds.length}台へ「${commandLabel(action.command)}」を送信しました。`,
        ["受付端末からの実行結果は端末状態で確認できます"]
      );
    }).catch((error: unknown) => {
      console.error("AI管制から遠隔操作を送信できませんでした。", error);
      appendSystemMessage("遠隔操作を送信できませんでした。通信状態と端末接続を確認してください。", ["操作失敗"]);
    }).finally(() => {
      setRunningActionId(null);
    });
  }, [appendSystemMessage, runningActionId]);

  const askCapabilityAI = useCallback((question: string) => {
    const trimmed = question.trim();
    if (trimmed === "") return;
    const stamp = Date.now();
    setMessages((current) => [
      ...current,
      { id: `capability-operator-${stamp}-${current.length}`, role: "operator", text: trimmed, evidence: [] },
    ]);
    setThinking(true);
    const reply = buildReply(trimmed, analyticsRef.current, activitiesRef.current, devicesRef.current);
    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
    replyTimerRef.current = window.setTimeout(() => {
      setThinking(false);
      setMessages((current) => [
        ...current,
        {
          id: `capability-ai-${Date.now()}-${current.length}`,
          role: "copilot",
          text: reply.text,
          evidence: reply.evidence,
          ...(reply.action === undefined ? {} : { action: reply.action }),
        },
      ]);
      window.setTimeout(() => {
        document.querySelector(".copilot-messages")?.scrollTo({ top: 999999, behavior: "smooth" });
      }, 0);
    }, 360);
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
      askCapabilityAI(question);
    };
    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, [askCapabilityAI]);

  useEffect(() => {
    const updateTargets = () => {
      setMessageTarget((current) => {
        const next = document.querySelector(".copilot-messages");
        return current === next ? current : next;
      });
      setPanelTarget((current) => {
        const next = document.querySelector(".copilot-page");
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

  useEffect(() => () => {
    if (replyTimerRef.current !== null) window.clearTimeout(replyTimerRef.current);
  }, []);

  return (
    <>
      {panelTarget !== null && createPortal(
        <div className="copilot-capability-wrap" data-capability-count={capabilityCount}><CapabilityPanel /></div>,
        panelTarget
      )}
      {messageTarget !== null && createPortal(
        <CapabilityMessages
          messages={messages}
          thinking={thinking}
          runningActionId={runningActionId}
          onAction={handleAction}
        />,
        messageTarget
      )}
    </>
  );
}
