import { useEffect, useRef } from "react";
import type { ReceptionMode } from "./types";
import type { ReceptionRemoteCommandType } from "../../src/receptionRemoteControlFirestore";

type ConversationTopic = "device" | "network" | "crowding" | "operations" | null;

type ConversationMemory = {
  mode: ReceptionMode | null;
  modeAt: number;
  command: ReceptionRemoteCommandType | null;
  commandAt: number;
  suggestedCommand: ReceptionRemoteCommandType | null;
  suggestedAt: number;
  topic: ConversationTopic;
  topicAt: number;
};

const MEMORY_TTL_MS = 4 * 60_000;
const SUGGESTION_TTL_MS = 2 * 60_000;

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\u3000。、！？!?「」『』（）()・]/g, "");
}

function explicitMode(text: string): ReceptionMode | null {
  const value = normalize(text);
  if (/(入口|入り口|入場側|入る方|入場端末|入場受付|エントリー側)/.test(value)) return "entry";
  if (/(出口|退場側|出る方|退場端末|退場受付|イグジット側)/.test(value)) return "exit";
  return null;
}

function inferCommand(text: string): ReceptionRemoteCommandType | null {
  const value = normalize(text);
  if (/(確認音|テスト音|チャイム|音|ピッ|サウンド)/.test(value) && /(鳴ら|再生|テスト|確認|出して)/.test(value)) {
    return "play-sound";
  }
  if (/(カメラ|読み取りカメラ)/.test(value) && /(再起動|再始動|リセット|立ち上げ直|やり直|復旧|直して|戻して|起こして)/.test(value)) {
    return "restart-camera";
  }
  if (/(未送信|未同期|同期|溜まって|たまって|送れてない|詰まって|保留データ|残ってるデータ)/.test(value) && /(再同期|同期して|同期かけ|送り直|再送|送って|流して|処理して|やって|片付けて)/.test(value)) {
    return "sync-pending";
  }
  if (/(アプリ|画面|受付アプリ)/.test(value) && /(再読み込み|読み直|リロード|更新して|再起動|立ち上げ直|読み込み直)/.test(value)) {
    return "reload-app";
  }
  const hasTarget = /(受付|入口|入り口|出口|入場側|退場側|入る方|出る方|入場受付|退場受付)/.test(value);
  if (hasTarget && /(一時停止|停止して|止めて|止めよう|休止|ストップ|一旦止め|いったん止め|受付止め)/.test(value)) {
    return "pause-reception";
  }
  if (hasTarget && /(再開|始めて|スタート|動かして|戻して|受付開始|受付戻して)/.test(value)) {
    return "resume-reception";
  }
  return null;
}

function inferTopic(text: string): ConversationTopic {
  const value = normalize(text);
  if (/(入口|出口|端末|カメラ|受付)/.test(value)) return "device";
  if (/(通信|回線|ネット|wifi|wi-fi|firebase|遅延|速度)/.test(value)) return "network";
  if (/(混雑|人数|定員|予測|会場|入場ペース|退場ペース)/.test(value)) return "crowding";
  if (/(優先|対応|対処|何すれば|なにすれば|やるべき)/.test(value)) return "operations";
  return null;
}

function modeLabel(mode: ReceptionMode) {
  return mode === "entry" ? "入口" : "出口";
}

function commandCanonical(command: ReceptionRemoteCommandType) {
  if (command === "play-sound") return "確認音を鳴らして";
  if (command === "restart-camera") return "カメラを再起動して";
  if (command === "sync-pending") return "未送信データを再同期して";
  if (command === "reload-app") return "受付アプリを再読み込みして";
  if (command === "pause-reception") return "受付を一時停止して";
  return "受付を再開して";
}

function recentMode(memory: ConversationMemory, now: number) {
  return memory.mode !== null && now - memory.modeAt <= MEMORY_TTL_MS ? memory.mode : null;
}

function recentSuggestion(memory: ConversationMemory, now: number) {
  return memory.suggestedCommand !== null && now - memory.suggestedAt <= SUGGESTION_TTL_MS
    ? memory.suggestedCommand
    : null;
}

function expireMemory(memory: ConversationMemory, now: number) {
  if (now - memory.modeAt > MEMORY_TTL_MS) memory.mode = null;
  if (now - memory.commandAt > MEMORY_TTL_MS) memory.command = null;
  if (now - memory.suggestedAt > SUGGESTION_TTL_MS) memory.suggestedCommand = null;
  if (now - memory.topicAt > MEMORY_TTL_MS) memory.topic = null;
}

function updateFromText(text: string, memory: ConversationMemory) {
  const now = Date.now();
  const mode = explicitMode(text);
  const command = inferCommand(text);
  const topic = inferTopic(text);
  if (mode !== null) {
    memory.mode = mode;
    memory.modeAt = now;
  }
  if (command !== null) {
    memory.command = command;
    memory.commandAt = now;
  }
  if (topic !== null) {
    memory.topic = topic;
    memory.topicAt = now;
  }
}

