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
  doc,
  onSnapshot,
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
      requestKnown = true;
      decide();
    }, onError);

    return () => {
      unsubscribeDevice();
      unsubscribeRequest();
    };
  }, [user]);

  if (state === "ready") return children;

  if (state === "auth" || state === "checking") {
    return <AccessCard><div className="access-spinner" /><h1>部員端末を確認しています</h1><p>Firebaseとの接続を確認中です</p></AccessCard>;
  }

  if (state === "pending") {
    return (
      <AccessCard>
        <span className="access-badge">承認待ち</span>
        <h1>端末申請を確認中です</h1>
        <p>QR受付アプリから送信した申請を、登録済みの部員端末で承認してください。承認されると、この画面から自動で管制システムへ進みます。</p>
        <button type="button" onClick={() => window.location.assign("/qr-system/")}>
          QR受付アプリへ戻る
        </button>
      </AccessCard>
    );
  }

  if (state === "error") {
    return <AccessCard><h1>管制システムを開けません</h1><p className="access-error" role="alert">{error}</p><button onClick={() => window.location.reload()}>再読み込み</button></AccessCard>;
  }

  return (
    <AccessCard>
      <span className="access-badge">未登録端末</span>
      <h1>先にQR受付アプリで申請してください</h1>
      <p>この管制アプリからは端末申請できません。QR受付アプリを開いて部員端末として申請し、登録済みの部員端末で承認してください。</p>
      {error !== "" && <p className="access-error" role="alert">{error}</p>}
      <button type="button" onClick={() => window.location.assign("/qr-system/")}>
        QR受付アプリを開く
      </button>
    </AccessCard>
  );
}
