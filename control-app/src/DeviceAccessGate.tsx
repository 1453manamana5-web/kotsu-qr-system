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
  role: string;
  active: boolean;
  deviceName: string;
};

function readDevice(data: DocumentData): AuthorizedDevice | null {
  if (typeof data.role !== "string" || typeof data.active !== "boolean") {
    return null;
  }

  return {
    role: data.role,
    active: data.active,
    deviceName: typeof data.deviceName === "string" ? data.deviceName : "部員端末",
  };
}

function detectDeviceType() {
  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();

  if (userAgent.includes("ipad") || (platform === "macintel" && navigator.maxTouchPoints > 1)) return "ipad";
  if (userAgent.includes("iphone")) return "iphone";
  if (userAgent.includes("android")) return "android";
  if (userAgent.includes("windows")) return "windows";
  if (userAgent.includes("macintosh") || platform.includes("mac")) return "mac";
  return userAgent === "" ? "unknown" : "other";
}

function createPairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);

  return Array.from(
    bytes,
    (value) => alphabet[value % alphabet.length]
  ).join("");
}

function AccessCard({ children }: { children: ReactNode }) {
  return (
    <main className="access-page">
      <section className="access-card">
        <div className="access-logo" aria-hidden="true">QR</div>
        {children}
      </section>
    </main>
  );
}

export default function DeviceAccessGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [state, setState] = useState<AccessState>("auth");
  const [pairingCode, setPairingCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (nextUser !== null) {
        setUser(nextUser);
        setState("checking");
        return;
      }

      void signInAnonymously(auth).catch((authError) => {
        console.error("匿名認証に失敗しました。", authError);
        setError("端末の自動認証に失敗しました。通信状態を確認してください。");
        setState("error");
      });
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (user === null) return undefined;

    let deviceKnown = false;
    let requestKnown = false;
    let device: AuthorizedDevice | null = null;
    let requestStatus = "";
    let requestedRole = "";

    const decide = () => {
      if (!deviceKnown || !requestKnown) return;

      if (
        device?.active === true &&
        (device.role === "member" || device.role === "control")
      ) {
        setState("ready");
      } else if (device?.active === true) {
        setError("この端末は部員端末として登録されていません。QR受付システムから部員端末への変更を申請してください。");
        setState("error");
      } else if (requestStatus === "pending" && requestedRole === "member") {
        setState("pending");
      } else {
        setState("request");
      }
    };

    const deviceRef = doc(db, "system", "device-access", "devices", user.uid);
    const requestRef = doc(db, "system", "device-access", "requests", user.uid);

    const onError = (loadError: Error) => {
      console.error("端末権限を確認できませんでした。", loadError);
      setError("端末権限を確認できませんでした。Firebaseとの通信を確認してください。");
      setState("error");
    };

    const unsubscribeDevice = onSnapshot(deviceRef, { includeMetadataChanges: true }, (snapshot) => {
      device = snapshot.exists() ? readDevice(snapshot.data()) : null;
      deviceKnown = true;
      decide();
    }, onError);

    const unsubscribeRequest = onSnapshot(requestRef, { includeMetadataChanges: true }, (snapshot) => {
      const requestData = snapshot.exists() ? snapshot.data() : null;
      requestStatus = requestData !== null && typeof requestData.status === "string"
        ? requestData.status
        : "";
      requestedRole = requestData !== null && typeof requestData.requestedRole === "string"
        ? requestData.requestedRole
        : "";
      setPairingCode(
        requestData !== null && typeof requestData.pairingCode === "string"
          ? requestData.pairingCode
          : ""
      );
      requestKnown = true;
      decide();
    }, onError);

    return () => {
      unsubscribeDevice();
      unsubscribeRequest();
    };
  }, [user]);

  const submitLinkRequest = async () => {
    if (user === null) return;

    setSubmitting(true);
    setError("");

    try {
      const nextPairingCode = createPairingCode();
      const batch = writeBatch(db);
      const requestRef = doc(db, "system", "device-access", "requests", user.uid);
      const auditRef = doc(collection(db, "system", "device-access", "audit"));
      const deviceName = "管制アプリ";

      batch.set(requestRef, {
        requestType: "initial",
        requestedRole: "member",
        displayName: "管制アプリ",
        deviceName,
        deviceType: detectDeviceType(),
        pairingCode: nextPairingCode,
        pairingExpiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000),
        status: "pending",
        requestedAt: serverTimestamp(),
        decidedAt: null,
        decidedByUid: "",
        decidedByName: "",
      });

      batch.set(auditRef, {
        action: "request-created",
        actorUid: user.uid,
        actorName: "管制アプリ",
        targetUid: user.uid,
        targetName: deviceName,
        role: "member",
        createdAt: serverTimestamp(),
      });

      await batch.commit();
      setPairingCode(nextPairingCode);
    } catch (submitError) {
      console.error("管制アプリの連携コードを発行できませんでした。", submitError);
      setError("連携コードを発行できませんでした。通信状態を確認して、もう一度お試しください。");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "ready") return children;

  if (state === "auth" || state === "checking") {
    return <AccessCard><div className="access-spinner" /><h1>部員端末を確認しています</h1><p>Firebaseとの接続を確認中です</p></AccessCard>;
  }

  if (state === "pending") {
    return (
      <AccessCard>
        <span className="access-badge">初回連携</span>
        <h1>受付アプリと連携</h1>
        <p>受付アプリの「端末管理」で、次のコードを入力してください。</p>
        {pairingCode !== "" && (
          <strong className="pairing-code" aria-label={`連携コード ${pairingCode}`}>
            {pairingCode.slice(0, 4)}-{pairingCode.slice(4)}
          </strong>
        )}
        <p className="pairing-note">コードは10分間・1回限り有効です。連携後は、この管制アプリを直接開けます。</p>
        <button type="button" disabled={submitting} onClick={() => void submitLinkRequest()}>
          {submitting ? "発行しています…" : "新しいコードを発行"}
        </button>
      </AccessCard>
    );
  }

  if (state === "error") {
    return <AccessCard><h1>管制システムを開けません</h1><p className="access-error" role="alert">{error}</p><button onClick={() => window.location.reload()}>再読み込み</button></AccessCard>;
  }

  return (
    <AccessCard>
      <span className="access-badge">初回のみ</span>
      <h1>受付アプリと連携</h1>
      <p>すでにログイン済みの受付アプリと、この管制アプリを同じ部員アカウントへ紐づけます。</p>
      {error !== "" && <p className="access-error" role="alert">{error}</p>}
      <button type="button" disabled={submitting} onClick={() => void submitLinkRequest()}>
        {submitting ? "発行しています…" : "連携コードを発行"}
      </button>
    </AccessCard>
  );
}
