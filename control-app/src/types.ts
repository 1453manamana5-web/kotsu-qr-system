export type EventStatus = "scheduled" | "active" | "ended";

export type EventData = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  status: EventStatus;
  dataDocumentId: string;
  capacity: number;
};

export type LiveActivity = {
  id: string;
  type: "ticket-entry" | "ticket-exit" | "member-entry" | "member-exit";
  timestamp: number;
};

export type AnalyticsSummary = {
  totalVisitors: number;
  currentInside: number;
  currentMembersInside: number;
  reEntryCount: number;
  ticketCount: number;
  activityCount: number;
  hourlyEntryCounts: Record<string, number>;
};

export type CameraState = "starting" | "ready" | "error";
export type ReceptionMode = "entry" | "exit";
export type ReceptionViewState =
  | "waiting"
  | "processing"
  | "success-animation"
  | "ticket-success"
  | "member-success"
  | "error";

export type ReceptionDevice = {
  id: string;
  registeredDeviceId: string;
  deviceName: string;
  deviceType: string;
  role: string;
  mode: ReceptionMode;
  appVersion: string;
  lastSeenAt: number;
  lastSuccessfulSyncAt: number;
  pendingCount: number;
  cameraState: CameraState;
  receptionPaused: boolean;
  firebaseLatencyMs: number;
  downloadMbps: number;
  networkMeasuredAt: string;
  screen: string;
  viewState: ReceptionViewState;
  sessionStartedAt: string;
  lastScanAt: string;
};

export type HealthSeverity = "normal" | "warning" | "critical";

export type SystemAlert = {
  id: string;
  severity: HealthSeverity;
  title: string;
  detail: string;
};
