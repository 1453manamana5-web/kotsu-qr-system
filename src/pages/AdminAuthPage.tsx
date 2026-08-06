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

import {
  playReceptionErrorSound,
  playReceptionSuccessSound,
} from "../receptionSound";

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

function AdminAuthModeIcon() {
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

function ReturnIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M27 14L9 32L27 50"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M11 32H54"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
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
          void playReceptionErrorSound();

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
          void playReceptionErrorSound();

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
            void playReceptionErrorSound();

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

          void playReceptionSuccessSound();

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

          void playReceptionErrorSound();

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
      <div className="admin-auth-background-circle admin-auth-background-circle-one" />

      <div className="admin-auth-background-circle admin-auth-background-circle-two" />

      <header className="admin-auth-header">
        <div className="admin-auth-header-main">
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="admin-auth-header-meta">
            <OnlineStatus />

            <span
              className="admin-auth-header-divider"
              aria-hidden="true"
            />

            <div className="admin-auth-current-event">
              <span className="admin-auth-current-event-label">
                EVENT
              </span>

              <strong>
                {eventName ||
                  "イベント未設定"}
              </strong>
            </div>
          </div>
        </div>

        <div className="admin-auth-mode">
          <span className="admin-auth-mode-icon">
            <AdminAuthModeIcon />
          </span>

          <span className="admin-auth-mode-copy">
            <small>
              ADMIN AUTH
            </small>

            <strong>
              管理者認証
            </strong>
          </span>
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
          <section className="admin-auth-waiting-panel">
            <div className="admin-auth-scanner-card">
              <div className="admin-auth-scanner-card-header">
                <div className="admin-auth-scanner-heading">
                  <span className="admin-auth-scanner-heading-icon">
                    <ScannerIcon />
                  </span>

                  <span className="admin-auth-scanner-heading-copy">
                    <small>
                      MEMBER QR SCANNER
                    </small>

                    <strong>
                      部員QRコード読み取り
                    </strong>
                  </span>
                </div>

                <div className="admin-auth-scanner-ready">
                  <span
                    className="admin-auth-scanner-ready-dot"
                    aria-hidden="true"
                  />

                  認証待機中
                </div>
              </div>

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
            </div>

            <div className="admin-auth-instruction">
              <span className="admin-auth-instruction-number">
                1
              </span>

              <span className="admin-auth-instruction-copy">
                <strong>
                  部員QRコードをカメラに向けてください
                </strong>

                <small>
                  登録済みの部員QRを読み取ると管理画面が開きます
                </small>
              </span>
            </div>
          </section>
        )}

        {authState ===
          "processing" && (
          <section className="admin-auth-result-panel admin-auth-processing-result">
            <div
              className="admin-auth-processing-spinner"
              aria-hidden="true"
            />

            <span className="admin-auth-result-eyebrow">
              PROCESSING
            </span>

            <h2>
              認証中
            </h2>

            <p className="admin-auth-result-primary">
              部員情報を確認しています
            </p>

            <p className="admin-auth-result-secondary">
              そのままお待ちください
            </p>
          </section>
        )}

        {authState ===
          "success" && (
          <section className="admin-auth-result-panel admin-auth-success-result">
            <div className="admin-auth-result-icon">
              ✓
            </div>

            <span className="admin-auth-result-eyebrow">
              ACCESS GRANTED
            </span>

            <h2>
              認証完了
            </h2>

            <p className="admin-auth-result-primary">
              {authenticatedMemberName}
              さん
            </p>

            <p className="admin-auth-result-secondary">
              管理画面を開きます
            </p>
          </section>
        )}

        {authState ===
          "error" && (
          <section className="admin-auth-result-panel admin-auth-error-result">
            <div className="admin-auth-result-icon">
              ×
            </div>

            <span className="admin-auth-result-eyebrow">
              AUTHENTICATION ERROR
            </span>

            <h2>
              認証失敗
            </h2>

            <p className="admin-auth-result-primary">
              登録された部員QRではありません
            </p>

            <p className="admin-auth-result-secondary">
              約2秒後に読み取り画面へ戻ります
            </p>
          </section>
        )}
      </main>

      <footer className="admin-auth-footer">
        <button
          type="button"
          className={`admin-auth-return-button admin-auth-return-${returnPage}`}
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
          <span className="admin-auth-return-icon">
            <ReturnIcon />
          </span>

          <span>
            {
              getReturnButtonText()
            }
          </span>
        </button>
      </footer>
    </div>
  );
}

export default AdminAuthPage;