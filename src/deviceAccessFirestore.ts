import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type QuerySnapshot,
  type Transaction,
  type Unsubscribe,
} from "firebase/firestore";

import {
  auth,
  db,
} from "./firebase";

export type DeviceRole =
  | "member"
  | "reception";

export type DeviceRequestType =
  | "initial"
  | "upgrade";

export type DeviceRequestStatus =
  | "pending"
  | "approved"
  | "rejected";

export type AuthorizedDevice = {
  uid: string;
  role: DeviceRole;
  displayName: string;
  deviceName: string;
  active: boolean;
  createdAt: string;
  approvedAt: string;
  approvedByUid: string;
  approvedByName: string;
};

export type DeviceAccessRequest = {
  uid: string;
  requestType: DeviceRequestType;
  requestedRole: DeviceRole;
  displayName: string;
  deviceName: string;
  status: DeviceRequestStatus;
  requestedAt: string;
  decidedAt: string;
  decidedByUid: string;
  decidedByName: string;
};

export type DeviceAccessAudit = {
  id: string;
  action:
    | "bootstrap-member"
    | "request-created"
    | "request-approved"
    | "request-rejected"
    | "device-disabled";
  actorUid: string;
  actorName: string;
  targetUid: string;
  targetName: string;
  role: DeviceRole | null;
  createdAt: string;
};

export type DeviceAccessConfig = {
  initialized: boolean;
  memberDeviceCount: number;
};

const ROOT_COLLECTION =
  "system";

const ROOT_DOCUMENT =
  "device-access";

function getConfigDocument() {
  return doc(
    db,
    ROOT_COLLECTION,
    ROOT_DOCUMENT
  );
}

function getDevicesCollection() {
  return collection(
    db,
    ROOT_COLLECTION,
    ROOT_DOCUMENT,
    "devices"
  );
}

function getDeviceDocument(
  uid: string
) {
  return doc(
    getDevicesCollection(),
    uid
  );
}

function getRequestsCollection() {
  return collection(
    db,
    ROOT_COLLECTION,
    ROOT_DOCUMENT,
    "requests"
  );
}

function getRequestDocument(
  uid: string
) {
  return doc(
    getRequestsCollection(),
    uid
  );
}

function getAuditCollection() {
  return collection(
    db,
    ROOT_COLLECTION,
    ROOT_DOCUMENT,
    "audit"
  );
}

function cleanRequiredText(
  value: string,
  label: string
) {
  const cleaned =
    value.trim();

  if (cleaned === "") {
    throw new Error(
      `${label}を入力してください。`
    );
  }

  if (cleaned.length > 60) {
    throw new Error(
      `${label}は60文字以内で入力してください。`
    );
  }

  return cleaned;
}

function getAuthenticatedUid() {
  const uid =
    auth.currentUser?.uid;

  if (uid === undefined) {
    throw new Error(
      "端末の自動認証が完了していません。"
    );
  }

  return uid;
}

function isDeviceRole(
  value: unknown
): value is DeviceRole {
  return (
    value === "member" ||
    value === "reception"
  );
}

function isRequestType(
  value: unknown
): value is DeviceRequestType {
  return (
    value === "initial" ||
    value === "upgrade"
  );
}

function isRequestStatus(
  value: unknown
): value is DeviceRequestStatus {
  return (
    value === "pending" ||
    value === "approved" ||
    value === "rejected"
  );
}

function readText(
  value: unknown
) {
  return typeof value === "string"
    ? value
    : "";
}

function readDateText(
  value: unknown
) {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    try {
      return value
        .toDate()
        .toISOString();
    } catch {
      return "";
    }
  }

  return "";
}

