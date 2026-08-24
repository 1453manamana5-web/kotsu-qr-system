import {
  type FormEvent,
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
    deviceName: typeof data.deviceName === "string" ? data.deviceName : "管制端末",
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
  const [displayName, setDisplayName] = useState("");
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

    const decide = () => {
      if (!deviceKnown || !requestKnown) return;

      if (device?.active === true && device.role === "control") {
        setState("ready");
      } else if (device?.active === true) {
        setError("この端末は管制端末として登録されていません。");
        setState("error");
      } else if (requestStatus === "pending") {
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
      if (!snapshot.exists() && snapshot.metadata.fromCache) return;
      device = snapshot.exists() ? readDevice(snapshot.data()) : null;
      deviceKnown = true;
      decide();
    }, onError);

    const unsubscribeRequest = onSnapshot(requestRef, { includeMetadataChanges: true }, (snapshot) => {
      if (!snapshot.exists() && snapshot.metadata.fromCache) return;
      requestStatus = snapshot.exists() && typeof snapshot.data().status === "string"
        ? snapshot.data().status
        : "";
      requestKnown = true;
      decide();
    }, onError);

    return () => {
      unsubscribeDevice();
      unsubscribeRequest();
    };
  }, [user]);

  const submitRequest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (user === null) return;

    const cleanName = displayName.trim();
    if (cleanName === "") return;

    setSubmitting(true);
    setError("");

    try {
      const batch = writeBatch(db);
      const requestRef = doc(db, "system", "device-access", "requests", user.uid);
      const auditRef = doc(collection(db, "system", "device-access", "audit"));
      const deviceName = `${cleanName}の管制端末`;

      batch.set(requestRef, {
        requestType: "initial",
        requestedRole: "control",
        displayName: cleanName,
        deviceName,
        deviceType: detectDeviceType(),
        status: "pending",
        requestedAt: serverTimestamp(),
        decidedAt: null,
        decidedByUid: "",
        decidedByName: "",
      });

      batch.set(auditRef, {
        action: "request-created",
        actorUid: user.uid,
        actorName: cleanName,
        targetUid: user.uid,
        targetName: deviceName,
        role: "control",
        createdAt: serverTimestamp(),
      });

      await batch.commit();
    } catch (submitError) {
      console.error("管制端末の申請に失敗しました。", submitError);
      setError("利用申請を送信できませんでした。受付システムの初期設定と通信状態を確認してください。");
    } finally {
      setSubmitting(false);
    }
  };

  if (state === "ready") return children;

  if (state === "auth" || state === "checking") {
    return <AccessCard><div className="access-spinner" /><h1>管制端末を確認しています</h1><p>Firebaseとの接続を確認中です</p></AccessCard>;
  }

  if (state === "pending") {
    return <AccessCard><span className="access-badge">申請中</span><h1>承認を待っています</h1><p>QR受付システムの「端末管理」から、この管制端末を承認してください。承認後は自動で開きます。</p></AccessCard>;
  }

  if (state === "error") {
    return <AccessCard><h1>管制システムを開けません</h1><p className="access-error" role="alert">{error}</p><button onClick={() => window.location.reload()}>再読み込み</button></AccessCard>;
  }

  return (
    <AccessCard>
      <span className="access-badge">CONTROL DEVICE</span>
      <h1>管制端末を申請</h1>
      <p>申請後、登録済みの部員端末で承認すると監視画面を利用できます。</p>
      <form onSubmit={submitRequest}>
        <label>
          操作する部員名
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={60}
            placeholder="例：山田"
            autoComplete="name"
            required
          />
        </label>
        {error !== "" && <p className="access-error" role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "送信しています…" : "管制端末として申請"}
        </button>
      </form>
    </AccessCard>
  );
}
