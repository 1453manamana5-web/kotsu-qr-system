import {
  useState,
} from "react";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import {
  db,
} from "../firebase";

type FirebaseTestPageProps = {
  setPage: (
    page: string
  ) => void;
};

type TestState =
  | "waiting"
  | "saving"
  | "success"
  | "error";

function FirebaseTestPage({
  setPage,
}: FirebaseTestPageProps) {
  const [
    testState,
    setTestState,
  ] = useState<TestState>(
    "waiting"
  );

  const [
    message,
    setMessage,
  ] = useState(
    "まだ接続テストをしていません"
  );

  const runConnectionTest =
    async () => {
      setTestState(
        "saving"
      );

      setMessage(
        "Firebaseへ接続しています…"
      );

      try {
        const testDocument =
          doc(
            db,
            "system",
            "connection-test"
          );

        await setDoc(
          testDocument,
          {
            message:
              "Firebase接続成功",

            appName:
              "交通研究部QRコード管理システム",

            updatedAt:
              serverTimestamp(),
          },
          {
            merge: true,
          }
        );

        const savedDocument =
          await getDoc(
            testDocument
          );

        if (
          !savedDocument.exists()
        ) {
          throw new Error(
            "保存したテストデータを読み込めませんでした。"
          );
        }

        setTestState(
          "success"
        );

        setMessage(
          "Firebaseへの保存と読み込みに成功しました"
        );
      } catch (error) {
        console.error(
          "Firebase接続テストに失敗しました。",
          error
        );

        const errorMessage =
          error instanceof Error
            ? error.message
            : "原因不明のエラー";

        setTestState(
          "error"
        );

        setMessage(
          `接続に失敗しました：${errorMessage}`
        );
      }
    };

  return (
    <div
      style={{
        minHeight:
          "100vh",

        boxSizing:
          "border-box",

        padding:
          "30px",

        background:
          "#f5f5f5",

        color:
          "#111",
      }}
    >
      <h1>
        Firebase接続テスト
      </h1>

      <div
        style={{
          maxWidth:
            "800px",

          marginTop:
            "30px",

          padding:
            "30px",

          borderRadius:
            "18px",

          background:
            "#fff",

          fontSize:
            "26px",

          fontWeight:
            "bold",
        }}
      >
        <p>
          {message}
        </p>

        <button
          type="button"
          disabled={
            testState ===
            "saving"
          }
          onClick={() =>
            void runConnectionTest()
          }
          style={{
            minHeight:
              "70px",

            padding:
              "12px 26px",

            border:
              "none",

            borderRadius:
              "14px",

            background:
              "#9966ee",

            color:
              "#fff",

            fontSize:
              "24px",

            fontWeight:
              "bold",

            cursor:
              testState ===
              "saving"
                ? "wait"
                : "pointer",
          }}
        >
          {testState ===
          "saving"
            ? "接続しています…"
            : "Firebase接続テスト"}
        </button>
      </div>

      <button
        type="button"
        onClick={() =>
          setPage(
            "settings"
          )
        }
        style={{
          marginTop:
            "30px",

          border:
            "none",

          background:
            "transparent",

          fontSize:
            "28px",

          fontWeight:
            "bold",

          cursor:
            "pointer",
        }}
      >
        前のページに戻る
      </button>
    </div>
  );
}

export default FirebaseTestPage;