import {
  type ChangeEvent,
  useState,
} from "react";

import {
  resetEventMemberStatusesInFirestore,
} from "../memberStatusReset";

import type {
  FullBackupFile,
} from "../backupRestore";

import OnlineStatus from "./OnlineStatus";

import "./SettingsPage.css";

type SettingsPageProps = {
  setPage: (
    page: string
  ) => void;

  eventName: string;

  onResetAllData: () => void;
};

type AppSettings = {
  deviceName: string;
  successSoundEnabled: boolean;
  errorSoundEnabled: boolean;
};

const APP_VERSION =
  "2.7.0";

const SETTINGS_STORAGE_KEY =
  "qr-management-app-settings";

const defaultSettings:
  AppSettings = {
  deviceName: "",
  successSoundEnabled: true,
  errorSoundEnabled: true,
};

function loadSettings():
  AppSettings {
  try {
    const savedSettings =
      localStorage.getItem(
        SETTINGS_STORAGE_KEY
      );

    if (
      savedSettings === null
    ) {
      return defaultSettings;
    }

    const parsedSettings =
      JSON.parse(
        savedSettings
      ) as Partial<AppSettings>;

    return {
      ...defaultSettings,
      ...parsedSettings,
    };
  } catch (error) {
    console.error(
      "設定の読み込みに失敗しました。",
      error
    );

    return defaultSettings;
  }
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <g fill="currentColor">
        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(45 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(90 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(135 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(180 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(225 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(270 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(315 32 32)"
        />
      </g>

      <circle
        cx="32"
        cy="32"
        r="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <circle
        cx="32"
        cy="32"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />
    </svg>
  );
}

function SettingsPage({
  setPage,
  eventName,
  onResetAllData,
}: SettingsPageProps) {
  const [
    settings,
    setSettings,
  ] = useState<AppSettings>(
    loadSettings
  );

  const [
    showResetModal,
    setShowResetModal,
  ] = useState(false);

  const [
    showVersionModal,
    setShowVersionModal,
  ] = useState(false);

  const [
    resettingMemberStatuses,
    setResettingMemberStatuses,
  ] = useState(false);

  const [
    backupBusy,
    setBackupBusy,
  ] = useState(false);

  const [
    backupStatus,
    setBackupStatus,
  ] = useState("");

  const saveSettings = (
    newSettings:
      AppSettings
  ) => {
    try {
      localStorage.setItem(
        SETTINGS_STORAGE_KEY,
        JSON.stringify(
          newSettings
        )
      );

      setSettings(
        newSettings
      );
    } catch (error) {
      console.error(
        "設定の保存に失敗しました。",
        error
      );

      alert(
        "設定を保存できませんでした。"
      );
    }
  };

  const updateDeviceName = (
    deviceName: string
  ) => {
    saveSettings({
      ...settings,
      deviceName,
    });
  };

  const toggleSuccessSound =
    () => {
      saveSettings({
        ...settings,

        successSoundEnabled:
          !settings.successSoundEnabled,
      });
    };

  const toggleErrorSound =
    () => {
      saveSettings({
        ...settings,

        errorSoundEnabled:
          !settings.errorSoundEnabled,
      });
    };

  const resetMemberStatuses =
    async () => {
      if (
        resettingMemberStatuses
      ) {
        return;
      }

      if (
        eventName.trim() ===
        ""
      ) {
        alert(
          "イベントが設定されていません。"
        );

        return;
      }

      const confirmed =
        window.confirm(
          `${eventName}の部員の入退室状態を、全員「未入室」に戻しますか？\n名前とQR番号は削除されません。`
        );

      if (
        !confirmed
      ) {
        return;
      }

      setResettingMemberStatuses(
        true
      );

      try {
        const resetCount =
          await resetEventMemberStatusesInFirestore(
            eventName
          );

        if (
          resetCount ===
          0
        ) {
          alert(
            "リセットする部員情報がありません。"
          );

          return;
        }

        alert(
          `${resetCount}人の部員状態を全員「未入室」に戻しました。`
        );
      } catch (error) {
        console.error(
          "Firestoreの部員状態リセットに失敗しました。",
          error
        );

        alert(
          "部員状態をリセットできませんでした。\n通信状態を確認して、もう一度試してください。"
        );
      } finally {
        setResettingMemberStatuses(
          false
        );
      }
    };

  const downloadBackup = (
    backup:
      FullBackupFile,
    fileNamePrefix:
      string
  ) => {
    const blob =
      new Blob(
        [
          JSON.stringify(
            backup,
            null,
            2
          ),
        ],
        {
          type:
            "application/json",
        }
      );

    const downloadUrl =
      URL.createObjectURL(
        blob
      );

    const link =
      document.createElement(
        "a"
      );

    const dateText =
      new Date()
        .toISOString()
        .replace(
          /[:.]/g,
          "-"
        );

    link.href =
      downloadUrl;

    link.download =
      `${fileNamePrefix}-${dateText}.json`;

    document.body.appendChild(
      link
    );

    link.click();
    link.remove();

    URL.revokeObjectURL(
      downloadUrl
    );
  };

  const exportData =
    async () => {
      if (
        backupBusy
      ) {
        return;
      }

      setBackupBusy(true);
      setBackupStatus(
        "Firestoreから全データを集めています…"
      );

      try {
        const {
          createFullBackup,
          getBackupSummary,
        } = await import(
          "../backupRestore"
        );

        const backup =
          await createFullBackup(
            APP_VERSION
          );

        downloadBackup(
          backup,
          "QR管理システム完全バックアップ"
        );

        const summary =
          getBackupSummary(
            backup
          );

        setBackupStatus(
          `書き出し完了：イベント${summary.events}件・チケット${summary.tickets}件・部員${summary.members}件・受付履歴${summary.activityLogs}件`
        );
      } catch (error) {
        console.error(
          "完全バックアップの作成に失敗しました。",
          error
        );

        setBackupStatus("");

        alert(
          "完全バックアップを作成できませんでした。\nインターネット接続とFirestoreの状態を確認してください。"
        );
      } finally {
        setBackupBusy(false);
      }
    };

  const importData = async (
    event:
      ChangeEvent<HTMLInputElement>
  ) => {
    const file =
      event.target.files?.[
        0
      ];

    event.target.value =
      "";

    if (
      file === undefined
    ) {
      return;
    }

    if (
      backupBusy
    ) {
      return;
    }

    if (
      !file.name
        .toLowerCase()
        .endsWith(
          ".json"
        )
    ) {
      alert(
        "JSON形式のバックアップファイルを選択してください。"
      );

      return;
    }

    if (
      file.size >
      50 * 1024 * 1024
    ) {
      alert(
        "バックアップファイルが大きすぎます。"
      );

      return;
    }

    setBackupBusy(true);
    setBackupStatus(
      "バックアップファイルを確認しています…"
    );

    try {
      const {
        createFullBackup,
        getBackupSummary,
        parseFullBackup,
        restoreFullBackup,
      } = await import(
        "../backupRestore"
      );

      const backup =
        parseFullBackup(
          await file.text()
        );

      const summary =
        getBackupSummary(
          backup
        );

      const exportedDate =
        new Date(
          backup.exportedAt
        ).toLocaleString(
          "ja-JP"
        );

      const confirmed =
        window.confirm(
          `完全バックアップを復元しますか？\n\n作成日時：${exportedDate}\nイベント：${summary.events}件\nチケット：${summary.tickets}件\n部員：${summary.members}件\n受付履歴：${summary.activityLogs}件\n\n現在のFirestoreデータと端末設定は、この内容に置き換わります。復元中は画面を閉じないでください。`
        );

      if (
        !confirmed
      ) {
        setBackupStatus("");

        return;
      }

      setBackupStatus(
        "復元前の現在データを自動保存しています…"
      );

      const currentBackup =
        await createFullBackup(
          APP_VERSION
        );

      downloadBackup(
        currentBackup,
        "QR管理システム復元前自動バックアップ"
      );

      await restoreFullBackup(
        backup,
        currentBackup,
        setBackupStatus
      );

      setBackupStatus(
        "復元が完了しました。"
      );

      alert(
        "完全バックアップを復元しました。\n画面を再読み込みします。"
      );

      window.location.reload();
    } catch (error) {
      console.error(
        "完全バックアップの復元に失敗しました。",
        error
      );

      setBackupStatus("");

      alert(
        error instanceof Error
          ? error.message
          : "バックアップファイルを復元できませんでした。"
      );
    } finally {
      setBackupBusy(false);
    }
  };

  const openResetModal =
    () => {
      setShowResetModal(
        true
      );
    };

  const closeResetModal =
    () => {
      setShowResetModal(
        false
      );
    };

  const resetAllData =
    () => {
      closeResetModal();

      onResetAllData();
    };

  const openVersionModal =
    () => {
      setShowVersionModal(
        true
      );
    };

  const closeVersionModal =
    () => {
      setShowVersionModal(
        false
      );
    };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <div>
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="settings-title-row">
            <OnlineStatus />
          </div>
        </div>

        <div className="settings-mode-label">
          <span className="settings-mode-icon">
            <SettingsIcon />
          </span>

          <span className="settings-mode-copy">
            <small>
              SETTINGS
            </small>

            <strong>
              設定
            </strong>
          </span>
        </div>
      </header>

      <main className="settings-content">
        <section className="settings-section settings-system-section">
          <h3>
            システム情報
          </h3>

          <div className="settings-info-row">
            <span>
              バージョン情報
            </span>

            <button
              type="button"
              className="settings-version settings-version-button"
              aria-haspopup="dialog"
              aria-label={`バージョン${APP_VERSION}のアップデート内容を表示`}
              onClick={
                openVersionModal
              }
            >
              <span>
                {APP_VERSION}
              </span>

              <small>
                更新内容
              </small>
            </button>
          </div>

          <div className="settings-info-row">
            <span>
              現在のイベント
            </span>

            <strong>
              {eventName ||
                "未設定"}
            </strong>
          </div>
        </section>

        <section className="settings-section settings-reception-section">
          <h3>
            受付画面の変更
          </h3>

          <div className="settings-mode-buttons">
            <button
              type="button"
              className="settings-entry-button"
              onClick={() =>
                setPage(
                  "entry"
                )
              }
            >
              入口受付
            </button>

            <button
              type="button"
              className="settings-exit-button"
              onClick={() =>
                setPage(
                  "exit"
                )
              }
            >
              出口受付
            </button>

            <button
              type="button"
              className="settings-finish-button"
              onClick={() =>
                setPage(
                  "home"
                )
              }
            >
              受付終了
            </button>
          </div>

          <p className="settings-help">
            受付モードを変更すると、選択した受付画面へ移動します。
          </p>
        </section>

        <section className="settings-section settings-device-section">
          <h3>
            端末設定
          </h3>

          <label className="settings-device-name">
            <span>
              端末名
            </span>

            <input
              type="text"
              value={
                settings.deviceName
              }
              onChange={(
                event
              ) =>
                updateDeviceName(
                  event.target.value
                )
              }
              placeholder="例：入口受付iPad 1"
              maxLength={
                40
              }
            />
          </label>

          <div className="settings-switch-row">
            <div>
              <strong>
                受付成功音
              </strong>

              <span>
                QR受付成功時の音
              </span>
            </div>

            <button
              type="button"
              className={`settings-toggle ${
                settings.successSoundEnabled
                  ? "enabled"
                  : "disabled"
              }`}
              onClick={
                toggleSuccessSound
              }
            >
              {settings.successSoundEnabled
                ? "オン"
                : "オフ"}
            </button>
          </div>

          <div className="settings-switch-row">
            <div>
              <strong>
                受付エラー音
              </strong>

              <span>
                QR受付失敗時の音
              </span>
            </div>

            <button
              type="button"
              className={`settings-toggle ${
                settings.errorSoundEnabled
                  ? "enabled"
                  : "disabled"
              }`}
              onClick={
                toggleErrorSound
              }
            >
              {settings.errorSoundEnabled
                ? "オン"
                : "オフ"}
            </button>
          </div>
        </section>

        <section className="settings-section settings-data-section">
          <h3>
            データ管理
          </h3>

          <div className="settings-data-buttons">
            <button
              type="button"
              className="settings-export-button"
              disabled={
                backupBusy
              }
              aria-busy={
                backupBusy
              }
              onClick={() => {
                void exportData();
              }}
            >
              {backupBusy
                ? "処理中…"
                : "完全バックアップを作成"}
            </button>

            <label
              className={`settings-import-button${
                backupBusy
                  ? " settings-import-button-disabled"
                  : ""
              }`}
              aria-disabled={
                backupBusy
              }
            >
              完全バックアップを復元

              <input
                type="file"
                accept=".json,application/json"
                disabled={
                  backupBusy
                }
                onChange={
                  importData
                }
              />
            </label>

            <button
              type="button"
              className="settings-status-reset-button"
              disabled={
                resettingMemberStatuses ||
                backupBusy
              }
              aria-busy={
                resettingMemberStatuses
              }
              onClick={() => {
                void resetMemberStatuses();
              }}
            >
              {resettingMemberStatuses
                ? "部員状態をリセット中…"
                : "部員の状態をリセット"}
            </button>
          </div>

          <p className="settings-help">
            イベント、チケット、部員、受付履歴、デザイン、端末設定を1つのJSONファイルに保存します。復元すると、Firestore上の共有データもバックアップ作成時点へ戻ります。
          </p>

          <p className="settings-backup-warning">
            バックアップファイルにはQR認証情報が含まれます。部外者へ渡さず、安全な場所に保管してください。未送信のオフライン受付と稼働中端末情報は保存されません。
          </p>

          {backupStatus !== "" && (
            <p
              className="settings-backup-status"
              role="status"
              aria-live="polite"
            >
              {backupStatus}
            </p>
          )}
        </section>

        <section className="settings-section settings-auth-section">
          <h3>
            データ接続
          </h3>

          <div className="settings-info-row">
            <span>
              接続方式
            </span>

            <strong>
              自動認証
            </strong>
          </div>

          <p className="settings-help">
            サイトを開くと自動で接続します。初めて開くときだけ、インターネット接続が必要です。
          </p>
        </section>

        <section className="settings-danger-section">
          <h3>
            危険な操作
          </h3>

          <p>
            初期化すると、イベント・部員QR・名前・デザイン・設定などがすべて削除されます。
          </p>

          <button
            type="button"
            className="settings-initialize-button"
            onClick={
              openResetModal
            }
          >
            <strong>
              データを初期化
            </strong>

            <span>
              部長や顧問に確認してから実行してください
            </span>
          </button>
        </section>
      </main>

      <button
        type="button"
        className="settings-return-button"
        onClick={() =>
          setPage(
            "admin"
          )
        }
      >
        管理モードに戻る
      </button>

      {showVersionModal && (
        <div
          className="settings-update-background"
          role="presentation"
          onPointerDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeVersionModal();
            }
          }}
        >
          <section
            className="settings-update-window"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-update-title"
          >
            <div className="settings-update-heading">
              <span className="settings-update-version">
                VERSION {APP_VERSION}
              </span>

              <h2 id="settings-update-title">
                アップデート内容
              </h2>

              <p>
                起動を大幅に軽量化し、端末管理・過去データ・自動配備をより安定して使えるようにしました。
              </p>
            </div>

            <ul className="settings-update-list">
              <li>
                <span className="settings-update-check">
                  ✓
                </span>

                <div>
                  <strong>
                    初回JavaScriptを約64%削減
                  </strong>

                  <span>
                    起動時に読むJavaScriptを圧縮時約269KBから約96KBへ削減しました。
                  </span>
                </div>
              </li>

              <li>
                <span className="settings-update-check">
                  ✓
                </span>

                <div>
                  <strong>
                    必要な機能だけを追加読み込み
                  </strong>

                  <span>
                    Firestore、QR生成、カメラ、印刷、分析処理を使う場面ごとに分割しました。
                  </span>
                </div>
              </li>

              <li>
                <span className="settings-update-check">
                  ✓
                </span>

                <div>
                  <strong>
                    過去データの読み込みを安定化
                  </strong>

                  <span>
                    保存済みデータを先に表示し、Firebaseとの同期と旧データ移行を背後で続けるようにしました。
                  </span>
                </div>
              </li>

              <li>
                <span className="settings-update-check">
                  ✓
                </span>

                <div>
                  <strong>
                    端末種別の表示に対応
                  </strong>

                  <span>
                    利用申請と登録済み端末に端末種別を表示し、更新時の点滅も防止しました。
                  </span>
                </div>
              </li>

              <li>
                <span className="settings-update-check">
                  ✓
                </span>

                <div>
                  <strong>
                    Firestoreルールを自動配備
                  </strong>

                  <span>
                    ルール更新をGitHubからFirebaseへ自動反映し、配備忘れを防ぐようにしました。
                  </span>
                </div>
              </li>
            </ul>

            <button
              type="button"
              className="settings-update-close"
              onClick={
                closeVersionModal
              }
            >
              閉じる
            </button>
          </section>
        </div>
      )}

      {showResetModal && (
        <div
          className="settings-reset-background"
          role="presentation"
          onMouseDown={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeResetModal();
            }
          }}
        >
          <section
            className="settings-reset-window"
            role="dialog"
            aria-modal="true"
            aria-label="データ初期化の確認"
          >
            <div className="settings-reset-icon">
              !
            </div>

            <h2>
              データを初期化
            </h2>

            <p className="settings-reset-question">
              本当にすべてのデータを初期化しますか？
            </p>

            <p className="settings-reset-warning">
              イベント、部員QR、部員名、デザイン、設定などがすべて削除されます。
              <br />
              この操作は取り消せません。
            </p>

            <div className="settings-reset-buttons">
              <button
                type="button"
                className="settings-reset-cancel"
                onClick={
                  closeResetModal
                }
              >
                初期化しない
              </button>

              <button
                type="button"
                className="settings-reset-confirm"
                onClick={
                  resetAllData
                }
              >
                すべて初期化する
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default SettingsPage;
