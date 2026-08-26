import { useLayoutEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";

const ASSIST_SETTING_PREFIX = "qr-control-personalized-assist-enabled-v1:uid:";

function readAssistEnabled(uid: string) {
  return window.localStorage.getItem(`${ASSIST_SETTING_PREFIX}${uid}`) !== "0";
}

export default function AssistPersistenceBridge() {
  useLayoutEffect(() => {
    let authResolved = false;
    let currentUid = auth.currentUser?.uid ?? null;

    const applySavedSetting = () => {
      const shell = document.querySelector(".control-shell");
      if (!(shell instanceof HTMLElement)) return;

      // 認証状態が確定するまではアシストを見せない。
      // これにより保存済みOFFなのに起動直後だけ表示されるちらつきも防ぐ。
      const enabled = authResolved && currentUid !== null
        ? readAssistEnabled(currentUid)
        : false;

      shell.classList.toggle("personalized-assist-disabled", !enabled);
    };

    applySavedSetting();

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      authResolved = true;
      currentUid = user?.uid ?? null;
      applySavedSetting();
    });

    // App本体より先に認証設定を読めても、control-shellが後から生成される場合がある。
    // DOM生成後にも保存済み設定を再適用する。
    const observer = new MutationObserver(applySavedSetting);
    observer.observe(document.body, { childList: true, subtree: true });

    // 同じアカウントを別タブで変更した場合も同期する。
    const handleStorage = (event: StorageEvent) => {
      if (currentUid === null) return;
      if (event.key !== `${ASSIST_SETTING_PREFIX}${currentUid}`) return;
      applySavedSetting();
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      unsubscribeAuth();
      observer.disconnect();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return null;
}
