import {
  useCallback,
  useEffect,
  useState,
} from "react";

import CameraQrScanner from "./CameraQrScanner";
import OnlineStatus from "./OnlineStatus";

import {
  findMemberByQrInFirestore,
} from "../memberFirestore";

import "./AdminAuthPage.css";

type AdminAuthPageProps = {
  setPage: (
    page: string
  ) => void;

  eventName: string;

  returnPage:
    | "home"
    | "entry"
    | "exit";
};

type AuthState =
  | "waiting"
  | "processing"
  | "success"
  | "error";

type ParsedMemberQr = {
  qrNumber: string;
  authToken: string;
};

function parseMemberQr(
  qrValue: string
): ParsedMemberQr | null {
  const parts =
    qrValue
      .trim()
      .split(":");

  if (
    parts.length !== 4 ||
    parts[0] !== "QRM1" ||
    parts[1] !== "MEMBER" ||
    parts[2].trim() === "" ||
    parts[3].trim() === ""
  ) {
    return null;
  }

  return {
    qrNumber:
      parts[2],

    authToken:
      parts[3],
  };
}

function AdminAuthPage({
  setPage,
  eventName,
  returnPage,
}: AdminAuthPageProps) {
  const [
    authState,
    setAuthState,
  ] = useState<AuthState>(
    "waiting"
  );

  const [
    authenticatedMemberName,
    setAuthenticatedMemberName,
  ] = useState("");

  const [
    scannerSession,
    setScannerSession,
  ] = useState(0);

  useEffect(() => {
    if (
      authState ===
        "waiting" ||
      authState ===
        "processing"
    ) {
      return;
    }

    const timer =
      window.setTimeout(
        () => {
          if (
            authState ===
            "success"
          ) {
            setPage(
              "admin"
            );

            return;
          }

          setAuthenticatedMemberName(
            ""
          );

          setAuthState(
            "waiting"
          );

          setScannerSession(
            (
              currentSession
            ) =>
              currentSession + 1
          );
        },
        2000
      );

    return () => {
      window.clearTimeout(
        timer
      );
    };
  }, [
    authState,
    setPage,
  ]);

  const handleQrScan =
    useCallback(
      async (
        scannedQrValue:
          string
      ) => {
        if (
          authState !==
          "waiting"
        ) {
          return;
        }

        const parsedQr =
          parseMemberQr(
            scannedQrValue
          );

        if (
          parsedQr ===
          null
        ) {
          setAuthenticatedMemberName(
            ""
          );

          setAuthState(
            "error"
          );

          return;
        }

        if (
          eventName.trim() ===
          ""
        ) {
          setAuthenticatedMemberName(
            ""
          );

          setAuthState(
            "error"
          );

          return;
        }

        setAuthState(
          "processing"
        );

        try {
          const member =
            await findMemberByQrInFirestore(
              eventName,
              parsedQr.qrNumber,
              parsedQr.authToken
            );

          if (
            member ===
            null
          ) {
            setAuthenticatedMemberName(
              ""
            );

            setAuthState(
              "error"
            );

            return;
          }

          const memberName =
            member.name.trim() ||
            "部員";

          setAuthenticatedMemberName(
            memberName
          );

          setAuthState(
            "success"
          );
        } catch (error) {
          console.error(
            "部員QR認証に失敗しました。",
            error
          );

          setAuthenticatedMemberName(
            ""
          );

          setAuthState(
            "error"
          );
        }
      },
      [
        authState,
        eventName,
      ]
    );

  const getReturnButtonText =
    () => {
      if (
        returnPage ===
        "entry"
      ) {
        return "入口受付へ戻る";
      }

      if (
        returnPage ===
        "exit"
      ) {
        return "出口受付へ戻る";
      }

      return "ホームへ戻る";
    };

  return (
    <div
      className={`admin-auth-page ${authState}`}
    >
      <header className="admin-auth-header">
        <div className="admin-auth-title-area">
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <OnlineStatus />
        </div>

        <div className="admin-auth-mode-label">
          管理者認証
        </div>
      </header>

      <main
        className="admin-auth-main"
        aria-live="polite"
        aria-busy={
          authState ===
          "processing"
        }
      >
        {authState ===
          "waiting" && (
          <section className="admin-auth-waiting">
            <div className="admin-auth-scanner-wrapper">
              <CameraQrScanner
                key={
                  scannerSession
                }
                enabled
                onScan={(
                  qrValue
                ) => {
                  void handleQrScan(
                    qrValue
                  );
                }}
              />
            </div>

            <p className="admin-auth-instruction">
              部員QRコードを読み込んでください
            </p>
          </section>
        )}

        {authState ===
          "processing" && (
          <section className="admin-auth-result">
            <div className="admin-auth-processing-icon">
              <span />
            </div>

            <h2>
              認証中
            </h2>

            <p>
              部員情報を確認しています
            </p>

            <strong>
              そのままお待ちください
            </strong>
          </section>
        )}

        {authState ===
          "success" && (
          <section className="admin-auth-result">
            <div className="admin-auth-result-icon">
              ✓
            </div>

            <h2>
              認証完了
            </h2>

            <p>
              {authenticatedMemberName}
              さん
            </p>

            <strong>
              管理画面を開きます
            </strong>
          </section>
        )}

        {authState ===
          "error" && (
          <section className="admin-auth-result">
            <div className="admin-auth-result-icon">
              ×
            </div>

            <h2>
              認証失敗
            </h2>

            <p>
              登録された部員QRではありません
            </p>

            <strong>
              もう一度読み取ってください
            </strong>
          </section>
        )}
      </main>

      <footer className="admin-auth-footer">
        <div className="admin-auth-event">
          <span className="admin-auth-event-label">
            CURRENT EVENT
          </span>

          <strong>
            {eventName ||
              "イベント未設定"}
          </strong>
        </div>

        <button
          type="button"
          className={`admin-auth-cancel-button admin-auth-cancel-${returnPage}`}
          disabled={
            authState ===
            "processing"
          }
          onClick={() =>
            setPage(
              returnPage
            )
          }
        >
          {
            getReturnButtonText()
          }
        </button>
      </footer>
    </div>
  );
}

export default AdminAuthPage;