import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  approveDeviceAccessRequest,
  deleteAuthorizedDevice,
  rejectDeviceAccessRequest,
  renameAuthorizedDevice,
  subscribeToAuthorizedDevices,
  subscribeToDeviceAccessAudit,
  subscribeToPendingDeviceRequests,
  type AuthorizedDevice,
  type DeviceAccessAudit,
  type DeviceAccessRequest,
  type DeviceType,
} from "../deviceAccessFirestore";

import {
  useDeviceAccess,
} from "../deviceAccessContext";

import OnlineStatus from "./OnlineStatus";

import "./DeviceManagementPage.css";

type DeviceManagementPageProps = {
  setPage: (page: string) => void;
};

type OperationState = {
  uid: string;
  action:
    | "approve"
    | "reject"
    | "rename"
    | "delete";
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
  switch (role) {
    case "member":
      return "部員端末";

    case "reception":
      return "受付専用端末";

    case "control":
      return "部員端末";
  }
}

function getDeviceTypeLabel(
  deviceType: DeviceType
) {
  switch (deviceType) {
    case "ipad":
      return "iPad";

    case "iphone":
      return "iPhone";

    case "android":
      return "Android";

    case "windows":
      return "Windows";

    case "mac":
      return "Mac";

    case "other":
      return "その他";

    case "unknown":
      return "端末種別不明";
  }
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
      if (entry.role === "member") {
        return "部員端末を申請";
      }

      return entry.role === "control"
        ? "部員端末を申請"
        : "受付専用端末を申請";

    case "request-approved":
      return "端末申請を承認";

    case "request-rejected":
      return "端末申請を却下";

    case "device-disabled":
      return "端末を停止";

    case "device-renamed":
      return "端末名を変更";

    case "device-deleted":
      return "端末を削除";
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

function DeviceModeIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <rect
        x="13"
        y="7"
        width="38"
        height="50"
        rx="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M25 48H39"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M22 29L29 36L43 21"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
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
  const [editingUid, setEditingUid] =
    useState<string | null>(null);
  const [editingName, setEditingName] =
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
        devices
          .filter(
            (device) =>
              device.active
          )
          .sort((first, second) => {
            if (first.uid === uid) {
              return -1;
            }

            if (second.uid === uid) {
              return 1;
            }

            return 0;
          }),
      [devices, uid]
    );
  const memberCount =
    activeDevices.filter(
      (device) =>
        device.role === "member" ||
        device.role === "control"
    ).length;
  const receptionCount =
    activeDevices.filter(
      (device) =>
        device.role === "reception"
    ).length;
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
    const previousDevice =
      devices.find(
        (device) =>
          device.uid === request.uid
      );
    const optimisticDevice:
      AuthorizedDevice = {
        uid: request.uid,
        role: request.requestedRole,
        displayName:
          request.displayName,
        deviceName:
          request.deviceName,
        deviceType:
          request.deviceType,
        active: true,
        createdAt:
          previousDevice?.createdAt ||
          request.requestedAt,
        approvedAt:
          new Date().toISOString(),
        approvedByUid: uid,
        approvedByName:
          currentDevice.displayName,
      };

    // Firestoreの応答を待たず、承認結果を先に画面へ反映する。
    setRequests((current) =>
      current.filter(
        (item) =>
          item.uid !== request.uid
      )
    );
    setDevices((current) => [
      ...current.filter(
        (device) =>
          device.uid !== request.uid
      ),
      optimisticDevice,
    ]);

    void runOperation(
      {
        uid: request.uid,
        action: "approve",
      },
      async () => {
        try {
          await approveDeviceAccessRequest(
            request.uid
          );
        } catch (error) {
          // 保存できなかった場合だけ、承認前の表示へ戻す。
          setRequests((current) =>
            current.some(
              (item) =>
                item.uid === request.uid
            )
              ? current
              : [...current, request].sort(
                  (first, second) =>
                    first.requestedAt.localeCompare(
                      second.requestedAt
                    )
                )
          );
          setDevices((current) => {
            const withoutTarget =
              current.filter(
                (device) =>
                  device.uid !==
                  request.uid
              );

            return previousDevice ===
              undefined
              ? withoutTarget
              : [
                  ...withoutTarget,
                  previousDevice,
                ];
          });

          throw error;
        }
      }
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

  const handleRename = (
    device: AuthorizedDevice
  ) => {
    const cleanName =
      editingName.trim();

    if (cleanName === "") {
      setOperationError(
        "端末名を入力してください。"
      );
      return;
    }

    void runOperation(
      {
        uid: device.uid,
        action: "rename",
      },
      async () => {
        await renameAuthorizedDevice(
          device.uid,
          cleanName
        );
        setEditingUid(null);
        setEditingName("");
      }
    );
  };

  const handleDelete = (
    device: AuthorizedDevice
  ) => {
    if (
      !window.confirm(
        `${device.deviceName}を登録済み端末から削除しますか？\n削除後は、この端末から再申請が必要です。`
      )
    ) {
      return;
    }

    void runOperation(
      {
        uid: device.uid,
        action: "delete",
      },
      () =>
        deleteAuthorizedDevice(
          device.uid
        )
    );
  };

  return (
    <div className="device-management-page">
      <header className="device-management-header">
        <div className="device-management-header-main">
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="device-management-header-status">
            <OnlineStatus />

            <span
              className="device-management-header-divider"
              aria-hidden="true"
            />

            <p>
              部員端末はすべて対等に申請を承認できます
            </p>
          </div>
        </div>

        <div className="device-management-mode-label">
          <span className="device-management-mode-icon">
            <DeviceModeIcon />
          </span>

          <span className="device-management-mode-copy">
            <small>
              DEVICE MANAGEMENT
            </small>

            <strong>
              端末管理
            </strong>
          </span>
        </div>
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
          <div className="device-management-left-column">
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

                        <span className="device-management-device-type">
                          {getDeviceTypeLabel(
                            request.deviceType
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

          <section className="device-management-panel device-management-devices-panel">
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
              {activeDevices.map((device) => {
                const isCurrent =
                  device.uid === uid;
                const isOperating =
                  operation?.uid ===
                  device.uid;

                return (
                  <article
                    key={device.uid}
                    className={`device-management-device-card${
                      isCurrent
                        ? " is-current"
                        : ""
                    }`}
                  >
                    <div className="device-management-device-topline">
                      <div className="device-management-device-badges">
                        <span
                          className={`device-management-role device-management-role-${device.role}`}
                        >
                          {getRoleLabel(
                            device.role
                          )}
                        </span>

                        <span className="device-management-device-type">
                          {getDeviceTypeLabel(
                            device.deviceType
                          )}
                        </span>

                        {isCurrent && (
                          <span className="device-management-self">
                            この端末
                          </span>
                        )}

                      </div>

                      <div className="device-management-device-actions">
                        {isCurrent && (
                          <button
                            type="button"
                            className="device-management-rename"
                            disabled={isOperating}
                            onClick={() => {
                              setEditingUid(
                                device.uid
                              );
                              setEditingName(
                                device.deviceName
                              );
                              setOperationError("");
                            }}
                          >
                            端末名を変更
                          </button>
                        )}

                        {!isCurrent && (
                          <button
                            type="button"
                            className="device-management-delete"
                            disabled={
                              isOperating ||
                              (
                                device.active &&
                                device.role ===
                                  "member" &&
                                memberCount <= 1
                              )
                            }
                            onClick={() =>
                              handleDelete(
                                device
                              )
                            }
                          >
                            {operation?.uid ===
                              device.uid &&
                            operation.action ===
                              "delete"
                              ? "削除中…"
                              : "削除"}
                          </button>
                        )}
                      </div>
                    </div>

                    {editingUid ===
                    device.uid ? (
                      <form
                        className="device-management-rename-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          handleRename(device);
                        }}
                      >
                        <input
                          type="text"
                          maxLength={60}
                          value={editingName}
                          autoFocus
                          onChange={(event) =>
                            setEditingName(
                              event.target.value
                            )
                          }
                          aria-label="新しい端末名"
                        />

                        <button
                          type="button"
                          onClick={() => {
                            setEditingUid(null);
                            setEditingName("");
                          }}
                        >
                          キャンセル
                        </button>

                        <button
                          type="submit"
                          className="save"
                          disabled={isOperating}
                        >
                          {isOperating
                            ? "保存中…"
                            : "保存"}
                        </button>
                      </form>
                    ) : (
                      <h3>
                        {device.deviceName}
                      </h3>
                    )}

                    <p>
                      {device.displayName ||
                        "部員名未設定"}
                    </p>

                  </article>
                );
              })}
            </div>
          </section>

        </div>
      </main>

      <footer className="device-management-footer">
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
      </footer>
    </div>
  );
}

export default DeviceManagementPage;
