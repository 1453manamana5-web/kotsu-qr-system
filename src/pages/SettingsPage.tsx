import {
  type ChangeEvent,
  useState,
} from "react";

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
  "2.5.2";

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

function createEventMembersStorageKey(
  eventName: string
) {
  const safeEventName =
    eventName.trim() === ""
      ? "event-not-set"
      : encodeURIComponent(
          eventName.trim()
        );

  return `qr-management-event-members-${safeEventName}`;
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
    () => {
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

      try {
        const storageKey =
          createEventMembersStorageKey(
            eventName
          );

        const savedMembers =
          localStorage.getItem(
            storageKey
          );

        if (
          savedMembers ===
          null
        ) {
          alert(
            "リセットする部員情報がありません。"
          );

          return;
        }

        const parsedMembers:
          unknown =
          JSON.parse(
            savedMembers
          );

        if (
          !Array.isArray(
            parsedMembers
          )
        ) {
          alert(
            "部員情報の形式が正しくありません。"
          );

          return;
        }

        const resetMembers =
          parsedMembers.map(
            (member) => ({
              ...member,
              status:
                "未入室",
            })
          );

        localStorage.setItem(
          storageKey,
          JSON.stringify(
            resetMembers
          )
        );

        alert(
          "部員の状態を全員「未入室」に戻しました。"
        );
      } catch (error) {
        console.error(
          "部員状態のリセットに失敗しました。",
          error
        );

        alert(
          "部員状態をリセットできませんでした。"
        );
      }
    };

  const exportData =
    () => {
      try {
        const exportedStorage:
          Record<
            string,
            string
          > = {};

        for (
          let index = 0;
          index <
          localStorage.length;
          index += 1
        ) {
          const key =
            localStorage.key(
              index
            );

          if (
            key !== null &&
            key.startsWith(
              "qr-management-"
            )
          ) {
            const value =
              localStorage.getItem(
                key
              );

            if (
              value !== null
            ) {
              exportedStorage[
                key
              ] = value;
            }
          }
        }

        const exportFile = {
          appName:
            "交通研究部QRコード管理システム",

          version:
            APP_VERSION,

          exportedAt:
            new Date().toISOString(),

          data:
            exportedStorage,
        };

        const blob =
          new Blob(
            [
              JSON.stringify(
                exportFile,
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
            .slice(
              0,
              10
            );

        link.href =
          downloadUrl;

        link.download =
          `QR管理システムバックアップ-${dateText}.json`;

        document.body.appendChild(
          link
        );

        link.click();
        link.remove();

        URL.revokeObjectURL(
          downloadUrl
        );
      } catch (error) {
        console.error(
          "データの書き出しに失敗しました。",
          error
        );

        alert(
          "データを書き出せませんでした。"
        );
      }
    };

  const importData = (
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

    const reader =
      new FileReader();

    reader.onload =
      () => {
        try {
          if (
            typeof reader.result !==
            "string"
          ) {
            throw new Error(
              "ファイルを読み込めませんでした。"
            );
          }

          const parsedFile:
            unknown =
            JSON.parse(
              reader.result
            );

          if (
            typeof parsedFile !==
              "object" ||
            parsedFile ===
              null ||
            !(
              "data" in
              parsedFile
            )
          ) {
            throw new Error(
              "バックアップファイルの形式が違います。"
            );
          }

          const data = (
            parsedFile as {
              data:
                unknown;
            }
          ).data;

          if (
            typeof data !==
              "object" ||
            data ===
              null ||
            Array.isArray(
              data
            )
          ) {
            throw new Error(
              "バックアップデータが正しくありません。"
            );
          }

          const confirmed =
            window.confirm(
              "バックアップデータを読み込みますか？\n同じ項目の現在データは上書きされます。"
            );

          if (
            !confirmed
          ) {
            return;
          }

          Object.entries(
            data
          ).forEach(
            (
              [
                key,
                value,
              ]
            ) => {
              if (
                key.startsWith(
                  "qr-management-"
                ) &&
                typeof value ===
                  "string"
              ) {
                localStorage.setItem(
                  key,
                  value
                );
              }
            }
          );

          alert(
            "データを読み込みました。画面を再読み込みします。"
          );

          window.location.reload();
        } catch (error) {
          console.error(
            "データの読み込みに失敗しました。",
            error
          );

          alert(
            "バックアップファイルを読み込めませんでした。"
          );
        }
      };

    reader.onerror =
      () => {
        alert(
          "ファイルを読み込めませんでした。"
        );
      };

    reader.readAsText(
      file
    );
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

            <strong className="settings-version">
              {APP_VERSION}
            </strong>
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
              onClick={
                exportData
              }
            >
              データを書き出す
            </button>

            <label className="settings-import-button">
              データを読み込む

              <input
                type="file"
                accept=".json,application/json"
                onChange={
                  importData
                }
              />
            </label>

            <button
              type="button"
              className="settings-status-reset-button"
              onClick={
                resetMemberStatuses
              }
            >
              部員の状態をリセット
            </button>
          </div>

          <p className="settings-help">
            書き出したJSONファイルは、別端末への移行やバックアップに使用できます。
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
