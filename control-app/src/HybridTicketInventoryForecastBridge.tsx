import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  getDocs,
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

type HistoricalProfile = {
  event: EventInfo;
  activities: ActivitySample[];
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
  todayRatePerMinute: number;
  historicalRatePerMinute: number;
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
  historyEventCount: number;
  todayWeight: number;
  historyWeight: number;
  historyCurve: number[];
};

type Message = {
  id: string;
  role: "operator" | "copilot";
  text: string;
  evidence: string[];
};

const EMPTY_TICKETS: TicketSummary = { total: 0, unused: 0 };
const MAX_HISTORY_EVENTS = 6;
const MAX_FORECAST_MINUTES = 360;

function normalize(text: string) {
  return text
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .toLowerCase()
    .replace(/[\s\u3000。、！？!?「」『』（）()・]/g, "");
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

  return {
    type: data.type,
    timestamp,
    isReEntry: data.isReEntry === true,
  };
}

function eventTime(event: EventInfo, time: string) {
  const value = new Date(`${event.date}T${time}`).getTime();
  return Number.isFinite(value) ? value : 0;
}

function eventDurationMinutes(event: EventInfo) {
  const start = eventTime(event, event.startTime);
  const end = eventTime(event, event.endTime);
  if (start <= 0 || end <= start) return 0;
  return (end - start) / 60_000;
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

function weightedAverage(values: Array<{ value: number; weight: number }>) {
  const weight = values.reduce((total, item) => total + item.weight, 0);
  if (weight <= 0) return 0;
  return values.reduce((total, item) => total + item.value * item.weight, 0) / weight;
}

function buildHistoricalSignals(
  profiles: HistoricalProfile[],
  elapsedMinutes: number,
  maxMinutes: number
) {
  const usable = profiles.filter((profile) => {
    const duration = eventDurationMinutes(profile.event);
    return duration >= Math.min(5, elapsedMinutes) && profile.activities.length > 0;
  });

  if (usable.length === 0) {
    return {
      eventCount: 0,
      ratePerMinute: 0,
      curve: Array.from({ length: maxMinutes + 1 }, () => 0),
    };
  }

  const rateSamples = usable.map((profile, index) => {
    const startAt = eventTime(profile.event, profile.event.startTime);
    const duration = eventDurationMinutes(profile.event);
    const targetElapsed = Math.min(elapsedMinutes, duration);
    const windowMinutes = Math.max(3, Math.min(10, targetElapsed || 10));
    const fromElapsed = Math.max(0, targetElapsed - windowMinutes);
    const count = countFirstEntries(
      profile.activities,
      startAt + fromElapsed * 60_000,
      startAt + targetElapsed * 60_000
    );
    return {
      value: count / Math.max(1, targetElapsed - fromElapsed),
      weight: 1 / (1 + index * 0.18),
    };
  });

  const ratePerMinute = weightedAverage(rateSamples);
  const curve = Array.from({ length: maxMinutes + 1 }, () => 0);

  for (let minute = 1; minute <= maxMinutes; minute += 1) {
    const demandSamples: Array<{ value: number; weight: number }> = [];

    usable.forEach((profile, index) => {
      const startAt = eventTime(profile.event, profile.event.startTime);
      const duration = eventDurationMinutes(profile.event);
      if (duration <= elapsedMinutes) return;

      const futureEnd = Math.min(duration, elapsedMinutes + minute);
      if (futureEnd <= elapsedMinutes) return;

      const count = countFirstEntries(
        profile.activities,
        startAt + elapsedMinutes * 60_000,
        startAt + futureEnd * 60_000
      );

      const coveredMinutes = futureEnd - elapsedMinutes;
      const scaledCount = coveredMinutes >= minute * 0.75
        ? count
        : count / Math.max(0.25, coveredMinutes) * minute;

      demandSamples.push({
        value: scaledCount,
        weight: 1 / (1 + index * 0.18),
      });
    });

    curve[minute] = demandSamples.length > 0
      ? weightedAverage(demandSamples)
      : ratePerMinute * minute;
  }

  return {
    eventCount: usable.length,
    ratePerMinute,
    curve,
  };
}

function buildForecastState(
  event: EventInfo | null,
  tickets: TicketSummary,
  activities: ActivitySample[],
  historicalProfiles: HistoricalProfile[],
  now: number
): ForecastState {
  const neutral: ForecastState = {
    level: "neutral",
    label: "判断待ち",
    detail: "イベント開始後の新規入場データから予測します。",
    ratePerMinute: 0,
    todayRatePerMinute: 0,
    historicalRatePerMinute: 0,
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
    historyEventCount: 0,
    todayWeight: 1,
    historyWeight: 0,
    historyCurve: Array.from({ length: MAX_FORECAST_MINUTES + 1 }, () => 0),
  };

  if (event === null) return neutral;

  const startAt = eventTime(event, event.startTime);
  const endAt = eventTime(event, event.endTime);
  const remainingMinutes = endAt > 0 ? Math.max(0, Math.ceil((endAt - now) / 60_000)) : null;

  if (tickets.total === 0) {
    return {
      ...neutral,
      level: "warning",
      label: "チケット未登録",
      detail: "現在イベントにチケットが登録されていません。",
      remainingMinutes,
    };
  }

  if (event.status === "ended" || (endAt > 0 && now >= endAt)) {
    return {
      ...neutral,
      label: "イベント終了",
      detail: `未使用チケットは${tickets.unused}枚残りました。`,
      remainingMinutes: 0,
      endForecast: {
        minutes: 0,
        expected: tickets.unused,
        low: tickets.unused,
        high: tickets.unused,
        cappedAtEnd: true,
      },
      quality: 100,
    };
  }

  if (startAt > 0 && now < startAt) {
    return {
      ...neutral,
      label: "開始前",
      detail: `未使用${tickets.unused}枚を準備済みです。開始後は過去イベントと当日データを自動で混ぜて予測します。`,
      remainingMinutes,
      historyEventCount: historicalProfiles.length,
    };
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

  const segmentWeight = segments.reduce((total, item) => total + item.weight, 0) || 1;
  const todayRatePerMinute = segments.reduce(
    (total, item) => total + item.rate * item.weight,
    0
  ) / segmentWeight;

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

  const maxForecastMinutes = Math.min(
    MAX_FORECAST_MINUTES,
    Math.max(60, remainingMinutes ?? 180)
  );
  const historical = buildHistoricalSignals(
    historicalProfiles,
    elapsedMinutes,
    maxForecastMinutes
  );

  const observedMinutes = Math.min(20, elapsedMinutes);
  const observedEntries = recent5 + previous5 + older10;
  const hasHistory = historical.eventCount > 0;
  const todayWeight = hasHistory
    ? clamp(
        0.35 +
          Math.min(0.35, observedMinutes / 20 * 0.35) +
          Math.min(0.20, observedEntries / 15 * 0.20),
        0.35,
        0.90
      )
    : 1;
  const historyWeight = hasHistory ? 1 - todayWeight : 0;
  const ratePerMinute =
    todayRatePerMinute * todayWeight +
    historical.ratePerMinute * historyWeight;
  const pacePer10 = ratePerMinute * 10;

  const quality = Math.round(clamp(
    18 +
      Math.min(42, observedEntries * 3.5) +
      Math.min(25, observedMinutes / 20 * 25) +
      Math.min(15, historical.eventCount * 3),
    15,
    100
  ));
  const uncertainty = quality >= 80 ? 0.16 : quality >= 60 ? 0.25 : quality >= 40 ? 0.36 : 0.50;
  const positiveTrendBoost = trendPercent !== null && trendPercent >= 20 ? 0.10 : 0;
  const lowRate = Math.max(0, ratePerMinute * (1 - uncertainty));
  const highRate = ratePerMinute * (1 + uncertainty + positiveTrendBoost);

  const demandFor = (requestedMinutes: number) => {
    const minute = Math.max(0, Math.min(maxForecastMinutes, Math.ceil(requestedMinutes)));
    const todayDemand = todayRatePerMinute * requestedMinutes;
    const historyDemand = hasHistory
      ? historical.curve[minute] ?? historical.ratePerMinute * requestedMinutes
      : todayDemand;
    return todayDemand * todayWeight + historyDemand * historyWeight;
  };

  const forecastFor = (requestedMinutes: number): ForecastPoint => {
    const effectiveMinutes = remainingMinutes === null
      ? requestedMinutes
      : Math.min(requestedMinutes, remainingMinutes);
    const expectedDemand = demandFor(effectiveMinutes);
    const highDemand = expectedDemand * (1 + uncertainty + positiveTrendBoost);
    const lowDemand = expectedDemand * Math.max(0, 1 - uncertainty);

    return {
      minutes: effectiveMinutes,
      expected: Math.max(0, Math.round(tickets.unused - expectedDemand)),
      low: Math.max(0, Math.floor(tickets.unused - highDemand)),
      high: Math.max(0, Math.ceil(tickets.unused - lowDemand)),
      cappedAtEnd: remainingMinutes !== null && requestedMinutes >= remainingMinutes,
    };
  };

  const endForecast = remainingMinutes === null ? null : forecastFor(remainingMinutes);
  let runoutMinutes: number | null = null;
  const searchLimit = Math.min(MAX_FORECAST_MINUTES, remainingMinutes ?? MAX_FORECAST_MINUTES);
  for (let minute = 1; minute <= searchLimit; minute += 1) {
    if (demandFor(minute) >= tickets.unused) {
      runoutMinutes = minute;
      break;
    }
  }
  if (runoutMinutes === null && ratePerMinute > 0.01) {
    runoutMinutes = tickets.unused / ratePerMinute;
  }

  let level: ForecastState["level"] = "neutral";
  let label = "判断材料少なめ";
  const mixText = hasHistory
    ? `今日${Math.round(todayWeight * 100)}%・過去${Math.round(historyWeight * 100)}%`
    : "当日データのみ";
  let detail = `未使用${tickets.unused}枚。${mixText}で予測しています。`;

  if (tickets.unused === 0) {
    level = "warning";
    label = "残りなし";
    detail = "未使用チケットが0枚です。";
  } else if ((observedEntries >= 3 || hasHistory) && endForecast !== null) {
    if (endForecast.expected <= 0) {
      level = "warning";
      label = "不足見込み";
      detail = `${mixText}のハイブリッド予測では終了前に在庫が尽きる見込みです。`;
    } else if (endForecast.low <= 0) {
      level = "watch";
      label = "足りる見込み・要観察";
      detail = `${mixText}の中心予測では足りますが、入場増加ケースでは不足する可能性があります。`;
    } else {
      level = "normal";
      label = "在庫に余裕";
      detail = `${mixText}の予測で、終了時は${endForecast.expected}枚（${endForecast.low}〜${endForecast.high}枚）残る見込みです。`;
    }
  }

  return {
    level,
    label,
    detail,
    ratePerMinute,
    todayRatePerMinute,
    historicalRatePerMinute: historical.ratePerMinute,
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
    historyEventCount: historical.eventCount,
    todayWeight,
    historyWeight,
    historyCurve: historical.curve,
  };
}

function forecastAt(tickets: TicketSummary, state: ForecastState, requestedMinutes: number): ForecastPoint {
  const effectiveMinutes = state.remainingMinutes === null
    ? requestedMinutes
    : Math.min(requestedMinutes, state.remainingMinutes);
  const minute = Math.max(0, Math.min(state.historyCurve.length - 1, Math.ceil(effectiveMinutes)));
  const todayDemand = state.todayRatePerMinute * effectiveMinutes;
  const historyDemand = state.historyEventCount > 0
    ? state.historyCurve[minute] ?? state.historicalRatePerMinute * effectiveMinutes
    : todayDemand;
  const expectedDemand = todayDemand * state.todayWeight + historyDemand * state.historyWeight;
  const uncertainty = state.quality >= 80 ? 0.16 : state.quality >= 60 ? 0.25 : state.quality >= 40 ? 0.36 : 0.50;
  const trendBoost = state.trendPercent !== null && state.trendPercent >= 20 ? 0.10 : 0;

  return {
    minutes: effectiveMinutes,
    expected: Math.max(0, Math.round(tickets.unused - expectedDemand)),
    low: Math.max(0, Math.floor(tickets.unused - expectedDemand * (1 + uncertainty + trendBoost))),
    high: Math.max(0, Math.ceil(tickets.unused - expectedDemand * Math.max(0, 1 - uncertainty))),
    cappedAtEnd: state.remainingMinutes !== null && requestedMinutes >= state.remainingMinutes,
  };
}

function shouldHandleQuestion(question: string) {
  const value = normalize(question);
  const ticketContext = /(チケット|券|在庫|未使用|残数|何枚残|枚残|売り切|尽き|もつ|持つ)/.test(value);
  const forecastContext = /(予測|見込み|ペース|あと|後|終了時|終わる頃|何分|何時|足りる|大丈夫|余裕|不足|減り|なくなる|無くなる|過去|前回|去年)/.test(value);
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
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function mixEvidence(state: ForecastState) {
  if (state.historyEventCount <= 0) return "過去イベント: 利用可能データなし";
  return `予測比率: 今日${Math.round(state.todayWeight * 100)}% / 過去${Math.round(state.historyWeight * 100)}%（${state.historyEventCount}イベント）`;
}

function buildReply(question: string, tickets: TicketSummary, state: ForecastState) {
  const value = normalize(question);
  const requestedMinutes = extractRequestedMinutes(value);

  if (/(過去|前回|去年)/.test(value)) {
    if (state.historyEventCount <= 0) {
      return {
        text: "現在は予測に使える過去イベントがありません。当日の入場データだけで計算しています。",
        evidence: [`当日消費ペース: 約${(state.todayRatePerMinute * 10).toFixed(1)}枚/10分`],
      };
    }
    return {
      text: `現在は過去${state.historyEventCount}イベントを予測に使っています。今日${Math.round(state.todayWeight * 100)}%、過去${Math.round(state.historyWeight * 100)}%の比率です。`,
      evidence: [
        `当日ペース: 約${(state.todayRatePerMinute * 10).toFixed(1)}枚/10分`,
        `過去同時間帯: 約${(state.historicalRatePerMinute * 10).toFixed(1)}枚/10分`,
        `予測データ品質: ${state.quality}/100`,
      ],
    };
  }

  if (requestedMinutes !== null && /(後|残|予測|何枚)/.test(value)) {
    const forecast = forecastAt(tickets, state, requestedMinutes);
    const label = forecast.cappedAtEnd && state.remainingMinutes !== null && requestedMinutes > state.remainingMinutes
      ? `イベント終了時（約${forecast.minutes}分後）`
      : `${requestedMinutes}分後`;
    return {
      text: `${label}の未使用チケットは${forecast.expected}枚、予測レンジは${forecast.low}〜${forecast.high}枚です。`,
      evidence: [
        `現在: ${tickets.unused}枚`,
        `ハイブリッド消費ペース: 約${state.pacePer10.toFixed(1)}枚/10分`,
        `トレンド: ${state.trendLabel}`,
        mixEvidence(state),
      ],
    };
  }

  if (/(終了時|終わる頃|最後|閉場時|終了まで)/.test(value) && /(残|何枚|予測|在庫)/.test(value)) {
    if (state.endForecast === null) {
      return {
        text: "終了時刻を使った在庫予測をまだ計算できません。",
        evidence: [`現在: ${tickets.unused}枚`],
      };
    }
    return {
      text: `終了時の未使用チケットは${state.endForecast.expected}枚、予測レンジは${state.endForecast.low}〜${state.endForecast.high}枚です。`,
      evidence: [
        `現在: ${tickets.unused}枚`,
        `終了まで: 約${state.remainingMinutes ?? 0}分`,
        `消費ペース: 約${state.pacePer10.toFixed(1)}枚/10分`,
        mixEvidence(state),
      ],
    };
  }

  if (/(あと何分|何分もつ|何分持つ|いつなくなる|いつ無くなる|何時.*尽|売り切)/.test(value)) {
    if (tickets.unused <= 0) {
      return { text: "未使用チケットはすでに0枚です。", evidence: ["在庫: 0枚"] };
    }
    if (state.runoutMinutes === null || state.ratePerMinute <= 0.01) {
      return {
        text: "現在の当日・過去データでは、在庫が尽きる時刻をまだ安定して算出できません。",
        evidence: [`現在: ${tickets.unused}枚`, mixEvidence(state)],
      };
    }
    if (state.remainingMinutes !== null && state.runoutMinutes > state.remainingMinutes) {
      return {
        text: `ハイブリッド予測では終了時刻まで在庫は持つ見込みです。単純換算では約${Math.round(state.runoutMinutes)}分後まで持つペースです。`,
        evidence: [
          `終了まで: 約${state.remainingMinutes}分`,
          `終了時予測: ${state.endForecast?.expected ?? "—"}枚`,
          mixEvidence(state),
        ],
      };
    }
    return {
      text: `現在の予測では約${Math.max(1, Math.round(state.runoutMinutes))}分後、${formatRunoutTime(state.runoutMinutes)}ごろに在庫が尽きる見込みです。`,
      evidence: [
        `現在: ${tickets.unused}枚`,
        `消費ペース: 約${state.pacePer10.toFixed(1)}枚/10分`,
        mixEvidence(state),
      ],
    };
  }

  if (/(ペース|減り方|消費速度|減る速さ|速くな|遅くな)/.test(value)) {
    const trendText = state.trendPercent === null
      ? state.trendLabel
      : `${state.trendLabel}（前5分比 ${state.trendPercent >= 0 ? "+" : ""}${state.trendPercent}%）`;
    return {
      text: `ハイブリッド消費ペースは約${state.pacePer10.toFixed(1)}枚/10分で、当日の傾向は${trendText}です。`,
      evidence: [
        `直近5分: ${state.recent5}枚`,
        `その前5分: ${state.previous5}枚`,
        `過去同時間帯: 約${(state.historicalRatePerMinute * 10).toFixed(1)}枚/10分`,
        mixEvidence(state),
      ],
    };
  }

  return {
    text: `${state.label}です。${state.detail}`,
    evidence: [
      `現在未使用: ${tickets.unused}枚`,
      `ハイブリッド消費ペース: 約${state.pacePer10.toFixed(1)}枚/10分`,
      `トレンド: ${state.trendLabel}`,
      state.endForecast === null
        ? "終了時予測: 算出待ち"
        : `終了時予測: ${state.endForecast.expected}枚（${state.endForecast.low}〜${state.endForecast.high}枚）`,
      mixEvidence(state),
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
  const mixLabel = state.historyEventCount > 0
    ? `今日 ${Math.round(state.todayWeight * 100)}% / 過去 ${Math.round(state.historyWeight * 100)}%`
    : "当日データのみ";

  return (
    <section className={`ticket-forecast-panel ${state.level}`}>
      <div className="ticket-forecast-heading">
        <div><small>HYBRID TICKET FORECAST</small><h3>チケット在庫予測</h3></div>
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
      <div className="ticket-forecast-detail">
        <p>{mixLabel}</p>
        <span>過去参照 {state.historyEventCount}イベント</span>
      </div>
      <p className="ticket-forecast-note">当日は直近5分・その前5分・10〜20分前を重み付け。過去イベントは「イベント開始から同じ経過時間帯」の新規入場ペースと、その先の消費推移を参照します。再入場は除外しています。</p>
    </section>
  );
}

function CopilotHint({ state }: { state: ForecastState }) {
  return (
    <section className="ticket-forecast-copilot-hint">
      <div><small>HYBRID TICKET INTELLIGENCE</small><h3>過去＋当日の在庫予測</h3></div>
      <p>「30分後何枚残る？」「終了時どれくらい？」「過去データ使ってる？」「あと何分もつ？」のように聞けます。</p>
      <span className={state.level}>{state.label} · 過去{state.historyEventCount}イベント参照</span>
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
            <small>{message.role === "copilot" ? "HYBRID TICKET INTELLIGENCE" : "OPERATOR"}</small>
            <p>{message.text}</p>
            {message.evidence.length > 0 && <ul>{message.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
          </div>
        </article>
      ))}
      {thinking && (
        <article className="copilot-message copilot is-thinking ticket-forecast-message">
          <div className="copilot-avatar" aria-hidden="true">AI</div>
          <div className="copilot-bubble"><small>HYBRID TICKET INTELLIGENCE</small><p><span /><span /><span /></p></div>
        </article>
      )}
    </>
  );
}

export default function HybridTicketInventoryForecastBridge({ database }: { database: Firestore }) {
  const [currentEvent, setCurrentEvent] = useState<EventInfo | null>(null);
  const [tickets, setTickets] = useState<TicketSummary>(EMPTY_TICKETS);
  const [activities, setActivities] = useState<ActivitySample[]>([]);
  const [historicalProfiles, setHistoricalProfiles] = useState<HistoricalProfile[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [overviewTarget, setOverviewTarget] = useState<Element | null>(null);
  const [copilotTarget, setCopilotTarget] = useState<Element | null>(null);
  const [messageTarget, setMessageTarget] = useState<Element | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [thinking, setThinking] = useState(false);
  const eventRef = useRef<EventInfo | null>(null);
  const ticketsRef = useRef<TicketSummary>(EMPTY_TICKETS);
  const activitiesRef = useRef<ActivitySample[]>([]);
  const historyRef = useRef<HistoricalProfile[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
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
        eventRef.current = null;
        ticketsRef.current = EMPTY_TICKETS;
        activitiesRef.current = [];
        historyRef.current = [];
        setCurrentEvent(null);
        setTickets(EMPTY_TICKETS);
        setActivities([]);
        setHistoricalProfiles([]);
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
      const next = snapshot.docs
        .map((item) => readActivity(item.data()))
        .filter((item): item is ActivitySample => item !== null);
      activitiesRef.current = next;
      setActivities(next);
    });

    return () => {
      unsubscribeTickets();
      unsubscribeActivity();
    };
  }, [currentEvent, database]);

  useEffect(() => {
    if (currentEvent === null) return undefined;
    let cancelled = false;

    const loadHistory = async () => {
      try {
        const eventsSnapshot = await getDocs(collection(database, "events"));
        if (cancelled) return;

        const pastEvents = eventsSnapshot.docs
          .map((item) => readEvent(item.id, item.data()))
          .filter((item): item is EventInfo => item !== null)
          .filter((item) => {
            if (item.id === currentEvent.id) return false;
            const endedByStatus = item.status === "ended";
            const endedByTime = eventTime(item, item.endTime) > 0 && eventTime(item, item.endTime) < Date.now();
            return endedByStatus || endedByTime;
          })
          .sort((a, b) => eventTime(b, b.startTime) - eventTime(a, a.startTime))
          .slice(0, MAX_HISTORY_EVENTS);

        const profiles = await Promise.all(pastEvents.map(async (pastEvent) => {
          const activitySnapshot = await getDocs(
            collection(database, "event-data", pastEvent.dataDocumentId, "activity")
          );
          const pastActivities = activitySnapshot.docs
            .map((item) => readActivity(item.data()))
            .filter((item): item is ActivitySample => item !== null);
          return { event: pastEvent, activities: pastActivities } satisfies HistoricalProfile;
        }));

        if (cancelled) return;
        const usable = profiles.filter((profile) =>
          profile.activities.some((activity) => activity.type === "ticket-entry" && !activity.isReEntry)
        );
        historyRef.current = usable;
        setHistoricalProfiles(usable);
      } catch (error) {
        console.error("チケット予測用の過去イベントを読み込めませんでした。", error);
        if (cancelled) return;
        historyRef.current = [];
        setHistoricalProfiles([]);
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [currentEvent, database]);

  const state = useMemo(
    () => buildForecastState(currentEvent, tickets, activities, historicalProfiles, now),
    [activities, currentEvent, historicalProfiles, now, tickets]
  );

  const ask = useCallback((question: string) => {
    const stamp = Date.now();
    setMessages((current) => [
      ...current,
      { id: `hybrid-ticket-op-${stamp}-${current.length}`, role: "operator", text: question, evidence: [] },
    ]);
    setThinking(true);

    const latest = buildForecastState(
      eventRef.current,
      ticketsRef.current,
      activitiesRef.current,
      historyRef.current,
      Date.now()
    );
    const reply = buildReply(question, ticketsRef.current, latest);

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setThinking(false);
      setMessages((current) => [
        ...current,
        {
          id: `hybrid-ticket-ai-${Date.now()}-${current.length}`,
          role: "copilot",
          text: reply.text,
          evidence: reply.evidence,
        },
      ]);
      window.setTimeout(() => {
        document.querySelector(".copilot-messages")?.scrollTo({ top: 999999, behavior: "smooth" });
      }, 0);
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
      {overviewTarget !== null && createPortal(
        <ForecastPanel tickets={tickets} state={state} />,
        overviewTarget
      )}
      {copilotTarget !== null && createPortal(<CopilotHint state={state} />, copilotTarget)}
      {messageTarget !== null && createPortal(
        <ForecastMessages messages={messages} thinking={thinking} />,
        messageTarget
      )}
    </>
  );
}
