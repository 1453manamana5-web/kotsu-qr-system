import {
  useMemo,
  useState,
  type FormEvent,
} from "react";

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
    .replace(/\s+/g, " ")
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
  if (date === "") {
    return "未入力";
  }

  const [
    year,
    month,
    day,
  ] = date.split("-");

  if (
    year === undefined ||
    month === undefined ||
    day === undefined
  ) {
    return date;
  }

  return `${year}年${Number(
    month
  )}月${Number(day)}日`;
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

    if (hasInvalidTime) {
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

    if (isDuplicate) {
      alert(
        [
          "同じ名前のイベントがすでに存在します。",
          "",
          "別のイベント名を入力してください。",
          "例：2027関一祭",
        ].join("\n")
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
      <header className="create-event-header">
        <div>
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <h2>
            イベント管理
          </h2>
        </div>

        <div className="create-event-mode">
          管理モード
        </div>
      </header>

      <form
        className="create-event-content"
        onSubmit={
          handleSubmit
        }
      >
        <section className="create-event-form">
          <label>
            <span>
              イベント名
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
            />
          </label>

          {duplicateEventName && (
            <p className="create-event-error">
              ⚠ 同じ名前のイベントがすでに存在します。年などを付けて、別の名前にしてください
            </p>
          )}

          <label>
            <span>
              開催日
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

          <div className="time-inputs">
            <label>
              <span>
                受付開始時刻
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

            <label>
              <span>
                受付終了時刻
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
              />
            </label>
          </div>

          {hasInvalidTime && (
            <p className="create-event-error">
              ⚠ 受付終了時刻は、受付開始時刻より後にしてください
            </p>
          )}
        </section>

        <aside className="create-event-preview">
          <h3>
            内容
          </h3>

          <div className="preview-card">
            <span>
              イベント名
            </span>

            <strong>
              {eventName.trim() ||
                "未入力"}
            </strong>
          </div>

          <div className="preview-card">
            <span>
              開催日
            </span>

            <strong>
              {formatDate(
                eventDate
              )}
            </strong>
          </div>

          <div className="preview-card">
            <span>
              受付時間
            </span>

            <strong>
              {startTime ||
                "未入力"}
              {" ～ "}
              {endTime ||
                "未入力"}
            </strong>
          </div>

          <p className="create-event-note">
            作成したイベントはイベント一覧に追加されます。現在のイベントは自動では変更されません。
          </p>
        </aside>

        <div className="create-event-actions">
          <button
            type="button"
            className="create-event-back"
            onClick={() =>
              setPage(
                "events"
              )
            }
          >
            前のページに戻る
          </button>

          <button
            type="submit"
            className="create-event-submit"
            disabled={
              !canCreate
            }
          >
            {duplicateEventName
              ? "同じ名前は使用できません"
              : "イベントを作成する"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default CreateEventPage;