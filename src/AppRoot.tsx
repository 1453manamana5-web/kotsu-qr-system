import {
  Component,
  lazy,
  Suspense,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

import AppSplashScreen from "./AppSplashScreen";

import AdminModeGuideBridge from "./AdminModeGuideBridge";
import ControlPairingBridge from "./ControlPairingBridge";
import DeviceAuthGate from "./DeviceAuthGate";
import EventDeletionCleanup from "./EventDeletionCleanup";
import ReceptionGuideBridge from "./ReceptionGuideBridge";
import TutorialHighlightOverlayBridge from "./TutorialHighlightOverlayBridge";

const DeviceAccessGate = lazy(() =>
  import("./DeviceAccessGate")
);

const App = lazy(() =>
  import("./App")
);

type StartupState =
  | "checking"
  | "ready"
  | "error";

const CHUNK_RECOVERY_KEY =
  "qr-system-chunk-recovery";

const pageLoadingFallback = (
  <main
    className="app-route-loading"
    aria-live="polite"
  >
    <span
      className="app-route-loading-spinner"
      aria-hidden="true"
    />

    <strong>
      画面を読み込んでいます
    </strong>
  </main>
);

type ChunkErrorBoundaryProps = {
  children: ReactNode;
};

type ChunkErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
};

class ChunkErrorBoundary extends Component<
  ChunkErrorBoundaryProps,
  ChunkErrorBoundaryState
> {
  state: ChunkErrorBoundaryState = {
    hasError: false,
    errorMessage: "",
  };

  componentDidCatch(
    error: unknown,
    _errorInfo: ErrorInfo
  ) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "画面の読み込みに失敗しました。",
      error
    );

    let alreadyRecovered = false;

    try {
      alreadyRecovered =
        sessionStorage.getItem(
          CHUNK_RECOVERY_KEY
        ) === "1";
    } catch {
      // sessionStorage が使えない環境でも
      // エラー画面へ進めるようにします。
    }

    if (!alreadyRecovered) {
      try {
        sessionStorage.setItem(
          CHUNK_RECOVERY_KEY,
          "1"
        );
      } catch {
        // 保存できなくても通常のエラー画面を表示します。
      }

      window.setTimeout(() => {
        window.location.reload();
      }, 100);

      return;
    }

    this.setState({
      hasError: true,
      errorMessage: message,
    });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: "32px 20px",
          boxSizing: "border-box",
          background: "#f6f8fc",
          color: "#1f2937",
          textAlign: "center",
        }}
      >
        <section
          style={{
            width: "min(520px, 100%)",
            padding: "28px",
            borderRadius: "20px",
            background: "#ffffff",
            boxShadow:
              "0 12px 36px rgba(15, 23, 42, 0.10)",
          }}
        >
          <strong
            style={{
              display: "block",
              fontSize: "20px",
              marginBottom: "12px",
            }}
          >
            画面を読み込めませんでした
          </strong>

          <p
            style={{
              margin: "0 0 20px",
              lineHeight: 1.7,
            }}
          >
            通信または保存されている画面データに問題がある可能性があります。
            下のボタンを押して、もう一度読み込んでください。
          </p>

          <button
            type="button"
            onClick={() => {
              try {
                sessionStorage.removeItem(
                  CHUNK_RECOVERY_KEY
                );
              } catch {
                // 無視して再読み込みします。
              }

              window.location.reload();
            }}
            style={{
              border: 0,
              borderRadius: "12px",
              padding: "12px 20px",
              fontSize: "16px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            再読み込み
          </button>

          {this.state.errorMessage !== "" && (
            <p
              style={{
                margin: "18px 0 0",
                fontSize: "12px",
                color: "#64748b",
                overflowWrap: "anywhere",
              }}
            >
              {this.state.errorMessage}
            </p>
          )}
        </section>
      </main>
    );
  }
}

function AppRoot() {
  const [
    authState,
    setAuthState,
  ] = useState<StartupState>(
    "checking"
  );

  const [
    accessState,
    setAccessState,
  ] = useState<StartupState>(
    "checking"
  );

  const canFinishSplash =
    authState === "error" ||
    (
      authState === "ready" &&
      accessState !== "checking"
    );

  return (
    <ChunkErrorBoundary>
      <AppSplashScreen
        canFinish={
          canFinishSplash
        }
      >
        <DeviceAuthGate
          onScreenStateChange={
            setAuthState
          }
        >
          <Suspense
            fallback={
              pageLoadingFallback
            }
          >
            <DeviceAccessGate
              onScreenStateChange={
                setAccessState
              }
            >
              <>
                <App />
                <EventDeletionCleanup />
                <ReceptionGuideBridge />
                <AdminModeGuideBridge />
                <ControlPairingBridge />
                <TutorialHighlightOverlayBridge />
              </>
            </DeviceAccessGate>
          </Suspense>
        </DeviceAuthGate>
      </AppSplashScreen>
    </ChunkErrorBoundary>
  );
}

export default AppRoot;
