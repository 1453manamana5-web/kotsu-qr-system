import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

type EventInfo = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "scheduled" | "active" | "ended";
  dataDocumentId: string;
  capacity: number;
};

type TicketSummary = {
  total: number;
  unused: number;
  inside: number;
  used: number;
  invalid: number;
};

type MemberSummary = {
  total: number;
  notEntered: number;
  inside: number;
  exited: number;
};

const EMPTY_TICKETS: TicketSummary = { total: 0, unused: 0, inside: 0, used: 0, invalid: 0 };
const EMPTY_MEMBERS: MemberSummary = { total: 0, notEntered: 0, inside: 0, exited: 0 };

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function readEvent(id: string, data: DocumentData): EventInfo | null {
  if (
    typeof data.name !== "string" ||
    typeof data.date !== "string" ||
    typeof data.startTime !== "string" ||
    typeof data.endTime !== "string"
  ) return null;

  return {
    id,
    name: data.name,
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    status: data.status === "active" || data.status === "ended" ? data.status : "scheduled",
    dataDocumentId:
      typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
        ? data.dataDocumentId
        : encodeURIComponent(data.name.trim() || "event-not-set"),
    capacity: readNumber(data.capacity) || 200,
  };
}

function summarizeTickets(docs: Array<{ data: () => DocumentData }>) {
  const summary = { ...EMPTY_TICKETS };
  for (const item of docs) {
    const status = item.data().status;
    if (status !== "未使用" && status !== "入場中" && status !== "使用済み" && status !== "無効") continue;
    summary.total += 1;
    if (status === "未使用") summary.unused += 1;
    if (status === "入場中") summary.inside += 1;
    if (status === "使用済み") summary.used += 1;
    if (status === "無効") summary.invalid += 1;
  }
  return summary;
}

function summarizeMembers(docs: Array<{ data: () => DocumentData }>) {
  const summary = { ...EMPTY_MEMBERS };
  for (const item of docs) {
    const status = item.data().status;
    if (status !== "未入室" && status !== "入室中" && status !== "退出済み") continue;
    summary.total += 1;
    if (status === "未入室") summary.notEntered += 1;
    if (status === "入室中") summary.inside += 1;
    if (status === "退出済み") summary.exited += 1;
  }
  return summary;
}

function eventStatus(event: EventInfo | null) {
  if (event === null) return { label: "未設定", tone: "idle" } as const;
  if (event.status === "active") return { label: "開催中", tone: "live" } as const;
  if (event.status === "ended") return { label: "終了", tone: "ended" } as const;
  return { label: "開始前", tone: "scheduled" } as const;
}

export default function SidebarOpsInfoBridge({ database }: { database: Firestore }) {
  const [sidebarTarget, setSidebarTarget] = useState<Element | null>(null);
  const [currentEvent, setCurrentEvent] = useState<EventInfo | null>(null);
  const [tickets, setTickets] = useState<TicketSummary>(EMPTY_TICKETS);
  const [members, setMembers] = useState<MemberSummary>(EMPTY_MEMBERS);

  useEffect(() => {
    const refreshTarget = () => {
      setSidebarTarget((current) => {
        const next = document.querySelector(".sidebar");
        return current === next ? current : next;
      });
    };
    refreshTarget();
    const observer = new MutationObserver(refreshTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
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
        setTickets(EMPTY_TICKETS);
        setMembers(EMPTY_MEMBERS);
        return;
      }

      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        setCurrentEvent(eventSnapshot.exists() ? readEvent(eventId, eventSnapshot.data()) : null);
      });
    });

    return () => {
      unsubscribeCurrent();
      unsubscribeEvent?.();
    };
  }, [database]);

  useEffect(() => {
    if (currentEvent === null) return undefined;
    const base = ["event-data", currentEvent.dataDocumentId] as const;
    const unsubscribeTickets = onSnapshot(collection(database, ...base, "tickets"), (snapshot) => {
      setTickets(summarizeTickets(snapshot.docs));
    });
    const unsubscribeMembers = onSnapshot(collection(database, ...base, "members"), (snapshot) => {
      setMembers(summarizeMembers(snapshot.docs));
    });
    return () => {
      unsubscribeTickets();
      unsubscribeMembers();
    };
  }, [currentEvent, database]);

  const status = eventStatus(currentEvent);
  const unusedRatio = useMemo(
    () => tickets.total > 0 ? Math.round((tickets.unused / tickets.total) * 100) : 0,
    [tickets.total, tickets.unused]
  );
  const ticketTone = tickets.total === 0
    ? "idle"
    : tickets.unused === 0
      ? "critical"
      : unusedRatio <= 10
        ? "warning"
        : "normal";

  if (sidebarTarget === null) return null;

  return createPortal(
    <section className="sidebar-ops-panel" aria-label="運用管理情報">
      <div className="sidebar-ops-heading">
        <div><small>LIVE OPERATIONS</small><strong>運用情報</strong></div>
        <span className={status.tone}><i aria-hidden="true" />{status.label}</span>
      </div>

      <div className="sidebar-event-card">
        <small>現在のイベント</small>
        <strong title={currentEvent?.name ?? "イベント未設定"}>{currentEvent?.name ?? "イベント未設定"}</strong>
        <p>{currentEvent === null ? "イベント管理で設定してください" : `${currentEvent.date} · ${currentEvent.startTime}〜${currentEvent.endTime}`}</p>
      </div>

      <div className="sidebar-ops-primary-grid">
        <article className={`ticket ${ticketTone}`}>
          <div><span aria-hidden="true">券</span><small>未使用チケット</small></div>
          <strong>{tickets.unused}<em>枚</em></strong>
          <div className="sidebar-stock-meter" aria-label={`未使用率${unusedRatio}%`}><i style={{ width: `${unusedRatio}%` }} /></div>
          <p>登録 {tickets.total}枚 · 残り {unusedRatio}%</p>
        </article>

        <article className="member">
          <div><span aria-hidden="true">部</span><small>入室中の部員</small></div>
          <strong>{members.inside}<em> / {members.total}人</em></strong>
          <p>未入室 {members.notEntered} · 退出済み {members.exited}</p>
        </article>
      </div>

      <div className="sidebar-ops-details">
        <div><span>入場中チケット</span><strong>{tickets.inside}</strong></div>
        <div><span>使用済み</span><strong>{tickets.used}</strong></div>
        <div><span>無効</span><strong className={tickets.invalid > 0 ? "attention" : ""}>{tickets.invalid}</strong></div>
        <div><span>会場定員</span><strong>{currentEvent?.capacity ?? 0}<small>人</small></strong></div>
      </div>

      <p className="sidebar-ops-note">ここは現在の運用に必要な数字だけを表示します。詳しい予測・分析は中央の画面で確認できます。</p>
    </section>,
    sidebarTarget
  );
}
