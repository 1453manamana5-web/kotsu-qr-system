import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  subscribeToAuthorizedDevice,
  type AuthorizedDevice,
} from "../../src/deviceAccessFirestore";
import { auth } from "./firebase";

import "./personalized-control.css";

type FeatureId =
  | "overview"
  | "analysis"
  | "devices"
  | "incidents"
  | "diagnostics"
  | "maintenance"
  | "lab"
  | "copilot";

type UsageEvent = {
  feature: FeatureId;
  previousFeature: FeatureId | null;
  timestamp: number;
  timeBucket: number;
};

type LearningProfile = {
  version: 2;
  paused: boolean;
  events: UsageEvent[];
};

type RankedFeature = {
  id: FeatureId;
  label: string;
  score: number;
  reason: string;
};

const PROFILE_PREFIX = "qr-control-personalization-v2:uid:";
const LEGACY_ACTIVE_OPERATOR_KEY = "qr-control-active-operator-v1";
const MAX_EVENTS = 320;

const FEATURES: ReadonlyArray<{
  id: FeatureId;
  label: string;
  keywords: string[];
}> = [
  { id: "overview", label: "ライブ運行", keywords: ["ライブ運行"] },
  { id: "analysis", label: "分析", keywords: ["分析"] },
  { id: "devices", label: "端末", keywords: ["端末"] },
  { id: "incidents", label: "障害履歴", keywords: ["障害履歴"] },
  { id: "diagnostics", label: "通信診断", keywords: ["通信診断"] },
  { id: "maintenance", label: "保守・データ", keywords: ["保守・データ", "保守データ"] },
  { id: "lab", label: "管制ラボ", keywords: ["管制ラボ"] },
  { id: "copilot", label: "AI管制", keywords: ["AI管制"] },
];

const DEFAULT_PROFILE: LearningProfile = {
  version: 2,
  paused: false,
  events: [],
};

function profileStorageKey(uid: string) {
  return `${PROFILE_PREFIX}${uid}`;
}

function readProfile(uid: string): LearningProfile {
  try {
    const raw = window.localStorage.getItem(profileStorageKey(uid));
    if (raw === null) return DEFAULT_PROFILE;
    const parsed = JSON.parse(raw) as Partial<LearningProfile>;
    if (parsed.version !== 2 || !Array.isArray(parsed.events)) return DEFAULT_PROFILE;

    const events = parsed.events.filter((item): item is UsageEvent => {
      if (typeof item !== "object" || item === null) return false;
      const candidate = item as Partial<UsageEvent>;
      return (
        FEATURES.some((feature) => feature.id === candidate.feature) &&
        (candidate.previousFeature === null || FEATURES.some((feature) => feature.id === candidate.previousFeature)) &&
        typeof candidate.timestamp === "number" &&
        Number.isFinite(candidate.timestamp) &&
        typeof candidate.timeBucket === "number" &&
        Number.isFinite(candidate.timeBucket)
      );
    });

    return {
      version: 2,
      paused: parsed.paused === true,
      events: events.slice(-MAX_EVENTS),
    };
  } catch {
    return DEFAULT_PROFILE;
  }
}

function writeProfile(uid: string, profile: LearningProfile) {
  window.localStorage.setItem(profileStorageKey(uid), JSON.stringify(profile));
}

function timeBucket(timestamp = Date.now()) {
  return Math.floor(new Date(timestamp).getHours() / 2);
}

function featureById(id: FeatureId) {
  return FEATURES.find((feature) => feature.id === id) ?? FEATURES[0];
}

function featureFromButton(button: HTMLButtonElement) {
  const text = (button.textContent ?? "").replace(/\s+/g, "").toLowerCase();
  return FEATURES.find((feature) =>
    feature.keywords.some((keyword) => text.includes(keyword.replace(/\s+/g, "").toLowerCase()))
  ) ?? null;
}

