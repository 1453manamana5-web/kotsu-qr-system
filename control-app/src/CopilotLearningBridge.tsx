import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type LearnedMapping = {
  id: string;
  example: string;
  normalizedExample: string;
  canonical: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  uses: number;
};

type TeachingState = {
  question: string;
  token: string;
};

type LearningFeedback = {
  mappingId: string;
  question: string;
  label: string;
};

type TeachOption = {
  label: string;
  canonical: string;
  description: string;
};

const STORAGE_KEY = "qr-control-copilot-learned-language-v1";
const MAX_MAPPINGS = 80;
const FALLBACK_MARKER = "その質問はまだ学習していません";

const TEACH_OPTIONS: readonly TeachOption[] = [
  { label: "全体の状況", canonical: "今どうなってる？", description: "会場・端末・異常をまとめて確認" },
  { label: "入口端末の状態", canonical: "入口は大丈夫？", description: "入口受付端末の状態確認" },
  { label: "出口端末の状態", canonical: "出口は大丈夫？", description: "出口受付端末の状態確認" },
  { label: "通信状態", canonical: "通信は大丈夫？", description: "回線・Firebase応答を確認" },
  { label: "混雑・人数予測", canonical: "このあと混む？", description: "現在人数と短期予測を確認" },
  { label: "優先対応", canonical: "今なにすればいい？", description: "今見るべき項目の優先順位" },
  { label: "対応方法", canonical: "どう対応すればいい？", description: "異常時の対応順を確認" },
  { label: "時間変化", canonical: "さっきより変わった？", description: "直近とその前の状態を比較" },
  { label: "来場者数", canonical: "今日の来場者何人？", description: "本日の来場者累計" },
  { label: "分析まとめ", canonical: "分析して", description: "現在の主要な分析値を確認" },
] as const;

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s\u3000。、！？!?「」『』（）()・:：,，.．\-ー]/g, "");
}

function bigrams(value: string) {
  const result = new Set<string>();
  if (value.length < 2) return result;
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function similarity(first: string, second: string) {
  if (first === second) return 1;
  if (first.length < 4 || second.length < 4) return 0;

  const shorter = first.length <= second.length ? first : second;
  const longer = first.length > second.length ? first : second;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.68) return 0.9;

  const a = bigrams(first);
  const b = bigrams(second);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const gram of a) if (b.has(gram)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function readMappings(): LearnedMapping[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is LearnedMapping => (
        typeof item === "object" &&
        item !== null &&
        typeof (item as LearnedMapping).id === "string" &&
        typeof (item as LearnedMapping).example === "string" &&
        typeof (item as LearnedMapping).normalizedExample === "string" &&
        typeof (item as LearnedMapping).canonical === "string" &&
        typeof (item as LearnedMapping).label === "string"
      ))
      .slice(0, MAX_MAPPINGS);
  } catch {
    return [];
  }
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function resubmitCanonical(
  canonical: string,
  bypass: WeakSet<HTMLFormElement>
) {
  const form = document.querySelector<HTMLFormElement>(".copilot-page .copilot-input");
  const input = form?.querySelector<HTMLInputElement>('input[type="text"]');
  if (form === null || input == null) return;

  setControlledInputValue(input, canonical);
  window.requestAnimationFrame(() => {
    setControlledInputValue(input, canonical);
    bypass.add(form);
    form.requestSubmit();
  });
}

function findLearnedMapping(question: string, mappings: LearnedMapping[]) {
  const normalized = normalize(question);
  if (normalized === "") return null;

  const ranked = mappings
    .map((mapping) => ({ mapping, score: similarity(normalized, mapping.normalizedExample) }))
    .sort((first, second) => second.score - first.score);

  const best = ranked[0];
  if (best === undefined) return null;
  if (best.score === 1) return best.mapping;

  const secondScore = ranked[1]?.score ?? 0;
  if (best.score >= 0.82) return best.mapping;
  if (best.score >= 0.74 && best.score - secondScore >= 0.1) return best.mapping;
  return null;
}

