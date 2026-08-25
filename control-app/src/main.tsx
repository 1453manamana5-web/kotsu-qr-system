import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DeviceAccessGate from "./DeviceAccessGate";
import PredictiveOpsOverlay from "./PredictiveOpsOverlay";
import ExperimentalLabBridge from "./ExperimentalLabBridge";
import TicketControlBridge from "./TicketControlBridge";
import MemberControlBridge from "./MemberControlBridge";
import HybridTicketInventoryForecastBridge from "./HybridTicketInventoryForecastBridge";
import AuthenticatedPersonalizedControlBridge from "./AuthenticatedPersonalizedControlBridge";
import AdminOpsBridge from "./AdminOpsBridge";
import MaintenanceDataBridge from "./MaintenanceDataBridge";
import CopilotLanguageExpansionBridge from "./CopilotLanguageExpansionBridge";
import CopilotRemoteCommandBridge from "./CopilotRemoteCommandBridge";
import CopilotCapabilityBridge from "./CopilotCapabilityBridge";
import PredictiveCorrelationMemory from "./PredictiveCorrelationMemory";
import PredictiveChatBridge from "./PredictiveChatBridge";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeviceAccessGate>
      <>
        <App database={db} />
        <PredictiveOpsOverlay database={db} />
        <ExperimentalLabBridge database={db} />
        <TicketControlBridge database={db} />
        <MemberControlBridge database={db} />
        <HybridTicketInventoryForecastBridge database={db} />
        <AuthenticatedPersonalizedControlBridge />
        <AdminOpsBridge database={db} />
        <MaintenanceDataBridge database={db} />
        <CopilotLanguageExpansionBridge />
        <CopilotRemoteCommandBridge database={db} />
        <CopilotCapabilityBridge database={db} />
        <PredictiveCorrelationMemory database={db} />
        <PredictiveChatBridge database={db} />
      </>
    </DeviceAccessGate>
  </StrictMode>
);