function currentFeatureFromDom(): FeatureId | null {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("aside.sidebar nav button"));
  const active = buttons.find((button) => button.classList.contains("active"));
  return active === undefined ? null : featureFromButton(active)?.id ?? null;
}

function recencyWeight(timestamp: number, now: number) {
  const ageHours = Math.max(0, (now - timestamp) / 3_600_000);
  return Math.max(0.15, Math.exp(-ageHours / 72));
}

function buildFrequentRanking(events: UsageEvent[], now: number): RankedFeature[] {
  return FEATURES.map((feature) => {
    const matching = events.filter((event) => event.feature === feature.id);
    const score = matching.reduce((total, event) => total + recencyWeight(event.timestamp, now), 0);
    return {
      id: feature.id,
      label: feature.label,
      score,
      reason: matching.length === 0 ? "まだ利用記録なし" : `利用 ${matching.length}回`,
    };
  })
    .filter((item) => item.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, 3);
}

function buildNextRanking(
  events: UsageEvent[],
  currentFeature: FeatureId | null,
  now: number
): RankedFeature[] {
  const bucket = timeBucket(now);

  return FEATURES.map((feature) => {
    const allUses = events.filter((event) => event.feature === feature.id);
    const recentFrequency = allUses.reduce(
      (total, event) => total + recencyWeight(event.timestamp, now),
      0
    );
    const timeUses = allUses.filter((event) => event.timeBucket === bucket).length;
    const transitionUses = currentFeature === null
      ? 0
      : events.filter((event) => event.previousFeature === currentFeature && event.feature === feature.id).length;

    const score = recentFrequency + timeUses * 1.8 + transitionUses * 3.2;
    const reason = transitionUses > 0
      ? `${featureById(currentFeature ?? feature.id).label}の次に${transitionUses}回使用`
      : timeUses > 0
        ? "この時間帯によく使用"
        : allUses.length > 0
          ? "最近よく使用"
          : "学習データ待ち";

    return {
      id: feature.id,
      label: feature.label,
      score,
      reason,
    };
  })
    .filter((item) => item.id !== currentFeature && item.score > 0)
    .sort((first, second) => second.score - first.score)
    .slice(0, 3);
}

function findSidebarButton(featureId: FeatureId) {
  const feature = featureById(featureId);
  return Array.from(document.querySelectorAll<HTMLButtonElement>("aside.sidebar nav button"))
    .find((button) => {
      const text = (button.textContent ?? "").replace(/\s+/g, "");
      return feature.keywords.some((keyword) => text.includes(keyword.replace(/\s+/g, "")));
    }) ?? null;
}

function learningLabel(eventCount: number) {
  if (eventCount < 3) return "学習開始";
  if (eventCount < 10) return "学習中";
  if (eventCount < 25) return "個人傾向を反映中";
  return "個人傾向を学習済み";
}

function ensureOverviewHost() {
  const summary = document.querySelector(".summary-grid");
  if (summary === null || summary.parentElement === null) return null;

  let host = document.getElementById("personalized-control-host");
  if (host === null) {
    host = document.createElement("div");
    host.id = "personalized-control-host";
  }

  if (host.parentElement !== summary.parentElement || host.nextElementSibling !== summary) {
    summary.parentElement.insertBefore(host, summary);
  }
  return host;
}

