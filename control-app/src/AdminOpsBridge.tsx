import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

type CurrentEvent = {
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

type ActivitySample = {
  type: "ticket-entry" | "ticket-exit" | "member-entry" | "member-exit";
  timestamp: number;
  isReEntry: boolean;
};

type InventoryJudgement = {
  level: "normal" | "watch" | "warning" | "neutral";
  label: string;
  detail: string;
  recentFirstEntries: number;
  projectedNeed: number | null;
  remainingMinutes: number | null;
};

type AdminMessage = {
  id: string;
  role: "operator" | "copilot";
  text: string;
  evidence: string[];
};

const EMPTY_TICKETS: TicketSummary = {
  total: 0,
  unused: 0,
  inside: 0,
  used: 0,
  invalid: 0,
};

const EMPTY_MEMBERS: MemberSummary = {
  total: 0,
  notEntered: 0,
  inside: 0,
  exited: 0,
};

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\u3000。、！？!?「」『』（）()・]/g, "");
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function readEvent(id: string, data: DocumentData): CurrentEvent | null {
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

function summarizeTickets(docs: Array<{ data: () => DocumentData }>): TicketSummary {
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

function summarizeMembers(docs: Array<{ data: () => DocumentData }>): MemberSummary {
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

function readActivity(data: DocumentData): ActivitySample | null {
  if (
    data.type !== "ticket-entry" &&
    data.type !== "ticket-exit" &&
    data.type !== "member-entry" &&
    data.type !== "member-exit"
  ) return null;
  if (typeof data.timestamp !== "string") return null;
  const timestamp = new Date(data.timestamp).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return {
    type: data.type,
    timestamp,
    isReEntry: data.isReEntry === true,
  };
}

function eventTime(event: CurrentEvent, time: string) {
  const value = new Date(`${event.date}T${time}`).getTime();
  return Number.isFinite(value) ? value : 0;
}

function buildInventoryJudgement(
  event: CurrentEvent | null,
  tickets: TicketSummary,
  activities: ActivitySample[],
  now: number
): InventoryJudgement {
  if (event === null) {
    return {
      level: "neutral",
      label: "判断待ち",
      detail: "現在イベントが設定されていません。",
      recentFirstEntries: 0,
      projectedNeed: null,
      remainingMinutes: null,
    };
  }
  if (tickets.total === 0) {
    return {
      level: "warning",
      label: "チケット未登録",
      detail: "現在イベントにチケットが登録されていません。",
      recentFirstEntries: 0,
      projectedNeed: null,
      remainingMinutes: null,
    };
  }

  const startAt = eventTime(event, event.startTime);
  const endAt = eventTime(event, event.endTime);
  if (event.status === "ended" || (endAt > 0 && now >= endAt)) {
    return {
      level: "neutral",
      label: "イベント終了",
      detail: `未使用チケットは${tickets.unused}枚残っています。`,
      recentFirstEntries: 0,
      projectedNeed: 0,
      remainingMinutes: 0,
    };
  }
  if (startAt > 0 && now < startAt) {
    return {
      level: "neutral",
      label: "開始前",
      detail: `未使用${tickets.unused}枚を準備済みです。開始後の入場ペースから必要枚数を判断します。`,
      recentFirstEntries: 0,
      projectedNeed: null,
      remainingMinutes: Math.max(0, Math.ceil((endAt - now) / 60_000)),
    };
  }

  const cutoff = now - 10 * 60_000;
  const recentFirstEntries = activities.filter((activity) =>
    activity.type === "ticket-entry" &&
    !activity.isReEntry &&
    activity.timestamp > cutoff &&
    activity.timestamp <= now
  ).length;
  const remainingMinutes = endAt > 0 ? Math.max(0, Math.ceil((endAt - now) / 60_000)) : null;

  if (tickets.unused === 0) {
    return {
      level: "warning",
      label: "残りなし",
      detail: "未使用チケットが0枚です。新規来場者へ渡せるチケットがありません。",
      recentFirstEntries,
      projectedNeed: remainingMinutes === null ? null : Math.ceil((recentFirstEntries / 10) * remainingMinutes),
      remainingMinutes,
    };
  }

  if (recentFirstEntries < 3 || remainingMinutes === null) {
    return {
      level: "neutral",
      label: "判断材料少なめ",
      detail: `未使用${tickets.unused}枚。直近10分の新規入場が${recentFirstEntries}人なので、需要予測はまだ参考値です。`,
      recentFirstEntries,
      projectedNeed: remainingMinutes === null ? null : Math.ceil((recentFirstEntries / 10) * remainingMinutes),
      remainingMinutes,
    };
  }

  const projectedNeed = Math.ceil((recentFirstEntries / 10) * remainingMinutes);
  const bufferedNeed = Math.ceil(projectedNeed * 1.2);
  if (tickets.unused >= bufferedNeed) {
    return {
      level: "normal",
      label: "在庫に余裕",
      detail: `直近10分ペース基準では終了まで約${projectedNeed}枚の需要見込みです。未使用${tickets.unused}枚なので余裕があります。`,
      recentFirstEntries,
      projectedNeed,
      remainingMinutes,
    };
  }
  if (tickets.unused >= projectedNeed) {
    return {
      level: "watch",
      label: "足りる見込み・要観察",
      detail: `需要見込み約${projectedNeed}枚に対して未使用${tickets.unused}枚です。急な入場増加には注意してください。`,
      recentFirstEntries,
      projectedNeed,
      remainingMinutes,
    };
  }
  return {
    level: "warning",
    label: "不足見込み",
    detail: `直近10分ペース基準では約${projectedNeed}枚必要ですが、未使用は${tickets.unused}枚です。追加対応を検討してください。`,
    recentFirstEntries,
    projectedNeed,
    remainingMinutes,
  };
}

function statusLabel(status: CurrentEvent["status"]) {
  if (status === "active") return "開催中";
  if (status === "ended") return "終了";
  return "予定";
}

function shouldHandleQuestion(question: string) {
  const value = normalize(question);
  return [
    "チケット", "券", "未使用", "在庫", "残り何枚", "何枚残", "足りる", "不足", "追加必要",
    "部員", "メンバー", "何人登録", "未入室", "退出済み",
    "イベント何時", "何時まで", "開始時刻", "終了時刻", "開催時間", "イベント情報", "イベント状況", "定員",
  ].some((word) => value.includes(word));
}

function buildQuestionReply(
  question: string,
  event: CurrentEvent | null,
  tickets: TicketSummary,
  members: MemberSummary,
  judgement: InventoryJudgement
) {
  const value = normalize(question);

  if (/(足りる|不足|在庫大丈夫|追加必要|追加いる|何枚必要|余裕)/.test(value) && /(チケット|券|在庫)/.test(value)) {
    return {
      text: `${judgement.label}です。${judgement.detail}`,
      evidence: [
        `未使用: ${tickets.unused}枚`,
        `直近10分の新規入場: ${judgement.recentFirstEntries}人`,
        judgement.projectedNeed === null ? "終了まで需要: 算出待ち" : `終了まで需要見込み: 約${judgement.projectedNeed}枚`,
      ],
    };
  }
  if (/(未使用|残り|使える|在庫)/.test(value) && /(チケット|券)/.test(value)) {
    return {
      text: `現在使える未使用チケットは${tickets.unused}枚です。登録総数は${tickets.total}枚です。`,
      evidence: [`未使用: ${tickets.unused}枚`, `入場中: ${tickets.inside}枚`, `使用済み: ${tickets.used}枚`, `無効: ${tickets.invalid}枚`],
    };
  }
  if (/(入場中|中にある|使ってる)/.test(value) && /(チケット|券)/.test(value)) {
    return {
      text: `入場中のチケットは${tickets.inside}枚です。`,
      evidence: [`未使用: ${tickets.unused}枚`, `使用済み: ${tickets.used}枚`],
    };
  }
  if (/(使用済み|使った)/.test(value) && /(チケット|券)/.test(value)) {
    return { text: `使用済みチケットは${tickets.used}枚です。`, evidence: [`登録総数: ${tickets.total}枚`] };
  }
  if (/(無効)/.test(value) && /(チケット|券)/.test(value)) {
    return { text: `無効チケットは${tickets.invalid}枚です。`, evidence: [`登録総数: ${tickets.total}枚`] };
  }
  if (/(チケット|券)/.test(value)) {
    return {
      text: `チケットは合計${tickets.total}枚登録されています。未使用${tickets.unused}枚、入場中${tickets.inside}枚、使用済み${tickets.used}枚、無効${tickets.invalid}枚です。`,
      evidence: [`AI運用判断: ${judgement.label}`],
    };
  }

  if (/(部員|メンバー)/.test(value)) {
    if (/(今|現在).*(何人|中|入室)|入室中/.test(value)) {
      return {
        text: `現在入室中の部員は${members.inside}人です。イベント登録は${members.total}人です。`,
        evidence: [`未入室: ${members.notEntered}人`, `退出済み: ${members.exited}人`],
      };
    }
    return {
      text: `このイベントには部員が${members.total}人登録されています。現在入室中${members.inside}人、未入室${members.notEntered}人、退出済み${members.exited}人です。`,
      evidence: [],
    };
  }

  if (event === null) {
    return { text: "現在のイベントが設定されていません。", evidence: ["イベント情報: 未設定"] };
  }
  if (/(定員)/.test(value)) {
    return { text: `現在イベント「${event.name}」の定員は${event.capacity}人です。`, evidence: [`状態: ${statusLabel(event.status)}`] };
  }
  if (/(何時まで|終了時刻|終わる|終了何時)/.test(value)) {
    return { text: `「${event.name}」は${event.endTime}終了予定です。`, evidence: [`開始: ${event.startTime}`, `日付: ${event.date}`] };
  }
  if (/(開始時刻|何時から|始まる)/.test(value)) {
    return { text: `「${event.name}」は${event.startTime}開始です。`, evidence: [`終了: ${event.endTime}`, `日付: ${event.date}`] };
  }
  return {
    text: `現在イベントは「${event.name}」で、${event.date} ${event.startTime}〜${event.endTime}、状態は${statusLabel(event.status)}です。`,
    evidence: [`定員: ${event.capacity}人`, `チケット: ${tickets.total}枚`, `部員登録: ${members.total}人`],
  };
}

function AdminOpsPanel({
  event,
  tickets,
  members,
  judgement,
}: {
  event: CurrentEvent | null;
  tickets: TicketSummary;
  members: MemberSummary;
  judgement: InventoryJudgement;
}) {
  return (
    <article className="panel admin-ops-panel">
      <div className="admin-ops-heading">
        <div><small>ADMIN DATA LINK</small><h2>運用・管理情報</h2></div>
        <span className={`admin-stock-badge ${judgement.level}`}>{judgement.label}</span>
      </div>
      <div className="admin-ops-grid">
        <section>
          <small>TICKETS</small>
          <strong>{tickets.total}<em>枚</em></strong>
          <dl>
            <div><dt>未使用</dt><dd>{tickets.unused}</dd></div>
            <div><dt>入場中</dt><dd>{tickets.inside}</dd></div>
            <div><dt>使用済み</dt><dd>{tickets.used}</dd></div>
            <div><dt>無効</dt><dd>{tickets.invalid}</dd></div>
          </dl>
        </section>
        <section>
          <small>MEMBERS</small>
          <strong>{members.total}<em>人</em></strong>
          <dl>
            <div><dt>入室中</dt><dd>{members.inside}</dd></div>
            <div><dt>未入室</dt><dd>{members.notEntered}</dd></div>
            <div><dt>退出済み</dt><dd>{members.exited}</dd></div>
          </dl>
        </section>
        <section className="event-card">
          <small>EVENT</small>
          <strong>{event?.name ?? "未設定"}</strong>
          <p>{event === null ? "イベント情報待機中" : `${event.date} · ${event.startTime}〜${event.endTime}`}</p>
          <dl>
            <div><dt>状態</dt><dd>{event === null ? "—" : statusLabel(event.status)}</dd></div>
            <div><dt>定員</dt><dd>{event?.capacity ?? 0}人</dd></div>
          </dl>
        </section>
      </div>
      <div className={`admin-stock-intelligence ${judgement.level}`}>
        <div><small>AI TICKET STOCK CHECK</small><strong>{judgement.label}</strong></div>
        <p>{judgement.detail}</p>
      </div>
    </article>
  );
}

function CopilotAdminPanel({ judgement }: { judgement: InventoryJudgement }) {
  return (
    <section className="copilot-admin-panel">
      <div><small>ADMIN DATA LINK</small><h3>管理情報連携</h3></div>
      <p>チケット在庫・部員登録・イベント時刻をAI管制から確認できます。</p>
      <div className={`copilot-admin-status ${judgement.level}`}><span>チケット判断</span><strong>{judgement.label}</strong></div>
      <p className="copilot-admin-examples">例：「チケット残り何枚？」「チケット足りる？」「部員何人登録？」「イベント何時まで？」</p>
    </section>
  );
}

function AdminMessages({ messages, thinking }: { messages: AdminMessage[]; thinking: boolean }) {
  return (
    <>
      {messages.map((message) => (
        <article key={message.id} className={`copilot-message ${message.role} admin-ops-message`}>
          <div className="copilot-avatar" aria-hidden="true">{message.role === "copilot" ? "AI" : "管"}</div>
          <div className="copilot-bubble">
            <small>{message.role === "copilot" ? "ADMIN INTELLIGENCE" : "OPERATOR"}</small>
            <p>{message.text}</p>
            {message.evidence.length > 0 && <ul>{message.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
          </div>
        </article>
      ))}
      {thinking && (
        <article className="copilot-message copilot is-thinking admin-ops-message">
          <div className="copilot-avatar" aria-hidden="true">AI</div>
          <div className="copilot-bubble"><small>ADMIN INTELLIGENCE</small><p><span /><span /><span /></p></div>
        </article>
      )}
    </>
  );
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function AdminOpsBridge({ database }: { database: Firestore }) {
  const [currentEvent, setCurrentEvent] = useState<CurrentEvent | null>(null);
  const [tickets, setTickets] = useState<TicketSummary>(EMPTY_TICKETS);
  const [members, setMembers] = useState<MemberSummary>(EMPTY_MEMBERS);
  const [activities, setActivities] = useState<ActivitySample[]>([]);
  const [now, setNow] = useState(0);
  const [overviewTarget, setOverviewTarget] = useState<Element | null>(null);
  const [copilotTarget, setCopilotTarget] = useState<Element | null>(null);
  const [messageTarget, setMessageTarget] = useState<Element | null>(null);
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const eventRef = useRef<CurrentEvent | null>(null);
  const ticketsRef = useRef<TicketSummary>(EMPTY_TICKETS);
  const membersRef = useRef<MemberSummary>(EMPTY_MEMBERS);
  const activitiesRef = useRef<ActivitySample[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
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
        eventRef.current = null;
        ticketsRef.current = EMPTY_TICKETS;
        membersRef.current = EMPTY_MEMBERS;
        activitiesRef.current = [];
        setCurrentEvent(null);
        setTickets(EMPTY_TICKETS);
        setMembers(EMPTY_MEMBERS);
        setActivities([]);
        return;
      }
      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        const next = eventSnapshot.exists() ? readEvent(eventId, eventSnapshot.data()) : null;
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
    if (currentEvent === null) return undefined;
    const basePath = ["event-data", currentEvent.dataDocumentId] as const;
    const unsubscribeTickets = onSnapshot(collection(database, ...basePath, "tickets"), (snapshot) => {
      const next = summarizeTickets(snapshot.docs);
      ticketsRef.current = next;
      setTickets(next);
    });
    const unsubscribeMembers = onSnapshot(collection(database, ...basePath, "members"), (snapshot) => {
      const next = summarizeMembers(snapshot.docs);
      membersRef.current = next;
      setMembers(next);
    });
    const unsubscribeActivities = onSnapshot(collection(database, ...basePath, "activity"), (snapshot) => {
      const next = snapshot.docs
        .map((item) => readActivity(item.data()))
        .filter((item): item is ActivitySample => item !== null);
      activitiesRef.current = next;
      setActivities(next);
    });
    return () => {
      unsubscribeTickets();
      unsubscribeMembers();
      unsubscribeActivities();
    };
  }, [currentEvent, database]);

  const judgement = useMemo(
    () => buildInventoryJudgement(currentEvent, tickets, activities, now),
    [activities, currentEvent, now, tickets]
  );

  const askAdminAI = useCallback((question: string) => {
    const stamp = Date.now();
    setMessages((current) => [...current, { id: `admin-op-${stamp}-${current.length}`, role: "operator", text: question, evidence: [] }]);
    setThinking(true);
    const latestJudgement = buildInventoryJudgement(
      eventRef.current,
      ticketsRef.current,
      activitiesRef.current,
      Date.now()
    );
    const reply = buildQuestionReply(question, eventRef.current, ticketsRef.current, membersRef.current, latestJudgement);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setThinking(false);
      setMessages((current) => [...current, {
        id: `admin-ai-${Date.now()}-${current.length}`,
        role: "copilot",
        text: reply.text,
        evidence: reply.evidence,
      }]);
      window.setTimeout(() => document.querySelector(".copilot-messages")?.scrollTo({ top: 999999, behavior: "smooth" }), 0);
    }, 300);
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
      askAdminAI(question);
    };
    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, [askAdminAI]);

  useEffect(() => {
    const updateTargets = () => {
      setOverviewTarget((current) => {
        const next = document.getElementById("live-prediction-panel");
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
    const initial = window.setTimeout(updateTargets, 0);
    const observer = new MutationObserver(updateTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(initial);
      observer.disconnect();
    };
  }, []);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  return (
    <>
      {overviewTarget !== null && createPortal(
        <AdminOpsPanel event={currentEvent} tickets={tickets} members={members} judgement={judgement} />,
        overviewTarget
      )}
      {copilotTarget !== null && createPortal(<CopilotAdminPanel judgement={judgement} />, copilotTarget)}
      {messageTarget !== null && createPortal(<AdminMessages messages={messages} thinking={thinking} />, messageTarget)}
    </>
  );
}
