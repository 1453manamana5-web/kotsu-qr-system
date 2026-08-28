import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DeviceAccessGate from "./DeviceAccessGate";
import ControlAssistBridge from "./ControlAssistBridge";
import ControlAssistHelpBridge from "./ControlAssistHelpBridge";
import BeginnerHomeBridge from "./BeginnerHomeBridge";
import SidebarClarityBridge from "./SidebarClarityBridge";
import { db } from "./firebase";
import "./index.css";
import "./experimental-nav.css";
import "./predictive-ops.css";
import "./predictive-correlation.css";
import "./copilot-capabilities.css";
import "./admin-ops.css";
import "./ticket-control.css";
import "./member-control.css";
import "./ticket-inventory-forecast.css";
import "./maintenance-data.css";
import "./experimental-lab-extensions.css";
import "./lab-autopilot-only.css";
import "./operations-management.css";
import "./sidebar-clarity.css";
import "./copilot-simplified.css";
import "./anomaly-notifications.css";
import "./topbar-clarity.css";
import "./typography-clarity.css";
import "./copilot-learning.css";

const DeferredControlFeatures = lazy(() => import("./DeferredControlFeatures"));

function DeferredFeaturesLoader() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 最初の画面と操作系を先に描画してから、
    // 管制ラボ・AI管制・予測・保守などの補助機能を読み込む。
    const timer = window.setTimeout(() => setReady(true), 700);
    return () => window.clearTimeout(timer);
  }, []);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <DeferredControlFeatures database={db} />
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeviceAccessGate>
      <>
        <App database={db} />
        <ControlAssistBridge database={db} />
        <ControlAssistHelpBridge />
        <BeginnerHomeBridge />
        <SidebarClarityBridge />
        <DeferredFeaturesLoader />
      </>
    </DeviceAccessGate>
  </StrictMode>
);
