import {
  addDoc,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";

import {
  auth,
} from "./firebaseAuth";

import {
  db,
} from "./firebase";

import {
  EVENT_DATA_COLLECTION,
  RECEPTION_DEVICES_COLLECTION,
  getEventDataId,
} from "./firestorePaths";

export type ReceptionRemoteCommandType =
  | "pause-reception"
  | "resume-reception"
  | "restart-camera"
  | "sync-pending"
  | "play-sound"
  | "reload-app";

export type ReceptionRemoteCommandStatus =
  | "pending"
  | "received"
  | "completed"
  | "failed";

export type ReceptionRemoteCommand = {
  id: string;
  type: ReceptionRemoteCommandType;
  status: ReceptionRemoteCommandStatus;
  issuedByUid: string;
  issuedByName: string;
  createdAt: number;
  expiresAt: number;
  receivedAt: number;
  completedAt: number;
  updatedAt: number;
  errorMessage: string;
};

const COMMAND_LIFETIME_MILLISECONDS =
  30 * 1000;

const COMMAND_TYPES:
  ReceptionRemoteCommandType[] = [
    "pause-reception",
    "resume-reception",
    "restart-camera",
    "sync-pending",
    "play-sound",
    "reload-app",
  ];

const COMMAND_STATUSES:
  ReceptionRemoteCommandStatus[] = [
    "pending",
    "received",
    "completed",
    "failed",
  ];

function readTimestamp(
  value: unknown
) {
  if (
    typeof value === "object" &&
    value !== null &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }

  return 0;
}

function readCommand(
  id: string,
  data: DocumentData
): ReceptionRemoteCommand | null {
  if (
    !COMMAND_TYPES.includes(
      data.type as ReceptionRemoteCommandType
    ) ||
    !COMMAND_STATUSES.includes(
      data.status as ReceptionRemoteCommandStatus
    )
  ) {
    return null;
  }

  return {
    id,
    type:
      data.type as ReceptionRemoteCommandType,
    status:
      data.status as ReceptionRemoteCommandStatus,
    issuedByUid:
      typeof data.issuedByUid === "string"
        ? data.issuedByUid
        : "",
    issuedByName:
      typeof data.issuedByName === "string"
        ? data.issuedByName
        : "管制システム",
    createdAt:
      readTimestamp(data.createdAt),
    expiresAt:
      readTimestamp(data.expiresAt),
    receivedAt:
      readTimestamp(data.receivedAt),
    completedAt:
      readTimestamp(data.completedAt),
    updatedAt:
      readTimestamp(data.updatedAt),
    errorMessage:
      typeof data.errorMessage === "string"
        ? data.errorMessage
        : "",
  };
}

function getCommandsCollection(
  eventDataId: string,
  deviceId: string
) {
  return collection(
    db,
    EVENT_DATA_COLLECTION,
    eventDataId,
    RECEPTION_DEVICES_COLLECTION,
    deviceId,
    "commands"
  );
}

function getCommandDocument(
  eventDataId: string,
  deviceId: string,
  commandId: string
) {
  return doc(
    getCommandsCollection(
      eventDataId,
      deviceId
    ),
    commandId
  );
}

export async function sendReceptionRemoteCommand(
  eventDataId: string,
  deviceId: string,
  type: ReceptionRemoteCommandType
) {
  const user =
    auth.currentUser;

  if (user === null) {
    throw new Error(
      "管制端末の認証情報がありません。"
    );
  }

  const commandDocument =
    await addDoc(
      getCommandsCollection(
        eventDataId,
        deviceId
      ),
      {
        type,
        status:
          "pending",
        issuedByUid:
          user.uid,
        issuedByName:
          "管制システム",
        createdAt:
          serverTimestamp(),
        expiresAt:
          Timestamp.fromMillis(
            Date.now() +
              COMMAND_LIFETIME_MILLISECONDS
          ),
        receivedAt:
          null,
        completedAt:
          null,
        updatedAt:
          serverTimestamp(),
        errorMessage:
          "",
      }
    );

  return commandDocument.id;
}

export function subscribeToReceptionRemoteCommands(
  eventDataId: string,
  deviceId: string,
  onCommandsChanged: (
    commands: ReceptionRemoteCommand[]
  ) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    query(
      getCommandsCollection(
        eventDataId,
        deviceId
      ),
      orderBy(
        "createdAt",
        "desc"
      ),
      limit(10)
    ),
    (snapshot) => {
      const commands =
        snapshot.docs
          .map((commandDocument) =>
            readCommand(
              commandDocument.id,
              commandDocument.data()
            )
          )
          .filter(
            (
              command
            ): command is ReceptionRemoteCommand =>
              command !== null
          )
          .sort((first, second) =>
            second.createdAt -
            first.createdAt
          );

      onCommandsChanged(
        commands
      );
    },
    (error) => {
      console.error(
        "遠隔操作履歴を取得できませんでした。",
        error
      );

      onError?.(error);
    }
  );
}

export function subscribeToPendingReceptionRemoteCommands(
  eventName: string,
  deviceId: string,
  onCommand: (
    command: ReceptionRemoteCommand
  ) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const eventDataId =
    getEventDataId(eventName);

  return onSnapshot(
    query(
      getCommandsCollection(
        eventDataId,
        deviceId
      ),
      where(
        "status",
        "==",
        "pending"
      )
    ),
    (snapshot) => {
      snapshot.docs.forEach(
        (commandDocument) => {
          const command =
            readCommand(
              commandDocument.id,
              commandDocument.data()
            );

          if (
            command !== null &&
            command.status === "pending"
          ) {
            onCommand(command);
          }
        }
      );
    },
    (error) => {
      console.error(
        "受付端末で遠隔操作を受信できませんでした。",
        error
      );

      onError?.(error);
    }
  );
}

export async function markReceptionRemoteCommandReceived(
  eventName: string,
  deviceId: string,
  commandId: string
) {
  await updateDoc(
    getCommandDocument(
      getEventDataId(eventName),
      deviceId,
      commandId
    ),
    {
      status:
        "received",
      receivedAt:
        serverTimestamp(),
      updatedAt:
        serverTimestamp(),
    }
  );
}

export async function finishReceptionRemoteCommand(
  eventName: string,
  deviceId: string,
  commandId: string,
  succeeded: boolean,
  errorMessage = ""
) {
  await updateDoc(
    getCommandDocument(
      getEventDataId(eventName),
      deviceId,
      commandId
    ),
    {
      status:
        succeeded
          ? "completed"
          : "failed",
      completedAt:
        serverTimestamp(),
      updatedAt:
        serverTimestamp(),
      errorMessage:
        errorMessage.slice(0, 160),
    }
  );
}
