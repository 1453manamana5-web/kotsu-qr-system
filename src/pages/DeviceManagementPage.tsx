import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  approveDeviceAccessRequest,
  disableAuthorizedDevice,
  rejectDeviceAccessRequest,
  subscribeToAuthorizedDevices,
  subscribeToDeviceAccessAudit,
  subscribeToPendingDeviceRequests,
  type AuthorizedDevice,
  type DeviceAccessAudit,
  type DeviceAccessRequest,
} from "../deviceAccessFirestore";

import {
  useDeviceAccess,
} from "../deviceAccessContext";

import "./DeviceManagementPage.css";

type DeviceManagementPageProps = {
  setPage: (page: string) => void;
};

type OperationState = {
  uid: string;
  action:
    | "approve"
    | "reject"
    | "disable";
} | null;

function getErrorMessage(
  error: unknown
) {
  if (
    error instanceof Error &&
    error.message.trim() !== ""
  ) {
    return error.message;
  }

  return "操作を完了できませんでした。通信状態を確認してください。";
}

function getRoleLabel(
  role: AuthorizedDevice["role"]
) {
  return role === "member"
    ? "部員端末"
    : "受付専用端末";
}

function formatDateTime(
  value: string
) {
  if (value === "") {
    return "記録中";
  }

  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "記録中";
  }

  return new Intl.DateTimeFormat(
    "ja-JP",
    {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }
  ).format(date);
}

function getAuditLabel(
  entry: DeviceAccessAudit
) {
  switch (entry.action) {
    case "bootstrap-member":
      return "最初の部員端末を登録";

    case "request-created":
      return entry.role === "member"
        ? "部員端末を申請"
        : "受付専用端末を申請";

    case "request-approved":
      return "端末申請を承認";

    case "request-rejected":
      return "端末申請を却下";

    case "device-disabled":
      return "端末を停止";
  }
}

function BackIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M25 16H8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M14 9L7 16L14 23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DeviceManagementPage({
  setPage,
}: DeviceManagementPageProps) {
  const {
    uid,
    device: currentDevice,
  } = useDeviceAccess();
  const [devices, setDevices] =
    useState<AuthorizedDevice[]>([]);
  const [requests, setRequests] =
    useState<DeviceAccessRequest[]>([]);
  const [audit, setAudit] =
    useState<DeviceAccessAudit[]>([]);
  const [loading, setLoading] =
    useState(true);
  const [loadError, setLoadError] =
    useState("");
  const [operation, setOperation] =
    useState<OperationState>(null);
  const [operationError, setOperationError] =
    useState("");

  useEffect(() => {
    let deviceReady = false;
    let requestReady = false;

    const markReady = () => {
      if (
        deviceReady &&
        requestReady
      ) {
        setLoading(false);
      }
    };

    const onError = (
      error: Error
    ) => {
      console.error(
        "端末管理データを読み込めませんでした。",
        error
      );
      setLoadError(
        getErrorMessage(error)
      );
      setLoading(false);
    };

    const unsubscribeDevices =
      subscribeToAuthorizedDevices(
        (nextDevices) => {
          setDevices(nextDevices);
          deviceReady = true;
          markReady();
        },
        onError
      );
    const unsubscribeRequests =
      subscribeToPendingDeviceRequests(
        (nextRequests) => {
          setRequests(nextRequests);
          requestReady = true;
          markReady();
        },
        onError
      );
    const unsubscribeAudit =
      subscribeToDeviceAccessAudit(
        setAudit,
        (error) => {
          console.warn(
            "端末操作履歴を読み込めませんでした。",
            error
          );
        }
      );

    return () => {
      unsubscribeDevices();
      unsubscribeRequests();
      unsubscribeAudit();
    };
  }, []);

  const activeDevices =
    useMemo(
      () =>
        devices.filter(
          (device) =>
            device.active
        ),
      [devices]
    );
  const memberCount =
    activeDevices.filter(
      (device) =>
        device.role === "member"
    ).length;
  const receptionCount =
    activeDevices.length -
    memberCount;

  const runOperation =
    async (
      nextOperation:
        Exclude<OperationState, null>,
      action: () => Promise<void>
    ) => {
      setOperation(nextOperation);
      setOperationError("");

      try {
        await action();
      } catch (error) {
        console.error(
          "端末管理の操作に失敗しました。",
          error
        );
        setOperationError(
          getErrorMessage(error)
        );
      } finally {
        setOperation(null);
      }
    };

  const handleApprove = (
    request: DeviceAccessRequest
  ) => {
    void runOperation(
      {
        uid: request.uid,
        action: "approve",
      },
      () =>
        approveDeviceAccessRequest(
          request.uid
        )
    );
  };

  const handleReject = (
    request: DeviceAccessRequest
  ) => {
    if (
      !window.confirm(
        `${request.deviceName}の申請を却下しますか？`
      )
    ) {
      return;
    }

    void runOperation(
      {
        uid: request.uid,
        action: "reject",
      },
      () =>
        rejectDeviceAccessRequest(
          request.uid
        )
    );
  };

  const handleDisable = (
    device: AuthorizedDevice
  ) => {
    if (
      !window.confirm(
        `${device.deviceName}の利用を停止しますか？\n停止後は、この端末から再申請が必要です。`
      )
    ) {
      return;
    }

    void runOperation(
      {
        uid: device.uid,
        action: "disable",
      },
      () =>
        disableAuthorizedDevice(
          device.uid
        )
    );
  };

  return (
    <div className="device-management-page">
      <header className="device-management-header">
        <div>
          <span className="device-management-eyebrow">
            管理メニュー
          </span>

          <h1>
            端末管理
          </h1>

          <p>
            部員端末はすべて対等に申請を承認できます
          </p>
        </div>

        <button
          type="button"
          className="device-management-back"
          onClick={() =>
            setPage("admin")
          }
        >
          <BackIcon />
          管理画面へ戻る
        </button>
      </header>

      <main className="device-management-main">
        <section className="device-management-summary">
          <article>
            <small>
              承認待ち
            </small>

            <strong>
              {requests.length}
              <span>件</span>
            </strong>
          </article>

          <article>
            <small>
              部員端末
            </small>

            <strong>
              {memberCount}
              <span>台</span>
            </strong>
          </article>

          <article>
            <small>
              受付専用端末
            </small>

            <strong>
              {receptionCount}
              <span>台</span>
            </strong>
          </article>

          <article className="device-management-current">
            <small>
              この端末
            </small>

            <strong>
              {currentDevice.deviceName}
            </strong>
          </article>
        </section>

        {operationError !== "" && (
          <p
            className="device-management-error"
            role="alert"
          >
            {operationError}
          </p>
        )}

        {loadError !== "" && (
          <p
            className="device-management-error"
            role="alert"
          >
            {loadError}
          </p>
        )}

        <div className="device-management-columns">
          <section className="device-management-panel device-management-requests-panel">
            <div className="device-management-panel-heading">
              <div>
                <span>REQUESTS</span>
                <h2>利用申請</h2>
              </div>

              <strong>
                {requests.length}
              </strong>
            </div>

            <div className="device-management-list">
              {loading ? (
                <p className="device-management-empty">
                  読み込んでいます…
                </p>
              ) : requests.length === 0 ? (
                <p className="device-management-empty">
                  現在、承認待ちの申請はありません
                </p>
              ) : (
                requests.map((request) => {
                  const isOperating =
                    operation?.uid ===
                    request.uid;

                  return (
                    <article
                      key={request.uid}
                      className="device-management-request-card"
                    >
                      <div className="device-management-card-topline">
                        <span
                          className={`device-management-role device-management-role-${request.requestedRole}`}
                        >
                          {getRoleLabel(
                            request.requestedRole
                          )}
                        </span>

                        {request.requestType ===
                          "upgrade" && (
                          <span className="device-management-upgrade">
                            変更申請
                          </span>
                        )}
                      </div>

                      <h3>
                        {request.deviceName}
                      </h3>

                      <p>
                        申請者：
                        <strong>
                          {request.displayName}
                        </strong>
                      </p>

                      <small>
                        {formatDateTime(
                          request.requestedAt
                        )}
                      </small>

                      <div className="device-management-request-actions">
                        <button
                          type="button"
                          className="device-management-reject"
                          disabled={isOperating}
                          onClick={() =>
                            handleReject(
                              request
                            )
                          }
                        >
                          却下
                        </button>

                        <button
                          type="button"
                          className="device-management-approve"
                          disabled={isOperating}
                          onClick={() =>
                            handleApprove(
                              request
                            )
                          }
                        >
                          {isOperating
                            ? "処理中…"
                            : "承認"}
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>

          <section className="device-management-panel">
            <div className="device-management-panel-heading">
              <div>
                <span>DEVICES</span>
                <h2>登録済み端末</h2>
              </div>

              <strong>
                {activeDevices.length}
              </strong>
            </div>

            <div className="device-management-list">
              {devices.map((device) => {
                const isCurrent =
                  device.uid === uid;
                const isOperating =
                  operation?.uid ===
                  device.uid;

                return (
                  <article
                    key={device.uid}
                    className={`device-management-device-card ${device.active ? "" : "disabled"}`}
                  >
                    <div>
                      <span
                        className={`device-management-role device-management-role-${device.role}`}
                      >
                        {getRoleLabel(
                          device.role
                        )}
                      </span>

                      {isCurrent && (
                        <span className="device-management-self">
                          この端末
                        </span>
                      )}

                      {!device.active && (
                        <span className="device-management-stopped">
                          停止中
                        </span>
                      )}
                    </div>

                    <h3>
                      {device.deviceName}
                    </h3>

                    <p>
                      {device.displayName ||
                        "部員名未設定"}
                    </p>

                    {device.active &&
                      !isCurrent && (
                      <button
                        type="button"
                        className="device-management-disable"
                        disabled={
                          isOperating ||
                          (
                            device.role ===
                              "member" &&
                            memberCount <= 1
                          )
                        }
                        onClick={() =>
                          handleDisable(
                            device
                          )
                        }
                      >
                        {isOperating
                          ? "停止中…"
                          : "利用を停止"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </section>

          <section className="device-management-panel device-management-audit-panel">
            <div className="device-management-panel-heading">
              <div>
                <span>HISTORY</span>
                <h2>操作履歴</h2>
              </div>
            </div>

            <div className="device-management-audit-list">
              {audit.length === 0 ? (
                <p className="device-management-empty">
                  操作履歴はまだありません
                </p>
              ) : (
                audit.map((entry) => (
                  <article key={entry.id}>
                    <span />

                    <div>
                      <strong>
                        {getAuditLabel(
                          entry
                        )}
                      </strong>

                      <p>
                        {entry.actorName ||
                          "端末"}
                        {" → "}
                        {entry.targetName ||
                          "端末"}
                      </p>
                    </div>

                    <time>
                      {formatDateTime(
                        entry.createdAt
                      )}
                    </time>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

export default DeviceManagementPage;
