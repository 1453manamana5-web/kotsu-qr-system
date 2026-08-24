import {
  type ReactNode,
  useEffect,
  useState,
} from "react";

import {
  onAuthStateChanged,
  signInAnonymously,
} from "firebase/auth";

import {
  auth,
} from "./firebaseAuth";

import "./DeviceAuthGate.css";

type DeviceAuthGateProps = {
  children: ReactNode;
  onScreenStateChange?: (
    state: AuthScreenState
  ) => void;
};

type AuthScreenState =
  | "checking"
  | "ready"
  | "error";

function getAnonymousAuthErrorMessage(
  error: unknown
) {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";

  switch (code) {
    case "auth/operation-not-allowed":
      return "Firebaseで匿名認証がまだ有効になっていません。";

    case "auth/network-request-failed":
      return "初回の自動接続にはインターネット接続が必要です。オンラインにして、もう一度お試しください。";

    case "auth/too-many-requests":
      return "接続が集中しています。少し待ってから、もう一度お試しください。";

    default:
      return "受付システムへ接続できませんでした。通信状態を確認してください。";
  }
}

function AuthLogo() {
  return (
    <div
      className="device-auth-logo"
      aria-hidden="true"
    >
      <span>QR</span>
    </div>
  );
}

function DeviceAuthGate({
  children,
  onScreenStateChange,
}: DeviceAuthGateProps) {
  const [
    screenState,
    setScreenState,
  ] = useState<AuthScreenState>(
    "checking"
  );
  const [errorMessage, setErrorMessage] =
    useState("");
  const [retryCount, setRetryCount] =
    useState(0);

  useEffect(() => {
    let active = true;
    let signInStarted = false;

    const startAnonymousSignIn =
      async () => {
        if (signInStarted) {
          return;
        }

        signInStarted = true;

        try {
          await signInAnonymously(auth);
        } catch (error) {
          if (!active) {
            return;
          }

          console.error(
            "受付システムの自動認証に失敗しました。",
            error
          );
          setErrorMessage(
            getAnonymousAuthErrorMessage(
              error
            )
          );
          setScreenState("error");
        }
      };

    const unsubscribe =
      onAuthStateChanged(
        auth,
        (user) => {
          if (!active) {
            return;
          }

          if (user !== null) {
            setScreenState("ready");
            return;
          }

          void startAnonymousSignIn();
        },
        (error) => {
          if (!active) {
            return;
          }

          console.error(
            "自動認証の状態を読み込めませんでした。",
            error
          );
          setErrorMessage(
            "受付システムへ接続できませんでした。通信状態を確認してください。"
          );
          setScreenState("error");
        }
      );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [retryCount]);

  useEffect(() => {
    if (screenState === "ready") {
      void import(
        "./offlineReceptionSync"
      )
        .then(({
          startOfflineReceptionSync,
        }) => {
          startOfflineReceptionSync();
        })
        .catch((error) => {
          console.warn(
            "オフライン受付の同期準備を次回へ延期します。",
            error
          );
        });
    }
  }, [screenState]);

  useEffect(() => {
    onScreenStateChange?.(
      screenState
    );
  }, [
    onScreenStateChange,
    screenState,
  ]);

  if (screenState === "ready") {
    return children;
  }

  return (
    <main className="device-auth-page">
      <section className="device-auth-card">
        <AuthLogo />

        {screenState === "checking" ? (
          <div
            className="device-auth-loading"
            aria-live="polite"
          >
            <span
              className="device-auth-spinner"
              aria-hidden="true"
            />

            <h1>
              受付システムを準備しています
            </h1>

            <p>
              そのままお待ちください
            </p>
          </div>
        ) : (
          <div className="device-auth-message">
            <h1>
              接続できませんでした
            </h1>

            <p role="alert">
              {errorMessage}
            </p>

            <div className="device-auth-actions">
              <button
                type="button"
                onClick={() => {
                  setScreenState(
                    "checking"
                  );
                  setErrorMessage("");
                  setRetryCount(
                    (currentCount) =>
                      currentCount + 1
                  );
                }}
              >
                もう一度試す
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export default DeviceAuthGate;