function convertDevice(
  uid: string,
  data: DocumentData
): AuthorizedDevice | null {
  if (
    !isDeviceRole(data.role) ||
    typeof data.active !== "boolean"
  ) {
    return null;
  }

  return {
    uid,
    role: data.role,
    displayName:
      readText(data.displayName),
    deviceName:
      readText(data.deviceName),
    active: data.active,
    createdAt:
      readDateText(data.createdAt),
    approvedAt:
      readDateText(data.approvedAt),
    approvedByUid:
      readText(data.approvedByUid),
    approvedByName:
      readText(data.approvedByName),
  };
}

function convertRequest(
  uid: string,
  data: DocumentData
): DeviceAccessRequest | null {
  if (
    !isRequestType(data.requestType) ||
    !isDeviceRole(data.requestedRole) ||
    !isRequestStatus(data.status)
  ) {
    return null;
  }

  return {
    uid,
    requestType:
      data.requestType,
    requestedRole:
      data.requestedRole,
    displayName:
      readText(data.displayName),
    deviceName:
      readText(data.deviceName),
    status:
      data.status,
    requestedAt:
      readDateText(data.requestedAt),
    decidedAt:
      readDateText(data.decidedAt),
    decidedByUid:
      readText(data.decidedByUid),
    decidedByName:
      readText(data.decidedByName),
  };
}

function convertAudit(
  id: string,
  data: DocumentData
): DeviceAccessAudit | null {
  const validAction =
    data.action === "bootstrap-member" ||
    data.action === "request-created" ||
    data.action === "request-approved" ||
    data.action === "request-rejected" ||
    data.action === "device-disabled";

  if (!validAction) {
    return null;
  }

  return {
    id,
    action: data.action,
    actorUid:
      readText(data.actorUid),
    actorName:
      readText(data.actorName),
    targetUid:
      readText(data.targetUid),
    targetName:
      readText(data.targetName),
    role:
      isDeviceRole(data.role)
        ? data.role
        : null,
    createdAt:
      readDateText(data.createdAt),
  };
}

function convertConfig(
  data: DocumentData | undefined
): DeviceAccessConfig {
  return {
    initialized:
      data?.initialized === true,
    memberDeviceCount:
      typeof data?.memberDeviceCount ===
        "number" &&
      Number.isFinite(
        data.memberDeviceCount
      )
        ? Math.max(
            0,
            Math.floor(
              data.memberDeviceCount
            )
          )
        : 0,
  };
}

export function subscribeToDeviceAccessConfig(
  onChanged: (
    config: DeviceAccessConfig,
    fromCache: boolean
  ) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    getConfigDocument(),
    {
      includeMetadataChanges: true,
    },
    (snapshot) => {
      onChanged(
        convertConfig(
          snapshot.exists()
            ? snapshot.data()
            : undefined
        ),
        snapshot.metadata.fromCache
      );
    },
    onError
  );
}

export function subscribeToAuthorizedDevice(
  uid: string,
  onChanged: (
    device: AuthorizedDevice | null,
    fromCache: boolean
  ) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    getDeviceDocument(uid),
    {
      includeMetadataChanges: true,
    },
    (snapshot) => {
      onChanged(
        snapshot.exists()
          ? convertDevice(
              snapshot.id,
              snapshot.data()
            )
          : null,
        snapshot.metadata.fromCache
      );
    },
    onError
  );
}

export function subscribeToDeviceRequest(
  uid: string,
  onChanged: (
    request: DeviceAccessRequest | null,
    fromCache: boolean
  ) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    getRequestDocument(uid),
    {
      includeMetadataChanges: true,
    },
    (snapshot) => {
      onChanged(
        snapshot.exists()
          ? convertRequest(
              snapshot.id,
              snapshot.data()
            )
          : null,
        snapshot.metadata.fromCache
      );
    },
    onError
  );
}

function convertDevicesSnapshot(
  snapshot: QuerySnapshot<DocumentData>
) {
  return snapshot.docs
    .map((item) =>
      convertDevice(
        item.id,
        item.data()
      )
    )
    .filter(
      (
        device
      ): device is AuthorizedDevice =>
        device !== null
    )
    .sort((first, second) => {
      if (first.active !== second.active) {
        return first.active ? -1 : 1;
      }

      if (first.role !== second.role) {
        return first.role === "member"
          ? -1
          : 1;
      }

      return first.displayName.localeCompare(
        second.displayName,
        "ja"
      );
    });
}

