import AnomalyNotificationBridge from "./AnomalyNotificationBridge";
import ExperimentalLabBridge from "./ExperimentalLabBridge";
import LabAutopilotVisibilityBridge from "./LabAutopilotVisibilityBridge";
import TicketControlBridge from "./TicketControlBridge";
import MemberControlBridge from "./MemberControlBridge";
import HybridTicketInventoryForecastBridge from "./HybridTicketInventoryForecastBridge";
import OperationsManagementBridge from "./OperationsManagementBridge";
import AdminOpsBridge from "./AdminOpsBridge";
import MaintenanceDataBridge from "./MaintenanceDataBridge";
import DetailedLabTutorial from "./DetailedLabTutorial";
import StandaloneTutorialGuideV3 from "./StandaloneTutorialGuideV3";
import PredictiveOpsOverlay from "./PredictiveOpsOverlay";
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
import type { Firestore } from "firebase/firestore";

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
import "./copilot-simplified.css";
import "./anomaly-notifications.css";
import "./copilot-learning.css";

export default function DeferredControlFeatures({ database }: { database: Firestore }) {
  return (
    <>
      <DetailedLabTutorial />
      <StandaloneTutorialGuideV3 />
      <PredictiveOpsOverlay database={database} />
      <AnomalyNotificationBridge database={database} />
      <ExperimentalLabBridge database={database} />
      <LabAutopilotVisibilityBridge />
      <TicketControlBridge database={database} />
      <MemberControlBridge database={database} />
      <HybridTicketInventoryForecastBridge database={database} />
      <OperationsManagementBridge />
      <AdminOpsBridge database={database} />
      <MaintenanceDataBridge database={database} />
      <CopilotLearningBridge />
      <CopilotLanguageExpansionBridge />
      <CopilotConversationMemoryBridge />
      <CopilotRemoteCommandBridge database={database} />
      <CopilotCapabilityBridge database={database} />
      <CopilotSimplificationBridge />
      <CopilotDecisionSupportBridge database={database} />
      <PredictiveCorrelationMemory database={database} />
      <PredictiveChatBridge database={database} />
      <TutorialHighlightOverlayBridge />
    </>
  );
}
