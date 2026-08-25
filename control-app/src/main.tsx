import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DeviceAccessGate from "./DeviceAccessGate";
import PredictiveOpsOverlay from "./PredictiveOpsOverlay";
import PredictiveChatBridge from "./PredictiveChatBridge";
import { db } from "./firebase";
import "./index.css";
import "./experimental-nav.css";
import "./predictive-ops.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeviceAccessGate>
      <>
        <App database={db} />
        <PredictiveOpsOverlay database={db} />
        <PredictiveChatBridge database={db} />
      </>
    </DeviceAccessGate>
  </StrictMode>
);
