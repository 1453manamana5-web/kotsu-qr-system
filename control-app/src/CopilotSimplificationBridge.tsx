import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const SIMPLE_PROMPTS = [
  "30秒ブリーフ",
  "今なにすればいい？",
  "このあと混む？",
  "入口と出口どっちが悪い？",
  "どう対応すればいい？",
  "今どうなってる？",
] as const;

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function submitPrompt(prompt: string) {
  const form = document.querySelector<HTMLFormElement>(".copilot-page .copilot-input");
  const input = form?.querySelector<HTMLInputElement>('input[type="text"]');
  if (form === null || input == null) return;

  setControlledInputValue(input, prompt);
  window.requestAnimationFrame(() => form.requestSubmit());
}

function syncSimpleCopy() {
  const page = document.querySelector(".copilot-page");
  if (!(page instanceof HTMLElement)) return;

  const heading = page.querySelector(".copilot-page-heading");
  const eyebrow = heading?.querySelector("small");
  const title = heading?.querySelector("h2");
  const badge = heading?.querySelector("span");

  if (eyebrow !== null && eyebrow !== undefined && eyebrow.textContent !== "CONTROL AI") {
    eyebrow.textContent = "CONTROL AI";
  }
  if (title !== null && title !== undefined && title.textContent !== "AI管制") {
    title.textContent = "AI管制";
  }
  if (badge !== null && badge !== undefined && badge.textContent !== "状況確認・操作支援") {
    badge.textContent = "状況確認・操作支援";
  }

  const status = page.querySelector(".copilot-status-strip");
  const decision = status?.querySelector("dl > div:last-child dd")?.textContent?.trim() ?? "";
  const statusTitle = status?.querySelector("div:nth-child(2) > strong");
  const nextStatus = decision.includes("要確認")
    ? "要確認"
    : decision.includes("注意")
      ? "注意項目あり"
      : decision.includes("正常")
        ? "現在は正常"
        : "状況を確認中";

  if (statusTitle !== null && statusTitle !== undefined && statusTitle.textContent !== nextStatus) {
    statusTitle.textContent = nextStatus;
  }

  const input = page.querySelector<HTMLInputElement>(".copilot-input input");
  if (input !== null && input.placeholder !== "気になることをそのまま入力") {
    input.placeholder = "気になることをそのまま入力";
  }

  const submit = page.querySelector<HTMLButtonElement>('.copilot-input button[type="submit"]');
  if (submit !== null && submit.textContent !== "送信") {
    submit.textContent = "送信";
  }
}

function SimplePrompts() {
  return (
    <div className="copilot-simple-prompts" aria-label="よく使う質問">
      {SIMPLE_PROMPTS.map((prompt) => (
        <button type="button" key={prompt} onClick={() => submitPrompt(prompt)}>
          {prompt}
        </button>
      ))}
    </div>
  );
}

export default function CopilotSimplificationBridge() {
  const [promptTarget, setPromptTarget] = useState<Element | null>(null);

  useEffect(() => {
    let scheduled = false;
    const refresh = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        const next = document.querySelector(".copilot-page .copilot-quick-prompts");
        setPromptTarget((current) => current === next ? current : next);
        syncSimpleCopy();
      });
    };

    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, []);

  return promptTarget === null ? null : createPortal(<SimplePrompts />, promptTarget);
}
