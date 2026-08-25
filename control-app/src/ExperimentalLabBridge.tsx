import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";

type ReceptionMode = "entry" | "exit";
type CameraState = "starting" | "ready" | "error";

type LabEvent = {
  id: string;
  dataDocumentId: string;
  capacity: number;
};

type LabDevice = {
  id: string;
  mode: ReceptionMode;
  name: string;
  lastSeenAt: number;
  pendingCount: number;
  firebaseLatencyMs: number;
  downloadMbps: number;
  cameraState: CameraState;
  receptionPaused: boolean;
};

type Activity = {
  type: "ticket-entry" | "ticket-exit" | "member-entry" | "member-exit";
  timestamp: number;
};

type Analytics = {
  currentInside: number;
  currentMembersInside: number;
};

type FaultScenario = "none" | "entry-network" | "shared-network" | "camera" | "sync";

type LabLog = {
  id: string;
  at: number;
  title: string;
  detail: string;
  kind: "info" | "watch" | "warning";
};

const DEFAULT_CAPACITY = 200;

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

function readDevice(id: string, data: DocumentData): LabDevice | null {
  if (data.mode !== "entry" && data.mode !== "exit") return null;
  const mode: ReceptionMode = data.mode;
  const cameraState: CameraState = data.cameraState === "ready" || data.cameraState === "error"
    ? data.cameraState
    : "starting";
  return {
    id,
    mode,
    name: typeof data.deviceName === "string" && data.deviceName.trim() !== ""
      ? data.deviceName
      : `${mode === "entry" ? "入口" : "出口"}受付端末`,
    lastSeenAt: timestampToMilliseconds(data.updatedAt) || readNumber(data.lastSeenAt),
    pendingCount: Math.floor(readNumber(data.pendingCount)),
    firebaseLatencyMs: Math.floor(readNumber(data.firebaseLatencyMs)),
    downloadMbps: Math.round(readNumber(data.downloadMbps) * 10) / 10,
    cameraState,
    receptionPaused: data.receptionPaused === true,
  };
}

function readActivity(data: DocumentData): Activity | null {
  if (
    data.type !== "ticket-entry" &&
    data.type !== "ticket-exit" &&
    data.type !== "member-entry" &&
    data.type !== "member-exit"
  ) return null;
  if (typeof data.timestamp !== "string") return null;
  const timestamp = new Date(data.timestamp).getTime();
  return Number.isFinite(timestamp) ? { type: data.type, timestamp } : null;
}

function isEntry(activity: Activity) {
  return activity.type === "ticket-entry" || activity.type === "member-entry";
}

function rate(activities: Activity[], now: number, predicate: (activity: Activity) => boolean) {
  const start = now - 10 * 60_000;
  return activities.filter((activity) => activity.timestamp > start && activity.timestamp <= now && predicate(activity)).length / 10;
}

function baseDeviceRisk(device: LabDevice, now: number) {
  let score = 0;
  const age = device.lastSeenAt <= 0 ? 60_000 : Math.max(0, now - device.lastSeenAt);
  if (age > 45_000) score += 55;
  else if (age > 15_000) score += 22;
  if (device.cameraState === "error") score += 30;
  else if (device.cameraState === "starting" && age > 10_000) score += 8;
  if (device.pendingCount > 0) score += Math.min(25, 5 + device.pendingCount * 4);
  if (device.firebaseLatencyMs >= 1_500) score += 25;
  else if (device.firebaseLatencyMs >= 900) score += 16;
  else if (device.firebaseLatencyMs >= 500) score += 7;
  if (device.downloadMbps > 0 && device.downloadMbps < 1) score += 18;
  else if (device.downloadMbps > 0 && device.downloadMbps < 3) score += 8;
  return Math.min(100, Math.round(score));
}

function riskLabel(score: number) {
  if (score >= 75) return "高リスク";
  if (score >= 50) return "注意";
  if (score >= 25) return "要観察";
  return "安定";
}

function effectLabel(value: number) {
  if (value >= 70) return "高";
  if (value >= 40) return "中";
  return "低";
}

