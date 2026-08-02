import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import CameraQrScanner from "./CameraQrScanner";
import OnlineStatus from "./OnlineStatus";

import {
  processTicketExitInFirestore,
} from "../ticketFirestore";

import {
  processMemberReceptionInFirestore,
} from "../memberFirestore";

import {
  createReceptionDeviceId,
  removeReceptionPresence,
  sendReceptionHeartbeat,
} from "../receptionPresenceFirestore";

import "./ExitPage.css";

type ExitPageProps = {
  setPage: (
    page: string
  ) => void;

  openAdminAuth:
    () => void;
};

type ReceptionState =
  | "waiting"
  | "processing"
  | "ticket-success"
  | "member-success"
  | "error";

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

const SUCCESS_SOUND_PATH =
  "/sounds/hankyu_style_gate_triple.wav";

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

function ExitModeIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M27 10H11V54H27"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M25 32H57"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />

      <path
        d="M46 21L57 32L46 43"
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

function ExitPage({
  setPage,
  openAdminAuth,
}: ExitPageProps) {
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
        "exit"
      )
  );

  const successSoundRef =
    useRef<HTMLAudioElement | null>(
      null
    );

  useEffect(() => {
    const successSound =
      new Audio(
        SUCCESS_SOUND_PATH
      );

    successSound.preload =
      "auto";

    successSound.load();

    successSoundRef.current =
      successSound;

    return () => {
      successSound.pause();

      successSoundRef.current =
        null;
    };
  }, []);

  const playSuccessSound =
    useCallback(() => {
      const successSound =
        successSoundRef.current;

      if (
        successSound === null
      ) {
        return;
      }

      successSound.pause();

      successSound.currentTime =
        0;

      void successSound
        .play()
        .catch(
          (error) => {
            console.warn(
              "出口受付の成功音を再生できませんでした。",
              error
            );
          }
        );
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
        try {
          await sendReceptionHeartbeat(
            eventName,
            receptionDeviceId,
            "exit"
          );
        } catch (error) {
          if (
            !stopped
          ) {
            console.error(
              "出口受付端末の生存通知に失敗しました。",
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
      ).catch(
        (error) => {
          console.warn(
            "出口受付端末の終了通知に失敗しました。",
            error
          );
        }
      );
    };
  }, [
    receptionDeviceId,
  ]);

  useEffect(() => {
    if (
      receptionState ===
        "waiting" ||
      receptionState ===
        "processing"
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

  const showError =
    useCallback(
      (
        message: string,
        qrNumber = ""
      ) => {
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

  const showTicketSuccess =
    useCallback(
      (
        ticketNumber: string
      ) => {
        playSuccessSound();

        setResultMessage(
          "退出を受け付けました"
        );

        setResultName(
          ""
        );

        setScannedQrNumber(
          ticketNumber
        );

        setReceptionState(
          "ticket-success"
        );
      },
      [
        playSuccessSound,
      ]
    );

  const showMemberSuccess =
    useCallback(
      (
        memberName: string,
        qrNumber: string,
        actionMessage: string
      ) => {
        playSuccessSound();

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

        setReceptionState(
          "member-success"
        );
      },
      [
        playSuccessSound,
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
            await processTicketExitInFirestore(
              eventName,
              parsedQr.qrNumber,
              parsedQr.authToken
            );

          if (
            !result.success
          ) {
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
                "not-entered"
            ) {
              showError(
                "このチケットはまだ入場していません",
                parsedQr.qrNumber
              );

              return;
            }

            if (
              result.reason ===
                "already-exited"
            ) {
              showError(
                "このチケットはすでに退出しています",
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
            result.ticket.qrNumber
          );
        } catch (error) {
          console.error(
            "Firestoreでの退出処理に失敗しました。",
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
            showError(
              "登録されていない部員QRです",
              parsedQr.qrNumber
            );

            return;
          }

          showMemberSuccess(
            result.member.name,
            result.member.qrNumber,
            result.action ===
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
      className={`exit-reception-page ${receptionState}`}
    >
      <div className="exit-background-circle exit-background-circle-one" />

      <div className="exit-background-circle exit-background-circle-two" />

      <header className="exit-reception-header">
        <div className="exit-header-main">
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="exit-header-meta">
            <OnlineStatus />

            <span
              className="exit-header-meta-divider"
              aria-hidden="true"
            />

            <div className="exit-current-event">
              <span className="exit-current-event-label">
                EVENT
              </span>

              <strong>
                {currentEventName ||
                  "イベント未設定"}
              </strong>
            </div>
          </div>
        </div>

        <div className="exit-reception-mode">
          <span className="exit-reception-mode-icon">
            <ExitModeIcon />
          </span>

          <span className="exit-reception-mode-copy">
            <small>
              EXIT
            </small>

            <strong>
              出口受付
            </strong>
          </span>
        </div>
      </header>

      <main className="exit-reception-main">
        {receptionState ===
          "waiting" && (
          <section className="exit-waiting-panel">
            <div className="exit-scanner-card">
              <div className="exit-scanner-card-header">
                <div className="exit-scanner-heading">
                  <span className="exit-scanner-heading-icon">
                    <ScannerIcon />
                  </span>

                  <span className="exit-scanner-heading-copy">
                    <small>
                      QR SCANNER
                    </small>

                    <strong>
                      QRコード読み取り
                    </strong>
                  </span>
                </div>

                <div className="exit-scanner-ready">
                  <span
                    className="exit-scanner-ready-dot"
                    aria-hidden="true"
                  />

                  読み取り待機中
                </div>
              </div>

              <div className="exit-scanner-wrapper">
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
              </div>
            </div>

            <div className="exit-scan-instruction">
              <span className="exit-scan-instruction-number">
                1
              </span>

              <span className="exit-scan-instruction-copy">
                <strong>
                  QRコードをカメラに向けてください
                </strong>

                <small>
                  読み取り枠に入ると自動で退出を受け付けます
                </small>
              </span>
            </div>
          </section>
        )}

        {receptionState ===
          "processing" && (
          <section className="exit-result-panel exit-processing-result">
            <div
              className="exit-processing-spinner"
              aria-hidden="true"
            />

            <span className="exit-result-eyebrow">
              PROCESSING
            </span>

            <h2>
              受付処理中
            </h2>

            <p className="exit-result-primary">
              Firebaseへ確認しています
            </p>

            <p className="exit-result-secondary">
              そのままお待ちください
            </p>
          </section>
        )}

        {receptionState ===
          "ticket-success" && (
          <section className="exit-result-panel exit-ticket-result">
            <div className="exit-result-icon">
              ✓
            </div>

            <span className="exit-result-eyebrow">
              EXIT ACCEPTED
            </span>

            <h2>
              受付完了
            </h2>

            <p className="exit-thank-you-message">
              御来場いただきありがとうございました
            </p>

            <p className="exit-result-number">
              {scannedQrNumber}
            </p>

            <p className="exit-result-secondary">
              {resultMessage}
            </p>
          </section>
        )}

        {receptionState ===
          "member-success" && (
          <section className="exit-result-panel exit-member-result">
            <div className="exit-result-icon">
              ✓
            </div>

            <span className="exit-result-eyebrow">
              MEMBER RECEPTION
            </span>

            <h2>
              {resultName}
            </h2>

            <p className="exit-result-primary exit-member-action">
              {resultMessage}
            </p>

            <p className="exit-result-number">
              {scannedQrNumber}
            </p>
          </section>
        )}

        {receptionState ===
          "error" && (
          <section className="exit-result-panel exit-error-result">
            <div className="exit-result-icon">
              ×
            </div>

            <span className="exit-result-eyebrow">
              RECEPTION ERROR
            </span>

            <h2>
              受付失敗
            </h2>

            <p className="exit-result-primary">
              {resultMessage ||
                "もう一度やり直してください"}
            </p>

            {scannedQrNumber !==
              "" && (
              <p className="exit-result-number">
                {scannedQrNumber}
              </p>
            )}

            <p className="exit-result-secondary">
              約2.5秒後に読み取り画面へ戻ります
            </p>
          </section>
        )}
      </main>

      <footer className="exit-reception-footer">
        <button
          type="button"
          className="exit-home-button"
          disabled={
            receptionState ===
            "processing"
          }
          onClick={() =>
            setPage(
              "home"
            )
          }
        >
          <span className="exit-footer-button-icon">
            <HomeIcon />
          </span>

          <span>
            ホームへ戻る
          </span>
        </button>

        <button
          type="button"
          className="exit-admin-button"
          disabled={
            receptionState ===
            "processing"
          }
          onClick={
            openAdminAuth
          }
        >
          <span className="exit-footer-button-icon">
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

export default ExitPage;