export function subscribeToAuthorizedDevices(
  onChanged: (
    devices: AuthorizedDevice[]
  ) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    getDevicesCollection(),
    (snapshot) => {
      onChanged(
        convertDevicesSnapshot(
          snapshot
        )
      );
    },
    onError
  );
}

export function subscribeToPendingDeviceRequests(
  onChanged: (
    requests: DeviceAccessRequest[]
  ) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    getRequestsCollection(),
    (snapshot) => {
      const requests =
        snapshot.docs
          .map((item) =>
            convertRequest(
              item.id,
              item.data()
            )
          )
          .filter(
            (
              request
            ): request is DeviceAccessRequest =>
              request !== null &&
              request.status === "pending"
          )
          .sort((first, second) =>
            first.requestedAt.localeCompare(
              second.requestedAt
            )
          );

      onChanged(requests);
    },
    onError
  );
}

export function subscribeToDeviceAccessAudit(
  onChanged: (
    entries: DeviceAccessAudit[]
  ) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    getAuditCollection(),
    (snapshot) => {
      const entries =
        snapshot.docs
          .map((item) =>
            convertAudit(
              item.id,
              item.data()
            )
          )
          .filter(
            (
              entry
            ): entry is DeviceAccessAudit =>
              entry !== null
          )
          .sort((first, second) =>
            second.createdAt.localeCompare(
              first.createdAt
            )
          )
          .slice(0, 30);

      onChanged(entries);
    },
    onError
  );
}

export async function bootstrapFirstMemberDevice(
  displayName: string,
  deviceName: string
) {
  const uid =
    getAuthenticatedUid();
  const cleanDisplayName =
    cleanRequiredText(
      displayName,
      "部員名"
    );
  const cleanDeviceName =
    cleanRequiredText(
      deviceName,
      "端末名"
    );
  const auditDocument =
    doc(getAuditCollection());

  await runTransaction(
    db,
    async (transaction) => {
      const configDocument =
        getConfigDocument();
      const configSnapshot =
        await transaction.get(
          configDocument
        );
      const config =
        convertConfig(
          configSnapshot.exists()
            ? configSnapshot.data()
            : undefined
        );

      if (config.initialized) {
        throw new Error(
          "初期設定はすでに完了しています。利用申請を送信してください。"
        );
      }

      transaction.set(
        configDocument,
        {
          initialized: true,
          memberDeviceCount: 1,
          createdAt:
            serverTimestamp(),
          updatedAt:
            serverTimestamp(),
        }
      );

      transaction.set(
        getDeviceDocument(uid),
        {
          role: "member",
          displayName:
            cleanDisplayName,
          deviceName:
            cleanDeviceName,
          active: true,
          createdAt:
            serverTimestamp(),
          approvedAt:
            serverTimestamp(),
          approvedByUid: uid,
          approvedByName:
            cleanDisplayName,
        }
      );

      transaction.set(
        auditDocument,
        {
          action:
            "bootstrap-member",
          actorUid: uid,
          actorName:
            cleanDisplayName,
          targetUid: uid,
          targetName:
            cleanDeviceName,
          role: "member",
          createdAt:
            serverTimestamp(),
        }
      );
    }
  );
}

