import {
  useEffect,
  useState,
} from "react";

import {
  getPendingReceptionCount,
  subscribeToPendingReceptionCount,
} from "../offlineReceptionStore";

import "./OnlineStatus.css";

type ConnectionStatus =
  | "online"
  | "offline";

function getCurrentConnectionStatus():
  ConnectionStatus {
  return navigator.onLine
    ? "online"
    : "offline";
}

function OnlineStatus() {
  const [
    connectionStatus,
    setConnectionStatus,
  ] = useState<ConnectionStatus>(
    getCurrentConnectionStatus
  );

  const [
    pendingCount,
    setPendingCount,
  ] = useState(
    getPendingReceptionCount
  );

  useEffect(() => {
    const handleOnline = () => {
      setConnectionStatus(
        "online"
      );
    };

    const handleOffline = () => {
      setConnectionStatus(
        "offline"
      );
    };

    window.addEventListener(
      "online",
      handleOnline
    );

    window.addEventListener(
      "offline",
      handleOffline
    );

    return () => {
      window.removeEventListener(
        "online",
        handleOnline
      );

      window.removeEventListener(
        "offline",
        handleOffline
      );
    };
  }, []);

  useEffect(() =>
    subscribeToPendingReceptionCount(
      setPendingCount
    ), []);

  const isOnline =
    connectionStatus ===
    "online";

  const isSyncPending =
    pendingCount > 0;

  const statusText = isOnline
    ? isSyncPending
      ? `同期中 ${pendingCount}件`
      : "オンライン"
    : isSyncPending
      ? `オフライン・端末保存 ${pendingCount}件`
      : "オフライン・端末保存";

  return (
    <div
      className={`connection-status ${
        isOnline
          ? "connection-online"
          : "connection-offline"
      }`}
      role="status"
      aria-live="polite"
      aria-label={
        isOnline
          ? isSyncPending
            ? `現在オンラインです。同期待ちが${pendingCount}件あります`
            : "現在オンラインです"
          : `現在オフラインです。受付データは端末に保存されます${
              isSyncPending
                ? `。同期待ちは${pendingCount}件です`
                : ""
            }`
      }
    >
      <span
        className="connection-status-circle"
        aria-hidden="true"
      />

      <span className="connection-status-text">
        {statusText}
      </span>
    </div>
  );
}

export default OnlineStatus;
