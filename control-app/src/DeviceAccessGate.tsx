import {
  type ReactNode,
  useEffect,
  useState,
} from "react";
import {
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  writeBatch,
  type DocumentData,
} from "firebase/firestore";
import { auth, db } from "./firebase";

type AccessState =
  | "auth"
  | "checking"
  | "request"
  | "pending"
  | "ready"
  | "error";

type AuthorizedDevice = {
  role: "member" | "reception";
  active: boolean;
  deviceName: string;
};

const PAIRING_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function readDevice(
  data: DocumentData
): AuthorizedDevice | null {
  if (
    typeof data.role !== "string" ||
    typeof data.active !== "boolean"
  ) {
    return null;
  }

  // v2.8以前の管制専用roleは、読み込み時だけmemberへ寄せる。
  // 新規保存ではcontrol roleを作らない。
  const role =
    data.role === "control"
      ? "member"
      : data.role;

  if (
    role !== "member" &&
    role !== "reception"
  ) {
    return null;
  }

  return {
    role,
    active: data.active,
    deviceName:
      typeof data.deviceName === "string"
        ? data.deviceName
        : "登録端末",
  };
}

function detectDeviceType() {
  const userAgent =
    navigator.userAgent.toLowerCase();
  const platform =
    navigator.platform.toLowerCase();

  if (
    userAgent.includes("ipad") ||
    (
      platform === "macintel" &&
      navigator.maxTouchPoints > 1
    )
  ) {
    return "ipad";
  }

  if (userAgent.includes("iphone")) {
    return "iphone";
  }
  if (userAgent.includes("android")) {
    return "android";
  }
  if (userAgent.includes("windows")) {
    return "windows";
  }
  if (
    userAgent.includes("macintosh") ||
    platform.includes("mac")
  ) {
    return "mac";
  }

  return userAgent === ""
    ? "unknown"
    : "other";
}

function createPairingCode() {
  const randomValues =
    new Uint32Array(8);
  crypto.getRandomValues(randomValues);

  return Array.from(
    randomValues,
    (value) =>
      PAIRING_ALPHABET[
        value % PAIRING_ALPHABET.length
      ]
  ).join("");
}

function AccessCard({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="access-page">
      <section className="access-card">
        <div
          className="access-logo"
          aria-hidden="true"
        >
          QR
        </div>
        {children}
      </section>
    </main>
  );
}

