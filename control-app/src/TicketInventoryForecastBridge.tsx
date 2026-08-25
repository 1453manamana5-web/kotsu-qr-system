import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
};

type TicketSummary = {
  total: number;
  unused: number;
};

type ActivitySample = {
  type: "ticket-entry" | "ticket-exit" | "member-entry" | "member-exit";
  timestamp: number;
  isReEntry: boolean;
};

type ForecastPoint = {
  minutes: number;
  expected: number;
  low: number;
  high: number;
  cappedAtEnd: boolean;
};

type ForecastState = {
  level: "normal" | "watch" | "warning" | "neutral";
  label: string;
  detail: string;
  ratePerMinute: number;
  pacePer10: number;
  recent5: number;
  previous5: number;
  older10: number;
  trendLabel: string;
  trendPercent: number | null;
  quality: number;
  remainingMinutes: number | null;
  endForecast: ForecastPoint | null;
  runoutMinutes: number | null;
  lowRate: number;
  highRate: number;
};

type Message = {
  id: string;
  role: "operator" | "copilot";
  text: string;
  evidence: string[];
};

const EMPTY_TICKETS: TicketSummary = { total: 0, unused: 0 };

function normalize(text: string) {
  return text
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\s\u3000。、！？!?「」『』（）()・]/g, "");
}

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
  };
}

function summarizeTickets(docs: Array<{ data: () => DocumentData }>): TicketSummary {
  let total = 0;
  let unused = 0;
  for (const item of docs) {
    const status = item.data().status;
    if (status !== "未使用" && status !== "入場中" && status !== "使用済み" && status !== "無効") continue;
    total += 1;
    if (status === "未使用") unused += 1;
  }
  return { total, unused };
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
  return { type: data.type, timestamp, isReEntry: data.isReEntry === true };
}

function eventTime(event: EventInfo, time: string) {
  const value = new Date(`${event.date}T${time}`).getTime();
  return Number.isFinite(value) ? value : 0;
}

