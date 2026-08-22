export const EVENTS_COLLECTION =
  "events";

export const SYSTEM_COLLECTION =
  "system";

export const EVENT_DATA_COLLECTION =
  "event-data";

export const TICKETS_COLLECTION =
  "tickets";

export const MEMBER_CARDS_COLLECTION =
  "member-cards";

export const EVENT_MEMBERS_COLLECTION =
  "members";

export const ACTIVITY_COLLECTION =
  "activity";

export const RECEPTION_DEVICES_COLLECTION =
  "reception-devices";

const eventDataIdsByName =
  new Map<string, string>();

export function createSafeEventId(
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

export function registerEventDataId(
  eventName: string,
  eventDataId: string
) {
  const normalizedName =
    eventName.trim();

  const normalizedDataId =
    eventDataId.trim();

  if (
    normalizedName === "" ||
    normalizedDataId === "" ||
    normalizedDataId.length >
      1_500 ||
    normalizedDataId.includes(
      "/"
    )
  ) {
    return;
  }

  eventDataIdsByName.set(
    normalizedName,
    normalizedDataId
  );
}

export function getEventDataId(
  eventName: string
) {
  const normalizedName =
    eventName.trim();

  return (
    eventDataIdsByName.get(
      normalizedName
    ) ??
    createSafeEventId(
      normalizedName
    )
  );
}

export function createSafeRandomId() {
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
      "安全なIDを生成できなかったため、代替方式を使用します。",
      error
    );
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}
