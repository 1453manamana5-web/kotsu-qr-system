import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  writeBatch,
} from "firebase/firestore";

import { db } from "./firebase";
import { auth } from "./firebaseAuth";
import { useDeviceAccess } from "./deviceAccessContext";

const ROOT_COLLECTION = "system";
const ROOT_DOCUMENT = "device-access";
const MAX_FULL_RESET_WRITES = 480;

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

async function resetDeviceManagementCompletely() {
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
    throw new Error("端末管理の完全リセットは、登録済みの部員端末から実行してください。");
  }

  const [devicesSnapshot, requestsSnapshot, auditSnapshot] = await Promise.all([
    getDocs(getDevicesCollection()),
    getDocs(getRequestsCollection()),
    getDocs(getAuditCollection()),
  ]);

  const totalWrites =
    devicesSnapshot.size +
    requestsSnapshot.size +
    auditSnapshot.size +
    1;

  if (totalWrites > MAX_FULL_RESET_WRITES) {
    throw new Error(
      `端末管理の記録が多すぎるため一括リセットできません（${totalWrites}件）。操作履歴を整理してからもう一度実行してください。`
    );
  }

  const batch = writeBatch(db);

  devicesSnapshot.docs.forEach((item) => batch.delete(item.ref));
  requestsSnapshot.docs.forEach((item) => batch.delete(item.ref));
  auditSnapshot.docs.forEach((item) => batch.delete(item.ref));
  batch.delete(getConfigDocument());

  await batch.commit();

  return {
    deletedDeviceCount: devicesSnapshot.size,
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
        "端末管理を完全に初期状態へ戻しますか？",
        "",
        "削除するもの：",
        "・現在使用中のこの端末を含む、すべての登録済み端末",
        "・すべての利用申請",
        "・すべての端末操作履歴",
        "・端末管理の初期設定",
        "",
        "イベント、チケット、部員、受付履歴など他のデータは削除しません。",
      ].join("\n")
    );

    if (!confirmed) return;

    const finalConfirmed = window.confirm(
      [
        "この端末自身の登録も削除します。",
        "",
        "実行後は『最初の部員端末を登録』画面へ戻り、この端末からもう一度登録し直します。",
        "その後、管制アプリとの連携も最初からやり直してください。",
        "",
        "本当に完全リセットしますか？",
      ].join("\n")
    );

    if (!finalConfirmed) return;

    setBusy(true);

    try {
      const result = await resetDeviceManagementCompletely();

      window.alert(
        [
          "端末管理を完全リセットしました。",
          "",
          `登録済み端末：${result.deletedDeviceCount}台削除`,
          `利用申請：${result.deletedRequestCount}件削除`,
          `操作履歴：${result.deletedAuditCount}件削除`,
          "",
          "この端末も未登録状態に戻しました。",
          "次の画面で最初の部員端末として登録し直してください。",
        ].join("\n")
      );

      window.location.reload();
    } catch (error) {
      console.error("端末管理の完全リセットに失敗しました。", error);

      window.alert(
        error instanceof Error
          ? `端末管理を完全リセットできませんでした。\n${error.message}`
          : "端末管理を完全リセットできませんでした。通信状態を確認してください。"
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
        {busy ? "端末管理を完全リセット中…" : "端末管理を完全リセット"}
      </button>
    </>,
    footerTarget
  );
}