function PersonalizedPanel({
  device,
  profile,
  frequent,
  nextFeatures,
  currentFeature,
  onNavigate,
  onTogglePause,
  onReset,
}: {
  device: AuthorizedDevice;
  profile: LearningProfile;
  frequent: RankedFeature[];
  nextFeatures: RankedFeature[];
  currentFeature: FeatureId | null;
  onNavigate: (feature: FeatureId) => void;
  onTogglePause: () => void;
  onReset: () => void;
}) {
  const displayName = device.displayName.trim() || device.deviceName.trim() || "認証済み部員";
  const maxFrequent = Math.max(...frequent.map((item) => item.score), 1);
  const maxNext = Math.max(...nextFeatures.map((item) => item.score), 1);

  return (
    <section className="personalized-control-panel">
      <div className="personalized-control-heading">
        <div>
          <small>AI PERSONALIZED CONTROL</small>
          <h2>{displayName} 専用の管制アシスト</h2>
          <p>
            {profile.paused
              ? "学習を一時停止しています。これまでの傾向だけを表示します。"
              : `${learningLabel(profile.events.length)} · ${profile.events.length}件の操作から傾向を計算`}
          </p>
        </div>
        <div className="personalized-control-actions">
          <button type="button" onClick={onTogglePause}>{profile.paused ? "学習を再開" : "学習を一時停止"}</button>
          <button type="button" className="subtle" onClick={onReset} disabled={profile.events.length === 0}>学習リセット</button>
        </div>
      </div>

      <div className="personalized-control-grid">
        <article className="personalized-card next-card">
          <div className="personalized-card-title">
            <div><small>NEXT ACTION</small><strong>次に使いそうな機能</strong></div>
            <span>{currentFeature === null ? "現在画面を確認中" : `${featureById(currentFeature).label}から予測`}</span>
          </div>
          {nextFeatures.length === 0 ? (
            <p className="personalized-empty">もう少し操作すると、ここに本人専用の候補が出ます。</p>
          ) : (
            <div className="personalized-ranking">
              {nextFeatures.map((item, index) => (
                <button type="button" key={item.id} onClick={() => onNavigate(item.id)}>
                  <b>{index + 1}</b>
                  <div>
                    <strong>{item.label}</strong>
                    <span>{item.reason}</span>
                    <i><em style={{ width: `${Math.max(12, item.score / maxNext * 100)}%` }} /></i>
                  </div>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="personalized-card frequent-card">
          <div className="personalized-card-title">
            <div><small>FREQUENTLY USED</small><strong>よく使う機能</strong></div>
            <span>最近の操作を重視</span>
          </div>
          {frequent.length === 0 ? (
            <p className="personalized-empty">まだ利用傾向がありません。</p>
          ) : (
            <div className="personalized-frequency-list">
              {frequent.map((item, index) => (
                <button type="button" key={item.id} onClick={() => onNavigate(item.id)}>
                  <span>{index + 1}</span>
                  <div><strong>{item.label}</strong><small>{item.reason}</small></div>
                  <i><em style={{ width: `${Math.max(12, item.score / maxFrequent * 100)}%` }} /></i>
                </button>
              ))}
            </div>
          )}
        </article>
      </div>

      <p className="personalized-control-note">
        個人学習は受付アプリの端末認証UIDだけで識別します。部員QR番号は毎年変わるため、学習の識別には使用しません。
      </p>
    </section>
  );
}

export default function AuthenticatedPersonalizedControlBridge() {
  const [device, setDevice] = useState<AuthorizedDevice | null>(null);
  const [profile, setProfile] = useState<LearningProfile>(DEFAULT_PROFILE);
  const [overviewHost, setOverviewHost] = useState<HTMLElement | null>(null);
  const [topbarHost, setTopbarHost] = useState<Element | null>(null);
  const [currentFeature, setCurrentFeature] = useState<FeatureId | null>(() => currentFeatureFromDom());
  const [clock, setClock] = useState(0);

  useEffect(() => {
    window.localStorage.removeItem(LEGACY_ACTIVE_OPERATOR_KEY);
  }, []);

  useEffect(() => {
    let unsubscribeDevice = () => {};

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      unsubscribeDevice();
      unsubscribeDevice = () => {};

      if (user === null) {
        setDevice(null);
        return;
      }

      unsubscribeDevice = subscribeToAuthorizedDevice(
        user.uid,
        (nextDevice) => setDevice(nextDevice?.active === true ? nextDevice : null),
        (error) => console.error("個人化AI用の端末認証情報を取得できませんでした。", error)
      );
    });

    return () => {
      unsubscribeAuth();
      unsubscribeDevice();
    };
  }, []);

  useEffect(() => {
    if (device === null) {
      queueMicrotask(() => setProfile(DEFAULT_PROFILE));
      return;
    }

    queueMicrotask(() => setProfile(readProfile(device.uid)));
  }, [device]);

  useEffect(() => {
    const refreshHosts = () => {
      setOverviewHost(ensureOverviewHost());
      setTopbarHost(document.querySelector(".topbar-meta"));
      setCurrentFeature(currentFeatureFromDom());
    };

    refreshHosts();
    const observer = new MutationObserver(refreshHosts);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    queueMicrotask(() => setClock(Date.now()));
    const interval = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (device === null) return undefined;

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("aside.sidebar nav button");
      if (button === null) return;
      const feature = featureFromButton(button);
      if (feature === null) return;

      const previousFeature = currentFeatureFromDom();
      setCurrentFeature(feature.id);
      setProfile((current) => {
        if (current.paused) return current;
        const nextEvent: UsageEvent = {
          feature: feature.id,
          previousFeature,
          timestamp: Date.now(),
          timeBucket: timeBucket(),
        };
        const nextProfile: LearningProfile = {
          ...current,
          events: [...current.events, nextEvent].slice(-MAX_EVENTS),
        };
        writeProfile(device.uid, nextProfile);
        return nextProfile;
      });
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [device]);

  const frequent = useMemo(
    () => buildFrequentRanking(profile.events, clock),
    [clock, profile.events]
  );

  const nextFeatures = useMemo(
    () => buildNextRanking(profile.events, currentFeature, clock),
    [clock, currentFeature, profile.events]
  );

  const navigate = useCallback((feature: FeatureId) => {
    findSidebarButton(feature)?.click();
  }, []);

  const togglePause = useCallback(() => {
    if (device === null) return;
    setProfile((current) => {
      const nextProfile = { ...current, paused: !current.paused };
      writeProfile(device.uid, nextProfile);
      return nextProfile;
    });
  }, [device]);

  const resetLearning = useCallback(() => {
    if (device === null || profile.events.length === 0) return;
    const displayName = device.displayName.trim() || device.deviceName.trim() || "この部員";
    if (!window.confirm(`${displayName}の管制学習データをリセットしますか？`)) return;
    const nextProfile: LearningProfile = { version: 2, paused: false, events: [] };
    writeProfile(device.uid, nextProfile);
    setProfile(nextProfile);
  }, [device, profile.events.length]);

  const displayName = device?.displayName.trim() || device?.deviceName.trim() || "";

  return (
    <>
      {topbarHost !== null && device !== null && createPortal(
        <div className="personalized-operator-selector" title={`${device.deviceName || "部員端末"}の受付アプリ認証を使用`}>
          <span>担当部員</span>
          <strong>{displayName || "認証済み部員"}</strong>
          <i className={profile.paused ? "paused" : "learning"} aria-hidden="true" />
        </div>,
        topbarHost
      )}

      {overviewHost !== null && device !== null && createPortal(
        <PersonalizedPanel
          device={device}
          profile={profile}
          frequent={frequent}
          nextFeatures={nextFeatures}
          currentFeature={currentFeature}
          onNavigate={navigate}
          onTogglePause={togglePause}
          onReset={resetLearning}
        />,
        overviewHost
      )}

      {overviewHost !== null && device === null && createPortal(
        <section className="personalized-control-panel personalized-control-empty">
          <div>
            <small>AI PERSONALIZED CONTROL</small>
            <h2>受付アプリの端末認証を確認しています</h2>
            <p>認証済み部員端末が確認できると、その認証UID専用の管制学習を開始します。</p>
          </div>
        </section>,
        overviewHost
      )}
    </>
  );
}
