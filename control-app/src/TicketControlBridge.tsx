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
  updateTicketStatusInFirestore,
  type Ticket,
  type TicketStatus,
} from "../../src/ticketFirestore";
import { registerEventDataId } from "../../src/firestorePaths";

type CurrentEvent = {
  id: string;
  name: string;
  dataDocumentId: string;
};

type TicketAction = {
  id: string;
  qrNumber: string;
  targetStatus: TicketStatus;
};

type TicketMessage = {
  id: string;
  role: "operator" | "copilot";
  text: string;
  evidence: string[];
  action?: TicketAction;
};

const STATUS_ORDER: TicketStatus[] = ["未使用", "入場中", "使用済み", "無効"];

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[０-９]/g, (value) => String.fromCharCode(value.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000。、！？!?「」『』（）()・]/g, "");
}

function isTicketStatus(value: unknown): value is TicketStatus {
  return value === "未使用" || value === "入場中" || value === "使用済み" || value === "無効";
}

function readTicket(documentId: string, data: DocumentData): Ticket | null {
  if (
    typeof data.qrNumber !== "string" ||
    typeof data.authToken !== "string" ||
    typeof data.createdAt !== "string" ||
    !isTicketStatus(data.status)
  ) return null;

  return {
    id: typeof data.id === "string" ? data.id : documentId,
    qrNumber: data.qrNumber,
    authToken: data.authToken,
    status: data.status,
    createdAt: data.createdAt,
  };
}

function readCurrentEvent(id: string, data: DocumentData): CurrentEvent | null {
  if (typeof data.name !== "string") return null;
  return {
    id,
    name: data.name,
    dataDocumentId:
      typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
        ? data.dataDocumentId
        : encodeURIComponent(data.name.trim() || "event-not-set"),
  };
}

function ticketNumericPart(qrNumber: string) {
  const match = qrNumber.match(/^TK(\d+)$/i);
  return match === null ? null : Number(match[1]);
}

