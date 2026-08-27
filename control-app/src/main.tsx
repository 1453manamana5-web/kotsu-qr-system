import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import DeviceAccessGate from "./DeviceAccessGate";
import DetailedLabTutorial from "./DetailedLabTutorial";
import StandaloneTutorialGuideV3 from "./StandaloneTutorialGuideV3";
import PredictiveOpsOverlay from "./PredictiveOpsOverlay";
import AnomalyNotificationBridge from "./AnomalyNotificationBridge";
import ExperimentalLabBridge from "./ExperimentalLabBridge";
import LabAutopilotVisibilityBridge from "./LabAutopilotVisibilityBridge";
import TicketControlBridge from "./TicketControlBridge";
import MemberControlBridge from "./MemberControlBridge";
import HybridTicketInventoryForecastBridge from "./HybridTicketInventoryForecastBridge";
import ControlAssistBridge from "./ControlAssistBridge";
import ControlAssistHelpBridge from "./ControlAssistHelpBridge";
import BeginnerHomeBridge from "./BeginnerHomeBridge";
import OperationsManagementBridge from "./OperationsManagementBridge";
import SidebarClarityBridge from "./SidebarClarityBridge";
import AdminOpsBridge from "./AdminOpsBridge";
import MaintenanceDataBridge from "./MaintenanceDataBridge";
import CopilotLearningBridge from "./CopilotLearningBridge";
import CopilotLanguageExpansionBridge from "./CopilotLanguageExpansionBridge";
import CopilotConversationMemoryBridge from "./CopilotConversationMemoryBridge";
import CopilotRemoteCommandBridge from "./CopilotRemoteCommandBridge";
import CopilotCapabilityBridge from "./CopilotCapabilityBridge";
import CopilotSimplificationBridge from "./CopilotSimplificationBridge";
import CopilotDecisionSupportBridge from "./CopilotDecisionSupportBridge";
import PredictiveCorrelationMemory from "./PredictiveCorrelationMemory";
import PredictiveChatBridge from "./PredictiveChatBridge";
import TutorialHighlightOverlayBridge from "../../src/TutorialHighlightOverlayBridge";
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DeviceAccessGate>
      <>
        <App database={db} />
        <DetailedLabTutorial />
        <StandaloneTutorialGuideV3 />
        <PredictiveOpsOverlay database={db} />
        <AnomalyNotificationBridge database={db} />
        <ExperimentalLabBridge database={db} />
        <LabAutopilotVisibilityBridge />
        <TicketControlBridge database={db} />
        <MemberControlBridge database={db} />
        <HybridTicketInventoryForecastBridge database={db} />
        <ControlAssistBridge database={db} />
        <ControlAssistHelpBridge />
        <BeginnerHomeBridge />
        <OperationsManagementBridge />
        <SidebarClarityBridge />
        <AdminOpsBridge database={db} />
        <MaintenanceDataBridge database={db} />
        <CopilotLearningBridge />
        <CopilotLanguageExpansionBridge />
        <CopilotConversationMemoryBridge />
        <CopilotRemoteCommandBridge database={db} />
        <CopilotCapabilityBridge database={db} />
        <CopilotSimplificationBridge />
        <CopilotDecisionSupportBridge database={db} />
        <PredictiveCorrelationMemory database={db} />
        <PredictiveChatBridge database={db} />
        <TutorialHighlightOverlayBridge />
      </>
    </DeviceAccessGate>
  </StrictMode>
);
