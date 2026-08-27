import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

function assistIsEnabled() {
  return document.querySelector<HTMLButtonElement>(".control-assist-toggle")?.getAttribute("aria-pressed") === "true";
}

export default function ControlAssistHelpBridge() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const copy = target.closest(".control-assist-toggle-copy");
      if (copy === null) return;

      const toggle = copy.closest<HTMLButtonElement>(".control-assist-toggle");
      if (toggle === null) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setEnabled(toggle.getAttribute("aria-pressed") === "true");
      setOpen(true);
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="control-assist-help-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <section
        className="control-assist-help-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="control-assist-help-title"
      >
        <div className="control-assist-help-head">
          <div>
            <small>CONTROL ASSIST</small>
            <h2 id="control-assist-help-title">管制アシストとは？</h2>
          </div>
          <button type="button" aria-label="説明を閉じる" onClick={() => setOpen(false)}>×</button>
        </div>

        <div className={`control-assist-help-status${enabled ? " enabled" : ""}`}>
          <span aria-hidden="true" />
          <div>
            <small>現在の状態</small>
            <strong>{enabled ? "ON · 提案通知を受け取ります" : "OFF · 提案通知は停止中です"}</strong>
          </div>
        </div>

        <p className="control-assist-help-lead">
          管制ラボの判断を通常画面まで届けるための通知アシストです。入口・出口端末の状態を見て、確認した方がよいことがある時だけ提案を表示します。
        </p>

        <div className="control-assist-help-grid">
          <article>
            <span aria-hidden="true">監</span>
            <div><strong>何を見る？</strong><p>通信、Firebase応答、同期待ち、カメラ、入口・出口の同時悪化を確認します。</p></div>
          </article>
          <article>
            <span aria-hidden="true">提</span>
            <div><strong>何をしてくれる？</strong><p>「共通Wi-Fiを先に確認」「この端末だけ再同期」など、次に確認する内容を通知します。</p></div>
          </article>
          <article>
            <span aria-hidden="true">安</span>
            <div><strong>勝手に操作する？</strong><p>しません。管制アシストは判断支援と通知だけです。自動操作は管制ラボの自動運転とは別です。</p></div>
          </article>
          <article>
            <span aria-hidden="true">抑</span>
            <div><strong>通知が多すぎない？</strong><p>同じ内容は一定時間抑制し、悪化や別の原因へ変わった時に改めて知らせます。</p></div>
          </article>
        </div>

        <div className="control-assist-help-note">
          <strong>切り替え方</strong>
          <p>上部のスイッチ部分を押すとON/OFFを切り替えます。「管制アシスト」の文字部分を押すと、この説明を開きます。</p>
        </div>

        <div className="control-assist-help-actions">
          <button type="button" className="primary" onClick={() => setOpen(false)}>わかった</button>
        </div>
      </section>

      <style>{`
        .control-assist-toggle-copy{cursor:help}.control-assist-help-backdrop{position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;padding:18px;background:rgba(16,28,48,.36);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}.control-assist-help-dialog{width:min(560px,calc(100vw - 28px));max-height:min(84dvh,760px);overflow:auto;box-sizing:border-box;padding:21px;border:1px solid rgba(255,255,255,.9);border-radius:22px;background:#fff;color:#24344d;box-shadow:0 28px 90px rgba(20,34,58,.32)}.control-assist-help-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.control-assist-help-head small{color:#61718a;font-size:9px;font-weight:950;letter-spacing:.13em}.control-assist-help-head h2{margin:4px 0 0;font-size:23px;line-height:1.25}.control-assist-help-head>button{display:grid;width:32px;height:32px;place-items:center;flex:0 0 auto;padding:0;border:0;border-radius:50%;background:#f1f4f8;color:#7b8799;font:inherit;font-size:20px;cursor:pointer}.control-assist-help-status{display:flex;align-items:center;gap:10px;margin-top:16px;padding:11px 12px;border:1px solid #dde4ee;border-radius:13px;background:#f7f9fc}.control-assist-help-status>span{width:10px;height:10px;border-radius:999px;background:#94a3b8;box-shadow:0 0 0 5px rgba(148,163,184,.14)}.control-assist-help-status.enabled{border-color:#cde2d5;background:#f2faf5}.control-assist-help-status.enabled>span{background:#35a66d;box-shadow:0 0 0 5px rgba(53,166,109,.14)}.control-assist-help-status small{display:block;color:#7a8799;font-size:9px;font-weight:850}.control-assist-help-status strong{display:block;margin-top:2px;font-size:12px}.control-assist-help-lead{margin:15px 1px 0;color:#607087;font-size:13px;line-height:1.7}.control-assist-help-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}.control-assist-help-grid article{display:flex;gap:10px;padding:12px;border:1px solid #e1e7ef;border-radius:14px;background:#fbfcfe}.control-assist-help-grid article>span{display:grid;width:31px;height:31px;place-items:center;flex:0 0 auto;border-radius:10px;background:#edf2f8;color:#536a8b;font-size:11px;font-weight:950}.control-assist-help-grid strong{display:block;font-size:12px}.control-assist-help-grid p{margin:4px 0 0;color:#748196;font-size:10px;line-height:1.55}.control-assist-help-note{margin-top:13px;padding:11px 12px;border-left:4px solid #5b78b8;border-radius:11px;background:#f3f6fb}.control-assist-help-note strong{font-size:11px}.control-assist-help-note p{margin:4px 0 0;color:#64748b;font-size:10px;line-height:1.55}.control-assist-help-actions{display:flex;justify-content:flex-end;margin-top:16px}.control-assist-help-actions button{min-height:40px;padding:8px 16px;border:1px solid #d5dce7;border-radius:11px;background:#f6f8fb;color:#526177;font:inherit;font-size:11px;font-weight:900;cursor:pointer}.control-assist-help-actions button.primary{border-color:#536fb0;background:#536fb0;color:#fff}@media(max-width:620px){.control-assist-help-dialog{padding:17px}.control-assist-help-grid{grid-template-columns:1fr}.control-assist-help-head h2{font-size:21px}}
      `}</style>
    </div>,
    document.body
  );
}
