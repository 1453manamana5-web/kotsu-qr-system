import {
  useEffect,
  useState,
} from "react";

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

  const isOnline =
    connectionStatus ===
    "online";

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
          ? "現在オンラインです"
          : "現在オフラインです"
      }
    >
      <span
        className="connection-status-circle"
        aria-hidden="true"
      />

      <span className="connection-status-text">
        {isOnline
          ? "オンライン"
          : "オフライン"}
      </span>
    </div>
  );
}

export default OnlineStatus;