function extractTicketReference(question: string) {
  const value = normalize(question);
  const tk = value.match(/tk0*(\d{1,9})/i);
  if (tk !== null) return { exact: `TK${tk[1].padStart(6, "0")}`, numeric: Number(tk[1]) };

  const prefixed = value.match(/(?:チケット|ticket|qr|券)(?:番号|no|#)?0*(\d{1,9})/i);
  if (prefixed !== null) return { exact: null, numeric: Number(prefixed[1]) };

  const suffixed = value.match(/0*(\d{1,9})(?:番|番の)?(?:チケット|ticket|券)/i);
  if (suffixed !== null) return { exact: null, numeric: Number(suffixed[1]) };

  return null;
}

function findTicket(question: string, tickets: Ticket[]) {
  const reference = extractTicketReference(question);
  if (reference === null) return null;

  if (reference.exact !== null) {
    const exact = tickets.find((ticket) => ticket.qrNumber.toUpperCase() === reference.exact?.toUpperCase());
    if (exact !== undefined) return exact;
  }

  return tickets.find((ticket) => ticketNumericPart(ticket.qrNumber) === reference.numeric) ?? null;
}

function inferTargetStatus(question: string): TicketStatus | null {
  const value = normalize(question);
  if (/(未使用に|未使用へ|未使用状態|未使用戻|未使用扱)/.test(value)) return "未使用";
  if (/(入場中に|入場中へ|入場扱|入場状態)/.test(value)) return "入場中";
  if (/(使用済みに|使用済みへ|使用済み扱|退場済み|退場扱)/.test(value)) return "使用済み";
  if (/(無効に|無効化|無効へ|使えなく)/.test(value)) return "無効";
  return null;
}

function requestsStatusChange(question: string) {
  const value = normalize(question);
  return /(にして|へ変更|変更して|変えて|戻して|扱いに|無効化|使えなく)/.test(value) || inferTargetStatus(question) !== null;
}

function shouldHandleIndividualTicketQuestion(question: string) {
  if (extractTicketReference(question) === null) return false;
  const value = normalize(question);
  return /(チケット|ticket|qr|券|tk\d)/i.test(value) || /\d+(?:番|番の)(?:チケット|券)/.test(value);
}

function formatCreatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "記録なし";
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusDescription(status: TicketStatus) {
  if (status === "未使用") return "まだ入場に使われていない状態";
  if (status === "入場中") return "現在会場内にいる扱い";
  if (status === "使用済み") return "退出済み・再入場可能な状態";
  return "受付で使用できない状態";
}

function buildReply(question: string, tickets: Ticket[]) {
  const ticket = findTicket(question, tickets);
  const reference = extractTicketReference(question);

  if (ticket === null) {
    const display = reference?.exact ?? (reference === null ? "指定番号" : `番号${reference.numeric}`);
    return {
      text: `${display}に一致するチケットは現在イベントで見つかりませんでした。`,
      evidence: [`登録チケット: ${tickets.length}枚`],
    };
  }

  const targetStatus = inferTargetStatus(question);
  if (requestsStatusChange(question) && targetStatus === null) {
    return {
      text: `${ticket.qrNumber}は現在「${ticket.status}」です。変更先を「未使用・入場中・使用済み・無効」のどれかで指定してください。`,
      evidence: [statusDescription(ticket.status)],
    };
  }

  if (targetStatus !== null) {
    if (ticket.status === targetStatus) {
      return {
        text: `${ticket.qrNumber}はすでに「${targetStatus}」です。変更は必要ありません。`,
        evidence: [`現在状態: ${ticket.status}`],
      };
    }
    return {
      text: `${ticket.qrNumber}を「${ticket.status}」から「${targetStatus}」へ変更する操作を準備しました。`,
      evidence: [
        `現在: ${ticket.status}`,
        `変更後: ${targetStatus}`,
        "状態変更は入退場集計へ反映される場合があります",
      ],
      action: {
        id: `ticket-action-${Date.now()}`,
        qrNumber: ticket.qrNumber,
        targetStatus,
      } satisfies TicketAction,
    };
  }

  return {
    text: `${ticket.qrNumber}の現在状態は「${ticket.status}」です。`,
    evidence: [statusDescription(ticket.status), `発行記録: ${formatCreatedAt(ticket.createdAt)}`],
  };
}

function TicketMessages({
  messages,
  runningActionId,
  onAction,
}: {
  messages: TicketMessage[];
  runningActionId: string | null;
  onAction: (action: TicketAction) => void;
}) {
  return (
    <>
      {messages.map((message) => (
        <article key={message.id} className={`copilot-message ${message.role} ticket-control-message`}>
          <div className="copilot-avatar" aria-hidden="true">{message.role === "copilot" ? "AI" : "管"}</div>
          <div className="copilot-bubble">
            <small>{message.role === "copilot" ? "TICKET CONTROL" : "OPERATOR"}</small>
            <p>{message.text}</p>
            {message.evidence.length > 0 && <ul>{message.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
            {message.action !== undefined && (
              <button
                type="button"
                className="ticket-ai-action-button"
                disabled={runningActionId !== null}
                onClick={() => onAction(message.action as TicketAction)}
              >
                {runningActionId === message.action.id ? "変更中…" : `${message.action.targetStatus}へ変更`}
              </button>
            )}
          </div>
        </article>
      ))}
    </>
  );
}

function TicketControlPanel({
  tickets,
  onChangeStatus,
  changing,
}: {
  tickets: Ticket[];
  onChangeStatus: (ticket: Ticket, status: TicketStatus) => void;
  changing: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selectedQrNumber, setSelectedQrNumber] = useState<string | null>(null);

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.qrNumber === selectedQrNumber) ?? null,
    [selectedQrNumber, tickets]
  );

  const findFromInput = () => {
    const ticket = findTicket(`チケット${query}`, tickets);
    setSelectedQrNumber(ticket?.qrNumber ?? "__NOT_FOUND__");
  };

  const notFound = selectedQrNumber === "__NOT_FOUND__";

  return (
    <section className="ticket-control-panel">
      <div className="ticket-control-heading">
        <div><small>INDIVIDUAL TICKET</small><h3>個別チケット照会・状態変更</h3></div>
        <span>{tickets.length}枚登録</span>
      </div>
      <div className="ticket-control-search">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              findFromInput();
            }
          }}
          placeholder="例: 123 / TK000123"
          inputMode="text"
          aria-label="チケット番号"
        />
        <button type="button" onClick={findFromInput}>照会</button>
      </div>
      {notFound && <p className="ticket-control-empty">該当するチケットが見つかりません。</p>}
      {selectedTicket !== null && (
        <div className="ticket-control-result">
          <div className="ticket-control-current">
            <div><small>QR NUMBER</small><strong>{selectedTicket.qrNumber}</strong></div>
            <span className={`ticket-status-chip status-${STATUS_ORDER.indexOf(selectedTicket.status)}`}>{selectedTicket.status}</span>
          </div>
          <p>{statusDescription(selectedTicket.status)}</p>
          <div className="ticket-status-actions">
            {STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                disabled={changing || selectedTicket.status === status}
                onClick={() => onChangeStatus(selectedTicket, status)}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="ticket-control-note">AI管制でも「チケット123の状態は？」「TK000123を未使用に戻して」のように操作できます。</p>
    </section>
  );
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function TicketControlBridge({ database }: { database: Firestore }) {
  const [currentEvent, setCurrentEvent] = useState<CurrentEvent | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [panelTarget, setPanelTarget] = useState<Element | null>(null);
  const [messageTarget, setMessageTarget] = useState<Element | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const ticketsRef = useRef<Ticket[]>([]);
  const eventRef = useRef<CurrentEvent | null>(null);

  useEffect(() => {
    let unsubscribeEvent: (() => void) | null = null;
    const unsubscribeCurrent = onSnapshot(doc(database, "system", "current-event"), (snapshot) => {
      const eventId = snapshot.exists() && typeof snapshot.data().eventId === "string"
        ? snapshot.data().eventId as string
        : "";
      unsubscribeEvent?.();
      unsubscribeEvent = null;
      eventRef.current = null;
      setCurrentEvent(null);
      if (eventId === "") return;

      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        const next = eventSnapshot.exists() ? readCurrentEvent(eventId, eventSnapshot.data()) : null;
        eventRef.current = next;
        setCurrentEvent(next);
        if (next !== null) registerEventDataId(next.name, next.dataDocumentId);
      });
    });

    return () => {
      unsubscribeCurrent();
      unsubscribeEvent?.();
    };
  }, [database]);

  useEffect(() => {
    ticketsRef.current = [];
    setTickets([]);
    if (currentEvent === null) return undefined;
    return onSnapshot(
      collection(database, "event-data", currentEvent.dataDocumentId, "tickets"),
      (snapshot) => {
        const next = snapshot.docs
          .map((item) => readTicket(item.id, item.data()))
          .filter((ticket): ticket is Ticket => ticket !== null)
          .sort((a, b) => a.qrNumber.localeCompare(b.qrNumber, "ja-JP", { numeric: true }));
        ticketsRef.current = next;
        setTickets(next);
      }
    );
  }, [currentEvent, database]);

  const appendMessage = useCallback((message: Omit<TicketMessage, "id">) => {
    setMessages((current) => [
      ...current,
      { ...message, id: `ticket-message-${Date.now()}-${current.length}` },
    ]);
    window.setTimeout(() => {
      document.querySelector(".copilot-messages")?.scrollTo({ top: 999999, behavior: "smooth" });
    }, 0);
  }, []);

  const changeTicketStatus = useCallback(async (
    ticket: Ticket,
    targetStatus: TicketStatus,
    actionId?: string
  ) => {
    const event = eventRef.current;
    if (event === null) {
      appendMessage({ role: "copilot", text: "現在のイベントが設定されていないため変更できません。", evidence: [] });
      return;
    }

    const latest = ticketsRef.current.find((item) => item.qrNumber === ticket.qrNumber);
    if (latest === undefined) {
      appendMessage({ role: "copilot", text: `${ticket.qrNumber}が見つからなくなったため操作を中止しました。`, evidence: ["最新データを再確認してください"] });
      return;
    }
    if (latest.status === targetStatus) {
      appendMessage({ role: "copilot", text: `${latest.qrNumber}はすでに「${targetStatus}」です。`, evidence: [] });
      return;
    }

    const confirmed = window.confirm(
      `${latest.qrNumber}の状態を変更します。\n\n${latest.status} → ${targetStatus}\n\n入退場人数・分析へ反映される場合があります。実行しますか？`
    );
    if (!confirmed) return;

    const runningId = actionId ?? `panel-${latest.qrNumber}-${targetStatus}`;
    setRunningActionId(runningId);
    try {
      registerEventDataId(event.name, event.dataDocumentId);
      await updateTicketStatusInFirestore(event.name, latest, targetStatus);
      appendMessage({
        role: "copilot",
        text: `${latest.qrNumber}を「${targetStatus}」へ変更しました。`,
        evidence: [`変更前: ${latest.status}`, `変更後: ${targetStatus}`, "集計データも更新対象です"],
      });
    } catch (error) {
      console.error("AI管制からチケット状態を変更できませんでした。", error);
      appendMessage({
        role: "copilot",
        text: `${latest.qrNumber}の状態を変更できませんでした。`,
        evidence: ["通信状態または権限を確認してください"],
      });
    } finally {
      setRunningActionId(null);
    }
  }, [appendMessage]);

  const handleAction = useCallback((action: TicketAction) => {
    if (runningActionId !== null) return;
    const ticket = ticketsRef.current.find((item) => item.qrNumber === action.qrNumber);
    if (ticket === undefined) {
      appendMessage({ role: "copilot", text: `${action.qrNumber}が見つからないため操作できません。`, evidence: [] });
      return;
    }
    void changeTicketStatus(ticket, action.targetStatus, action.id);
  }, [appendMessage, changeTicketStatus, runningActionId]);

  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.classList.contains("copilot-input")) return;
      const input = form.querySelector<HTMLInputElement>('input[type="text"]');
      const question = input?.value.trim() ?? "";
      if (question === "" || !shouldHandleIndividualTicketQuestion(question)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (input !== null) setControlledInputValue(input, "");

      const reply = buildReply(question, ticketsRef.current);
      appendMessage({ role: "operator", text: question, evidence: [] });
      appendMessage({
        role: "copilot",
        text: reply.text,
        evidence: reply.evidence,
        ...(reply.action === undefined ? {} : { action: reply.action }),
      });
    };

    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, [appendMessage]);

  useEffect(() => {
    const updateTargets = () => {
      setPanelTarget((current) => {
        const next = document.querySelector(".admin-ops-panel");
        return current === next ? current : next;
      });
      setMessageTarget((current) => {
        const next = document.querySelector(".copilot-messages");
        return current === next ? current : next;
      });
    };
    const initial = window.setTimeout(updateTargets, 0);
    const observer = new MutationObserver(updateTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(initial);
      observer.disconnect();
    };
  }, []);

  return (
    <>
      {panelTarget !== null && createPortal(
        <TicketControlPanel
          tickets={tickets}
          changing={runningActionId !== null}
          onChangeStatus={(ticket, status) => void changeTicketStatus(ticket, status)}
        />,
        panelTarget
      )}
      {messageTarget !== null && createPortal(
        <TicketMessages messages={messages} runningActionId={runningActionId} onAction={handleAction} />,
        messageTarget
      )}
    </>
  );
}