export default function CopilotLearningBridge() {
  const [mappings, setMappings] = useState<LearnedMapping[]>(() => readMappings());
  const [messageTarget, setMessageTarget] = useState<Element | null>(null);
  const [promptTarget, setPromptTarget] = useState<Element | null>(null);
  const [teaching, setTeaching] = useState<TeachingState | null>(null);
  const [feedback, setFeedback] = useState<LearningFeedback | null>(null);
  const mappingsRef = useRef(mappings);
  const bypassRef = useRef(new WeakSet<HTMLFormElement>());
  const lastQuestionRef = useRef("");
  const handledFallbacksRef = useRef(new WeakSet<Element>());

  useEffect(() => {
    mappingsRef.current = mappings;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mappings.slice(0, MAX_MAPPINGS)));
    } catch {
      // Learning is optional; the rest of AI control keeps working without local storage.
    }
  }, [mappings]);

  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.classList.contains("copilot-input")) return;
      const input = form.querySelector<HTMLInputElement>('input[type="text"]');
      if (input === null) return;

      if (bypassRef.current.has(form)) {
        bypassRef.current.delete(form);
        return;
      }

      const question = input.value.trim();
      if (question === "") return;
      lastQuestionRef.current = question;

      const learned = findLearnedMapping(question, mappingsRef.current);
      if (learned === null) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const usedAt = Date.now();
      setMappings((current) => current.map((item) => item.id === learned.id
        ? { ...item, lastUsedAt: usedAt, uses: item.uses + 1 }
        : item));
      setTeaching(null);
      setFeedback(null);
      resubmitCanonical(learned.canonical, bypassRef.current);
    };

    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, []);

  useEffect(() => {
    let scheduled = false;
    const scan = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        const nextMessages = document.querySelector(".copilot-page .copilot-messages");
        const nextPrompts = document.querySelector(".copilot-page .copilot-quick-prompts");
        setMessageTarget((current) => current === nextMessages ? current : nextMessages);
        setPromptTarget((current) => current === nextPrompts ? current : nextPrompts);

        const replies = [...document.querySelectorAll<HTMLElement>(
          ".copilot-page .copilot-message.copilot:not(.is-thinking) .copilot-bubble"
        )];
        const latest = replies[replies.length - 1];
        if (latest === undefined || handledFallbacksRef.current.has(latest)) return;
        const text = latest.textContent?.trim() ?? "";
        if (!text.includes(FALLBACK_MARKER)) return;

        handledFallbacksRef.current.add(latest);
        const question = lastQuestionRef.current.trim();
        if (question === "") return;
        setFeedback(null);
        setTeaching({ question, token: `${Date.now()}-${question}` });
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  const learnedCount = mappings.length;
  const frequentlyUsed = useMemo(
    () => [...mappings].sort((first, second) => second.uses - first.uses)[0] ?? null,
    [mappings]
  );

  const teach = (option: TeachOption) => {
    if (teaching === null) return;
    const normalizedExample = normalize(teaching.question);
    const now = Date.now();
    const existing = mappingsRef.current.find((item) => item.normalizedExample === normalizedExample);
    const mappingId = existing?.id ?? `learned-${now}-${Math.random().toString(36).slice(2, 8)}`;

    setMappings((current) => {
      const withoutSame = current.filter((item) => item.normalizedExample !== normalizedExample);
      return [
        {
          id: mappingId,
          example: teaching.question,
          normalizedExample,
          canonical: option.canonical,
          label: option.label,
          createdAt: existing?.createdAt ?? now,
          lastUsedAt: now,
          uses: existing?.uses ?? 0,
        },
        ...withoutSame,
      ].slice(0, MAX_MAPPINGS);
    });

    setFeedback({ mappingId, question: teaching.question, label: option.label });
    setTeaching(null);
    resubmitCanonical(option.canonical, bypassRef.current);
  };

  const undoFeedback = () => {
    if (feedback === null) return;
    setMappings((current) => current.filter((item) => item.id !== feedback.mappingId));
    setFeedback(null);
  };

  const learningStatus = promptTarget === null ? null : createPortal(
    <div className="copilot-learning-status" title={frequentlyUsed === null ? "まだ学習データはありません" : `よく使う学習: ${frequentlyUsed.label}`}>
      <span aria-hidden="true">学</span>
      <strong>会話学習</strong>
      <small>{learnedCount === 0 ? "未学習" : `${learnedCount}件`}</small>
    </div>,
    promptTarget
  );

  const teachingPanel = messageTarget === null || (teaching === null && feedback === null) ? null : createPortal(
    <div className="copilot-learning-region" aria-live="polite">
      {teaching !== null && (
        <section className="copilot-teaching-card" key={teaching.token}>
          <div className="copilot-teaching-heading">
            <span aria-hidden="true">学</span>
            <div>
              <small>会話学習</small>
              <strong>この質問の意味を教えてください</strong>
              <p>「{teaching.question}」</p>
            </div>
          </div>
          <p className="copilot-teaching-note">選んだ意味だけを記憶します。AIの安全確認や遠隔操作ルールは変更しません。</p>
          <div className="copilot-teaching-options">
            {TEACH_OPTIONS.map((option) => (
              <button type="button" key={option.canonical} onClick={() => teach(option)}>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </button>
            ))}
          </div>
          <button type="button" className="copilot-teaching-skip" onClick={() => setTeaching(null)}>
            今回は学習しない
          </button>
        </section>
      )}

      {feedback !== null && (
        <section className="copilot-learning-complete">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>「{feedback.label}」として学習しました</strong>
            <p>次から「{feedback.question}」や十分近い言い方を、この意味として扱います。</p>
          </div>
          <button type="button" onClick={undoFeedback}>取り消す</button>
        </section>
      )}
    </div>,
    messageTarget
  );

  return (
    <>
      {learningStatus}
      {teachingPanel}
    </>
  );
}
