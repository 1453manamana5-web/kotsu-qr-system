import {
  collection,
  getDocsFromServer,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import {
  db,
} from "./firebase";

import {
  cacheEventMembersForOffline,
} from "./offlineReceptionStore";

import type {
  EventMember,
} from "./memberFirestore";

const EVENT_DATA_COLLECTION =
  "event-data";

const EVENT_MEMBERS_COLLECTION =
  "members";

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

export async function resetEventMemberStatusesInFirestore(
  eventName: string
) {
  const normalizedEventName =
    eventName.trim();

  if (
    normalizedEventName ===
    ""
  ) {
    return 0;
  }

  const membersCollection =
    collection(
      db,
      EVENT_DATA_COLLECTION,
      createSafeEventId(
        normalizedEventName
      ),
      EVENT_MEMBERS_COLLECTION
    );

  /*
    リセット対象は必ずサーバー上の最新データから取得します。
    オフラインキャッシュだけを見て、実際のFirestore側を
    リセットし損ねることを防ぎます。
  */
  const snapshot =
    await getDocsFromServer(
      membersCollection
    );

  if (
    snapshot.empty
  ) {
    cacheEventMembersForOffline(
      normalizedEventName,
      []
    );

    return 0;
  }

  const chunkSize =
    450;

  for (
    let startIndex = 0;
    startIndex <
    snapshot.docs.length;
    startIndex += chunkSize
  ) {
    const currentChunk =
      snapshot.docs.slice(
        startIndex,
        startIndex +
          chunkSize
      );

    const batch =
      writeBatch(db);

    currentChunk.forEach(
      (documentSnapshot) => {
        batch.set(
          documentSnapshot.ref,
          {
            status:
              "未入室",

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

  const resetMembers =
    snapshot.docs
      .map(
        (documentSnapshot) => {
          const data =
            documentSnapshot.data();

          const qrNumber =
            typeof data.qrNumber ===
              "string"
              ? data.qrNumber
              : documentSnapshot.id;

          const name =
            typeof data.name ===
              "string"
              ? data.name
              : "";

          return {
            qrNumber,
            name,
            status:
              "未入室",
          } satisfies EventMember;
        }
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

  /*
    受付用の端末内キャッシュも同じ状態へそろえます。
    リセット直後に通信が切れても、古い入退室状態を
    参照しないようにします。
  */
  cacheEventMembersForOffline(
    normalizedEventName,
    resetMembers
  );

  return snapshot.size;
}