function inferSuggestionFromReply(text: string, memory: ConversationMemory) {
  const value = normalize(text);
  const now = Date.now();
  const mode = explicitMode(text);
  if (mode !== null) {
    memory.mode = mode;
    memory.modeAt = now;
  }

  let suggestion: ReceptionRemoteCommandType | null = null;
  if (/カメラ/.test(value) && /(エラー|異常|不調|復旧|再起動)/.test(value) && !/(カメラ.*正常|異常なし)/.test(value)) {
    suggestion = "restart-camera";
  } else if (/(同期待ち|未送信|未同期)/.test(value) && !/(0件|ありません)/.test(value)) {
    suggestion = "sync-pending";
  } else if (/(受付一時停止中|受付が一時停止|停止中のqr)/.test(value)) {
    suggestion = "resume-reception";
  }

  if (suggestion !== null) {
    memory.suggestedCommand = suggestion;
    memory.suggestedAt = now;
  }
}

function resolveFollowUp(question: string, memory: ConversationMemory): string | null {
  const value = normalize(question);
  const now = Date.now();
  expireMemory(memory, now);
  const mode = recentMode(memory, now);
  const suggestion = recentSuggestion(memory, now);

  if (mode !== null && /(じゃあ)?(反対|もう片方|もう一方|逆側)(は|どう|大丈夫|の状態|の通信)?$/.test(value)) {
    const opposite: ReceptionMode = mode === "entry" ? "exit" : "entry";
    return `${modeLabel(opposite)}は大丈夫？`;
  }

  if (mode !== null && /(反対|もう片方|もう一方|逆側).*(通信|回線|ネット|状態)/.test(value)) {
    const opposite: ReceptionMode = mode === "entry" ? "exit" : "entry";
    return `${modeLabel(opposite)}の通信を調べて`;
  }

  if (mode !== null && /(それ|そこ|その端末|今の|さっきの)?(直せる|治せる|復旧できる|対応できる|直せそう)/.test(value)) {
    if (suggestion !== null) return `${modeLabel(mode)}${commandCanonical(suggestion)}`;
    return `${modeLabel(mode)}端末を調べて`;
  }

  if (mode !== null && /(その端末|そっち|そこ|今の端末).*(大丈夫|状態|どう|おかしい)/.test(value)) {
    return `${modeLabel(mode)}は大丈夫？`;
  }

  if (mode !== null && /(その端末|そっち|そこ|今の端末).*(通信|回線|ネット)/.test(value)) {
    return `${modeLabel(mode)}の通信を調べて`;
  }

  const command = inferCommand(question);
  const hasExplicitMode = explicitMode(question) !== null;
  const followUpCommand = /(だけ|それ|そっち|そこ|じゃあ|その|今の|さっきの|お願い|やって)/.test(value);
  if (command !== null && !hasExplicitMode && mode !== null && followUpCommand) {
    return `${modeLabel(mode)}${commandCanonical(command)}`;
  }

  if (mode !== null && memory.topic === "device" && /(じゃあ)?(どうすれば|どうしたら|何すれば|なにすれば|次は)/.test(value)) {
    if (suggestion !== null) return `${modeLabel(mode)}${commandCanonical(suggestion)}`;
    return `${modeLabel(mode)}端末を調べて`;
  }

  return null;
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function resubmit(
  form: HTMLFormElement,
  input: HTMLInputElement,
  canonical: string,
  bypass: WeakSet<HTMLFormElement>
) {
  setControlledInputValue(input, canonical);
  window.requestAnimationFrame(() => {
    setControlledInputValue(input, canonical);
    window.requestAnimationFrame(() => {
      bypass.add(form);
      form.requestSubmit();
    });
  });
}

export default function CopilotConversationMemoryBridge() {
  const bypassRef = useRef(new WeakSet<HTMLFormElement>());
  const memoryRef = useRef<ConversationMemory>({
    mode: null,
    modeAt: 0,
    command: null,
    commandAt: 0,
    suggestedCommand: null,
    suggestedAt: 0,
    topic: null,
    topicAt: 0,
  });

  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.classList.contains("copilot-input")) return;
      const input = form.querySelector<HTMLInputElement>('input[type="text"]');
      if (input === null) return;

      if (bypassRef.current.has(form)) {
        bypassRef.current.delete(form);
        updateFromText(input.value, memoryRef.current);
        return;
      }

      const question = input.value.trim();
      if (question === "") return;
      const canonical = resolveFollowUp(question, memoryRef.current);
      updateFromText(canonical ?? question, memoryRef.current);
      if (canonical === null || normalize(canonical) === normalize(question)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      resubmit(form, input, canonical, bypassRef.current);
    };

    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, []);

  useEffect(() => {
    let lastReply = "";
    let scheduled = false;
    const scan = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        const replies = [...document.querySelectorAll<HTMLElement>(".copilot-messages .copilot-message.copilot:not(.is-thinking) .copilot-bubble")];
        const latest = replies[replies.length - 1];
        const text = latest?.textContent?.trim() ?? "";
        if (text === "" || text === lastReply) return;
        lastReply = text;
        inferSuggestionFromReply(text, memoryRef.current);
      });
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
