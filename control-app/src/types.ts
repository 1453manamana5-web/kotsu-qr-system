export type EventStatus = "scheduled" | "active" | "ended";

export type EventData = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  status: EventStatus;
  dataDocumentId: string;
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
  screen: string;
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
