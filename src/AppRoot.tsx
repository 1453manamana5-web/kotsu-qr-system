import {
  Suspense,
  useState,
} from "react";

import App from "./App";

import AppSplashScreen from "./AppSplashScreen";

import DeviceAuthGate from "./DeviceAuthGate";

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
    startupState,
    setStartupState,
  ] = useState<StartupState>(
    "checking"
  );

  return (
    <AppSplashScreen
      canFinish={
        startupState !==
        "checking"
      }
    >
      <DeviceAuthGate
        onScreenStateChange={
          setStartupState
        }
      >
        <Suspense
          fallback={
            pageLoadingFallback
          }
        >
          <App />
        </Suspense>
      </DeviceAuthGate>
    </AppSplashScreen>
  );
}

export default AppRoot;