export async function submitDeviceAccessRequest(
  requestedRole: DeviceRole,
  displayName: string,
  deviceName: string,
  requestType: DeviceRequestType =
    "initial"
) {
  const uid =
    getAuthenticatedUid();
  const cleanDisplayName =
    cleanRequiredText(
      displayName,
      "部員名"
    );
  const cleanDeviceName =
    cleanRequiredText(
      deviceName,
      "端末名"
    );

  const batch =
    writeBatch(db);

  batch.set(
    getRequestDocument(uid),
    {
      requestType,
      requestedRole,
      displayName:
        cleanDisplayName,
      deviceName:
        cleanDeviceName,
      status: "pending",
      requestedAt:
        serverTimestamp(),
      decidedAt: null,
      decidedByUid: "",
      decidedByName: "",
    }
  );

  batch.set(
    doc(getAuditCollection()),
    {
      action: "request-created",
      actorUid: uid,
      actorName:
        cleanDisplayName,
      targetUid: uid,
      targetName:
        cleanDeviceName,
      role: requestedRole,
      createdAt:
        serverTimestamp(),
    }
  );

  await batch.commit();
}

async function getActorInTransaction(
  transaction: Transaction,
  actorUid: string
) {
  const actorSnapshot =
    await transaction.get(
      getDeviceDocument(
        actorUid
      )
    );
  const actor =
    actorSnapshot.exists()
      ? convertDevice(
          actorSnapshot.id,
          actorSnapshot.data()
        )
      : null;

  if (
    actor === null ||
    !actor.active ||
    actor.role !== "member"
  ) {
    throw new Error(
      "この操作は部員端末から行ってください。"
    );
  }

  return actor;
}

export async function approveDeviceAccessRequest(
  targetUid: string
) {
  const actorUid =
    getAuthenticatedUid();

  if (actorUid === targetUid) {
    throw new Error(
      "自分の申請は自分では承認できません。別の部員端末から承認してください。"
    );
  }

  const auditDocument =
    doc(getAuditCollection());

  await runTransaction(
    db,
    async (transaction) => {
      const actor =
        await getActorInTransaction(
          transaction,
          actorUid
        );
      const requestDocument =
        getRequestDocument(
          targetUid
        );
      const requestSnapshot =
        await transaction.get(
          requestDocument
        );
      const request =
        requestSnapshot.exists()
          ? convertRequest(
              requestSnapshot.id,
              requestSnapshot.data()
            )
          : null;

      if (
        request === null ||
        request.status !== "pending"
      ) {
        throw new Error(
          "この申請はすでに処理されています。"
        );
      }

      const targetDocument =
        getDeviceDocument(
          targetUid
        );
      const targetSnapshot =
        await transaction.get(
          targetDocument
        );
      const currentTarget =
        targetSnapshot.exists()
          ? convertDevice(
              targetSnapshot.id,
              targetSnapshot.data()
            )
          : null;
      const configDocument =
        getConfigDocument();
      const configSnapshot =
        await transaction.get(
          configDocument
        );
      const config =
        convertConfig(
          configSnapshot.exists()
            ? configSnapshot.data()
            : undefined
        );

      if (!config.initialized) {
        throw new Error(
          "端末管理の初期設定が完了していません。"
        );
      }

      const becomesNewMember =
        request.requestedRole ===
          "member" &&
        !(
          currentTarget?.active ===
            true &&
          currentTarget.role ===
            "member"
        );

      const targetData:
        DocumentData = {
        role:
          request.requestedRole,
        displayName:
          request.displayName,
        deviceName:
          request.deviceName,
        active: true,
        approvedAt:
          serverTimestamp(),
        approvedByUid:
          actor.uid,
        approvedByName:
          actor.displayName,
      };

      if (currentTarget === null) {
        targetData.createdAt =
          serverTimestamp();
      }

      transaction.set(
        targetDocument,
        targetData,
        {
          merge: true,
        }
      );

      transaction.update(
        requestDocument,
        {
          status: "approved",
          decidedAt:
            serverTimestamp(),
          decidedByUid:
            actor.uid,
          decidedByName:
            actor.displayName,
        }
      );

      if (becomesNewMember) {
        transaction.update(
          configDocument,
          {
            memberDeviceCount:
              config.memberDeviceCount +
              1,
            updatedAt:
              serverTimestamp(),
          }
        );
      }

      transaction.set(
        auditDocument,
        {
          action:
            "request-approved",
          actorUid:
            actor.uid,
          actorName:
            actor.displayName,
          targetUid,
          targetName:
            request.deviceName,
          role:
            request.requestedRole,
          createdAt:
            serverTimestamp(),
        }
      );
    }
  );
}

