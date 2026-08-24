import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";

import {
  db,
} from "./firebase";

import {
  EVENT_DATA_COLLECTION,
  RECEPTION_DEVICES_COLLECTION,
  getEventDataId,
  createSafeRandomId,
} from "./firestorePaths";

import type {
  DeviceRole,
  DeviceType,
} from "./deviceAccessFirestore";

export type ReceptionMode =
  | "entry"
  | "exit";

export type ReceptionDevice = {
  deviceId: string;
  mode: ReceptionMode;
  lastSeenAt: number;
  registeredDeviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  role: DeviceRole;
  appVersion: string;
  lastSuccessfulSyncAt: string;
  pendingCount: number;
  cameraState: ReceptionCameraState;
  screen: ReceptionScreen;
  sessionStartedAt: string;
  lastScanAt: string;
};

export type ReceptionCameraState =
  | "starting"
  | "ready"
  | "error";

export type ReceptionScreen =
  | "entry-reception"
  | "exit-reception";

export type ReceptionHeartbeat = {
  registeredDeviceId: string;
  deviceName: string;
  deviceType: DeviceType;
  role: DeviceRole;
  mode: ReceptionMode;
  appVersion: string;
  pendingCount: number;
  cameraState: ReceptionCameraState;
  screen: ReceptionScreen;
  sessionStartedAt: string;
  lastScanAt: string;
};

export type ReceptionPresenceSummary = {
  entryCount: number;
  exitCount: number;
  devices: ReceptionDevice[];
};

/*
  直近15秒以内に生存通知が届いた端末を
  稼働中として数えます。
*/
const ONLINE_LIMIT_MILLISECONDS =
  15 * 1000;

function isReceptionMode(
  value: unknown
): value is ReceptionMode {
  return (
    value === "entry" ||
    value === "exit"
  );
}

function convertReceptionDevice(
  documentId: string,
  data: DocumentData
): ReceptionDevice | null {
  if (
    !isReceptionMode(
      data.mode
    ) ||
    typeof data.lastSeenAt !==
      "number"
  ) {
    return null;
  }

  return {
    deviceId:
      typeof data.deviceId ===
        "string"
        ? data.deviceId
        : documentId,

    mode:
      data.mode,

    lastSeenAt:
      data.lastSeenAt,

    registeredDeviceId:
      typeof data.registeredDeviceId ===
        "string"
        ? data.registeredDeviceId
        : "",

    deviceName:
      typeof data.deviceName ===
        "string"
        ? data.deviceName
        : "受付端末",

    deviceType:
      typeof data.deviceType ===
        "string"
        ? data.deviceType as DeviceType
        : "unknown",

    role:
      data.role === "member" ||
      data.role === "reception" ||
      data.role === "control"
        ? data.role
        : "reception",

    appVersion:
      typeof data.appVersion ===
        "string"
        ? data.appVersion
        : "不明",

    lastSuccessfulSyncAt:
      typeof data.lastSuccessfulSyncAt ===
        "object" &&
      data.lastSuccessfulSyncAt !== null &&
      "toDate" in data.lastSuccessfulSyncAt &&
      typeof data.lastSuccessfulSyncAt.toDate ===
        "function"
        ? data.lastSuccessfulSyncAt.toDate().toISOString()
        : "",

    pendingCount:
      typeof data.pendingCount ===
        "number"
        ? Math.max(
            0,
            Math.floor(data.pendingCount)
          )
        : 0,

    cameraState:
      data.cameraState === "ready" ||
      data.cameraState === "error"
        ? data.cameraState
        : "starting",

    screen:
      data.screen === "exit-reception"
        ? "exit-reception"
        : "entry-reception",

    sessionStartedAt:
      typeof data.sessionStartedAt ===
        "string"
        ? data.sessionStartedAt
        : "",

    lastScanAt:
      typeof data.lastScanAt ===
        "string"
        ? data.lastScanAt
        : "",
  };
}

function getReceptionDevicesCollection(
  eventName: string
) {
  return collection(
    db,
    EVENT_DATA_COLLECTION,
    getEventDataId(
      eventName
    ),
    RECEPTION_DEVICES_COLLECTION
  );
}

