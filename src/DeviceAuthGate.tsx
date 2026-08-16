import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";

import {
  doc,
  getDoc,
  getDocFromCache,
} from "firebase/firestore";

import {
  auth,
  db,
} from "./firebase";

import {
  startOfflineReceptionSync,
} from "./offlineReceptionSync";

import "./DeviceAuthGate.css";

type DeviceAuthGateProps = {
  children: ReactNode;
};

type AuthScreenState =
  | "checking"
  | "signed-out"
  | "signing-in"
  | "checking-access"
  | "authorized"
  | "unauthorized"
  | "error";

const AUTHORIZED_USERS_COLLECTION =
  "authorized-users";

function getSignInErrorMessage(
  error: unknown
) {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";

  switch (code) {
    case "auth/invalid-credential":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return "メールアドレスまたはパスワードが違います。";

    case "auth/user-disabled":
      return "この端末アカウントは無効になっています。";

    case "auth/too-many-requests":
      return "試行回数が多すぎます。少し待ってからやり直してください。";

    case "auth/network-request-failed":
      return "通信できませんでした。初回認証はオンラインで行ってください。";

    case "auth/operation-not-allowed":
      return "Firebaseでメール認証がまだ有効になっていません。";

    default:
      return "端末認証に失敗しました。もう一度やり直してください。";
  }
}

async function isAuthorizedUser(
  user: User
) {
  const authorizationDocument =
    doc(
      db,
      AUTHORIZED_USERS_COLLECTION,
      user.uid
    );

  try {
    const snapshot = await getDoc(
      authorizationDocument
    );

    return snapshot.exists();
  } catch (onlineError) {
    try {
      const cachedSnapshot =
        await getDocFromCache(
          authorizationDocument
        );

      return cachedSnapshot.exists();
    } catch {
      throw onlineError;
    }
  }
}

function AuthLogo() {
  return (
    <div
      className="device-auth-logo"
      aria-hidden="true"
    >
      <span>QR</span>
    </div>
  );
}