export default function DeviceAccessGate({
  children,
}: {
  children: ReactNode;
}) {
  const [user, setUser] =
    useState<User | null>(null);
  const [state, setState] =
    useState<AccessState>("auth");
  const [error, setError] =
    useState("");
  const [pairingCode, setPairingCode] =
    useState("");
  const [pairingBusy, setPairingBusy] =
    useState(false);
  const [pairingError, setPairingError] =
    useState("");

  useEffect(() => {
    const unsubscribe =
      onAuthStateChanged(
        auth,
        (nextUser) => {
          if (nextUser !== null) {
            setUser(nextUser);
            setState("checking");
            return;
          }

          void signInAnonymously(auth).catch(
            (authError) => {
              console.error(
                "匿名認証に失敗しました。",
                authError
              );
              setError(
                "端末の自動認証に失敗しました。通信状態を確認してください。"
              );
              setState("error");
            }
          );
        }
      );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (user === null) {
      return undefined;
    }

    let deviceKnown = false;
    let requestKnown = false;
    let device: AuthorizedDevice | null = null;
    let requestStatus = "";
    let requestedRole = "";
    let requestPairingCode = "";

    const decide = () => {
      if (!deviceKnown || !requestKnown) {
        return;
      }

      setPairingCode(requestPairingCode);

      if (
        device?.active === true &&
        device.role === "member"
      ) {
        setState("ready");
        return;
      }

      if (device?.active === true) {
        setError(
          "この端末は受付専用端末として登録されています。QR受付システムから部員端末への変更を申請してください。"
        );
        setState("error");
        return;
      }

      if (
        requestStatus === "pending" &&
        requestedRole === "member"
      ) {
        setState("pending");
        return;
      }

      setState("request");
    };

    const deviceRef = doc(
      db,
      "system",
      "device-access",
      "devices",
      user.uid
    );
    const requestRef = doc(
      db,
      "system",
      "device-access",
      "requests",
      user.uid
    );

    const onError = (loadError: Error) => {
      console.error(
        "端末権限を確認できませんでした。",
        loadError
      );
      setError(
        "端末権限を確認できませんでした。Firebaseとの通信を確認してください。"
      );
      setState("error");
    };

    const unsubscribeDevice = onSnapshot(
      deviceRef,
      { includeMetadataChanges: true },
      (snapshot) => {
        device = snapshot.exists()
          ? readDevice(snapshot.data())
          : null;
        deviceKnown = true;
        decide();
      },
      onError
    );

    const unsubscribeRequest = onSnapshot(
      requestRef,
      { includeMetadataChanges: true },
      (snapshot) => {
        const requestData =
          snapshot.exists()
            ? snapshot.data()
            : null;

        requestStatus =
          requestData !== null &&
          typeof requestData.status === "string"
            ? requestData.status
            : "";
        requestedRole =
          requestData !== null &&
          typeof requestData.requestedRole ===
            "string"
            ? requestData.requestedRole
            : "";
        requestPairingCode =
          requestData !== null &&
          typeof requestData.pairingCode ===
            "string"
            ? requestData.pairingCode
            : "";
        requestKnown = true;
        decide();
      },
      onError
    );

    return () => {
      unsubscribeDevice();
      unsubscribeRequest();
    };
  }, [user]);

  const createControlPairingRequest =
    async () => {
      if (
        user === null ||
        pairingBusy
      ) {
        return;
      }

      setPairingBusy(true);
      setPairingError("");

      try {
        const nextCode =
          createPairingCode();
        const expiresAt =
          Timestamp.fromMillis(
            Date.now() +
              8 * 60 * 1000
          );
        const requestRef = doc(
          db,
          "system",
          "device-access",
          "requests",
          user.uid
        );
        const auditRef = doc(
          collection(
            db,
            "system",
            "device-access",
            "audit"
          )
        );
        const batch = writeBatch(db);

        batch.set(requestRef, {
          requestType: "initial",
          requestedRole: "member",
          displayName: "管制アプリ",
          deviceName: "管制アプリ",
          deviceType: detectDeviceType(),
          status: "pending",
          requestedAt: serverTimestamp(),
          decidedAt: null,
          decidedByUid: "",
          decidedByName: "",
          pairingCode: nextCode,
          pairingExpiresAt: expiresAt,
        });

        batch.set(auditRef, {
          action: "request-created",
          actorUid: user.uid,
          actorName: "管制アプリ",
          targetUid: user.uid,
          targetName: "管制アプリ",
          role: "member",
          createdAt: serverTimestamp(),
        });

        await batch.commit();
        setPairingCode(nextCode);
      } catch (requestError) {
        console.error(
          "管制アプリの連携コードを発行できませんでした。",
          requestError
        );
        setPairingError(
          requestError instanceof Error
            ? requestError.message
            : "連携コードを発行できませんでした。通信状態を確認してください。"
        );
      } finally {
        setPairingBusy(false);
      }
    };

  if (state === "ready") {
    return children;
  }

  if (
    state === "auth" ||
    state === "checking"
  ) {
    return (
      <AccessCard>
        <div className="access-spinner" />
        <h1>登録端末を確認しています</h1>
        <p>Firebaseとの接続を確認中です</p>
      </AccessCard>
    );
  }

  if (state === "pending") {
    const hasPairingCode =
      pairingCode !== "";

    return (
      <AccessCard>
        <span className="access-badge">
          {hasPairingCode
            ? "連携待ち"
            : "承認待ち"}
        </span>
        <h1>
          {hasPairingCode
            ? "QR受付システムと連携"
            : "端末申請を確認中です"}
        </h1>

        {hasPairingCode ? (
          <>
            <p>
              QR受付アプリの「管理モード → 設定 → システム情報」で、下の8文字を入力してください。承認されると自動で管制システムへ進みます。
            </p>

            <div
              style={{
                margin: "18px 0",
                padding: "18px 16px",
                border: "1px solid #c9d8ef",
                borderRadius: 16,
                background: "#f5f9ff",
                fontSize:
                  "clamp(28px, 7vw, 44px)",
                fontWeight: 900,
                letterSpacing: ".14em",
                textAlign: "center",
              }}
            >
              {pairingCode.slice(0, 4)}-
              {pairingCode.slice(4)}
            </div>

            <p>
              連携コードは約8分間有効です。通らない場合は新しいコードを再発行してください。
            </p>

            {pairingError !== "" && (
              <p
                className="access-error"
                role="alert"
              >
                {pairingError}
              </p>
            )}

            <button
              type="button"
              disabled={pairingBusy}
              onClick={() => {
                void createControlPairingRequest();
              }}
            >
              {pairingBusy
                ? "発行しています…"
                : "コードを再発行"}
            </button>
          </>
        ) : (
          <p>
            QR受付アプリから送信した申請を、登録済みの部員端末で承認してください。承認されると、この画面から自動で管制システムへ進みます。
          </p>
        )}

        <button
          type="button"
          onClick={() =>
            window.location.assign(
              "/qr-system/"
            )
          }
        >
          QR受付アプリを開く
        </button>
      </AccessCard>
    );
  }

  if (state === "error") {
    return (
      <AccessCard>
        <h1>管制システムを開けません</h1>
        <p
          className="access-error"
          role="alert"
        >
          {error}
        </p>
        <button
          type="button"
          onClick={() =>
            window.location.reload()
          }
        >
          再読み込み
        </button>
      </AccessCard>
    );
  }

  return (
    <AccessCard>
      <span className="access-badge">
        未連携
      </span>
      <h1>QR受付システムと連携</h1>
      <p>
        この管制アプリを登録端末として連携します。連携コードを発行して、QR受付アプリの「管理モード → 設定 → システム情報」に入力してください。
      </p>

      {pairingError !== "" && (
        <p
          className="access-error"
          role="alert"
        >
          {pairingError}
        </p>
      )}

      <button
        type="button"
        disabled={pairingBusy}
        onClick={() => {
          void createControlPairingRequest();
        }}
      >
        {pairingBusy
          ? "発行しています…"
          : "連携コードを発行"}
      </button>

      <button
        type="button"
        onClick={() =>
          window.location.assign(
            "/qr-system/"
          )
        }
      >
        QR受付アプリを開く
      </button>
    </AccessCard>
  );
}