function getReceptionDeviceDocument(
  eventName: string,
  deviceId: string
) {
  return doc(
    db,
    EVENT_DATA_COLLECTION,
    getEventDataId(
      eventName
    ),
    RECEPTION_DEVICES_COLLECTION,
    deviceId
  );
}

export function createReceptionDeviceId(
  mode: ReceptionMode
) {
  const storageKey =
    `qr-management-reception-device-${mode}`;

  try {
    const savedDeviceId =
      sessionStorage.getItem(
        storageKey
      );

    if (
      savedDeviceId !==
      null &&
      savedDeviceId.trim() !==
      ""
    ) {
      return savedDeviceId;
    }

    const newDeviceId =
      `${mode}-${createSafeRandomId()}`;

    sessionStorage.setItem(
      storageKey,
      newDeviceId
    );

    return newDeviceId;
  } catch (error) {
    console.warn(
      "受付端末IDを保存できませんでした。",
      error
    );

    return `${mode}-${createSafeRandomId()}`;
  }
}

export async function sendReceptionHeartbeat(
  eventName: string,
  deviceId: string,
  heartbeat: ReceptionHeartbeat
) {
  if (
    eventName.trim() ===
    ""
  ) {
    return;
  }

  await setDoc(
    getReceptionDeviceDocument(
      eventName,
      deviceId
    ),
    {
      deviceId,

      registeredDeviceId:
        heartbeat.registeredDeviceId,

      deviceName:
        heartbeat.deviceName,

      deviceType:
        heartbeat.deviceType,

      role:
        heartbeat.role,

      mode:
        heartbeat.mode,

      appVersion:
        heartbeat.appVersion,

      /*
        画面側ですぐ判定できるように
        ミリ秒の数値も保存します。
      */
      lastSeenAt:
        Date.now(),

      lastSuccessfulSyncAt:
        serverTimestamp(),

      pendingCount:
        heartbeat.pendingCount,

      cameraState:
        heartbeat.cameraState,

      screen:
        heartbeat.screen,

      sessionStartedAt:
        heartbeat.sessionStartedAt,

      lastScanAt:
        heartbeat.lastScanAt,

      updatedAt:
        serverTimestamp(),
    },
    {
      merge: true,
    }
  );
}

export async function removeReceptionPresence(
  eventName: string,
  deviceId: string
) {
  if (
    eventName.trim() ===
    ""
  ) {
    return;
  }

  await deleteDoc(
    getReceptionDeviceDocument(
      eventName,
      deviceId
    )
  );
}

export function subscribeToReceptionPresence(
  eventName: string,
  onPresenceChanged: (
    summary:
      ReceptionPresenceSummary
  ) => void,
  onError?: (
    error: Error
  ) => void
): Unsubscribe {
  if (
    eventName.trim() ===
    ""
  ) {
    onPresenceChanged({
      entryCount:
        0,

      exitCount:
        0,

      devices:
        [],
    });

    return () => {
      // イベント未設定時は解除処理なし
    };
  }

  return onSnapshot(
    getReceptionDevicesCollection(
      eventName
    ),

    (snapshot) => {
      const currentTime =
        Date.now();

      const devices =
        snapshot.docs
          .map(
            (
              documentSnapshot
            ) =>
              convertReceptionDevice(
                documentSnapshot.id,
                documentSnapshot.data()
              )
          )
          .filter(
            (
              device
            ): device is ReceptionDevice =>
              device !== null
          )
          .filter(
            (device) =>
              currentTime -
                device.lastSeenAt <=
              ONLINE_LIMIT_MILLISECONDS
          );

      onPresenceChanged({
        entryCount:
          devices.filter(
            (device) =>
              device.mode ===
              "entry"
          ).length,

        exitCount:
          devices.filter(
            (device) =>
              device.mode ===
              "exit"
          ).length,

        devices,
      });
    },

    (error) => {
      console.error(
        "受付端末の稼働状況を取得できませんでした。",
        error
      );

      onError?.(
        error
      );
    }
  );
}