function countFirstEntries(activities: ActivitySample[], start: number, end: number) {
  return activities.filter((activity) =>
    activity.type === "ticket-entry" &&
    !activity.isReEntry &&
    activity.timestamp > start &&
    activity.timestamp <= end
  ).length;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildForecastState(
  event: EventInfo | null,
  tickets: TicketSummary,
  activities: ActivitySample[],
  now: number
): ForecastState {
  const neutral: ForecastState = {
    level: "neutral",
    label: "判断待ち",
    detail: "イベント開始後の新規入場データから予測します。",
    ratePerMinute: 0,
    pacePer10: 0,
    recent5: 0,
    previous5: 0,
    older10: 0,
    trendLabel: "データ待ち",
    trendPercent: null,
    quality: 0,
    remainingMinutes: null,
    endForecast: null,
    runoutMinutes: null,
    lowRate: 0,
    highRate: 0,
  };
  if (event === null) return neutral;

  const startAt = eventTime(event, event.startTime);
  const endAt = eventTime(event, event.endTime);
  const remainingMinutes = endAt > 0 ? Math.max(0, Math.ceil((endAt - now) / 60_000)) : null;
  if (tickets.total === 0) {
    return { ...neutral, level: "warning", label: "チケット未登録", detail: "現在イベントにチケットが登録されていません。", remainingMinutes };
  }
  if (event.status === "ended" || (endAt > 0 && now >= endAt)) {
    return {
      ...neutral,
      label: "イベント終了",
      detail: `未使用チケットは${tickets.unused}枚残りました。`,
      remainingMinutes: 0,
      endForecast: { minutes: 0, expected: tickets.unused, low: tickets.unused, high: tickets.unused, cappedAtEnd: true },
      quality: 100,
    };
  }
  if (startAt > 0 && now < startAt) {
    return { ...neutral, label: "開始前", detail: `未使用${tickets.unused}枚を準備済みです。`, remainingMinutes };
  }

  const elapsedMinutes = startAt > 0 ? Math.max(0.25, (now - startAt) / 60_000) : 20;
  const recentWindow = Math.min(5, elapsedMinutes);
  const previousWindow = clamp(elapsedMinutes - 5, 0, 5);
  const olderWindow = clamp(elapsedMinutes - 10, 0, 10);
  const recent5 = countFirstEntries(activities, now - 5 * 60_000, now);
  const previous5 = countFirstEntries(activities, now - 10 * 60_000, now - 5 * 60_000);
  const older10 = countFirstEntries(activities, now - 20 * 60_000, now - 10 * 60_000);

  const segments = [
    { rate: recent5 / Math.max(0.25, recentWindow), weight: 0.55, available: recentWindow > 0 },
    { rate: previous5 / Math.max(0.25, previousWindow), weight: 0.30, available: previousWindow > 0 },
    { rate: older10 / Math.max(0.25, olderWindow), weight: 0.15, available: olderWindow > 0 },
  ].filter((item) => item.available);
  const weightTotal = segments.reduce((total, item) => total + item.weight, 0) || 1;
  const ratePerMinute = segments.reduce((total, item) => total + item.rate * item.weight, 0) / weightTotal;
  const pacePer10 = ratePerMinute * 10;

  const recentRate = recent5 / Math.max(0.25, recentWindow);
  const previousRate = previousWindow > 0 ? previous5 / previousWindow : 0;
  let trendPercent: number | null = null;
  let trendLabel = "横ばい";
  if (previousWindow < 1) {
    trendLabel = "比較データ待ち";
  } else if (previousRate <= 0 && recentRate > 0) {
    trendLabel = "増加中";
  } else if (previousRate > 0) {
    trendPercent = Math.round(((recentRate - previousRate) / previousRate) * 100);
    if (trendPercent >= 50) trendLabel = "急増";
    else if (trendPercent >= 20) trendLabel = "増加";
    else if (trendPercent <= -50) trendLabel = "急減";
    else if (trendPercent <= -20) trendLabel = "減少";
  }

  const observedMinutes = Math.min(20, elapsedMinutes);
  const observedEntries = recent5 + previous5 + older10;
  const quality = Math.round(clamp(
    18 + Math.min(47, observedEntries * 4) + Math.min(35, observedMinutes / 20 * 35),
    15,
    100
  ));
  const uncertainty = quality >= 80 ? 0.18 : quality >= 60 ? 0.28 : quality >= 40 ? 0.40 : 0.55;
  const positiveTrendBoost = trendPercent !== null && trendPercent >= 20 ? 0.12 : 0;
  const lowRate = Math.max(0, ratePerMinute * (1 - uncertainty));
  const highRate = ratePerMinute * (1 + uncertainty + positiveTrendBoost);
  const runoutMinutes = ratePerMinute > 0.01 ? tickets.unused / ratePerMinute : null;

  const forecastFor = (requestedMinutes: number): ForecastPoint => {
    const effectiveMinutes = remainingMinutes === null ? requestedMinutes : Math.min(requestedMinutes, remainingMinutes);
    return {
      minutes: effectiveMinutes,
      expected: Math.max(0, Math.round(tickets.unused - ratePerMinute * effectiveMinutes)),
      low: Math.max(0, Math.floor(tickets.unused - highRate * effectiveMinutes)),
      high: Math.max(0, Math.ceil(tickets.unused - lowRate * effectiveMinutes)),
      cappedAtEnd: remainingMinutes !== null && requestedMinutes >= remainingMinutes,
    };
  };

  const endForecast = remainingMinutes === null ? null : forecastFor(remainingMinutes);
  let level: ForecastState["level"] = "neutral";
  let label = "判断材料少なめ";
  let detail = `未使用${tickets.unused}枚。予測データ品質${quality}/100です。`;

  if (tickets.unused === 0) {
    level = "warning";
    label = "残りなし";
    detail = "未使用チケットが0枚です。";
  } else if (observedEntries >= 3 && endForecast !== null) {
    if (endForecast.expected <= 0) {
      level = "warning";
      label = "不足見込み";
      detail = `現在ペースでは終了前に在庫が尽きる見込みです。終了時予測は${endForecast.expected}枚、レンジ${endForecast.low}〜${endForecast.high}枚です。`;
    } else if (endForecast.low <= 0) {
      level = "watch";
      label = "足りる見込み・要観察";
      detail = `中心予測では足りますが、入場増加ケースでは不足する可能性があります。終了時${endForecast.expected}枚（${endForecast.low}〜${endForecast.high}枚）予測です。`;
    } else {
      level = "normal";
      label = "在庫に余裕";
      detail = `終了時は${endForecast.expected}枚（${endForecast.low}〜${endForecast.high}枚）残る予測です。`;
    }
  }

  return {
    level,
    label,
    detail,
    ratePerMinute,
    pacePer10,
    recent5,
    previous5,
    older10,
    trendLabel,
    trendPercent,
    quality,
    remainingMinutes,
    endForecast,
    runoutMinutes,
    lowRate,
    highRate,
  };
}

function forecastAt(tickets: TicketSummary, state: ForecastState, requestedMinutes: number): ForecastPoint {
  const effectiveMinutes = state.remainingMinutes === null
    ? requestedMinutes
    : Math.min(requestedMinutes, state.remainingMinutes);
  return {
    minutes: effectiveMinutes,
    expected: Math.max(0, Math.round(tickets.unused - state.ratePerMinute * effectiveMinutes)),
    low: Math.max(0, Math.floor(tickets.unused - state.highRate * effectiveMinutes)),
    high: Math.max(0, Math.ceil(tickets.unused - state.lowRate * effectiveMinutes)),
    cappedAtEnd: state.remainingMinutes !== null && requestedMinutes >= state.remainingMinutes,
  };
}

function shouldHandleQuestion(question: string) {
  const value = normalize(question);
  const ticketContext = /(チケット|券|在庫|未使用|残数|何枚残|枚残|売り切|尽き|もつ|持つ)/.test(value);
  const forecastContext = /(予測|見込み|ペース|あと|後|終了時|終わる頃|何分|何時|足りる|大丈夫|余裕|不足|減り|なくなる|無くなる)/.test(value);
  return ticketContext && forecastContext;
}

function extractRequestedMinutes(value: string) {
  const hourHalf = value.match(/(\d{1,2})時間半(?:後)?/);
  if (hourHalf !== null) return Number(hourHalf[1]) * 60 + 30;
  const hours = value.match(/(\d{1,2})時間(?:後)?/);
  if (hours !== null) return Number(hours[1]) * 60;
  const minutes = value.match(/(\d{1,3})分(?:後)?/);
  if (minutes !== null) return Number(minutes[1]);
  if (value.includes("半時間")) return 30;
  return null;
}

function formatRunoutTime(minutes: number) {
  const date = new Date(Date.now() + minutes * 60_000);
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function buildReply(question: string, tickets: TicketSummary, state: ForecastState) {
  const value = normalize(question);
  const requestedMinutes = extractRequestedMinutes(value);

  if (requestedMinutes !== null && /(後|残|予測|何枚)/.test(value)) {
    const forecast = forecastAt(tickets, state, requestedMinutes);
    const label = forecast.cappedAtEnd && state.remainingMinutes !== null && requestedMinutes > state.remainingMinutes
      ? `イベント終了時（約${forecast.minutes}分後）`
      : `${requestedMinutes}分後`;
    return {
      text: `${label}の未使用チケットは${forecast.expected}枚、予測レンジは${forecast.low}〜${forecast.high}枚です。`,
      evidence: [
        `現在: ${tickets.unused}枚`,
        `消費ペース: 約${state.pacePer10.toFixed(1)}枚/10分`,
        `トレンド: ${state.trendLabel}`,
        `予測データ品質: ${state.quality}/100`,
      ],
    };
  }

  if (/(終了時|終わる頃|最後|閉場時|終了まで)/.test(value) && /(残|何枚|予測|在庫)/.test(value)) {
    if (state.endForecast === null) {
      return { text: "終了時刻を使った在庫予測をまだ計算できません。", evidence: [`現在: ${tickets.unused}枚`] };
    }
    return {
      text: `終了時の未使用チケットは${state.endForecast.expected}枚、予測レンジは${state.endForecast.low}〜${state.endForecast.high}枚です。`,
      evidence: [
        `現在: ${tickets.unused}枚`,
        `終了まで: 約${state.remainingMinutes ?? 0}分`,
        `消費ペース: 約${state.pacePer10.toFixed(1)}枚/10分`,
        `トレンド: ${state.trendLabel}`,
      ],
    };
  }

  if (/(あと何分|何分もつ|何分持つ|いつなくなる|いつ無くなる|何時.*尽|売り切)/.test(value)) {
    if (tickets.unused <= 0) {
      return { text: "未使用チケットはすでに0枚です。", evidence: ["在庫: 0枚"] };
    }
    if (state.runoutMinutes === null || state.ratePerMinute <= 0.01) {
      return { text: "直近では新規チケット消費がほぼないため、在庫が尽きる時刻は算出できません。", evidence: [`現在: ${tickets.unused}枚`] };
    }
    if (state.remainingMinutes !== null && state.runoutMinutes > state.remainingMinutes) {
      return {
        text: `現在ペースなら終了時刻まで在庫は持つ見込みです。在庫が尽きる単純計算は約${Math.round(state.runoutMinutes)}分後ですが、イベント終了後になります。`,
        evidence: [`終了まで: 約${state.remainingMinutes}分`, `終了時予測: ${state.endForecast?.expected ?? "—"}枚`],
      };
    }
    return {
      text: `現在ペースでは約${Math.max(1, Math.round(state.runoutMinutes))}分後、${formatRunoutTime(state.runoutMinutes)}ごろに在庫が尽きる計算です。`,
      evidence: [`現在: ${tickets.unused}枚`, `消費ペース: 約${state.pacePer10.toFixed(1)}枚/10分`, `トレンド: ${state.trendLabel}`],
    };
  }

  if (/(ペース|減り方|消費速度|減る速さ|速くな|遅くな)/.test(value)) {
    const trendText = state.trendPercent === null ? state.trendLabel : `${state.trendLabel}（前5分比 ${state.trendPercent >= 0 ? "+" : ""}${state.trendPercent}%）`;
    return {
      text: `現在の新規チケット消費は約${state.pacePer10.toFixed(1)}枚/10分で、傾向は${trendText}です。`,
      evidence: [`直近5分: ${state.recent5}枚`, `その前5分: ${state.previous5}枚`, `10〜20分前: ${state.older10}枚`],
    };
  }

  return {
    text: `${state.label}です。${state.detail}`,
    evidence: [
      `現在未使用: ${tickets.unused}枚`,
      `消費ペース: 約${state.pacePer10.toFixed(1)}枚/10分`,
      `トレンド: ${state.trendLabel}`,
      state.endForecast === null ? "終了時予測: 算出待ち" : `終了時予測: ${state.endForecast.expected}枚（${state.endForecast.low}〜${state.endForecast.high}枚）`,
      `予測データ品質: ${state.quality}/100`,
    ],
  };
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function ForecastPanel({ tickets, state }: { tickets: TicketSummary; state: ForecastState }) {
  const forecast15 = forecastAt(tickets, state, 15);
  const forecast30 = forecastAt(tickets, state, 30);
  return (
    <section className={`ticket-forecast-panel ${state.level}`}>
      <div className="ticket-forecast-heading">
        <div><small>TICKET INVENTORY FORECAST</small><h3>チケット在庫予測</h3></div>
        <span>{state.label}</span>
      </div>
      <div className="ticket-forecast-metrics">
        <article><small>NOW</small><strong>{tickets.unused}<em>枚</em></strong><p>現在の未使用</p></article>
        <article><small>PACE</small><strong>{state.pacePer10.toFixed(1)}<em>枚/10分</em></strong><p>{state.trendLabel}</p></article>
        <article><small>+15 MIN</small><strong>{forecast15.expected}<em>枚</em></strong><p>{forecast15.low}〜{forecast15.high}枚</p></article>
        <article><small>+30 MIN</small><strong>{forecast30.expected}<em>枚</em></strong><p>{forecast30.low}〜{forecast30.high}枚</p></article>
        <article><small>EVENT END</small><strong>{state.endForecast?.expected ?? "—"}<em>{state.endForecast === null ? "" : "枚"}</em></strong><p>{state.endForecast === null ? "算出待ち" : `${state.endForecast.low}〜${state.endForecast.high}枚`}</p></article>
      </div>
      <div className="ticket-forecast-detail">
        <p>{state.detail}</p>
        <span>予測データ品質 {state.quality}/100</span>
      </div>
      <p className="ticket-forecast-note">直近5分・その前5分・10〜20分前の新規入場だけを重み付けして計算。再入場は新しい紙チケットを消費しないため除外しています。</p>
    </section>
  );
}

function CopilotHint({ state }: { state: ForecastState }) {
  return (
    <section className="ticket-forecast-copilot-hint">
      <div><small>TICKET FORECAST INTELLIGENCE</small><h3>在庫予測を自然文で照会</h3></div>
      <p>「30分後何枚残る？」「終了時どれくらい？」「あと何分もつ？」「減り方速くなってる？」のように聞けます。</p>
      <span className={state.level}>{state.label} · 約{state.pacePer10.toFixed(1)}枚/10分</span>
    </section>
  );
}

function ForecastMessages({ messages, thinking }: { messages: Message[]; thinking: boolean }) {
  return (
    <>
      {messages.map((message) => (
        <article key={message.id} className={`copilot-message ${message.role} ticket-forecast-message`}>
          <div className="copilot-avatar" aria-hidden="true">{message.role === "copilot" ? "AI" : "管"}</div>
          <div className="copilot-bubble">
            <small>{message.role === "copilot" ? "TICKET INTELLIGENCE" : "OPERATOR"}</small>
            <p>{message.text}</p>
            {message.evidence.length > 0 && <ul>{message.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
          </div>
        </article>
      ))}
      {thinking && (
        <article className="copilot-message copilot is-thinking ticket-forecast-message">
          <div className="copilot-avatar" aria-hidden="true">AI</div>
          <div className="copilot-bubble"><small>TICKET INTELLIGENCE</small><p><span /><span /><span /></p></div>
        </article>
      )}
    </>
  );
}

export default function TicketInventoryForecastBridge({ database }: { database: Firestore }) {
  const [currentEvent, setCurrentEvent] = useState<EventInfo | null>(null);
  const [tickets, setTickets] = useState<TicketSummary>(EMPTY_TICKETS);
  const [activities, setActivities] = useState<ActivitySample[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [overviewTarget, setOverviewTarget] = useState<Element | null>(null);
  const [copilotTarget, setCopilotTarget] = useState<Element | null>(null);
  const [messageTarget, setMessageTarget] = useState<Element | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [thinking, setThinking] = useState(false);
  const eventRef = useRef<EventInfo | null>(null);
  const ticketsRef = useRef<TicketSummary>(EMPTY_TICKETS);
  const activitiesRef = useRef<ActivitySample[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let unsubscribeEvent: (() => void) | null = null;
    const unsubscribeCurrent = onSnapshot(doc(database, "system", "current-event"), (snapshot) => {
      const eventId = snapshot.exists() && typeof snapshot.data().eventId === "string" ? snapshot.data().eventId as string : "";
      unsubscribeEvent?.();
      unsubscribeEvent = null;
      if (eventId === "") {
        eventRef.current = null;
        ticketsRef.current = EMPTY_TICKETS;
        activitiesRef.current = [];
        setCurrentEvent(null);
        setTickets(EMPTY_TICKETS);
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
    const base = ["event-data", currentEvent.dataDocumentId] as const;
    const unsubscribeTickets = onSnapshot(collection(database, ...base, "tickets"), (snapshot) => {
      const next = summarizeTickets(snapshot.docs);
      ticketsRef.current = next;
      setTickets(next);
    });
    const unsubscribeActivity = onSnapshot(collection(database, ...base, "activity"), (snapshot) => {
      const next = snapshot.docs.map((item) => readActivity(item.data())).filter((item): item is ActivitySample => item !== null);
      activitiesRef.current = next;
      setActivities(next);
    });
    return () => {
      unsubscribeTickets();
      unsubscribeActivity();
    };
  }, [currentEvent, database]);

  const state = useMemo(
    () => buildForecastState(currentEvent, tickets, activities, now),
    [activities, currentEvent, now, tickets]
  );

  const ask = useCallback((question: string) => {
    const stamp = Date.now();
    setMessages((current) => [...current, { id: `ticket-forecast-op-${stamp}-${current.length}`, role: "operator", text: question, evidence: [] }]);
    setThinking(true);
    const latest = buildForecastState(eventRef.current, ticketsRef.current, activitiesRef.current, Date.now());
    const reply = buildReply(question, ticketsRef.current, latest);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setThinking(false);
      setMessages((current) => [...current, { id: `ticket-forecast-ai-${Date.now()}-${current.length}`, role: "copilot", text: reply.text, evidence: reply.evidence }]);
      window.setTimeout(() => document.querySelector(".copilot-messages")?.scrollTo({ top: 999999, behavior: "smooth" }), 0);
    }, 320);
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
      ask(question);
    };
    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, [ask]);

  useEffect(() => {
    const updateTargets = () => {
      setOverviewTarget((current) => {
        const next = document.querySelector(".admin-ops-panel");
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
      {overviewTarget !== null && createPortal(<ForecastPanel tickets={tickets} state={state} />, overviewTarget)}
      {copilotTarget !== null && createPortal(<CopilotHint state={state} />, copilotTarget)}
      {messageTarget !== null && createPortal(<ForecastMessages messages={messages} thinking={thinking} />, messageTarget)}
    </>
  );
}
