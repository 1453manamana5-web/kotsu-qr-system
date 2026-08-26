import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DeviceAccessGate from "./DeviceAccessGate";
import PredictiveOpsOverlay from "./PredictiveOpsOverlay";
import ExperimentalLabBridge from "./ExperimentalLabBridge";
import LabAutopilotVisibilityBridge from "./LabAutopilotVisibilityBridge";
import LabSimulationRemovalBridge from "./LabSimulationRemovalBridge";
import TicketControlBridge from "./TicketControlBridge";
import MemberControlBridge from "./MemberControlBridge";
import HybridTicketInventoryForecastBridge from "./HybridTicketInventoryForecastBridge";
import AssistPersistenceBridge from "./AssistPersistenceBridge";
import AuthenticatedPersonalizedControlBridge from "./AuthenticatedPersonalizedControlBridge";
import BeginnerHomeBridge from "./BeginnerHomeBridge";
import OperationsManagementBridge from "./OperationsManagementBridge";
import SidebarClarityBridge from "./SidebarClarityBridge";
import AdminOpsBridge from "./AdminOpsBridge";
import MaintenanceDataBridge from "./MaintenanceDataBridge";
import CopilotLanguageExpansionBridge from "./CopilotLanguageExpansionBridge";
import CopilotConversationMemoryBridge from "./CopilotConversationMemoryBridge";
import CopilotRemoteCommandBridge from "./CopilotRemoteCommandBridge";
import CopilotCapabilityBridge from "./CopilotCapabilityBridge";
import CopilotSimplificationBridge from "./CopilotSimplificationBridge";
import CopilotDecisionSupportBridge from "./CopilotDecisionSupportBridge";
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
import "./lab-autopilot-only.css";
import "./lab-no-simulation.css";
import "./operations-management.css";
import "./sidebar-clarity.css";
import "./copilot-simplified.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeviceAccessGate>
      <>
        <App database={db} />
        <AssistPersistenceBridge />
        <PredictiveOpsOverlay database={db} />
        <ExperimentalLabBridge database={db} />
        <LabAutopilotVisibilityBridge />
        <LabSimulationRemovalBridge />
        <TicketControlBridge database={db} />
        <MemberControlBridge database={db} />
        <HybridTicketInventoryForecastBridge database={db} />
        <AuthenticatedPersonalizedControlBridge />
        <BeginnerHomeBridge />
        <OperationsManagementBridge />
        <SidebarClarityBridge />
        <AdminOpsBridge database={db} />
        <MaintenanceDataBridge database={db} />
        <CopilotLanguageExpansionBridge />
        <CopilotConversationMemoryBridge />
        <CopilotRemoteCommandBridge database={db} />
        <CopilotCapabilityBridge database={db} />
        <CopilotSimplificationBridge />
        <CopilotDecisionSupportBridge database={db} />
        <PredictiveCorrelationMemory database={db} />
        <PredictiveChatBridge database={db} />
      </>
    </DeviceAccessGate>
  </StrictMode>
);
