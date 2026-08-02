import {
  useMemo,
  useState,
  type FormEvent,
} from "react";

import OnlineStatus from "./OnlineStatus";

import "./CreateEventPage.css";

type EventData = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
};

type NewEventData = {
  name: string;
  date: string;
  startTime: string;
  endTime: string;
};

type CreateEventPageProps = {
  setPage: (
    page: string
  ) => void;

  onCreateEvent: (
    event: NewEventData
  ) => void;
};

const EVENTS_STORAGE_KEY =
  "qr-management-events";

function normalizeEventName(
  eventName: string
) {
  return eventName
    .trim()
    .replace(
      /\s+/g,
      " "
    )
    .toLocaleLowerCase(
      "ja-JP"
    );
}

function loadExistingEventNames() {
  try {
    const savedEvents =
      localStorage.getItem(
        EVENTS_STORAGE_KEY
      );

    if (
      savedEvents === null
    ) {
      return [];
    }

    const parsedEvents: unknown =
      JSON.parse(
        savedEvents
      );

    if (
      !Array.isArray(
        parsedEvents
      )
    ) {
      return [];
    }

    return parsedEvents
      .filter(
        (
          event
        ): event is EventData =>
          typeof event?.id ===
            "string" &&
          typeof event?.name ===
            "string" &&
          typeof event?.date ===
            "string" &&
          typeof event?.startTime ===
            "string" &&
          typeof event?.endTime ===
            "string"
      )
      .map(
        (event) =>
          event.name
      );
  } catch (error) {
    console.error(
      "既存イベントの読み込みに失敗しました。",
      error
    );

    return [];
  }
}

function formatDate(
  date: string
) {
  if (
    date === ""
  ) {
    return "未入力";
  }

  const dateObject =
    new Date(
      `${date}T00:00`
    );

  if (
    !Number.isFinite(
      dateObject.getTime()
    )
  ) {
    return date;
  }

  return new Intl.DateTimeFormat(
    "ja-JP",
    {
      year:
        "numeric",

      month:
        "long",

      day:
        "numeric",

      weekday:
        "short",
    }
  ).format(
    dateObject
  );
}

function EventIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="14"
        width="46"
        height="41"
        rx="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M9 27H55"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M21 8V20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M43 8V20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M24 41L30 47L42 35"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FormIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M15 9H42L51 18V55H15V9Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <path
        d="M42 9V19H51"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <path
        d="M23 30H43"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M23 40H43"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function NameIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M14 16H50V48H14V16Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <circle
        cx="25"
        cy="29"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M18 43C19 37 21 34 25 34C29 34 31 37 32 43"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M38 27H46"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M38 37H46"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <rect
        x="10"
        y="15"
        width="44"
        height="39"
        rx="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M10 27H54"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M21 9V20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M43 9V20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <circle
        cx="32"
        cy="32"
        r="23"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M32 18V33L43 40"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PreviewIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M6 32C13 20 22 14 32 14C42 14 51 20 58 32C51 44 42 50 32 50C22 50 13 44 6 32Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <circle
        cx="32"
        cy="32"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M25 16H8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M14 9L7 16L14 23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CreateIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M16 7V25"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M7 16H25"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CreateEventPage({
  setPage,
  onCreateEvent,
}: CreateEventPageProps) {
  const [
    eventName,
    setEventName,
  ] = useState("");

  const [
    eventDate,
    setEventDate,
  ] = useState("");

  const [
    startTime,
    setStartTime,
  ] = useState("");

  const [
    endTime,
    setEndTime,
  ] = useState("");

  const existingEventNames =
    useMemo(
      () =>
        loadExistingEventNames(),
      []
    );

  const normalizedInputName =
    normalizeEventName(
      eventName
    );

  const duplicateEventName =
    normalizedInputName !== "" &&
    existingEventNames.some(
      (existingName) =>
        normalizeEventName(
          existingName
        ) ===
        normalizedInputName
    );

  const hasAllInputs =
    eventName.trim() !== "" &&
    eventDate !== "" &&
    startTime !== "" &&
    endTime !== "";

  const hasInvalidTime =
    startTime !== "" &&
    endTime !== "" &&
    endTime <= startTime;

  const canCreate =
    hasAllInputs &&
    !hasInvalidTime &&
    !duplicateEventName;

  const completedItemCount =
    [
      eventName.trim() !== "",
      eventDate !== "",
      startTime !== "",
      endTime !== "" &&
        !hasInvalidTime,
    ].filter(
      Boolean
    ).length;

  const handleSubmit = (
    event:
      FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    const finalEventName =
      eventName.trim();

    if (
      finalEventName === ""
    ) {
      alert(
        "イベント名を入力してください。"
      );

      return;
    }

    if (
      eventDate === ""
    ) {
      alert(
        "開催日を入力してください。"
      );

      return;
    }

    if (
      startTime === "" ||
      endTime === ""
    ) {
      alert(
        "受付開始時刻と受付終了時刻を入力してください。"
      );

      return;
    }

    if (
      hasInvalidTime
    ) {
      alert(
        "受付終了時刻は、受付開始時刻より後にしてください。"
      );

      return;
    }

    const latestEventNames =
      loadExistingEventNames();

    const isDuplicate =
      latestEventNames.some(
        (existingName) =>
          normalizeEventName(
            existingName
          ) ===
          normalizeEventName(
            finalEventName
          )
      );

    if (
      isDuplicate
    ) {
      alert(
        [
          "同じ名前のイベントがすでに存在します。",
          "",
          "別のイベント名を入力してください。",
          "例：2027関一祭",
        ].join(
          "\n"
        )
      );

      return;
    }

    onCreateEvent({
      name:
        finalEventName,

      date:
        eventDate,

      startTime,

      endTime,
    });

    setPage(
      "events"
    );
  };

  return (
    <div className="create-event-page">
      <div className="create-event-background create-event-background-one" />

      <div className="create-event-background create-event-background-two" />

      <header className="create-event-header">
        <div className="create-event-header-main">
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="create-event-header-meta">
            <OnlineStatus />

            <span
              className="create-event-header-divider"
              aria-hidden="true"
            />

            <span className="create-event-page-name">
              CREATE EVENT
            </span>
          </div>
        </div>

        <div className="create-event-mode">
          <span className="create-event-mode-icon">
            <EventIcon />
          </span>

          <span className="create-event-mode-copy">
            <small>
              EVENT MANAGEMENT
            </small>

            <strong>
              イベント新規作成
            </strong>
          </span>
        </div>
      </header>

      <form
        className="create-event-content"
        onSubmit={
          handleSubmit
        }
      >
        <section className="create-event-form-panel">
          <div className="create-event-panel-heading">
            <div className="create-event-panel-title">
              <span className="create-event-panel-icon">
                <FormIcon />
              </span>

              <div>
                <span className="create-event-eyebrow">
                  EVENT INFORMATION
                </span>

                <h2>
                  イベント情報
                </h2>
              </div>
            </div>

            <div className="create-event-progress">
              <span>
                入力状況
              </span>

              <strong>
                {completedItemCount}
                /4
              </strong>
            </div>
          </div>

          <div className="create-event-fields">
            <label className="create-event-field create-event-name-field">
              <span className="create-event-field-heading">
                <span className="create-event-field-icon">
                  <NameIcon />
                </span>

                <span>
                  <strong>
                    イベント名
                  </strong>

                  <small>
                    受付画面や管理画面に表示されます
                  </small>
                </span>
              </span>

              <input
                type="text"
                value={
                  eventName
                }
                onChange={(
                  event
                ) =>
                  setEventName(
                    event.target.value
                  )
                }
                placeholder="例：2027関一祭"
                maxLength={40}
                autoComplete="off"
                className={
                  duplicateEventName
                    ? "create-event-input-error"
                    : ""
                }
              />
            </label>

            {duplicateEventName && (
              <p className="create-event-error">
                <span>
                  !
                </span>

                同じ名前のイベントがすでに存在します。年などを付けて、別の名前にしてください。
              </p>
            )}

            <label className="create-event-field">
              <span className="create-event-field-heading">
                <span className="create-event-field-icon">
                  <CalendarIcon />
                </span>

                <span>
                  <strong>
                    開催日
                  </strong>

                  <small>
                    イベントを実施する日を選択してください
                  </small>
                </span>
              </span>

              <input
                type="date"
                value={
                  eventDate
                }
                onChange={(
                  event
                ) =>
                  setEventDate(
                    event.target.value
                  )
                }
              />
            </label>

            <div className="create-event-time-fields">
              <label className="create-event-field">
                <span className="create-event-field-heading">
                  <span className="create-event-field-icon">
                    <ClockIcon />
                  </span>

                  <span>
                    <strong>
                      受付開始時刻
                    </strong>

                    <small>
                      受付を開始する時刻
                    </small>
                  </span>
                </span>

                <input
                  type="time"
                  value={
                    startTime
                  }
                  onChange={(
                    event
                  ) =>
                    setStartTime(
                      event.target.value
                    )
                  }
                />
              </label>

              <label className="create-event-field">
                <span className="create-event-field-heading">
                  <span className="create-event-field-icon">
                    <ClockIcon />
                  </span>

                  <span>
                    <strong>
                      受付終了時刻
                    </strong>

                    <small>
                      受付を終了する時刻
                    </small>
                  </span>
                </span>

                <input
                  type="time"
                  value={
                    endTime
                  }
                  min={
                    startTime
                  }
                  onChange={(
                    event
                  ) =>
                    setEndTime(
                      event.target.value
                    )
                  }
                  className={
                    hasInvalidTime
                      ? "create-event-input-error"
                      : ""
                  }
                />
              </label>
            </div>

            {hasInvalidTime && (
              <p className="create-event-error">
                <span>
                  !
                </span>

                受付終了時刻は、受付開始時刻より後にしてください。
              </p>
            )}
          </div>
        </section>

        <aside className="create-event-preview">
          <div className="create-event-preview-heading">
            <span className="create-event-preview-icon">
              <PreviewIcon />
            </span>

            <div>
              <span className="create-event-eyebrow">
                LIVE PREVIEW
              </span>

              <h2>
                入力内容
              </h2>
            </div>
          </div>

          <div className="create-event-preview-card">
            <div className="create-event-preview-top">
              <span className="create-event-preview-calendar-icon">
                <EventIcon />
              </span>

              <span className="create-event-preview-status">
                開催前
              </span>
            </div>

            <div className="create-event-preview-name">
              <small>
                EVENT NAME
              </small>

              <strong
                className={
                  eventName.trim() ===
                  ""
                    ? "create-event-preview-empty"
                    : ""
                }
              >
                {eventName.trim() ||
                  "イベント名未入力"}
              </strong>
            </div>

            <div className="create-event-preview-information">
              <div>
                <span className="create-event-preview-information-icon">
                  <CalendarIcon />
                </span>

                <span>
                  <small>
                    開催日
                  </small>

                  <strong
                    className={
                      eventDate ===
                      ""
                        ? "create-event-preview-empty"
                        : ""
                    }
                  >
                    {formatDate(
                      eventDate
                    )}
                  </strong>
                </span>
              </div>

              <div>
                <span className="create-event-preview-information-icon">
                  <ClockIcon />
                </span>

                <span>
                  <small>
                    受付時間
                  </small>

                  <strong
                    className={
                      startTime ===
                        "" ||
                      endTime ===
                        ""
                        ? "create-event-preview-empty"
                        : ""
                    }
                  >
                    {startTime ||
                      "未入力"}
                    {" ～ "}
                    {endTime ||
                      "未入力"}
                  </strong>
                </span>
              </div>
            </div>
          </div>

          <div className="create-event-note">
            <span>
              i
            </span>

            <p>
              作成したイベントはイベント一覧に追加されます。現在のイベントは自動では変更されません。
            </p>
          </div>

          <div className="create-event-validation">
            <div
              className={
                eventName.trim() !==
                ""
                  ? "create-event-validation-complete"
                  : ""
              }
            >
              <span>
                {eventName.trim() !==
                ""
                  ? "✓"
                  : "1"}
              </span>

              イベント名
            </div>

            <div
              className={
                eventDate !==
                ""
                  ? "create-event-validation-complete"
                  : ""
              }
            >
              <span>
                {eventDate !==
                ""
                  ? "✓"
                  : "2"}
              </span>

              開催日
            </div>

            <div
              className={
                startTime !==
                ""
                  ? "create-event-validation-complete"
                  : ""
              }
            >
              <span>
                {startTime !==
                ""
                  ? "✓"
                  : "3"}
              </span>

              開始時刻
            </div>

            <div
              className={
                endTime !==
                  "" &&
                !hasInvalidTime
                  ? "create-event-validation-complete"
                  : ""
              }
            >
              <span>
                {endTime !==
                  "" &&
                !hasInvalidTime
                  ? "✓"
                  : "4"}
              </span>

              終了時刻
            </div>
          </div>
        </aside>

        <footer className="create-event-actions">
          <button
            type="button"
            className="create-event-back"
            onClick={() =>
              setPage(
                "events"
              )
            }
          >
            <span className="create-event-action-icon">
              <BackIcon />
            </span>

            イベント管理に戻る
          </button>

          <button
            type="submit"
            className="create-event-submit"
            disabled={
              !canCreate
            }
          >
            <span className="create-event-action-icon">
              <CreateIcon />
            </span>

            <span>
              {duplicateEventName
                ? "同じ名前は使用できません"
                : "イベントを作成する"}
            </span>
          </button>
        </footer>
      </form>
    </div>
  );
}

export default CreateEventPage;