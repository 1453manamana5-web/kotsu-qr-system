import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import CameraQrScanner from "./CameraQrScanner";
import OnlineStatus from "./OnlineStatus";

import {
  processTicketEntryInFirestore,
} from "../ticketFirestore";

import {
  processMemberReceptionInFirestore,
} from "../memberFirestore";

import {
  createReceptionDeviceId,
  removeReceptionPresence,
  sendReceptionHeartbeat,
} from "../receptionPresenceFirestore";

import {
  playQrDetectedSound,
  playReceptionErrorSound,
  playReceptionSuccessSound,
} from "../receptionSound";

import "./EntryPage.css";

type EntryPageProps = {
  setPage: (
    page: string
  ) => void;

  openAdminAuth:
    () => void;
};

type ReceptionState =
  | "waiting"
  | "processing"
  | "success-animation"
  | "ticket-success"
  | "member-success"
  | "error";

type SuccessResultState =
  | "ticket-success"
  | "member-success";

type EventData = {
  name: string;
  date?: string;
  startTime?: string;
  endTime?: string;
};

type ParsedQr = {
  type:
    | "TICKET"
    | "MEMBER";

  qrNumber: string;
  authToken: string;
};

const EVENT_STORAGE_KEY =
  "qr-management-current-event";

const HEARTBEAT_INTERVAL_MILLISECONDS =
  5 * 1000;

const SUCCESS_ANIMATION_MILLISECONDS =
  1500;


function loadCurrentEventName() {
  try {
    const savedEvent =
      localStorage.getItem(
        EVENT_STORAGE_KEY
      );

    if (
      savedEvent === null
    ) {
      return "";
    }

    const parsedEvent =
      JSON.parse(
        savedEvent
      ) as Partial<EventData>;

    return typeof parsedEvent.name ===
      "string"
      ? parsedEvent.name
      : "";
  } catch (error) {
    console.error(
      "イベント情報の読み込みに失敗しました。",
      error
    );

    return "";
  }
}

function parseQr(
  qrValue: string
): ParsedQr | null {
  const parts =
    qrValue
      .trim()
      .split(":");

  if (
    parts.length !== 4 ||
    parts[0] !== "QRM1" ||
    (
      parts[1] !==
        "TICKET" &&
      parts[1] !==
        "MEMBER"
    ) ||
    parts[2].trim() === "" ||
    parts[3].trim() === ""
  ) {
    return null;
  }

  return {
    type:
      parts[1] as
        | "TICKET"
        | "MEMBER",

    qrNumber:
      parts[2],

    authToken:
      parts[3],
  };
}

function EntryModeIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M37 10H53V54H37"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M7 32H39"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />

      <path
        d="M29 21L40 32L29 43"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ScannerIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M9 23V14C9 11 11 9 14 9H23"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M41 9H50C53 9 55 11 55 14V23"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M55 41V50C55 53 53 55 50 55H41"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M23 55H14C11 55 9 53 9 50V41"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <rect
        x="20"
        y="20"
        width="9"
        height="9"
        rx="1"
        fill="currentColor"
      />

      <rect
        x="35"
        y="20"
        width="9"
        height="9"
        rx="1"
        fill="currentColor"
      />

      <rect
        x="20"
        y="35"
        width="9"
        height="9"
        rx="1"
        fill="currentColor"
      />

      <path
        d="M36 36H44V44H36V40H40"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M10 25H22L36 13V51L22 39H10V25Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M43 23C47 27 47 37 43 41"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M49 16C58 25 58 39 49 48"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M9 30L32 10L55 30"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M15 27V54H49V27"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <path
        d="M26 54V38H38V54"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M32 7L51 15V29C51 42 43 52 32 57C21 52 13 42 13 29V15L32 7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <circle
        cx="32"
        cy="28"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M21 45C23 38 27 35 32 35C37 35 41 38 43 45"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EntryPage({
  setPage,
  openAdminAuth,
}: EntryPageProps) {
  const [
    receptionState,
    setReceptionState,
  ] =
    useState<ReceptionState>(
      "waiting"
    );

  const [
    resultMessage,
    setResultMessage,
  ] = useState("");

  const [
    resultName,
    setResultName,
  ] = useState("");

  const [
    scannedQrNumber,
    setScannedQrNumber,
  ] = useState("");

  const [
    currentEventName,
  ] = useState(
    () =>
      loadCurrentEventName()
  );

  const [
    receptionDeviceId,
  ] = useState(
    () =>
      createReceptionDeviceId(
        "entry"
      )
  );

  const [
    soundReady,
    setSoundReady,
  ] = useState(false);

  const [
    soundStarting,
    setSoundStarting,
  ] = useState(false);

  const [
    soundActivationError,
    setSoundActivationError,
  ] = useState("");

  const successAnimationTimerRef =
    useRef<
      number |
      null
    >(null);

  useEffect(() => {
    return () => {
      if (
        successAnimationTimerRef.current !==
        null
      ) {
        window.clearTimeout(
          successAnimationTimerRef.current
        );
      }
    };
  }, []);

  useEffect(() => {
    const eventName =
      loadCurrentEventName();

    if (
      eventName.trim() ===
      ""
    ) {
      return;
    }

    let stopped =
      false;

    const sendHeartbeat =
      async () => {
        if (!navigator.onLine) {
          return;
        }

        try {
          await sendReceptionHeartbeat(
            eventName,
            receptionDeviceId,
            "entry"
          );
        } catch (error) {
          if (
            !stopped
          ) {
            console.error(
              "入口受付端末の生存通知に失敗しました。",
              error
            );
          }
        }
      };

    void sendHeartbeat();

    const heartbeatTimer =
      window.setInterval(
        () => {
          void sendHeartbeat();
        },
        HEARTBEAT_INTERVAL_MILLISECONDS
      );

    return () => {
      stopped =
        true;

      window.clearInterval(
        heartbeatTimer
      );

      void removeReceptionPresence(
        eventName,
        receptionDeviceId
      ).catch((error) => {
        if (navigator.onLine) {
          console.warn(
            "入口受付端末の終了通知に失敗しました。",
            error
          );
        }
      });
    };
  }, [
    receptionDeviceId,
  ]);

  useEffect(() => {
    if (
      receptionState ===
        "waiting" ||
      receptionState ===
        "processing" ||
      receptionState ===
        "success-animation"
    ) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          setReceptionState(
            "waiting"
          );

          setResultMessage(
            ""
          );

          setResultName(
            ""
          );

          setScannedQrNumber(
            ""
          );
        },
        2500
      );

    return () => {
      window.clearTimeout(
        timer
      );
    };
  }, [
    receptionState,
  ]);

  const handleStartReception =
    useCallback(
      async () => {
        if (
          soundStarting
        ) {
          return;
        }

        setSoundStarting(
          true
        );

        setSoundActivationError(
          ""
        );

        const soundPlayed =
          await playReceptionSuccessSound();

        if (
          !soundPlayed
        ) {
          setSoundActivationError(
            "音を有効にできませんでした。iPadの音量を確認して、もう一度押してください。"
          );

          setSoundStarting(
            false
          );

          return;
        }

        setSoundReady(
          true
        );

        setSoundStarting(
          false
        );
      },
      [
        soundStarting,
      ]
    );

  const showError =
    useCallback(
      (
        message: string,
        qrNumber = ""
      ) => {
        void playReceptionErrorSound();

        setResultMessage(
          message
        );

        setResultName(
          ""
        );

        setScannedQrNumber(
          qrNumber
        );

        setReceptionState(
          "error"
        );
      },
      []
    );

  const startSuccessAnimation =
    useCallback(
      (
        resultState:
          SuccessResultState
      ) => {
        if (
          successAnimationTimerRef.current !==
          null
        ) {
          window.clearTimeout(
            successAnimationTimerRef.current
          );
        }

        setReceptionState(
          "success-animation"
        );

        successAnimationTimerRef.current =
          window.setTimeout(
            () => {
              successAnimationTimerRef.current =
                null;

              void playReceptionSuccessSound();

              setReceptionState(
                resultState
              );
            },
            SUCCESS_ANIMATION_MILLISECONDS
          );
      },
      []
    );

  const showTicketSuccess =
    useCallback(
      (
        ticketNumber: string,
        message: string
      ) => {
        setResultMessage(
          message
        );

        setResultName(
          ""
        );

        setScannedQrNumber(
          ticketNumber
        );

        startSuccessAnimation(
          "ticket-success"
        );
      },
      [
        startSuccessAnimation,
      ]
    );

  const showMemberSuccess =
    useCallback(
      (
        memberName: string,
        qrNumber: string,
        actionMessage: string
      ) => {
        setResultName(
          memberName.trim() ===
            ""
            ? "名前未設定の部員"
            : `${memberName}さん`
        );

        setResultMessage(
          actionMessage
        );

        setScannedQrNumber(
          qrNumber
        );

        startSuccessAnimation(
          "member-success"
        );
      },
      [
        startSuccessAnimation,
      ]
    );

  const processTicket =
    useCallback(
      async (
        eventName: string,
        parsedQr: ParsedQr
      ) => {
        try {
          const result =
            await processTicketEntryInFirestore(
              eventName,
              parsedQr.qrNumber,
              parsedQr.authToken
            );

          if (
            !result.success
          ) {
            if (
              result.reason ===
                "not-cached"
            ) {
              showError(
                "この端末にチケット情報がありません。通信を確認してください",
                parsedQr.qrNumber
              );

              return;
            }

            if (
              result.reason ===
                "invalid"
            ) {
              showError(
                "このチケットは無効です",
                parsedQr.qrNumber
              );

              return;
            }

            if (
              result.reason ===
                "already-inside"
            ) {
              showError(
                "このチケットはすでに入場しています",
                parsedQr.qrNumber
              );

              return;
            }

            showError(
              "このイベントでは使用できないチケットです",
              parsedQr.qrNumber
            );

            return;
          }

          showTicketSuccess(
            result.ticket.qrNumber,

            result.syncStatus ===
              "pending"
              ? result.isReEntry
                ? "再入場を端末に保存しました（通信復旧後に自動同期）"
                : "入場を端末に保存しました（通信復旧後に自動同期）"
              : result.isReEntry
                ? "再入場を受け付けました"
                : "入場を受け付けました"
          );
        } catch (error) {
          console.error(
            "Firestoreでの入場処理に失敗しました。",
            error
          );

          showError(
            "チケット情報を保存できませんでした",
            parsedQr.qrNumber
          );
        }
      },
      [
        showError,
        showTicketSuccess,
      ]
    );

  const processMember =
    useCallback(
      async (
        eventName: string,
        parsedQr: ParsedQr
      ) => {
        try {
          const result =
            await processMemberReceptionInFirestore(
              eventName,
              parsedQr.qrNumber,
              parsedQr.authToken
            );

          if (
            !result.success
          ) {
            if (
              result.reason ===
                "not-cached"
            ) {
              showError(
                "この端末に部員情報がありません。通信を確認してください",
                parsedQr.qrNumber
              );

              return;
            }

            if (
              result.reason ===
                "duplicate"
            ) {
              showError(
                "この部員QRは直前に受付済みです",
                parsedQr.qrNumber
              );

              return;
            }

            showError(
              "登録されていない部員QRです",
              parsedQr.qrNumber
            );

            return;
          }

          showMemberSuccess(
            result.member.name,
            result.member.qrNumber,
            result.syncStatus ===
              "pending"
              ? result.action ===
                  "entry"
                ? "入室を端末に保存しました（自動同期）"
                : "退出を端末に保存しました（自動同期）"
              : result.action ===
                  "entry"
                ? "入室完了"
                : "退出完了"
          );
        } catch (error) {
          console.error(
            "Firestoreでの部員受付処理に失敗しました。",
            error
          );

          showError(
            "部員情報を保存できませんでした",
            parsedQr.qrNumber
          );
        }
      },
      [
        showError,
        showMemberSuccess,
      ]
    );

  const processQr =
    useCallback(
      async (
        qrValue: string
      ) => {
        if (
          receptionState !==
          "waiting"
        ) {
          return;
        }

        const eventName =
          loadCurrentEventName();

        if (
          eventName ===
          ""
        ) {
          showError(
            "イベントが設定されていません"
          );

          return;
        }

        const parsedQr =
          parseQr(
            qrValue
          );

        if (
          parsedQr ===
          null
        ) {
          showError(
            "このQRコードは使用できません"
          );

          return;
        }

        void playQrDetectedSound();

        setReceptionState(
          "processing"
        );

        if (
          parsedQr.type ===
          "MEMBER"
        ) {
          await processMember(
            eventName,
            parsedQr
          );

          return;
        }

        await processTicket(
          eventName,
          parsedQr
        );
      },
      [
        receptionState,
        processMember,
        processTicket,
        showError,
      ]
    );

  return (
    <div
      className={`entry-reception-page ${receptionState} ${soundReady ? "sound-ready" : "sound-locked"}`}
    >
      <div className="entry-background-circle entry-background-circle-one" />

      <div className="entry-background-circle entry-background-circle-two" />

      <header className="entry-reception-header">
        <div className="entry-header-main">
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="entry-header-meta">
            <OnlineStatus />

            <span
              className="entry-header-meta-divider"
              aria-hidden="true"
            />

            <div className="entry-current-event">
              <span className="entry-current-event-label">
                EVENT
              </span>

              <strong>
                {currentEventName ||
                  "イベント未設定"}
              </strong>
            </div>
          </div>
        </div>

        <div className="entry-reception-mode">
          <span className="entry-reception-mode-icon">
            <EntryModeIcon />
          </span>

          <span className="entry-reception-mode-copy">
            <small>
              ENTRY
            </small>

            <strong>
              入口受付
            </strong>
          </span>
        </div>
      </header>

      <main className="entry-reception-main">
        {receptionState ===
          "waiting" &&
          !soundReady && (
          <section className="entry-sound-start-panel">
            <div className="entry-sound-start-icon">
              <SpeakerIcon />
            </div>

            <span className="entry-sound-start-eyebrow">
              SOUND CHECK
            </span>

            <h2>
              音声を有効にして
              <br />
              受付を開始
            </h2>

            <p className="entry-sound-start-description">
              ボタンを押すと確認用の3連音が鳴り、
              その後カメラが起動します。
            </p>

            <button
              type="button"
              className="entry-sound-start-button"
              disabled={
                soundStarting
              }
              onClick={() => {
                void handleStartReception();
              }}
            >
              <span className="entry-sound-start-button-icon">
                <SpeakerIcon />
              </span>

              <span>
                {soundStarting
                  ? "音声を準備しています…"
                  : "音を有効にして受付を開始"}
              </span>
            </button>

            <p className="entry-sound-start-note">
              iPadの音量が上がっていることを確認してください
            </p>

            {soundActivationError !==
              "" && (
              <p
                className="entry-sound-start-error"
                role="alert"
              >
                {soundActivationError}
              </p>
            )}
          </section>
        )}

        {(receptionState ===
          "waiting" ||
          receptionState ===
            "processing" ||
          receptionState ===
            "success-animation") &&
          soundReady && (
          <section className="entry-waiting-panel">
            <div className="entry-scanner-card">
              <div className="entry-scanner-card-header">
                <div className="entry-scanner-heading">
                  <span className="entry-scanner-heading-icon">
                    <ScannerIcon />
                  </span>

                  <span className="entry-scanner-heading-copy">
                    <small>
                      QR SCANNER
                    </small>

                    <strong>
                      QRコード読み取り
                    </strong>
                  </span>
                </div>

                <div className="entry-scanner-ready">
                  <span
                    className="entry-scanner-ready-dot"
                    aria-hidden="true"
                  />

                  {receptionState ===
                  "processing"
                    ? "受付処理中"
                    : receptionState ===
                        "success-animation"
                      ? "認証成功"
                      : "読み取り待機中"}
                </div>
              </div>

              <div className="entry-scanner-wrapper">
                <CameraQrScanner
                  enabled
                  onScan={(
                    qrValue
                  ) => {
                    void processQr(
                      qrValue
                    );
                  }}
                />

                {receptionState ===
                  "processing" && (
                  <div
                    className="entry-scan-processing-overlay"
                    aria-live="polite"
                  >
                    <div
                      className="entry-processing-spinner"
                      aria-hidden="true"
                    />

                    <strong>
                      受付処理中
                    </strong>

                    <span>
                      チケット情報を確認しています
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="entry-scan-instruction">
              <span className="entry-scan-instruction-number">
                1
              </span>

              <span className="entry-scan-instruction-copy">
                <strong>
                  QRコードをカメラに向けてください
                </strong>

                <small>
                  読み取り枠に入ると自動で受付します
                </small>
              </span>
            </div>
          </section>
        )}

        {receptionState ===
          "ticket-success" && (
          <section
            className="entry-result-panel entry-ticket-result"
            role="status"
            aria-live="polite"
          >
            <div
              className="entry-result-icon entry-ticket-success-icon"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 120 120"
                focusable="false"
              >
                <circle
                  className="entry-ticket-success-circle"
                  cx="60"
                  cy="60"
                  r="48"
                />

                <path
                  className="entry-ticket-success-check"
                  d="M35 61.5 52 78 86 42"
                />
              </svg>
            </div>

            <span className="entry-result-eyebrow">
              ADMISSION COMPLETE
            </span>

            <h2 className="entry-ticket-success-title">
              {resultMessage.includes(
                "再入場"
              )
                ? "再入場OK"
                : "入場OK"}
            </h2>

            <p className="entry-ticket-success-message">
              {resultMessage}
            </p>

            <p className="entry-result-number">
              <span>
                TICKET
              </span>

              {scannedQrNumber}
            </p>

            <div
              className="entry-result-return"
              aria-hidden="true"
            >
              <span>
                次の読み取り画面へ戻ります
              </span>

              <div className="entry-result-return-track">
                <span />
              </div>
            </div>
          </section>
        )}

        {receptionState ===
          "member-success" && (
          <section className="entry-result-panel entry-member-result">
            <div className="entry-result-icon">
              ✓
            </div>

            <span className="entry-result-eyebrow">
              MEMBER RECEPTION
            </span>

            <h2>
              {resultName}
            </h2>

            <p className="entry-result-primary entry-member-action">
              {resultMessage}
            </p>

            <p className="entry-result-number">
              {scannedQrNumber}
            </p>
          </section>
        )}

        {receptionState ===
          "error" && (
          <section className="entry-result-panel entry-error-result">
            <div className="entry-result-icon">
              ×
            </div>

            <span className="entry-result-eyebrow">
              RECEPTION ERROR
            </span>

            <h2>
              受付失敗
            </h2>

            <p className="entry-result-primary">
              {resultMessage ||
                "もう一度やり直してください"}
            </p>

            {scannedQrNumber !==
              "" && (
              <p className="entry-result-number">
                {scannedQrNumber}
              </p>
            )}

            <p className="entry-result-secondary">
              約2.5秒後に読み取り画面へ戻ります
            </p>
          </section>
        )}
      </main>

      <footer className="entry-reception-footer">
        <button
          type="button"
          className="entry-home-button"
          disabled={
            receptionState ===
              "processing" ||
            receptionState ===
              "success-animation" ||
            soundStarting
          }
          onClick={() =>
            setPage(
              "home"
            )
          }
        >
          <span className="entry-footer-button-icon">
            <HomeIcon />
          </span>

          <span>
            ホームへ戻る
          </span>
        </button>

        <button
          type="button"
          className="entry-admin-button"
          disabled={
            receptionState ===
              "processing" ||
            receptionState ===
              "success-animation" ||
            soundStarting
          }
          onClick={
            openAdminAuth
          }
        >
          <span className="entry-footer-button-icon">
            <AdminIcon />
          </span>

          <span>
            管理モード
          </span>
        </button>
      </footer>
    </div>
  );
}

export default EntryPage;