function DeviceAuthGate({
  children,
}: DeviceAuthGateProps) {
  const [
    screenState,
    setScreenState,
  ] = useState<AuthScreenState>(
    "checking"
  );
  const [
    currentUser,
    setCurrentUser,
  ] = useState<User | null>(null);
  const [email, setEmail] =
    useState("");
  const [password, setPassword] =
    useState("");
  const [errorMessage, setErrorMessage] =
    useState("");

  const verifyAuthorization =
    useCallback(
      async (user: User) => {
        setScreenState(
          "checking-access"
        );
        setErrorMessage("");

        try {
          const authorized =
            await isAuthorizedUser(
              user
            );

          setScreenState(
            authorized
              ? "authorized"
              : "unauthorized"
          );
        } catch (error) {
          console.error(
            "端末の利用許可を確認できませんでした。",
            error
          );
          setErrorMessage(
            navigator.onLine
              ? "端末の利用許可を確認できませんでした。Firebaseの設定を確認してください。"
              : "オフラインで利用許可を確認できませんでした。一度オンラインで認証してください。"
          );
          setScreenState("error");
        }
      },
      []
    );

  useEffect(() => {
    let active = true;

    const unsubscribe =
      onAuthStateChanged(
        auth,
        (user) => {
          if (!active) {
            return;
          }

          setCurrentUser(user);

          if (user === null) {
            setScreenState(
              "signed-out"
            );
            return;
          }

          void verifyAuthorization(
            user
          );
        },
        (error) => {
          if (!active) {
            return;
          }

          console.error(
            "端末認証の状態を読み込めませんでした。",
            error
          );
          setErrorMessage(
            "端末認証の状態を読み込めませんでした。"
          );
          setScreenState("error");
        }
      );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [verifyAuthorization]);

  useEffect(() => {
    if (
      screenState === "authorized"
    ) {
      startOfflineReceptionSync();
    }
  }, [screenState]);

  const handleSignIn = async (
    event: FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();

    if (
      email.trim() === "" ||
      password === ""
    ) {
      setErrorMessage(
        "メールアドレスとパスワードを入力してください。"
      );
      return;
    }

    setScreenState("signing-in");
    setErrorMessage("");

    try {
      await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      setPassword("");
    } catch (error) {
      console.warn(
        "端末認証に失敗しました。",
        error
      );
      setErrorMessage(
        getSignInErrorMessage(error)
      );
      setScreenState("signed-out");
    }
  };

  const handleSignOut = async () => {
    setErrorMessage("");

    try {
      await signOut(auth);
    } catch (error) {
      console.error(
        "端末認証を解除できませんでした。",
        error
      );
      setErrorMessage(
        "端末認証を解除できませんでした。"
      );
      setScreenState("error");
    }
  };

  if (screenState === "authorized") {
    return children;
  }

  const isLoading =
    screenState === "checking" ||
    screenState === "signing-in" ||
    screenState === "checking-access";

  return (
    <main className="device-auth-page">
      <section className="device-auth-card">
        <AuthLogo />

        {isLoading ? (
          <div
            className="device-auth-loading"
            aria-live="polite"
          >
            <span
              className="device-auth-spinner"
              aria-hidden="true"
            />

            <h1>
              {screenState ===
              "signing-in"
                ? "端末を認証しています"
                : "利用許可を確認しています"}
            </h1>

            <p>
              そのままお待ちください
            </p>
          </div>
        ) : screenState ===
          "signed-out" ? (
          <>
            <div className="device-auth-heading">
              <h1>
                端末認証
              </h1>

              <p>
                許可された端末アカウントでログインしてください。
              </p>
            </div>

            <form
              className="device-auth-form"
              onSubmit={handleSignIn}
            >
              <label>
                メールアドレス

                <input
                  type="email"
                  value={email}
                  onChange={(event) =>
                    setEmail(
                      event.target.value
                    )
                  }
                  autoComplete="username"
                  inputMode="email"
                  required
                />
              </label>

              <label>
                パスワード

                <input
                  type="password"
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value
                    )
                  }
                  autoComplete="current-password"
                  required
                />
              </label>

              {errorMessage !== "" && (
                <p
                  className="device-auth-error"
                  role="alert"
                >
                  {errorMessage}
                </p>
              )}

              <button type="submit">
                この端末でログイン
              </button>
            </form>

            <p className="device-auth-note">
              ログイン状態はこの端末に保存されます。共用端末では、使用後に設定画面から認証を解除してください。
            </p>
          </>
        ) : screenState ===
          "unauthorized" ? (
          <div className="device-auth-message">
            <h1>
              このアカウントは未許可です
            </h1>

            <p>
              Firebaseの許可済み端末一覧へ、次のUIDを登録してください。
            </p>

            <code>
              {currentUser?.uid ?? ""}
            </code>

            <div className="device-auth-actions">
              <button
                type="button"
                onClick={() => {
                  if (
                    currentUser !== null
                  ) {
                    void verifyAuthorization(
                      currentUser
                    );
                  }
                }}
              >
                登録後に再確認
              </button>

              <button
                type="button"
                className="device-auth-secondary"
                onClick={() =>
                  void handleSignOut()
                }
              >
                別のアカウントを使う
              </button>
            </div>
          </div>
        ) : (
          <div className="device-auth-message">
            <h1>
              認証を確認できませんでした
            </h1>

            <p role="alert">
              {errorMessage}
            </p>

            <div className="device-auth-actions">
              {currentUser !== null && (
                <button
                  type="button"
                  onClick={() =>
                    void verifyAuthorization(
                      currentUser
                    )
                  }
                >
                  もう一度確認
                </button>
              )}

              <button
                type="button"
                className="device-auth-secondary"
                onClick={() =>
                  void handleSignOut()
                }
              >
                ログイン画面に戻る
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export default DeviceAuthGate;
