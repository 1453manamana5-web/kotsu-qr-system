import {
  useCallback,
  useEffect,
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
    receptionDeviceId,
  ] = useState(
    () =>
      createReceptionDeviceId(
        "exit"
      )
  );

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
      []
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

        setReceptionState(
          "member-success"
        );
      },
      []
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
      <header className="exit-reception-header">
        <div>
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <OnlineStatus />
        </div>

        <div className="exit-reception-mode">
          出口受付
        </div>
      </header>

      <main className="exit-reception-main">
        {receptionState ===
          "waiting" && (
          <section className="exit-waiting-panel">
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

            <p className="exit-scan-instruction">
              QRコードを読み込んでください
            </p>
          </section>
        )}

        {receptionState ===
          "processing" && (
          <section className="exit-result-panel">
            <h2>
              受付処理中
            </h2>

            <p>
              Firebaseへ確認しています…
            </p>
          </section>
        )}

        {receptionState ===
          "ticket-success" && (
          <section className="exit-result-panel">
            <div className="exit-result-icon">
              ✓
            </div>

            <h2>
              受付完了
            </h2>

            <p className="exit-thank-you-message">
              御来場いただきありがとうございました
            </p>

            <p className="exit-result-number">
              {
                scannedQrNumber
              }
            </p>

            <p className="exit-result-message">
              {
                resultMessage
              }
            </p>
          </section>
        )}

        {receptionState ===
          "member-success" && (
          <section className="exit-result-panel exit-member-result">
            <div className="exit-result-icon">
              ✓
            </div>

            <h2>
              {resultName}
            </h2>

            <p className="exit-member-action">
              {
                resultMessage
              }
            </p>

            <p className="exit-result-number">
              {
                scannedQrNumber
              }
            </p>
          </section>
        )}

        {receptionState ===
          "error" && (
          <section className="exit-result-panel">
            <div className="exit-result-icon">
              ×
            </div>

            <h2>
              受付失敗
            </h2>

            <p>
              {resultMessage ||
                "もう一度やり直してください"}
            </p>

            {scannedQrNumber !==
              "" && (
              <p className="exit-result-number">
                {
                  scannedQrNumber
                }
              </p>
            )}
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
          ホームへ戻る
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
          管理モード
        </button>
      </footer>
    </div>
  );
}

export default ExitPage;