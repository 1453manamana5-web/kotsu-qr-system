import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";

import {
  db,
} from "./firebase";

import {
  acceptMemberReceptionOffline,
  cacheEventMembersForOffline,
  cacheMemberCardsForOffline,
  isTransientReceptionError,
  updateCachedMemberStatus,
} from "./offlineReceptionStore";

export type MemberStatus =
  | "未入室"
  | "入室中"
  | "退出済み";

export type MemberCard = {
  id: string;
  qrNumber: string;
  authToken: string;
};

export type EventMember = {
  qrNumber: string;
  name: string;
  status: MemberStatus;
};

export type Member =
  MemberCard &
  EventMember;

export type MemberReceptionResult =
  | {
      success: true;
      member: Member;
      action:
        | "entry"
        | "exit";
      syncStatus:
        | "synced"
        | "pending";
    }
  | {
      success: false;
      reason:
        | "not-found"
        | "not-cached"
        | "invalid-token"
        | "duplicate";
    };

const MEMBER_CARDS_COLLECTION =
  "member-cards";

const EVENT_DATA_COLLECTION =
  "event-data";

const EVENT_MEMBERS_COLLECTION =
  "members";

const ACTIVITY_COLLECTION =
  "activity";

function createSafeEventId(
  eventName: string
) {
  const normalizedName =
    eventName.trim();

  return normalizedName === ""
    ? "event-not-set"
    : encodeURIComponent(
        normalizedName
      );
}