export async function rejectDeviceAccessRequest(
  targetUid: string
) {
  const actorUid =
    getAuthenticatedUid();

  if (actorUid === targetUid) {
    throw new Error(
      "自分の申請は自分では却下できません。"
    );
  }

  const auditDocument =
    doc(getAuditCollection());

  await runTransaction(
    db,
    async (transaction) => {
      const actor =
        await getActorInTransaction(
          transaction,
          actorUid
        );
      const requestDocument =
        getRequestDocument(
          targetUid
        );
      const requestSnapshot =
        await transaction.get(
          requestDocument
        );
      const request =
        requestSnapshot.exists()
          ? convertRequest(
              requestSnapshot.id,
              requestSnapshot.data()
            )
          : null;

      if (
        request === null ||
        request.status !== "pending"
      ) {
        throw new Error(
          "この申請はすでに処理されています。"
        );
      }

      transaction.update(
        requestDocument,
        {
          status: "rejected",
          decidedAt:
            serverTimestamp(),
          decidedByUid:
            actor.uid,
          decidedByName:
            actor.displayName,
        }
      );

      transaction.set(
        auditDocument,
        {
          action:
            "request-rejected",
          actorUid:
            actor.uid,
          actorName:
            actor.displayName,
          targetUid,
          targetName:
            request.deviceName,
          role:
            request.requestedRole,
          createdAt:
            serverTimestamp(),
        }
      );
    }
  );
}

export async function disableAuthorizedDevice(
  targetUid: string
) {
  const actorUid =
    getAuthenticatedUid();

  if (actorUid === targetUid) {
    throw new Error(
      "現在使用中の端末は停止できません。別の部員端末から操作してください。"
    );
  }

  const auditDocument =
    doc(getAuditCollection());

  await runTransaction(
    db,
    async (transaction) => {
      const actor =
        await getActorInTransaction(
          transaction,
          actorUid
        );
      const targetDocument =
        getDeviceDocument(
          targetUid
        );
      const targetSnapshot =
        await transaction.get(
          targetDocument
        );
      const target =
        targetSnapshot.exists()
          ? convertDevice(
              targetSnapshot.id,
              targetSnapshot.data()
            )
          : null;

      if (
        target === null ||
        !target.active
      ) {
        throw new Error(
          "この端末はすでに停止されています。"
        );
      }

      const configDocument =
        getConfigDocument();
      const configSnapshot =
        await transaction.get(
          configDocument
        );
      const config =
        convertConfig(
          configSnapshot.exists()
            ? configSnapshot.data()
            : undefined
        );

      if (
        target.role === "member" &&
        config.memberDeviceCount <= 1
      ) {
        throw new Error(
          "最後の部員端末は停止できません。先に別の部員端末を承認してください。"
        );
      }

      transaction.update(
        targetDocument,
        {
          active: false,
          disabledAt:
            serverTimestamp(),
          disabledByUid:
            actor.uid,
          disabledByName:
            actor.displayName,
        }
      );

      if (target.role === "member") {
        transaction.update(
          configDocument,
          {
            memberDeviceCount:
              Math.max(
                0,
                config.memberDeviceCount -
                  1
              ),
            updatedAt:
              serverTimestamp(),
          }
        );
      }

      transaction.set(
        auditDocument,
        {
          action:
            "device-disabled",
          actorUid:
            actor.uid,
          actorName:
            actor.displayName,
          targetUid,
          targetName:
            target.deviceName,
          role:
            target.role,
          createdAt:
            serverTimestamp(),
        }
      );
    }
  );
}
