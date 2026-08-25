import {
  removeReceptionPresence,
  type ReceptionMode,
} from "./receptionPresenceFirestore";

const EVENT_STORAGE_KEY =
  "qr-management-current-event";

const RETRY_DELAYS = [
  250,
  1000,
  3000,
] as const;

function readCurrentEventName() {
  try {
    const savedEvent =
      localStorage.getItem(
        EVENT_STORAGE_KEY
      );

    if (savedEvent === null) {
      return "";
    }

    const parsed =
      JSON.parse(savedEvent) as {
        name?: unknown;
      };

    return typeof parsed.name === "string"
      ? parsed.name
      : "";
  } catch (error) {
    console.warn(
      "受付終了時のイベント情報を読み込めませんでした。",
      error
    );
    return "";
  }
}

function readReceptionDeviceId(
  mode: ReceptionMode
) {
  try {
    return sessionStorage.getItem(
      `qr-management-reception-device-${mode}`
    ) ?? "";
  } catch (error) {
    console.warn(
      "受付終了時の端末IDを読み込めませんでした。",
      error
    );
    return "";
  }
}

function isReceptionScreenActive(
  mode: ReceptionMode
) {
  return document.querySelector(
    mode === "entry"
      ? ".entry-reception-main"
      : ".exit-reception-main"
  ) !== null;
}

function deletePresence(
  eventName: string,
  deviceId: string
) {
  if (
    eventName.trim() === "" ||
    deviceId.trim() === ""
  ) {
    return;
  }

  void removeReceptionPresence(
    eventName,
    deviceId
  ).catch((error) => {
    if (navigator.onLine) {
      console.warn(
        "意図的に終了した受付端末の状態を解除できませんでした。",
        error
      );
    }
  });
}

function finishIntentionalReception(
  mode: ReceptionMode
) {
  const eventName =
    readCurrentEventName();
  const deviceId =
    readReceptionDeviceId(mode);

  if (
    eventName.trim() === "" ||
    deviceId.trim() === ""
  ) {
    return;
  }

  /*
    React側のアンマウント処理より先に一度削除します。
    これで「ホームへ戻る」という人の操作を、通信断として
    管制側が扱う時間をできるだけ作らないようにします。
  */
  deletePresence(
    eventName,
    deviceId
  );

  /*
    ちょうど戻る瞬間にハートビート送信中だった場合、
    削除後に古い端末情報が再作成されることがあります。
    短時間だけ削除を確認し直します。

    同じ受付へ入り直した場合は受付画面が存在するため、
    新しいセッションの端末情報は削除しません。
  */
  for (const delay of RETRY_DELAYS) {
    window.setTimeout(
      () => {
        if (
          isReceptionScreenActive(mode)
        ) {
          return;
        }

        deletePresence(
          eventName,
          deviceId
        );
      },
      delay
    );
  }
}

export function installIntentionalReceptionStopGuard() {
  const handleClick = (
    event: MouseEvent
  ) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const homeButton =
      event.target.closest(
        ".entry-home-button, .exit-home-button"
      );

    if (!(homeButton instanceof HTMLButtonElement)) {
      return;
    }

    if (homeButton.disabled) {
      return;
    }

    const mode: ReceptionMode =
      homeButton.classList.contains(
        "exit-home-button"
      )
        ? "exit"
        : "entry";

    finishIntentionalReception(mode);
  };

  document.addEventListener(
    "click",
    handleClick,
    true
  );

  return () => {
    document.removeEventListener(
      "click",
      handleClick,
      true
    );
  };
}
