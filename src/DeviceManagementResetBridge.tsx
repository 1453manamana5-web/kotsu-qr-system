import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import { db } from "./firebase";
import { auth } from "./firebaseAuth";
import { useDeviceAccess } from "./deviceAccessContext";

const ROOT_COLLECTION = "system";
const ROOT_DOCUMENT = "device-access";
const MAX_BATCH_DELETE_COUNT = 450;

function getConfigDocument() {
  return doc(db, ROOT_COLLECTION, ROOT_DOCUMENT);
}

function getDevicesCollection() {
  return collection(db, ROOT_COLLECTION, ROOT_DOCUMENT, "devices");
}

function getRequestsCollection() {
  return collection(db, ROOT_COLLECTION, ROOT_DOCUMENT, "requests");
}

function getAuditCollection() {
  return collection(db, ROOT_COLLECTION, ROOT_DOCUMENT, "audit");
}

async function resetDeviceManagementKeepingCurrentMember() {
  const uid = auth.currentUser?.uid;

  if (uid === undefined) {
    throw new Error("端末の自動認証が完了していません。");
  }

  const currentDeviceDocument = doc(getDevicesCollection(), uid);
  const currentDeviceSnapshot = await getDoc(currentDeviceDocument);

  if (!currentDeviceSnapshot.exists()) {
    throw new Error("現在使用中の端末が端末管理に登録されていません。");
  }

  const currentDevice = currentDeviceSnapshot.data();

  if (currentDevice.active !== true || currentDevice.role !== "member") {
    throw new Error("端末管理のリセットは、登録済みの部員端末から実行してください。");
  }

  const [devicesSnapshot, requestsSnapshot, auditSnapshot] = await Promise.all([
    getDocs(getDevicesCollection()),
    getDocs(getRequestsCollection()),
    getDocs(getAuditCollection()),
  ]);

  const deleteTargets = [
    ...devicesSnapshot.docs.filter((item) => item.id !== uid).map((item) => item.ref),
    ...requestsSnapshot.docs.map((item) => item.ref),
    ...auditSnapshot.docs.map((item) => item.ref),
  ];

  for (let index = 0; index < deleteTargets.length; index += MAX_BATCH_DELETE_COUNT) {
    const batch = writeBatch(db);

    deleteTargets
      .slice(index, index + MAX_BATCH_DELETE_COUNT)
      .forEach((reference) => batch.delete(reference));

    await batch.commit();
  }

  const configBatch = writeBatch(db);
  configBatch.set(
    getConfigDocument(),
    {
      initialized: true,
      memberDeviceCount: 1,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await configBatch.commit();

  return {
    deletedDeviceCount: Math.max(0, devicesSnapshot.size - 1),
    deletedRequestCount: requestsSnapshot.size,
    deletedAuditCount: auditSnapshot.size,
  };
}

export default function DeviceManagementResetBridge() {
  const { device } = useDeviceAccess();
  const [footerTarget, setFooterTarget] = useState<Element | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let scheduled = false;

    const refresh = () => {
      if (scheduled) return;
      scheduled = true;

      window.requestAnimationFrame(() => {
        scheduled = false;
        const next = document.querySelector(".device-management-footer");
        setFooterTarget((current) => current === next ? current : next);
      });
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  const handleReset = async () => {
    if (busy) return;

    const confirmed = window.confirm(
      [
        "端末管理を連携し直すためにリセットしますか？",
        "",
        "残すもの：現在使用中のこの部員端末",
        "削除するもの：その他の登録済み端末・すべての利用申請・操作履歴",
        "",
        "イベント、チケット、部員、受付履歴など他のデータは削除しません。",
      ].join("\n")
    );

    if (!confirmed) return;

    const finalConfirmed = window.confirm(
      "端末管理の接続情報を初期状態に戻します。\nこの端末以外は再度申請・連携が必要になります。\n本当に実行しますか？"
    );

    if (!finalConfirmed) return;

    setBusy(true);

    try {
      const result = await resetDeviceManagementKeepingCurrentMember();

      alert(
        [
          "端末管理をリセットしました。",
          "",
          `登録済み端末：${result.deletedDeviceCount}台削除`,
          `利用申請：${result.deletedRequestCount}件削除`,
          `操作履歴：${result.deletedAuditCount}件削除`,
          "",
          "この部員端末だけを残しています。",
          "次に管制アプリで新しい連携コードを発行して、端末管理から連携してください。",
        ].join("\n")
      );
    } catch (error) {
      console.error("端末管理のリセットに失敗しました。", error);

      alert(
        error instanceof Error
          ? `端末管理をリセットできませんでした。\n${error.message}`
          : "端末管理をリセットできませんでした。通信状態を確認してください。"
      );
    } finally {
      setBusy(false);
    }
  };

  if (footerTarget === null || device.role !== "member") {
    return null;
  }

  return createPortal(
    <>
      <style>{`
        .device-management-reset-button{margin-left:auto;min-height:44px;padding:9px 14px;border:1px solid #e8b0b0;border-radius:12px;background:#fff3f3;color:#a13232;font:inherit;font-weight:850;cursor:pointer}.device-management-reset-button:hover{background:#ffe9e9}.device-management-reset-button:disabled{opacity:.55;cursor:wait}@media(max-width:760px){.device-management-reset-button{width:100%;margin-left:0}.device-management-footer{flex-wrap:wrap}}
      `}</style>
      <button
        type="button"
        className="device-management-reset-button"
        disabled={busy}
        onClick={() => {
          void handleReset();
        }}
      >
        {busy ? "端末管理をリセット中…" : "端末管理だけリセット"}
      </button>
    </>,
    footerTarget
  );
}
