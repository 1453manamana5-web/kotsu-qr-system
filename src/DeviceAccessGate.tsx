import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";

import {
  auth,
} from "./firebase";

import {
  bootstrapFirstMemberDevice,
  submitDeviceAccessRequest,
  subscribeToAuthorizedDevice,
  subscribeToDeviceAccessConfig,
  subscribeToDeviceRequest,
  type AuthorizedDevice,
  type DeviceAccessRequest,
  type DeviceRole,
} from "./deviceAccessFirestore";

import {
  DeviceAccessContext,
  type DeviceAccessContextValue,
} from "./deviceAccessContext";

import "./DeviceAccessGate.css";

type DeviceAccessScreenState =
  | "checking"
  | "ready"
  | "error";

type DeviceAccessGateProps = {
  children: ReactNode;
  onScreenStateChange?: (
    state: DeviceAccessScreenState
  ) => void;
};

function getDefaultDeviceName() {
  const isIPad =
    /iPad/i.test(
      navigator.userAgent
    ) ||
    (
      /Macintosh/i.test(
        navigator.userAgent
      ) &&
      navigator.maxTouchPoints > 1
    );

  if (isIPad) {
    return "受付用iPad";
  }

  if (
    /iPhone/i.test(
      navigator.userAgent
    )
  ) {
    return "iPhone";
  }

  if (
    /Android/i.test(
      navigator.userAgent
    )
  ) {
    return "Android端末";
  }

  return "部員端末";
}

function getErrorMessage(
  error: unknown
) {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";

  if (
    code ===
    "unavailable"
  ) {
    return "通信できませんでした。オンラインにして、もう一度お試しください。";
  }

  if (
    code ===
    "permission-denied"
  ) {
    return "この端末には操作権限がありません。別の部員端末で申請状態を確認してください。";
  }

  if (
    error instanceof Error &&
    error.message.trim() !== ""
  ) {
    return error.message;
  }

  return "操作を完了できませんでした。通信状態を確認してください。";
}

function DeviceLogo() {
  return (
    <div
      className="device-access-logo"
      aria-hidden="true"
    >
      <span>QR</span>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="device-access-page">
      <section className="device-access-card device-access-card-compact">
        <DeviceLogo />

        <div
          className="device-access-loading"
          aria-live="polite"
        >
          <span
            className="device-access-spinner"
            aria-hidden="true"
          />

          <h1>
            端末を確認しています
          </h1>

          <p>
            そのままお待ちください
          </p>
        </div>
      </section>
    </main>
  );
}

