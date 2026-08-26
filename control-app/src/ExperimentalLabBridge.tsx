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
type LabSection = "overview" | "autopilot" | "terminal" | "research";

type LabEvent = {
  dataDocumentId: string;
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

type LabLog = {
  id: string;
  at: number;
  title: string;
  detail: string;
  kind: "info" | "watch" | "warning";
};

const LAB_SECTIONS: ReadonlyArray<{
  id: Exclude<LabSection, "overview">;
  label: string;
}> = [
  { id: "autopilot", label: "自動運転" },
  { id: "terminal", label: "端末研究" },
  { id: "research", label: "研究ログ" },
];

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
      ? data.deviceName.trim()
      : `${mode === "entry" ? "入口" : "出口"}受付端末`,
    lastSeenAt: timestampToMilliseconds(data.updatedAt) || readNumber(data.lastSeenAt),
    pendingCount: Math.floor(readNumber(data.pendingCount)),
    firebaseLatencyMs: Math.floor(readNumber(data.firebaseLatencyMs)),
    downloadMbps: Math.round(readNumber(data.downloadMbps) * 10) / 10,
    cameraState,
    receptionPaused: data.receptionPaused === true,
  };
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
  if (device.receptionPaused) score += 5;
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

function ensureLabHubHost() {
  const page = document.querySelector(".lab-page");
  if (!(page instanceof HTMLElement)) return null;

  let host = document.getElementById("experimental-lab-hub-host");
  if (!(host instanceof HTMLElement)) {
    host = document.createElement("div");
    host.id = "experimental-lab-hub-host";
  }

  const heading = page.querySelector(".lab-page-heading");
  if (heading instanceof HTMLElement) {
    if (host.parentElement !== page || host.previousElementSibling !== heading) {
      heading.insertAdjacentElement("afterend", host);
    }
  } else if (host.parentElement !== page) {
    page.prepend(host);
  }

  return host;
}

