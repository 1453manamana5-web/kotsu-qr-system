import { useCallback, useEffect, useRef, useState } from "react";
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
  dataDocumentId: string;
};

type RemoteAction = {
  id: string;
  label: string;
  command: ReceptionRemoteCommandType;
  deviceIds: string[];
  targetText: string;
  confirmText?: string;
};

type RemoteMessage = {
  id: string;
  role: "operator" | "copilot";
  text: string;
  evidence: string[];
  action?: RemoteAction;
};

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\u3000。、！？!?「」『』（）()・]/g, "");
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

function explicitMode(question: string): ReceptionMode | null {
  const value = normalize(question);
  if (/(入口|入り口|入場側|入る方|入場端末|入場受付)/.test(value)) return "entry";
  if (/(出口|退場側|出る方|退場端末|退場受付)/.test(value)) return "exit";
  return null;
}

function requestsBoth(question: string) {
  return /(両方|2台|二台|両端末|両受付|全端末|全部の端末|両方とも|双方)/.test(normalize(question));
}

function inferCommand(question: string): ReceptionRemoteCommandType | null {
  const value = normalize(question);
  if (/(確認音|テスト音|チャイム|音|ピッ|サウンド)/.test(value) && /(鳴ら|再生|テスト|確認|出して)/.test(value)) {
    return "play-sound";
  }
  if (/(アプリ|受付アプリ|画面)/.test(value) && /(再読み込み|読み直|リロード|読み込み直|アプリ再起動)/.test(value)) {
    return "reload-app";
  }
  if (/カメラ/.test(value) && /(再起動|再始動|リセット|直して|復旧|立ち上げ直|戻して)/.test(value)) {
    return "restart-camera";
  }
  if (/(未送信|未同期|同期|溜まって|たまって|送れてない|詰まって)/.test(value) && /(再同期|同期して|送り直|再送|送って|流して|処理して)/.test(value)) {
    return "sync-pending";
  }
  if (/受付/.test(value) && /(一時停止|停止して|止めて|休止|ストップ)/.test(value)) {
    return "pause-reception";
  }
  if (/受付/.test(value) && /(再開|始めて|スタート|動かして|戻して)/.test(value)) {
    return "resume-reception";
  }
  return null;
}

function commandLabel(command: ReceptionRemoteCommandType) {
  if (command === "pause-reception") return "受付を一時停止";
  if (command === "resume-reception") return "受付を再開";
  if (command === "restart-camera") return "カメラを再起動";
  if (command === "sync-pending") return "未送信データを再同期";
  if (command === "play-sound") return "確認音を鳴らす";
  return "受付アプリを再読み込み";
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function newestDevicesByMode(devices: ReceptionDevice[]) {
  return (["entry", "exit"] as const)
    .map((mode) => devices.filter((device) => device.mode === mode).sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0])
    .filter((device): device is ReceptionDevice => device !== undefined);
}

function buildReply(question: string, devices: ReceptionDevice[]): { text: string; evidence: string[]; action?: RemoteAction } {
  const command = inferCommand(question);
  if (command === null) return { text: "操作内容を特定できませんでした。", evidence: [] };

  const mode = explicitMode(question);
  const both = requestsBoth(question);
  const candidates = newestDevicesByMode(devices);
  const targets = both
    ? candidates
    : mode === null
      ? []
      : candidates.filter((device) => device.mode === mode);

  if (targets.length === 0) {
    return {
      text: mode === null && !both
        ? "操作対象を特定できませんでした。入口・出口・両方のどれかを指定してください。"
        : "対象の受付端末が現在見つかりません。",
      evidence: ["遠隔操作には受付端末の通信が必要です"],
    };
  }

  const label = commandLabel(command);
  const targetText = targets.length === 1
    ? targets[0].deviceName
    : `${targets.length}台の受付端末`;
  const disruptive = command === "pause-reception" || command === "reload-app";

  return {
    text: `${targetText}への「${label}」を準備しました。実行ボタンを押すと送信します。`,
    evidence: targets.map((device) =>
      `${device.mode === "entry" ? "入口" : "出口"}: ${device.deviceName} / 同期待ち${device.pendingCount}件`
    ),
    action: {
      id: `remote-ai-${Date.now()}`,
      label: targets.length === 1 ? `${label}を実行` : `両端末へ${label}`,
      command,
      deviceIds: targets.map((device) => device.id),
      targetText,
      ...(disruptive ? { confirmText: `${targetText}へ「${label}」を実行しますか？` } : {}),
    },
  };
}