function createSafeRandomId() {
  try {
    if (
      typeof globalThis.crypto !==
        "undefined" &&
      typeof globalThis.crypto.randomUUID ===
        "function"
    ) {
      return globalThis.crypto.randomUUID();
    }
  } catch (error) {
    console.warn(
      "IDを生成できませんでした。",
      error
    );
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function isMemberStatus(
  value: unknown
): value is MemberStatus {
  return (
    value === "未入室" ||
    value === "入室中" ||
    value === "退出済み"
  );
}

function convertMemberCard(
  documentId: string,
  data: DocumentData
): MemberCard | null {
  if (
    typeof data.qrNumber !==
      "string" ||
    typeof data.authToken !==
      "string"
  ) {
    return null;
  }

  return {
    id:
      typeof data.id ===
        "string"
        ? data.id
        : documentId,

    qrNumber:
      data.qrNumber,

    authToken:
      data.authToken,
  };
}

function convertEventMember(
  documentId: string,
  data: DocumentData
): EventMember | null {
  if (
    typeof data.name !==
      "string" ||
    !isMemberStatus(
      data.status
    )
  ) {
    return null;
  }

  return {
    qrNumber:
      typeof data.qrNumber ===
        "string"
        ? data.qrNumber
        : documentId,

    name:
      data.name,

    status:
      data.status,
  };
}

function getMemberCardDocument(
  qrNumber: string
) {
  return doc(
    db,
    MEMBER_CARDS_COLLECTION,
    qrNumber
  );
}

function getEventMembersCollection(
  eventName: string
) {
  return collection(
    db,
    EVENT_DATA_COLLECTION,
    createSafeEventId(
      eventName
    ),
    EVENT_MEMBERS_COLLECTION
  );
}

function getEventMemberDocument(
  eventName: string,
  qrNumber: string
) {
  return doc(
    db,
    EVENT_DATA_COLLECTION,
    createSafeEventId(
      eventName
    ),
    EVENT_MEMBERS_COLLECTION,
    qrNumber
  );
}

function getActivityDocument(
  eventName: string,
  activityId: string
) {
  return doc(
    db,
    EVENT_DATA_COLLECTION,
    createSafeEventId(
      eventName
    ),
    ACTIVITY_COLLECTION,
    activityId
  );
}

export function subscribeToMemberCards(
  onCardsChanged: (
    cards: MemberCard[]
  ) => void,
  onError?: (
    error: Error
  ) => void
): Unsubscribe {
  return onSnapshot(
    collection(
      db,
      MEMBER_CARDS_COLLECTION
    ),

    (snapshot) => {
      const cards =
        snapshot.docs
          .map(
            (
              documentSnapshot
            ) =>
              convertMemberCard(
                documentSnapshot.id,
                documentSnapshot.data()
              )
          )
          .filter(
            (
              card
            ): card is MemberCard =>
              card !== null
          )
          .sort(
            (
              firstCard,
              secondCard
            ) =>
              firstCard.qrNumber.localeCompare(
                secondCard.qrNumber,
                "ja-JP",
                {
                  numeric: true,
                }
              )
          );

      if (
        !snapshot.metadata.fromCache ||
        cards.length > 0
      ) {
        cacheMemberCardsForOffline(
          cards
        );
      }

      onCardsChanged(
        cards
      );
    },

    (error) => {
      console.error(
        "部員QR台帳の同期に失敗しました。",
        error
      );

      onError?.(
        error
      );
    }
  );
}

export function subscribeToEventMembers(
  eventName: string,
  onMembersChanged: (
    members: EventMember[]
  ) => void,
  onError?: (
    error: Error
  ) => void
): Unsubscribe {
  if (
    eventName.trim() === ""
  ) {
    onMembersChanged([]);

    return () => {
      // イベント未設定時は解除処理なし
    };
  }

  return onSnapshot(
    getEventMembersCollection(
      eventName
    ),

    (snapshot) => {
      const members =
        snapshot.docs
          .map(
            (
              documentSnapshot
            ) =>
              convertEventMember(
                documentSnapshot.id,
                documentSnapshot.data()
              )
          )
          .filter(
            (
              member
            ): member is EventMember =>
              member !== null
          )
          .sort(
            (
              firstMember,
              secondMember
            ) =>
              firstMember.qrNumber.localeCompare(
                secondMember.qrNumber,
                "ja-JP",
                {
                  numeric: true,
                }
              )
          );

      if (
        !snapshot.metadata.fromCache ||
        members.length > 0
      ) {
        cacheEventMembersForOffline(
          eventName,
          members
        );
      }

      onMembersChanged(
        members
      );
    },

    (error) => {
      console.error(
        "イベント別部員情報の同期に失敗しました。",
        error
      );

      onError?.(
        error
      );
    }
  );
}

export async function createMemberInFirestore(
  eventName: string,
  memberCard: MemberCard,
  eventMember: EventMember
) {
  const batch =
    writeBatch(db);

  batch.set(
    getMemberCardDocument(
      memberCard.qrNumber
    ),
    {
      id:
        memberCard.id,

      qrNumber:
        memberCard.qrNumber,

      authToken:
        memberCard.authToken,

      createdAt:
        serverTimestamp(),

      updatedAt:
        serverTimestamp(),
    }
  );

  batch.set(
    getEventMemberDocument(
      eventName,
      eventMember.qrNumber
    ),
    {
      qrNumber:
        eventMember.qrNumber,

      name:
        eventMember.name,

      status:
        eventMember.status,

      updatedAt:
        serverTimestamp(),
    }
  );

  await batch.commit();
}

export async function saveEventMemberInFirestore(
  eventName: string,
  eventMember: EventMember
) {
  await setDoc(
    getEventMemberDocument(
      eventName,
      eventMember.qrNumber
    ),
    {
      qrNumber:
        eventMember.qrNumber,

      name:
        eventMember.name,

      status:
        eventMember.status,

      updatedAt:
        serverTimestamp(),
    },
    {
      merge: true,
    }
  );
}

export async function saveEventMembersInFirestore(
  eventName: string,
  eventMembers: EventMember[]
) {
  const chunkSize =
    450;

  for (
    let startIndex = 0;
    startIndex <
    eventMembers.length;
    startIndex += chunkSize
  ) {
    const currentChunk =
      eventMembers.slice(
        startIndex,
        startIndex +
          chunkSize
      );

    const batch =
      writeBatch(db);

    currentChunk.forEach(
      (eventMember) => {
        batch.set(
          getEventMemberDocument(
            eventName,
            eventMember.qrNumber
          ),
          {
            qrNumber:
              eventMember.qrNumber,

            name:
              eventMember.name,

            status:
              eventMember.status,

            updatedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          }
        );
      }
    );

    await batch.commit();
  }
}

export async function regenerateMemberQrInFirestore(
  memberCard: MemberCard,
  newAuthToken: string
) {
  await setDoc(
    getMemberCardDocument(
      memberCard.qrNumber
    ),
    {
      id:
        memberCard.id,

      qrNumber:
        memberCard.qrNumber,

      authToken:
        newAuthToken,

      updatedAt:
        serverTimestamp(),
    },
    {
      merge: true,
    }
  );
}

export async function deleteMemberFromFirestore(
  eventName: string,
  qrNumber: string
) {
  const batch =
    writeBatch(db);

  batch.delete(
    getMemberCardDocument(
      qrNumber
    )
  );

  batch.delete(
    getEventMemberDocument(
      eventName,
      qrNumber
    )
  );

  await batch.commit();
}

export async function findMemberByQrInFirestore(
  eventName: string,
  qrNumber: string,
  authToken: string
): Promise<Member | null> {
  return runTransaction(
    db,
    async (
      transaction
    ) => {
      const memberCardSnapshot =
        await transaction.get(
          getMemberCardDocument(
            qrNumber
          )
        );

      if (
        !memberCardSnapshot.exists()
      ) {
        return null;
      }

      const memberCard =
        convertMemberCard(
          memberCardSnapshot.id,
          memberCardSnapshot.data()
        );

      if (
        memberCard === null ||
        memberCard.authToken !==
          authToken
      ) {
        return null;
      }

      const eventMemberSnapshot =
        await transaction.get(
          getEventMemberDocument(
            eventName,
            qrNumber
          )
        );

      const eventMember =
        eventMemberSnapshot.exists()
          ? convertEventMember(
              eventMemberSnapshot.id,
              eventMemberSnapshot.data()
            )
          : null;

      return {
        ...memberCard,

        qrNumber:
          memberCard.qrNumber,

        name:
          eventMember?.name ??
          "",

        status:
          eventMember?.status ??
          "未入室",
      };
    }
  );
}

function processMemberReceptionOffline(
  eventName: string,
  qrNumber: string,
  authToken: string
): MemberReceptionResult {
  const result =
    acceptMemberReceptionOffline(
      eventName,
      qrNumber,
      authToken
    );

  if (!result.success) {
    if (
      result.reason ===
      "storage-failed"
    ) {
      throw new Error(
        "端末内へ部員受付データを保存できませんでした。"
      );
    }

    return {
      success: false,
      reason: result.reason,
    };
  }

  return {
    success: true,
    member: result.member,
    action: result.action,
    syncStatus: "pending",
  };
}

export async function processMemberReceptionInFirestore(
  eventName: string,
  qrNumber: string,
  authToken: string
): Promise<MemberReceptionResult> {
  const memberCardDocument =
    getMemberCardDocument(
      qrNumber
    );

  const eventMemberDocument =
    getEventMemberDocument(
      eventName,
      qrNumber
    );

  const activityId =
    createSafeRandomId();

  const capturedAt =
    new Date().toISOString();

  const activityDocument =
    getActivityDocument(
      eventName,
      activityId
    );

  if (
    typeof navigator !==
      "undefined" &&
    navigator.onLine === false
  ) {
    return processMemberReceptionOffline(
      eventName,
      qrNumber,
      authToken
    );
  }

  try {
    const result:
      MemberReceptionResult =
      await runTransaction(
      db,
      async (
        transaction
      ) => {
      const memberCardSnapshot =
        await transaction.get(
          memberCardDocument
        );

      if (
        !memberCardSnapshot.exists()
      ) {
        return {
          success:
            false,

          reason:
            "not-found",
        };
      }

      const memberCard =
        convertMemberCard(
          memberCardSnapshot.id,
          memberCardSnapshot.data()
        );

      if (
        memberCard === null
      ) {
        return {
          success:
            false,

          reason:
            "not-found",
        };
      }

      if (
        memberCard.authToken !==
        authToken
      ) {
        return {
          success:
            false,

          reason:
            "invalid-token",
        };
      }

      const eventMemberSnapshot =
        await transaction.get(
          eventMemberDocument
        );

      const currentEventMember =
        eventMemberSnapshot.exists()
          ? convertEventMember(
              eventMemberSnapshot.id,
              eventMemberSnapshot.data()
            )
          : null;

      const currentStatus =
        currentEventMember?.status ??
        "未入室";

      const newStatus:
        MemberStatus =
        currentStatus ===
          "入室中"
          ? "退出済み"
          : "入室中";

      const action =
        newStatus ===
          "入室中"
          ? "entry"
          : "exit";

      const updatedMember:
        Member = {
        ...memberCard,

        qrNumber:
          memberCard.qrNumber,

        name:
          currentEventMember?.name ??
          "",

        status:
          newStatus,
      };

      transaction.set(
        eventMemberDocument,
        {
          qrNumber:
            memberCard.qrNumber,

          name:
            currentEventMember?.name ??
            "",

          status:
            newStatus,

          lastReceptionAt:
            capturedAt,

          lastReceptionOperationId:
            activityId,

          updatedAt:
            serverTimestamp(),
        },
        {
          merge: true,
        }
      );

      transaction.set(
        activityDocument,
        {
          id:
            activityId,

          type:
            action ===
              "entry"
              ? "member-entry"
              : "member-exit",

          qrNumber:
            memberCard.qrNumber,

          timestamp:
            capturedAt,

          source:
            "scanner",

          createdAt:
            serverTimestamp(),
        }
      );

      return {
        success:
          true,

        member:
          updatedMember,

        action,

        syncStatus:
          "synced",
      };
      }
    );

    if (result.success) {
      updateCachedMemberStatus(
        eventName,
        {
          qrNumber:
            result.member.qrNumber,
          name:
            result.member.name,
          status:
            result.member.status,
        }
      );
    }

    return result;
  } catch (error) {
    if (
      (
        typeof navigator !==
          "undefined" &&
        navigator.onLine === false
      ) ||
      isTransientReceptionError(
        error
      )
    ) {
      return processMemberReceptionOffline(
        eventName,
        qrNumber,
        authToken
      );
    }

    throw error;
  }
}

export async function deleteAllEventMembersFromFirestore(
  eventName: string,
  eventMembers: EventMember[]
) {
  const chunkSize =
    450;

  for (
    let startIndex = 0;
    startIndex <
    eventMembers.length;
    startIndex += chunkSize
  ) {
    const currentChunk =
      eventMembers.slice(
        startIndex,
        startIndex +
          chunkSize
      );

    const batch =
      writeBatch(db);

    currentChunk.forEach(
      (eventMember) => {
        batch.delete(
          getEventMemberDocument(
            eventName,
            eventMember.qrNumber
          )
        );
      }
    );

    await batch.commit();
  }
}

export async function deleteMemberCardOnlyFromFirestore(
  qrNumber: string
) {
  await deleteDoc(
    getMemberCardDocument(
      qrNumber
    )
  );
}
