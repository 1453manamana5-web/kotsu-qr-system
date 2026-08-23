import {
  Suspense,
  useState,
} from "react";

import App from "./App";

import AppSplashScreen from "./AppSplashScreen";

import DeviceAuthGate from "./DeviceAuthGate";

import DeviceAccessGate from "./DeviceAccessGate";

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
        <DeviceAccessGate
          onScreenStateChange={
            setAccessState
          }
        >
          <Suspense
            fallback={
              pageLoadingFallback
            }
          >
            <App />
          </Suspense>
        </DeviceAccessGate>
      </DeviceAuthGate>
    </AppSplashScreen>
  );
}

export default AppRoot;
