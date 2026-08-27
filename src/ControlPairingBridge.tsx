import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  approveDeviceAccessRequest,
  subscribeToPendingDeviceRequests,
  type DeviceAccessRequest,
} from "./deviceAccessFirestore";

function normalizePairingCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

export default function ControlPairingBridge() {
  const [target, setTarget] = useState<Element | null>(null);
  const [requests, setRequests] = useState<DeviceAccessRequest[]>([]);
  const [linkCode, setLinkCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let scheduled = false;

    const refresh = () => {
      if (scheduled) return;
      scheduled = true;

      window.requestAnimationFrame(() => {
        scheduled = false;
        const next = document.querySelector(
          ".device-management-requests-panel"
        );
        setTarget((current) =>
          current === next ? current : next
        );
      });
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (target === null) return undefined;

    return subscribeToPendingDeviceRequests(
      setRequests,
      (loadError) => {
        console.warn(
          "管制アプリの連携申請を読み込めませんでした。",
          loadError
        );
      }
    );
  }, [target]);

  const pairingRequests = requests.filter(
    (request) => request.pairingCode !== ""
  );

  if (target === null || pairingRequests.length === 0) {
    return null;
  }

  const handleSubmit = async () => {
    if (busy) return;

    const normalizedCode = normalizePairingCode(linkCode);

    if (normalizedCode.length !== 8) {
      setError("8文字の連携コードを入力してください。");
      return;
    }

    const request = pairingRequests.find(
      (item) => item.pairingCode === normalizedCode
    );

    if (request === undefined) {
      setError(
        "一致する連携コードが見つかりません。管制アプリで新しいコードを発行してください。"
      );
      return;
    }

    if (
      request.pairingExpiresAt !== "" &&
      new Date(request.pairingExpiresAt).getTime() <= Date.now()
    ) {
      setError(
        "この連携コードは期限切れです。管制アプリで新しいコードを発行してください。"
      );
      return;
    }

    setBusy(true);
    setError("");

    try {
      await approveDeviceAccessRequest(request.uid);
      setLinkCode("");
    } catch (approveError) {
      console.error(
        "管制アプリの連携に失敗しました。",
        approveError
      );
      setError(
        approveError instanceof Error
          ? approveError.message
          : "管制アプリを連携できませんでした。"
      );
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <>
      <style>{`
        .control-pairing-bridge{margin:0 18px 16px;padding:14px;border:1px solid #c9d8ef;border-radius:16px;background:#f5f9ff}.control-pairing-bridge-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.control-pairing-bridge-heading strong{font-size:15px}.control-pairing-bridge-heading small{color:#6d7d95;font-size:11px}.control-pairing-bridge-form{display:flex;gap:9px}.control-pairing-bridge-form input{min-width:0;flex:1;height:44px;padding:0 13px;border:1px solid #b9c8df;border-radius:11px;background:#fff;font:inherit;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.control-pairing-bridge-form button{min-width:105px;border:0;border-radius:11px;background:#3f6fbd;color:#fff;font:inherit;font-weight:850;cursor:pointer}.control-pairing-bridge-form button:disabled{opacity:.55;cursor:wait}.control-pairing-bridge-error{margin:9px 0 0;color:#b13c3c;font-size:12px;font-weight:750}@media(max-width:760px){.control-pairing-bridge-form{flex-direction:column}.control-pairing-bridge-form button{min-height:44px}}
      `}</style>

      <section className="control-pairing-bridge">
        <div className="control-pairing-bridge-heading">
          <strong>管制アプリを連携</strong>
          <small>管制アプリに表示された8文字を入力</small>
        </div>

        <form
          className="control-pairing-bridge-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <input
            type="text"
            value={linkCode}
            maxLength={9}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCD-EFGH"
            aria-label="管制アプリの連携コード"
            disabled={busy}
            onChange={(event) => {
              setLinkCode(event.target.value.toUpperCase());
              setError("");
            }}
          />

          <button type="submit" disabled={busy}>
            {busy ? "連携中…" : "連携する"}
          </button>
        </form>

        {error !== "" && (
          <p className="control-pairing-bridge-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </>,
    target
  );
}