function RemoteMessages({
  messages,
  runningActionId,
  onAction,
}: {
  messages: RemoteMessage[];
  runningActionId: string | null;
  onAction: (action: RemoteAction) => void;
}) {
  return (
    <>
      {messages.map((message) => (
        <article key={message.id} className={`copilot-message ${message.role} capability-chat-message remote-command-message`}>
          <div className="copilot-avatar" aria-hidden="true">{message.role === "copilot" ? "AI" : "管"}</div>
          <div className="copilot-bubble">
            <small>{message.role === "copilot" ? "REMOTE CONTROL" : "OPERATOR"}</small>
            <p>{message.text}</p>
            {message.evidence.length > 0 && <ul>{message.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
            {message.action !== undefined && (
              <button
                type="button"
                className="capability-action-button"
                disabled={runningActionId !== null}
                onClick={() => onAction(message.action as RemoteAction)}
              >
                {runningActionId === message.action.id ? "実行中…" : message.action.label}
              </button>
            )}
          </div>
        </article>
      ))}
    </>
  );
}

export default function CopilotRemoteCommandBridge({ database }: { database: Firestore }) {
  const [currentEvent, setCurrentEvent] = useState<CurrentEvent | null>(null);
  const [messageTarget, setMessageTarget] = useState<Element | null>(null);
  const [messages, setMessages] = useState<RemoteMessage[]>([]);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const currentEventRef = useRef<CurrentEvent | null>(null);
  const devicesRef = useRef<ReceptionDevice[]>([]);

  useEffect(() => {
    let unsubscribeEvent: (() => void) | null = null;
    const unsubscribeCurrent = onSnapshot(doc(database, "system", "current-event"), (snapshot) => {
      const eventId = snapshot.exists() && typeof snapshot.data().eventId === "string"
        ? snapshot.data().eventId as string
        : "";
      unsubscribeEvent?.();
      unsubscribeEvent = null;
      currentEventRef.current = null;
      setCurrentEvent(null);
      if (eventId === "") return;

      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        if (!eventSnapshot.exists()) return;
        const data = eventSnapshot.data();
        const next = {
          id: eventId,
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
    devicesRef.current = [];
    if (currentEvent === null) return undefined;
    return onSnapshot(
      collection(database, "event-data", currentEvent.dataDocumentId, "reception-devices"),
      (snapshot) => {
        devicesRef.current = snapshot.docs
          .map((item) => readDevice(item.id, item.data()))
          .filter((device): device is ReceptionDevice => device !== null);
      }
    );
  }, [currentEvent, database]);

  const appendMessage = useCallback((message: Omit<RemoteMessage, "id">) => {
    setMessages((current) => [
      ...current,
      { ...message, id: `remote-message-${Date.now()}-${current.length}` },
    ]);
    window.setTimeout(() => {
      document.querySelector(".copilot-messages")?.scrollTo({ top: 999999, behavior: "smooth" });
    }, 0);
  }, []);

  const handleAction = useCallback((action: RemoteAction) => {
    if (runningActionId !== null) return;
    if (action.confirmText !== undefined && !window.confirm(action.confirmText)) return;
    const event = currentEventRef.current;
    if (event === null) {
      appendMessage({ role: "copilot", text: "現在のイベントが設定されていないため操作できません。", evidence: ["操作中止"] });
      return;
    }

    setRunningActionId(action.id);
    void Promise.all(action.deviceIds.map((deviceId) =>
      sendReceptionRemoteCommand(event.dataDocumentId, deviceId, action.command)
    )).then(() => {
      appendMessage({
        role: "copilot",
        text: `${action.targetText}へ「${commandLabel(action.command)}」を送信しました。`,
        evidence: ["受付端末からの実行結果は端末状態で確認できます"],
      });
    }).catch((error: unknown) => {
      console.error("AI管制から遠隔操作を送信できませんでした。", error);
      appendMessage({ role: "copilot", text: "遠隔操作を送信できませんでした。通信状態と端末接続を確認してください。", evidence: ["操作失敗"] });
    }).finally(() => {
      setRunningActionId(null);
    });
  }, [appendMessage, runningActionId]);

  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.classList.contains("copilot-input")) return;
      const input = form.querySelector<HTMLInputElement>('input[type="text"]');
      const question = input?.value.trim() ?? "";
      if (question === "" || inferCommand(question) === null) return;

      const mode = explicitMode(question);
      const both = requestsBoth(question);
      if (mode === null && !both) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (input !== null) setControlledInputValue(input, "");

      const reply = buildReply(question, devicesRef.current);
      appendMessage({ role: "operator", text: question, evidence: [] });
      appendMessage({ role: "copilot", text: reply.text, evidence: reply.evidence, ...(reply.action === undefined ? {} : { action: reply.action }) });
    };

    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, [appendMessage]);

  useEffect(() => {
    const updateTarget = () => {
      setMessageTarget((current) => {
        const next = document.querySelector(".copilot-messages");
        return current === next ? current : next;
      });
    };
    const first = window.setTimeout(updateTarget, 0);
    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(first);
      observer.disconnect();
    };
  }, []);

  if (messageTarget === null) return null;
  return createPortal(
    <RemoteMessages messages={messages} runningActionId={runningActionId} onAction={handleAction} />,
    messageTarget
  );
}