export default function ExperimentalLabBridge({ database }: { database: Firestore }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [section, setSection] = useState<LabSection>("overview");
  const [event, setEvent] = useState<LabEvent | null>(null);
  const [devices, setDevices] = useState<LabDevice[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [logs, setLogs] = useState<LabLog[]>([]);
  const previousSignatureRef = useRef("");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const next = ensureLabHubHost();
      setTarget((current) => current === next ? current : next);
    };

    const first = window.setTimeout(refresh, 0);
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(first);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const page = target?.closest(".lab-page");
    if (!(page instanceof HTMLElement)) return undefined;

    page.classList.remove(
      "lab-focus-overview",
      "lab-focus-autopilot",
      "lab-focus-terminal",
      "lab-focus-research"
    );
    page.classList.add(`lab-focus-${section}`);

    return () => {
      page.classList.remove(
        "lab-focus-overview",
        "lab-focus-autopilot",
        "lab-focus-terminal",
        "lab-focus-research"
      );
    };
  }, [section, target]);

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
          dataDocumentId: typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
            ? data.dataDocumentId
            : encodeURIComponent(name || "event-not-set"),
        });
      });
    });

    return () => {
      unsubscribeCurrent();
      unsubscribeEvent?.();
    };
  }, [database]);

  useEffect(() => {
    if (event === null) return undefined;

    return onSnapshot(
      collection(database, "event-data", event.dataDocumentId, "reception-devices"),
      (snapshot) => {
        setDevices(snapshot.docs
          .map((item) => readDevice(item.id, item.data()))
          .filter((item): item is LabDevice => item !== null));
      }
    );
  }, [database, event]);

  const deviceRisks = useMemo(() => devices
    .map((device) => ({ device, score: baseDeviceRisk(device, now) }))
    .sort((a, b) => b.score - a.score), [devices, now]);

  const dataQuality = useMemo(() => {
    let score = event === null ? 10 : 35;
    score += Math.min(30, devices.length * 15);
    const freshDevices = devices.filter((device) => device.lastSeenAt > 0 && now - device.lastSeenAt < 15_000).length;
    score += Math.min(20, freshDevices * 10);
    const measuredDevices = devices.filter((device) => device.firebaseLatencyMs > 0 || device.downloadMbps > 0).length;
    score += Math.min(15, measuredDevices * 8);
    return Math.min(100, score);
  }, [devices, event, now]);

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

    const camera = highest.device.cameraState === "error"
      ? 88
      : highest.device.cameraState === "starting" ? 55 : 18;
    const sync = highest.device.pendingCount > 0
      ? Math.min(92, 55 + highest.device.pendingCount * 7)
      : 16;
    const network = highest.device.firebaseLatencyMs >= 900 ||
      (highest.device.downloadMbps > 0 && highest.device.downloadMbps < 3)
      ? 76
      : 28;

    return [
      { name: "カメラ再起動", score: camera, note: "カメラ系の症状に対する期待効果" },
      { name: "未送信再同期", score: sync, note: "同期詰まりに対する期待効果" },
      { name: "現地でWi-Fi確認", score: network, note: "通信悪化に対する期待効果" },
    ];
  }, [deviceRisks]);

  const signature = useMemo(() => deviceRisks
    .map(({ device, score }) => [device.id, Math.round(score / 10), device.pendingCount, device.cameraState].join(":"))
    .join("|"), [deviceRisks]);

  useEffect(() => {
    if (target === null || signature === previousSignatureRef.current) return;
    previousSignatureRef.current = signature;
    const highest = deviceRisks[0];

    const next: LabLog = highest !== undefined && highest.score >= 25
      ? {
          id: `${Date.now()}-${signature}`,
          at: Date.now(),
          title: `${highest.device.name}を重点監視`,
          detail: `ライブ指標のリスクは${highest.score}/100。${riskLabel(highest.score)}として追跡します。`,
          kind: highest.score >= 50 ? "warning" : "watch",
        }
      : {
          id: `${Date.now()}-${signature || "stable"}`,
          at: Date.now(),
          title: "ラボ判断エンジン更新",
          detail: "強い異常兆候はありません。端末のライブ指標を更新しました。",
          kind: "info",
        };

    setLogs((current) => [next, ...current].slice(0, 8));
  }, [deviceRisks, signature, target]);

  if (target === null) return null;

  const highestPreventive = preventive[0]?.index ?? 0;
  const highestRisk = deviceRisks[0]?.score ?? 0;
  const watchedDevice = deviceRisks[0]?.device.name ?? "なし";

  return createPortal(
    <section className="experimental-lab-extension">
      <div className="lab-hub-toolbar">
        <button
          type="button"
          className={`lab-hub-home${section === "overview" ? " active" : ""}`}
          onClick={() => setSection("overview")}
        >
          <span aria-hidden="true">‹</span>
          {section === "overview" ? "ラボ概要" : "概要へ戻る"}
        </button>

        <div className="lab-hub-tabs" aria-label="管制ラボのカテゴリ">
          {LAB_SECTIONS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={section === item.id ? "active" : ""}
              onClick={() => setSection(item.id)}
              aria-pressed={section === item.id}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="lab-readiness compact">
          <span>データ品質</span>
          <strong>{dataQuality}<em>/100</em></strong>
        </div>
      </div>

      {section === "overview" && (
        <>
          <div className="lab-overview-intro">
            <div>
              <small>CONTROL LAB · EXPERIMENTAL</small>
              <h3>試したい内容を1つ選択</h3>
              <p>必要な機能だけ3カテゴリに整理しています。通常運用では開かなくても問題ありません。</p>
            </div>
            <span>通常運用では開かなくてもOK</span>
          </div>

          <div className="lab-category-grid">
            <button type="button" className="is-live" onClick={() => setSection("autopilot")}>
              <span className="lab-category-icon" aria-hidden="true">自</span>
              <div>
                <small>OPERATIONS</small>
                <strong>自動運転</strong>
                <p>判断支援と復旧レベルを設定します。</p>
                <em>実端末へ操作する場合あり</em>
              </div>
              <b aria-hidden="true">→</b>
            </button>

            <button type="button" onClick={() => setSection("terminal")}>
              <span className="lab-category-icon" aria-hidden="true">端</span>
              <div>
                <small>TERMINAL STUDY</small>
                <strong>端末研究</strong>
                <p>端末状態から先回りの確認候補を比較します。</p>
                <em>現在の最大指数 {highestPreventive}</em>
              </div>
              <b aria-hidden="true">→</b>
            </button>

            <button type="button" onClick={() => setSection("research")}>
              <span className="lab-category-icon" aria-hidden="true">記</span>
              <div>
                <small>RESEARCH</small>
                <strong>研究ログ</strong>
                <p>ラボの判断履歴と現在の評価状態を確認します。</p>
                <em>記録 {logs.length}件 · 品質 {dataQuality}/100</em>
              </div>
              <b aria-hidden="true">→</b>
            </button>
          </div>

          <div className="lab-overview-note">
            <strong>実運用への影響</strong>
            <span>「自動運転」だけが設定に応じて実端末へ操作します。端末研究と研究ログは表示・分析のみです。</span>
          </div>
        </>
      )}

      {section === "autopilot" && (
        <div className="lab-section-intro is-live">
          <div>
            <small>OPERATIONS AUTOPILOT</small>
            <strong>自動運転・判断支援</strong>
            <p>このカテゴリだけは実端末へ操作を送る場合があります。設定と現在の判断は下にまとめています。</p>
          </div>
          <span>実運用に影響あり</span>
        </div>
      )}

      {section === "terminal" && (
        <>
          <div className="lab-section-intro">
            <div>
              <small>TERMINAL STUDY</small>
              <strong>端末の予防保全・対応比較</strong>
              <p>端末のライブ指標をまとめ、何を先に確認する価値が高いか比較します。</p>
            </div>
            <span>表示・比較のみ</span>
          </div>

          <div className="lab-experiment-grid">
            <article className="lab-preventive">
              <div className="lab-card-heading">
                <div><small>PREVENTIVE MAINTENANCE</small><strong>予防保全インデックス</strong></div>
                <span>{highestPreventive}</span>
              </div>
              <p>故障確率ではなく、今の状態から「先回りして確認する価値」を示す試験指標です。</p>
              <div className="lab-preventive-list">
                {preventive.length === 0
                  ? <span className="lab-empty">端末データ待機中</span>
                  : preventive.map((item) => (
                      <div key={item.device.id}>
                        <span>{item.device.mode === "entry" ? "入口" : "出口"}</span>
                        <strong>{item.index}</strong>
                        <p>{item.action}</p>
                      </div>
                    ))}
              </div>
            </article>

            <article className="lab-action-outcome">
              <div className="lab-card-heading">
                <div><small>ACTION OUTCOME</small><strong>対応結果予測</strong></div>
                <span>β</span>
              </div>
              <p>現在の症状と操作の相性から、どの対応を先に試す価値が高いか比較します。</p>
              <div className="lab-effect-list">
                {actionEffects.length === 0
                  ? <span className="lab-empty">端末データ待機中</span>
                  : actionEffects.map((item) => (
                      <div key={item.name}>
                        <span><strong>{item.name}</strong><small>{item.note}</small></span>
                        <b className={`effect-${effectLabel(item.score)}`}>{effectLabel(item.score)} · {item.score}</b>
                      </div>
                    ))}
              </div>
              <small className="lab-study-note">数値は成功率ではなく、現在症状との適合度です。</small>
            </article>
          </div>
        </>
      )}

      {section === "research" && (
        <>
          <div className="lab-section-intro">
            <div>
              <small>RESEARCH</small>
              <strong>研究ログ・評価状態</strong>
              <p>ラボの判断履歴と、判断に使えるデータの状態だけをまとめています。</p>
            </div>
            <span>{logs.length}件の履歴</span>
          </div>

          <div className="lab-lower-grid">
            <article className="lab-decision-log">
              <div className="lab-card-heading">
                <div><small>DECISION TRACE</small><strong>判断ログ</strong></div>
                <span>{logs.length}件</span>
              </div>
              <div className="lab-log-list">
                {logs.length === 0
                  ? <span className="lab-empty">判断ログを準備しています</span>
                  : logs.map((log) => (
                      <div key={log.id} className={log.kind}>
                        <time>{formatClock(log.at)}</time>
                        <span><strong>{log.title}</strong><p>{log.detail}</p></span>
                      </div>
                    ))}
              </div>
            </article>

            <article className="lab-research-score">
              <div className="lab-card-heading">
                <div><small>RESEARCH STATUS</small><strong>現在の評価状態</strong></div>
                <span>LIVE</span>
              </div>
              <dl>
                <div><dt>データ品質</dt><dd>{dataQuality}/100</dd></div>
                <div><dt>最大ライブリスク</dt><dd>{highestRisk}/100</dd></div>
                <div><dt>受信中の端末</dt><dd>{devices.length}台</dd></div>
                <div><dt>重点監視</dt><dd>{watchedDevice}</dd></div>
              </dl>
              <p>ここに表示する値はライブ端末状態の評価だけに限定しています。</p>
            </article>
          </div>
        </>
      )}
    </section>,
    target
  );
}