function DeviceAccessGate({
  children,
  onScreenStateChange,
}: DeviceAccessGateProps) {
  const uid =
    auth.currentUser?.uid ?? "";
  const [configLoaded, setConfigLoaded] =
    useState(false);
  const [configInitialized, setConfigInitialized] =
    useState(false);
  const [configFromCache, setConfigFromCache] =
    useState(true);
  const [deviceLoaded, setDeviceLoaded] =
    useState(false);
  const [deviceFromCache, setDeviceFromCache] =
    useState(true);
  const [device, setDevice] =
    useState<AuthorizedDevice | null>(
      null
    );
  const [requestLoaded, setRequestLoaded] =
    useState(false);
  const [requestFromCache, setRequestFromCache] =
    useState(true);
  const [request, setRequest] =
    useState<DeviceAccessRequest | null>(
      null
    );
  const [loadError, setLoadError] =
    useState("");
  const [displayName, setDisplayName] =
    useState("");
  const [deviceName, setDeviceName] =
    useState(getDefaultDeviceName);
  const [requestedRole, setRequestedRole] =
    useState<DeviceRole>("reception");
  const [submitting, setSubmitting] =
    useState(false);
  const [submitError, setSubmitError] =
    useState("");
  const [upgradePromptOpen, setUpgradePromptOpen] =
    useState(false);
  const [upgradeSubmitting, setUpgradeSubmitting] =
    useState(false);
  const [upgradeError, setUpgradeError] =
    useState("");

  useEffect(() => {
    if (uid === "") {
      return undefined;
    }

    const onError = (
      error: Error
    ) => {
      console.error(
        "端末の利用権限を読み込めませんでした。",
        error
      );
      setLoadError(
        getErrorMessage(error)
      );
    };

    const unsubscribeConfig =
      subscribeToDeviceAccessConfig(
        (config, fromCache) => {
          setConfigInitialized(
            config.initialized
          );
          setConfigFromCache(
            fromCache
          );
          setConfigLoaded(true);
        },
        onError
      );
    const unsubscribeDevice =
      subscribeToAuthorizedDevice(
        uid,
        (nextDevice, fromCache) => {
          setDevice(nextDevice);
          setDeviceFromCache(
            fromCache
          );
          setDeviceLoaded(true);
        },
        onError
      );
    const unsubscribeRequest =
      subscribeToDeviceRequest(
        uid,
        (nextRequest, fromCache) => {
          setRequest(nextRequest);
          setRequestFromCache(
            fromCache
          );
          setRequestLoaded(true);
        },
        onError
      );

    return () => {
      unsubscribeConfig();
      unsubscribeDevice();
      unsubscribeRequest();
    };
  }, [uid]);

  const activeDevice =
    device?.active === true
      ? device
      : null;

  const configKnown =
    configLoaded &&
    (
      configInitialized ||
      !configFromCache
    );
  const deviceKnown =
    deviceLoaded &&
    (
      device !== null ||
      !deviceFromCache
    );
  const requestKnown =
    requestLoaded &&
    (
      request !== null ||
      !requestFromCache
    );
  const accessReady =
    configKnown &&
    (
      !configInitialized ||
      activeDevice !== null ||
      (
        deviceKnown &&
        requestKnown
      )
    );
  const accessUnavailableOffline =
    !accessReady &&
    navigator.onLine === false;

  useEffect(() => {
    if (
      loadError !== "" ||
      accessUnavailableOffline
    ) {
      onScreenStateChange?.("error");
      return;
    }

    onScreenStateChange?.(
      accessReady
        ? "ready"
        : "checking"
    );
  }, [
    accessReady,
    accessUnavailableOffline,
    loadError,
    onScreenStateChange,
  ]);

  const handleBootstrap =
    async (
      event: FormEvent<HTMLFormElement>
    ) => {
      event.preventDefault();
      setSubmitting(true);
      setSubmitError("");

      try {
        await bootstrapFirstMemberDevice(
          displayName,
          deviceName
        );
      } catch (error) {
        console.error(
          "最初の部員端末を登録できませんでした。",
          error
        );
        setSubmitError(
          getErrorMessage(error)
        );
      } finally {
        setSubmitting(false);
      }
    };

  const handleRequest =
    async (
      event: FormEvent<HTMLFormElement>
    ) => {
      event.preventDefault();
      setSubmitting(true);
      setSubmitError("");

      try {
        await submitDeviceAccessRequest(
          requestedRole,
          displayName,
          deviceName,
          "initial"
        );
      } catch (error) {
        console.error(
          "端末の利用申請を送信できませんでした。",
          error
        );
        setSubmitError(
          getErrorMessage(error)
        );
      } finally {
        setSubmitting(false);
      }
    };

  const requestAdminAccess =
    () => {
      if (
        activeDevice?.role ===
        "member"
      ) {
        return true;
      }

      setUpgradeError("");
      setUpgradePromptOpen(true);
      return false;
    };

  const handleUpgradeRequest =
    async () => {
      if (activeDevice === null) {
        return;
      }

      setUpgradeSubmitting(true);
      setUpgradeError("");

      try {
        await submitDeviceAccessRequest(
          "member",
          activeDevice.displayName,
          activeDevice.deviceName,
          "upgrade"
        );
      } catch (error) {
        console.error(
          "部員端末への変更申請を送信できませんでした。",
          error
        );
        setUpgradeError(
          getErrorMessage(error)
        );
      } finally {
        setUpgradeSubmitting(false);
      }
    };

  const contextValue:
    DeviceAccessContextValue | null =
    activeDevice === null
      ? null
      : {
          uid,
          device: activeDevice,
          request,
          isMemberDevice:
            activeDevice.role ===
            "member",
          requestAdminAccess,
        };

  const effectiveLoadError =
    uid === ""
      ? "端末の自動認証情報を取得できませんでした。"
      : loadError;

  if (
    effectiveLoadError !== "" ||
    (
      !accessReady &&
      navigator.onLine === false
    )
  ) {
    return (
      <main className="device-access-page">
        <section className="device-access-card device-access-card-compact">
          <DeviceLogo />

          <div className="device-access-message">
            <h1>
              端末を確認できません
            </h1>

            <p role="alert">
              {effectiveLoadError ||
                "この端末では利用権限をまだ確認できません。最初の一度だけオンラインで開いてください。"}
            </p>

            <button
              type="button"
              className="device-access-primary-button"
              onClick={() =>
                window.location.reload()
              }
            >
              再読み込み
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (!accessReady) {
    return <LoadingScreen />;
  }

  if (!configInitialized) {
    return (
      <main className="device-access-page">
        <section className="device-access-card">
          <DeviceLogo />

          <div className="device-access-heading">
            <span className="device-access-eyebrow">
              初期設定
            </span>

            <h1>
              最初の部員端末を登録
            </h1>

            <p>
              この端末を最初の部員端末として登録します。所有者ではなく、ほかの部員端末と同じ権限です。
            </p>
          </div>

          <form
            className="device-access-form"
            onSubmit={handleBootstrap}
          >
            <label>
              操作する部員名

              <input
                type="text"
                autoComplete="name"
                maxLength={60}
                value={displayName}
                onChange={(event) =>
                  setDisplayName(
                    event.target.value
                  )
                }
                placeholder="例：山田"
                required
              />
            </label>

            <label>
              この端末の名前

              <input
                type="text"
                maxLength={60}
                value={deviceName}
                onChange={(event) =>
                  setDeviceName(
                    event.target.value
                  )
                }
                placeholder="例：受付iPad 1"
                required
              />
            </label>

            {submitError !== "" && (
              <p
                className="device-access-error"
                role="alert"
              >
                {submitError}
              </p>
            )}

            <button
              type="submit"
              className="device-access-primary-button"
              disabled={submitting}
            >
              {submitting
                ? "登録しています…"
                : "この端末を登録する"}
            </button>
          </form>

          <p className="device-access-note">
            登録後は、この端末からほかの端末の申請を承認できます。
          </p>
        </section>
      </main>
    );
  }

  if (activeDevice === null) {
    const pendingRequest =
      request?.status === "pending"
        ? request
        : null;

    if (pendingRequest !== null) {
      return (
        <main className="device-access-page">
          <section className="device-access-card device-access-card-compact">
            <DeviceLogo />

            <div className="device-access-message">
              <span className="device-access-status-badge">
                申請中
              </span>

              <h1>
                承認を待っています
              </h1>

              <p>
                部員端末の「端末管理」から承認されると、自動で使えるようになります。
              </p>

              <dl className="device-access-request-summary">
                <div>
                  <dt>端末名</dt>
                  <dd>
                    {pendingRequest.deviceName}
                  </dd>
                </div>

                <div>
                  <dt>申請内容</dt>
                  <dd>
                    {pendingRequest.requestedRole ===
                    "member"
                      ? "部員端末"
                      : "受付専用端末"}
                  </dd>
                </div>
              </dl>
            </div>
          </section>
        </main>
      );
    }

    return (
      <main className="device-access-page">
        <section className="device-access-card">
          <DeviceLogo />

          <div className="device-access-heading">
            <span className="device-access-eyebrow">
              端末登録
            </span>

            <h1>
              利用申請を送信
            </h1>

            <p>
              この端末の使い方を選び、部員端末へ承認を依頼します。
            </p>
          </div>

          {request?.status ===
            "rejected" && (
            <p className="device-access-rejected">
              前回の申請は却下されました。内容を確認して再申請できます。
            </p>
          )}

          {device !== null &&
            !device.active && (
            <p className="device-access-rejected">
              この端末の利用は停止されています。必要な場合は再申請してください。
            </p>
          )}

          <form
            className="device-access-form"
            onSubmit={handleRequest}
          >
            <label>
              操作する部員名

              <input
                type="text"
                autoComplete="name"
                maxLength={60}
                value={displayName}
                onChange={(event) =>
                  setDisplayName(
                    event.target.value
                  )
                }
                placeholder="例：山田"
                required
              />
            </label>

            <label>
              この端末の名前

              <input
                type="text"
                maxLength={60}
                value={deviceName}
                onChange={(event) =>
                  setDeviceName(
                    event.target.value
                  )
                }
                placeholder="例：入口受付iPad"
                required
              />
            </label>

            <fieldset className="device-access-role-fieldset">
              <legend>
                端末の種類
              </legend>

              <div className="device-access-role-grid">
                <button
                  type="button"
                  className={
                    requestedRole ===
                    "reception"
                      ? "selected"
                      : ""
                  }
                  onClick={() =>
                    setRequestedRole(
                      "reception"
                    )
                  }
                >
                  <strong>
                    受付専用端末
                  </strong>

                  <small>
                    入退場受付のみ
                  </small>
                </button>

                <button
                  type="button"
                  className={
                    requestedRole ===
                    "member"
                      ? "selected"
                      : ""
                  }
                  onClick={() =>
                    setRequestedRole(
                      "member"
                    )
                  }
                >
                  <strong>
                    部員端末
                  </strong>

                  <small>
                    管理・承認も可能
                  </small>
                </button>
              </div>
            </fieldset>

            {submitError !== "" && (
              <p
                className="device-access-error"
                role="alert"
              >
                {submitError}
              </p>
            )}

            <button
              type="submit"
              className="device-access-primary-button"
              disabled={submitting}
            >
              {submitting
                ? "送信しています…"
                : "利用申請を送信"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (contextValue === null) {
    return <LoadingScreen />;
  }

  const upgradePending =
    request?.status === "pending" &&
    request.requestType === "upgrade" &&
    request.requestedRole === "member";

  return (
    <DeviceAccessContext.Provider
      value={contextValue}
    >
      {children}

      {upgradePromptOpen &&
        activeDevice.role !==
          "member" && (
        <div
          className="device-access-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setUpgradePromptOpen(
                false
              );
            }
          }}
        >
          <section
            className="device-access-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="device-access-modal-title"
          >
            <span className="device-access-modal-icon" aria-hidden="true">
              🔒
            </span>

            <h2 id="device-access-modal-title">
              この端末は受付専用です
            </h2>

            {upgradePending ? (
              <p>
                部員端末への変更を申請中です。別の部員端末で承認すると、管理モードを利用できます。
              </p>
            ) : (
              <p>
                管理モードを利用するには、部員端末への変更申請が必要です。
              </p>
            )}

            {upgradeError !== "" && (
              <p
                className="device-access-error"
                role="alert"
              >
                {upgradeError}
              </p>
            )}

            <div className="device-access-modal-actions">
              <button
                type="button"
                className="device-access-secondary-button"
                onClick={() =>
                  setUpgradePromptOpen(
                    false
                  )
                }
              >
                閉じる
              </button>

              {!upgradePending && (
                <button
                  type="button"
                  className="device-access-primary-button"
                  disabled={upgradeSubmitting}
                  onClick={() => {
                    void handleUpgradeRequest();
                  }}
                >
                  {upgradeSubmitting
                    ? "申請しています…"
                    : "部員端末申請をする"}
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </DeviceAccessContext.Provider>
  );
}

export default DeviceAccessGate;
