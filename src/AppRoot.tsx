import {
  lazy,
  Suspense,
  useState,
} from "react";

import AppSplashScreen from "./AppSplashScreen";

import AdminModeGuideBridge from "./AdminModeGuideBridge";
import ControlPairingBridge from "./ControlPairingBridge";
import DeviceAuthGate from "./DeviceAuthGate";
import EventDeletionCleanup from "./EventDeletionCleanup";
import ReceptionGuideBridge from "./ReceptionGuideBridge";

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
            </>
          </DeviceAccessGate>
        </Suspense>
      </DeviceAuthGate>
    </AppSplashScreen>
  );
}

export default AppRoot;
