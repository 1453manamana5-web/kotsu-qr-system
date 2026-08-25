import { type ChangeEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { APP_VERSION } from "../../src/appVersion";
import type { FullBackupFile } from "../../src/backupRestore";
import { auth } from "./firebase";

const DELETE_BATCH_SIZE = 400;
const ASSIST_SETTING_PREFIX = "qr-control-personalized-assist-enabled-v1:uid:";
const PERSONALIZATION_PROFILE_PREFIX = "qr-control-personalization-v2:uid:";

function assistSettingKey(uid: string) {
  return `${ASSIST_SETTING_PREFIX}${uid}`;
}

function personalizationProfileKey(uid: string) {
  return `${PERSONALIZATION_PROFILE_PREFIX}${uid}`;
}

function readAssistEnabled(uid: string) {
  return window.localStorage.getItem(assistSettingKey(uid)) !== "0";
}

function writeAssistEnabled(uid: string, enabled: boolean) {
  window.localStorage.setItem(assistSettingKey(uid), enabled ? "1" : "0");

  const profileKey = personalizationProfileKey(uid);
  try {
    const raw = window.localStorage.getItem(profileKey);
    const parsed = raw === null ? null : JSON.parse(raw) as Record<string, unknown>;
    const events = Array.isArray(parsed?.events) ? parsed.events : [];
    window.localStorage.setItem(profileKey, JSON.stringify({
      ...(parsed ?? {}),
      version: 2,
      paused: !enabled,
      events,
    }));
  } catch {
    window.localStorage.setItem(profileKey, JSON.stringify({
      version: 2,
      paused: !enabled,
      events: [],
    }));
  }
}

function syncAssistRuntime(enabled: boolean) {
  const shell = document.querySelector(".control-shell");
  if (shell instanceof HTMLElement) {
    shell.classList.toggle("personalized-assist-disabled", !enabled);
  }

  const button = Array.from(document.querySelectorAll<HTMLButtonElement>(".personalized-control-actions button"))
    .find((item) => {
      const text = (item.textContent ?? "").trim();
      return enabled ? text === "学習を再開" : text === "学習を一時停止";
    });
  button?.click();
}

function hideLegacyAssistPauseButton() {
  for (const button of document.querySelectorAll<HTMLButtonElement>(".personalized-control-actions button")) {
    const text = (button.textContent ?? "").trim();
    if (text === "学習を一時停止" || text === "学習を再開") {
      button.hidden = true;
      button.setAttribute("aria-hidden", "true");
      button.tabIndex = -1;
    }
  }
}

function downloadBackup(backup: FullBackupFile, fileNamePrefix: string) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const dateText = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = downloadUrl;
  link.download = `${fileNamePrefix}-${dateText}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}

async function deleteReferences(
  database: Firestore,
  references: DocumentReference<DocumentData>[]
) {
  for (let offset = 0; offset < references.length; offset += DELETE_BATCH_SIZE) {
    const batch = writeBatch(database);
    references.slice(offset, offset + DELETE_BATCH_SIZE).forEach((reference) => {
      batch.delete(reference);
    });
    await batch.commit();
  }
}

async function deleteCollectionDocuments(
  database: Firestore,
  path: [string, ...string[]]
) {
  const snapshot = await getDocs(collection(database, ...path));
  await deleteReferences(database, snapshot.docs.map((item) => item.ref));
}

async function resetAllData(database: Firestore, currentBackup: FullBackupFile) {
  for (const eventData of currentBackup.firestore.eventData) {
    const eventDataId = eventData.eventDocumentId;

    await deleteCollectionDocuments(database, [
      "event-data",
      eventDataId,
      "reception-devices",
    ]);

    for (const collectionName of ["tickets", "members", "activity", "analytics"]) {
      await deleteCollectionDocuments(database, [
        "event-data",
        eventDataId,
        collectionName,
      ]);
    }

    await deleteDoc(doc(database, "event-data", eventDataId));
  }

  await deleteReferences(
    database,
    currentBackup.firestore.events.map((item) => doc(database, "events", item.id))
  );

  await deleteReferences(
    database,
    currentBackup.firestore.memberCards.map((item) => doc(database, "member-cards", item.id))
  );

  // createFullBackup は device-access をバックアップ対象から除外しているため、
  // 承認済み部員端末の権限はここでも維持されます。
  await deleteReferences(
    database,
    currentBackup.firestore.system.map((item) => doc(database, "system", item.id))
  );

  const localKeys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key !== null && key.startsWith("qr-management-")) localKeys.push(key);
  }
  localKeys.forEach((key) => localStorage.removeItem(key));
}

export default function MaintenanceDataBridge({ database }: { database: Firestore }) {
  const [navTarget, setNavTarget] = useState<Element | null>(null);
  const [mainTarget, setMainTarget] = useState<Element | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [operatorUid, setOperatorUid] = useState<string | null>(null);
  const [assistEnabled, setAssistEnabled] = useState(true);

  useEffect(() => onAuthStateChanged(auth, (user) => {
    setOperatorUid(user?.uid ?? null);
    setAssistEnabled(user === null ? true : readAssistEnabled(user.uid));
  }), []);

  useEffect(() => {
    const updateTargets = () => {
      setNavTarget((current) => {
        const next = document.querySelector(".sidebar nav");
        return current === next ? current : next;
      });
      setMainTarget((current) => {
        const next = document.querySelector(".control-shell main");
        return current === next ? current : next;
      });
      hideLegacyAssistPauseButton();
    };

    const initial = window.setTimeout(updateTargets, 0);
    const observer = new MutationObserver(updateTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(initial);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const shell = document.querySelector(".control-shell");
    if (!(shell instanceof HTMLElement)) return undefined;
    shell.classList.toggle("maintenance-view-open", open);
    return () => shell.classList.remove("maintenance-view-open");
  }, [open]);

  useEffect(() => {
    if (operatorUid === null) return;
    syncAssistRuntime(assistEnabled);
  }, [assistEnabled, operatorUid]);

  useEffect(() => {
    if (navTarget === null) return undefined;
    const closeWhenAnotherViewOpens = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (button === null || button.classList.contains("maintenance-nav-button")) return;
      setOpen(false);
    };
    navTarget.addEventListener("click", closeWhenAnotherViewOpens);
    return () => navTarget.removeEventListener("click", closeWhenAnotherViewOpens);
  }, [navTarget]);

  const toggleAssist = () => {
    if (operatorUid === null) return;
    const nextEnabled = !assistEnabled;
    writeAssistEnabled(operatorUid, nextEnabled);
    setAssistEnabled(nextEnabled);
  };

  const exportData = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("Firestoreから全データを集めています…");
    try {
      const { createFullBackup, getBackupSummary } = await import("../../src/backupRestore");
      const backup = await createFullBackup(APP_VERSION);
      downloadBackup(backup, "QR管理システム完全バックアップ");
      const summary = getBackupSummary(backup);
      setStatus(
        `バックアップ完了：イベント${summary.events}件・チケット${summary.tickets}件・部員${summary.members}件・受付履歴${summary.activityLogs}件`
      );
    } catch (error) {
      console.error("管制画面から完全バックアップを作成できませんでした。", error);
      setStatus("");
      window.alert("完全バックアップを作成できませんでした。通信状態を確認してください。");
    } finally {
      setBusy(false);
    }
  };

  const importData = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined || busy) return;
    if (!file.name.toLowerCase().endsWith(".json")) {
      window.alert("JSON形式のバックアップファイルを選択してください。");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      window.alert("バックアップファイルが大きすぎます。");
      return;
    }

    setBusy(true);
    setStatus("バックアップファイルを確認しています…");
    try {
      const {
        createFullBackup,
        getBackupSummary,
        parseFullBackup,
        restoreFullBackup,
      } = await import("../../src/backupRestore");
      const backup = parseFullBackup(await file.text());
      const summary = getBackupSummary(backup);
      const exportedDate = new Date(backup.exportedAt).toLocaleString("ja-JP");
      const confirmed = window.confirm(
        `完全バックアップを復元しますか？\n\n作成日時：${exportedDate}\nイベント：${summary.events}件\nチケット：${summary.tickets}件\n部員：${summary.members}件\n受付履歴：${summary.activityLogs}件\n\n現在の共有データと端末設定は、この内容に置き換わります。`
      );
      if (!confirmed) {
        setStatus("");
        return;
      }

      setStatus("復元前の現在データを自動保存しています…");
      const currentBackup = await createFullBackup(APP_VERSION);
      downloadBackup(currentBackup, "QR管理システム復元前自動バックアップ");
      await restoreFullBackup(backup, currentBackup, setStatus);
      setStatus("復元が完了しました。");
      window.alert("完全バックアップを復元しました。画面を再読み込みします。");
      window.location.reload();
    } catch (error) {
      console.error("管制画面から完全バックアップを復元できませんでした。", error);
      setStatus("");
      window.alert(
        error instanceof Error
          ? error.message
          : "バックアップファイルを復元できませんでした。"
      );
    } finally {
      setBusy(false);
    }
  };

  const runFullReset = async () => {
    if (busy) return;
    if (!window.confirm(
      "すべてのイベント・チケット・部員・受付履歴・分析データなどを初期化します。\n実行前に完全バックアップを自動作成します。\n\nこの操作は元に戻せません。実行しますか？"
    )) return;

    setBusy(true);
    setStatus("初期化前の完全バックアップを作成しています…");
    try {
      const { createFullBackup, getBackupSummary } = await import("../../src/backupRestore");
      const currentBackup = await createFullBackup(APP_VERSION);
      downloadBackup(currentBackup, "QR管理システム初期化前自動バックアップ");
      const summary = getBackupSummary(currentBackup);
      setStatus(
        `バックアップ完了。イベント${summary.events}件を含む共有データを初期化しています…`
      );
      await resetAllData(database, currentBackup);
      setStatus("全データの初期化が完了しました。");
      window.alert("QR管理システムの全データを初期化しました。画面を再読み込みします。");
      window.location.reload();
    } catch (error) {
      console.error("管制画面から全データを初期化できませんでした。", error);
      setStatus("");
      window.alert(
        "全データを初期化できませんでした。初期化前バックアップが保存されている場合は保持したまま、通信状態を確認してください。"
      );
    } finally {
      setBusy(false);
    }
  };

  if (navTarget === null || mainTarget === null) return null;

  return (
    <>
      {createPortal(
        <button
          type="button"
          className={`maintenance-nav-button${open ? " active" : ""}`}
          onClick={() => setOpen(true)}
          aria-pressed={open}
        >
          <span aria-hidden="true">⚙</span>
          設定
          <span className="settings-legacy-keyword">保守・データ</span>
        </button>,
        navTarget
      )}

      {open && createPortal(
        <section className="page-panel maintenance-data-page">
          <div className="page-heading maintenance-page-heading">
            <div>
              <small>CONTROL SETTINGS</small>
              <h2>設定</h2>
            </div>
            <span>{busy ? "処理中" : "この部員の設定"}</span>
          </div>

          <p className="maintenance-page-intro">
            管制画面の使い方と、バックアップなどのデータ管理をここで設定します。
          </p>

          <section className="control-settings-section" aria-labelledby="assist-setting-title">
            <div className="control-settings-section-heading">
              <div><small>ASSIST</small><h3 id="assist-setting-title">管制アシスト</h3></div>
              <span className={assistEnabled ? "is-on" : "is-off"}>{assistEnabled ? "ON" : "OFF"}</span>
            </div>
            <div className="assist-setting-row">
              <div>
                <strong>あなた向けの管制アシストを使う</strong>
                <p>操作傾向から「次に使いそうな機能」と「よく使う機能」を表示します。OFFにしても学習済みデータは消えません。</p>
              </div>
              <button
                type="button"
                className={`settings-toggle${assistEnabled ? " is-on" : ""}`}
                onClick={toggleAssist}
                disabled={operatorUid === null}
                role="switch"
                aria-checked={assistEnabled}
                aria-label="管制アシストをオン・オフ"
              >
                <span />
              </button>
            </div>
            <p className="assist-setting-note">
              {operatorUid === null
                ? "受付アプリの端末認証を確認しています。"
                : assistEnabled
                  ? "現在ONです。ライブ運行で個人向け候補を表示し、操作傾向を学習します。"
                  : "現在OFFです。個人向け表示と操作学習を停止しています。"}
            </p>
          </section>

          <div className="settings-section-title">
            <div><small>DATA MANAGEMENT</small><strong>データ管理</strong></div>
            <span>重要な操作は実行前に確認します</span>
          </div>

          <div className="maintenance-data-grid">
            <article>
              <small>BACKUP</small>
              <strong>完全バックアップ</strong>
              <p>イベント、チケット、部員、受付履歴、分析、端末設定をJSONへ保存します。</p>
              <button type="button" disabled={busy} onClick={() => void exportData()}>
                {busy ? "処理中…" : "バックアップを作成"}
              </button>
            </article>

            <article>
              <small>RESTORE</small>
              <strong>バックアップ復元</strong>
              <p>復元前に現在データを自動保存してから、共有データをバックアップ時点へ戻します。</p>
              <label className={busy ? "is-disabled" : ""}>
                バックアップを選択
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={importData}
                />
              </label>
            </article>

            <article className="danger">
              <small>FULL RESET</small>
              <strong>全部リセット</strong>
              <p>実行前に完全バックアップを自動作成します。承認済み部員端末の権限は維持されます。</p>
              <button type="button" disabled={busy} onClick={() => void runFullReset()}>
                全データを初期化
              </button>
            </article>
          </div>

          <p className="maintenance-data-note">
            バックアップにはQR認証情報が含まれます。部外者へ渡さず、安全な場所に保管してください。
          </p>
          {status !== "" && <p className="maintenance-data-status" role="status">{status}</p>}
        </section>,
        mainTarget
      )}
    </>
  );
}