function formatClock(value: number) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export default function ExperimentalLabBridge({ database }: { database: Firestore }) {
  const [target, setTarget] = useState<Element | null>(null);
  const [event, setEvent] = useState<LabEvent | null>(null);
  const [devices, setDevices] = useState<LabDevice[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({ currentInside: 0, currentMembersInside: 0 });
  const [now, setNow] = useState(() => Date.now());
  const [entryMultiplier, setEntryMultiplier] = useState(100);
  const [exitMultiplier, setExitMultiplier] = useState(100);
  const [scenario, setScenario] = useState<FaultScenario>("none");
  const [logs, setLogs] = useState<LabLog[]>([]);
  const previousSignatureRef = useRef("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => {
      setTarget(document.querySelector(".lab-page"));
    }, 0);
    const observer = new MutationObserver(() => {
      const next = document.querySelector(".lab-page");
      setTarget((current) => current === next ? current : next);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(first);
      observer.disconnect();
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
        setEvent(null);
        return;
      }
      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        if (!eventSnapshot.exists()) {
          setEvent(null);
          return;
        }
        const data = eventSnapshot.data();
        const name = typeof data.name === "string" ? data.name.trim() : "event-not-set";
        setEvent({
          id: eventId,
          dataDocumentId: typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
            ? data.dataDocumentId
            : encodeURIComponent(name || "event-not-set"),
          capacity: Math.max(1, Math.floor(readNumber(data.capacity) || DEFAULT_CAPACITY)),
        });
      });
    });
    return () => {
      unsubscribeCurrent();
      unsubscribeEvent?.();
    };
  }, [database]);

  useEffect(() => {
    if (event === null) {
      return undefined;
    }
    const base = ["event-data", event.dataDocumentId] as const;
    const unsubscribeDevices = onSnapshot(collection(database, ...base, "reception-devices"), (snapshot) => {
      setDevices(snapshot.docs
        .map((item) => readDevice(item.id, item.data()))
        .filter((item): item is LabDevice => item !== null));
    });
    const unsubscribeActivity = onSnapshot(collection(database, ...base, "activity"), (snapshot) => {
      setActivities(snapshot.docs
        .map((item) => readActivity(item.data()))
        .filter((item): item is Activity => item !== null));
    });
    const unsubscribeAnalytics = onSnapshot(doc(database, ...base, "analytics", "summary"), (snapshot) => {
      const data = snapshot.exists() ? snapshot.data() : {};
      setAnalytics({
        currentInside: Math.floor(readNumber(data.currentInside)),
        currentMembersInside: Math.floor(readNumber(data.currentMembersInside)),
      });
    });
    return () => {
      unsubscribeDevices();
      unsubscribeActivity();
      unsubscribeAnalytics();
    };
  }, [database, event]);

  const entryRate = useMemo(() => rate(activities, now, isEntry), [activities, now]);
  const exitRate = useMemo(() => rate(activities, now, (activity) => !isEntry(activity)), [activities, now]);
  const currentOccupancy = analytics.currentInside + analytics.currentMembersInside;

  const deviceRisks = useMemo(() => devices
    .map((device) => ({ device, score: baseDeviceRisk(device, now) }))
    .sort((a, b) => b.score - a.score), [devices, now]);

  const injectedRisk = scenario === "none" ? 0
    : scenario === "entry-network" ? 26
      : scenario === "shared-network" ? 42
        : scenario === "camera" ? 34
          : 30;

  const baseRisk = deviceRisks[0]?.score ?? 0;
  const simulatedRisk = Math.min(100, baseRisk + injectedRisk);
  const simulatedEntryRate = entryRate * entryMultiplier / 100;
  const simulatedExitRate = exitRate * exitMultiplier / 100;
  const simulated15 = Math.max(0, Math.round(currentOccupancy + (simulatedEntryRate - simulatedExitRate) * 15));
  const occupancyRatio = event === null ? 0 : simulated15 / event.capacity;

  const dataQuality = useMemo(() => {
    let score = 20;
    if (event !== null) score += 20;
    score += Math.min(30, devices.length * 15);
    const recent = activities.filter((activity) => now - activity.timestamp <= 10 * 60_000).length;
    score += Math.min(20, recent * 2);
    if (devices.every((device) => device.lastSeenAt > 0 && now - device.lastSeenAt < 15_000)) score += 10;
    return Math.min(100, score);
  }, [activities, devices, event, now]);

  const preventive = useMemo(() => deviceRisks.map(({ device, score }) => {
    const index = Math.min(100, Math.round(
      score * 0.7 +
      Math.min(20, device.pendingCount * 4) +
      (device.firebaseLatencyMs >= 700 ? 10 : 0) +
      (device.cameraState !== "ready" ? 10 : 0)
    ));
    const action = device.cameraState === "error"
      ? "カメラ再起動を事前候補にする"
      : device.pendingCount > 0
        ? "再同期で詰まりが減るか確認する"
        : device.firebaseLatencyMs >= 700
          ? "通信推移を重点監視する"
          : "通常監視を継続する";
    return { device, index, action };
  }), [deviceRisks]);

  const actionEffects = useMemo(() => {
    const highest = deviceRisks[0];
    if (highest === undefined) return [];
    const camera = highest.device.cameraState === "error" ? 88 : highest.device.cameraState === "starting" ? 55 : 18;
    const sync = highest.device.pendingCount > 0 ? Math.min(92, 55 + highest.device.pendingCount * 7) : 16;
    const network = highest.device.firebaseLatencyMs >= 900 || (highest.device.downloadMbps > 0 && highest.device.downloadMbps < 3) ? 76 : 28;
    return [
      { name: "カメラ再起動", score: camera, note: "カメラ系の症状に対する期待効果" },
      { name: "未送信再同期", score: sync, note: "同期詰まりに対する期待効果" },
      { name: "現地でWi-Fi確認", score: network, note: "通信悪化に対する期待効果" },
    ];
  }, [deviceRisks]);

  const signature = useMemo(() => [
    scenario,
    Math.round(baseRisk / 10),
    Math.round(entryRate * 10),
    Math.round(exitRate * 10),
    Math.round(currentOccupancy / 10),
  ].join(":"), [baseRisk, currentOccupancy, entryRate, exitRate, scenario]);

  useEffect(() => {
    if (target === null || signature === previousSignatureRef.current) return;
    previousSignatureRef.current = signature;
    const highest = deviceRisks[0];
    const next: LabLog = scenario !== "none"
      ? {
          id: `${Date.now()}-${signature}`,
          at: Date.now(),
          title: "仮想障害シナリオを再計算",
          detail: `シミュレーション上の最大リスクは${simulatedRisk}/100です。実端末には反映していません。`,
          kind: simulatedRisk >= 75 ? "warning" : "watch",
        }
      : highest !== undefined && highest.score >= 25
        ? {
            id: `${Date.now()}-${signature}`,
            at: Date.now(),
            title: `${highest.device.name}を重点監視`,
            detail: `ライブ指標のリスクは${highest.score}/100。${riskLabel(highest.score)}として追跡します。`,
            kind: highest.score >= 50 ? "warning" : "watch",
          }
        : {
            id: `${Date.now()}-${signature}`,
            at: Date.now(),
            title: "ラボ判断エンジン更新",
            detail: "強い異常兆候はありません。デジタルツインと予防保全評価を更新しました。",
            kind: "info",
          };
    setLogs((current) => [next, ...current].slice(0, 8));
  }, [deviceRisks, scenario, signature, simulatedRisk, target]);

  if (target === null) return null;

  return createPortal(
    <section className="experimental-lab-extension">
      <div className="experimental-lab-heading">
        <div>
          <small>EXPERIMENTAL CONTROL INTELLIGENCE</small>
          <h2>高度試験モジュール</h2>
          <p>仮想計算だけを行う機能を含みます。障害注入シミュレーションは実端末へ変更を送りません。</p>
        </div>
        <div className="lab-readiness">
          <span>実験データ品質</span>
          <strong>{dataQuality}<em>/100</em></strong>
        </div>
      </div>

      <div className="lab-experiment-grid">
        <article className="lab-digital-twin">
          <div className="lab-card-heading"><div><small>DIGITAL TWIN</small><strong>会場デジタルツイン</strong></div><span>{simulated15}人</span></div>
          <p>直近10分の入退場を基準に、流量を変えた場合の15分後を仮想計算します。</p>
          <label>
            <span>入場流量 <b>{entryMultiplier}%</b></span>
            <input type="range" min="40" max="200" step="10" value={entryMultiplier} onChange={(e) => setEntryMultiplier(Number(e.target.value))} />
          </label>
          <label>
            <span>退出流量 <b>{exitMultiplier}%</b></span>
            <input type="range" min="40" max="200" step="10" value={exitMultiplier} onChange={(e) => setExitMultiplier(Number(e.target.value))} />
          </label>
          <dl>
            <div><dt>現在</dt><dd>{currentOccupancy}人</dd></div>
            <div><dt>ライブ流量</dt><dd>入 {entryRate.toFixed(1)} / 出 {exitRate.toFixed(1)} 人/分</dd></div>
            <div><dt>15分後</dt><dd>{simulated15}人</dd></div>
            <div><dt>定員比</dt><dd className={occupancyRatio >= 1 ? "is-danger" : occupancyRatio >= 0.8 ? "is-watch" : ""}>{Math.round(occupancyRatio * 100)}%</dd></div>
          </dl>
        </article>

        <article className="lab-fault-injection">
          <div className="lab-card-heading"><div><small>VIRTUAL FAULT INJECTION</small><strong>障害注入シミュレーション</strong></div><span className={simulatedRisk >= 75 ? "danger" : simulatedRisk >= 50 ? "warning" : "normal"}>{simulatedRisk}</span></div>
          <p>実機を壊さず、仮想的な故障条件を足して判断エンジンの反応を確認します。</p>
          <div className="lab-scenario-buttons">
            <button className={scenario === "none" ? "active" : ""} onClick={() => setScenario("none")}>通常</button>
            <button className={scenario === "entry-network" ? "active" : ""} onClick={() => setScenario("entry-network")}>入口通信悪化</button>
            <button className={scenario === "shared-network" ? "active" : ""} onClick={() => setScenario("shared-network")}>共通回線悪化</button>
            <button className={scenario === "camera" ? "active" : ""} onClick={() => setScenario("camera")}>カメラ異常</button>
            <button className={scenario === "sync" ? "active" : ""} onClick={() => setScenario("sync")}>同期詰まり</button>
          </div>
          <div className="lab-simulation-result">
            <span>ライブ値</span><strong>{baseRisk}/100</strong><i>→</i><span>仮想値</span><strong>{simulatedRisk}/100</strong>
          </div>
          <small className="lab-virtual-note">SIMULATION ONLY · 実端末への遠隔操作なし</small>
        </article>

        <article className="lab-preventive">
          <div className="lab-card-heading"><div><small>PREVENTIVE MAINTENANCE</small><strong>予防保全インデックス</strong></div><span>{preventive[0]?.index ?? 0}</span></div>
          <p>故障確率ではなく、今の状態から「先回りして確認する価値」を示す試験指標です。</p>
          <div className="lab-preventive-list">
            {preventive.length === 0 ? <span className="lab-empty">端末データ待機中</span> : preventive.map((item) => (
              <div key={item.device.id}>
                <span>{item.device.mode === "entry" ? "入口" : "出口"}</span>
                <strong>{item.index}</strong>
                <p>{item.action}</p>
              </div>
            ))}
          </div>
        </article>

        <article className="lab-action-outcome">
          <div className="lab-card-heading"><div><small>ACTION OUTCOME ESTIMATOR</small><strong>対応結果予測</strong></div><span>β</span></div>
          <p>現在の症状と操作の相性から、どの対応を先に試す価値が高いか比較します。</p>
          <div className="lab-effect-list">
            {actionEffects.length === 0 ? <span className="lab-empty">端末データ待機中</span> : actionEffects.map((item) => (
              <div key={item.name}>
                <span><strong>{item.name}</strong><small>{item.note}</small></span>
                <b className={`effect-${effectLabel(item.score)}`}>{effectLabel(item.score)} · {item.score}</b>
              </div>
            ))}
          </div>
          <small className="lab-virtual-note">期待効果は成功率ではなく、現在症状との適合度です。</small>
        </article>
      </div>

      <div className="lab-lower-grid">
        <article className="lab-decision-log">
          <div className="lab-card-heading"><div><small>DECISION TRACE</small><strong>判断ログ</strong></div><span>{logs.length}件</span></div>
          <div className="lab-log-list">
            {logs.map((log) => (
              <div key={log.id} className={log.kind}>
                <time>{formatClock(log.at)}</time>
                <span><strong>{log.title}</strong><p>{log.detail}</p></span>
              </div>
            ))}
          </div>
        </article>

        <article className="lab-research-score">
          <div className="lab-card-heading"><div><small>RESEARCH STATUS</small><strong>試験エンジン状態</strong></div><span>ACTIVE</span></div>
          <dl>
            <div><dt>データ品質</dt><dd>{dataQuality}/100</dd></div>
            <div><dt>最大ライブリスク</dt><dd>{baseRisk}/100</dd></div>
            <div><dt>仮想シナリオ</dt><dd>{scenario === "none" ? "なし" : "注入中"}</dd></div>
            <div><dt>デジタルツイン</dt><dd>{entryMultiplier}% / {exitMultiplier}%</dd></div>
          </dl>
          <p>ここでのシミュレーション結果は自動運転Lv.3の実行条件には使用しません。試験表示と判断比較だけに隔離しています。</p>
        </article>
      </div>
    </section>,
    target
  );
}
