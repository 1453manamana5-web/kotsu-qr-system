import { useEffect, useRef } from "react";
import type { ReceptionMode } from "./types";
import type { ReceptionRemoteCommandType } from "../../src/receptionRemoteControlFirestore";

type Destination =
  | "overview"
  | "analysis"
  | "devices"
  | "incidents"
  | "diagnostics"
  | "lab"
  | "copilot";

type ConversationContext = {
  mode: ReceptionMode | null;
  command: ReceptionRemoteCommandType | null;
  destination: Destination | null;
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[\s\u3000。、！？!?「」『』（）()・]/g, "");
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function explicitMode(question: string): ReceptionMode | null {
  const value = normalize(question);
  if (/(入口|入り口|入場側|入る方|入場端末|入場受付)/.test(value)) return "entry";
  if (/(出口|退場側|出る方|退場端末|退場受付)/.test(value)) return "exit";
  return null;
}

function requestsBoth(question: string) {
  return /(両方|2台|二台|両端末|両受付|全端末|全部の端末|まとめて|一斉)/.test(
    normalize(question)
  );
}

function targetLabel(mode: ReceptionMode | null, both: boolean) {
  if (both) return "両方";
  if (mode === "entry") return "入口";
  if (mode === "exit") return "出口";
  return "";
}

function inferRemoteCommand(question: string): ReceptionRemoteCommandType | null {
  const value = normalize(question);

  if (
    /(確認音|テスト音|チャイム|音|ピッ)/.test(value) &&
    /(鳴ら|再生|テスト|確認)/.test(value)
  ) return "play-sound";

  if (
    /カメラ/.test(value) &&
    /(再起動|再始動|リセット|立ち上げ直|やり直|復旧して|直して|戻して)/.test(value)
  ) return "restart-camera";

  if (
    /(未送信|未同期|同期|溜まって|たまって|送れてない|詰まって)/.test(value) &&
    /(再同期|同期して|同期かけ|送り直|再送|送って|流して|処理して|やって)/.test(value)
  ) return "sync-pending";

  if (
    /(アプリ|画面|受付アプリ)/.test(value) &&
    /(再読み込み|読み直|リロード|更新して|再起動|立ち上げ直)/.test(value)
  ) return "reload-app";

  const hasReceptionTarget =
    /(受付|入口|入り口|出口|入場側|退場側|入る方|出る方)/.test(value);

  if (
    hasReceptionTarget &&
    /(一時停止|停止して|止めて|止めよう|休止|ストップ|一旦止め|いったん止め)/.test(value)
  ) return "pause-reception";

  if (
    hasReceptionTarget &&
    /(再開|始めて|スタート|動かして|戻して|受付開始)/.test(value)
  ) return "resume-reception";

  return null;
}

function commandCanonical(command: ReceptionRemoteCommandType) {
  if (command === "play-sound") return "確認音を鳴らして";
  if (command === "restart-camera") return "カメラを再起動して";
  if (command === "sync-pending") return "未送信データを再同期して";
  if (command === "reload-app") return "受付アプリを再読み込みして";
  if (command === "pause-reception") return "受付を一時停止して";
  return "受付を再開して";
}

function canonicalRemote(
  question: string,
  context: ConversationContext
): string | null {
  const value = normalize(question);
  let command = inferRemoteCommand(question);
  let mode = explicitMode(question);
  let both = requestsBoth(question);

  const repeatsLast = /(それやって|じゃあやって|それで|お願い|実行して|もう一回|もう一度|同じの|さっきのもう一回)/.test(value);
  const requestsOther = /(もう片方|反対側|反対も|そっちも|もう一方)/.test(value);
  const requestsBothFollowUp = /(両方やって|両方も|2台とも|二台とも|全部やって)/.test(value);

  if (command === null && (repeatsLast || requestsOther || requestsBothFollowUp)) {
    command = context.command;
  }
  if (command === null) return null;

  if (requestsBothFollowUp) both = true;

  if (requestsOther && context.mode !== null) {
    mode = context.mode === "entry" ? "exit" : "entry";
  } else if (mode === null && !both && repeatsLast) {
    mode = context.mode;
  }

  if (mode === null && !both) return null;
  const target = targetLabel(mode, both);
  return `${target}${commandCanonical(command)}`;
}

function navigationCanonical(question: string): string | null {
  const value = normalize(question);
  const openVerb = /(開いて|開けて|見せて|表示|出して|移動|行って|飛んで|見たい|画面)/.test(value);
  if (!openVerb) return null;

  if (/(回線|ネットワーク|ネット|通信|接続).*(診断|チェック|状態|画面)|診断.*(回線|ネット|通信)/.test(value)) {
    return "通信診断開いて";
  }
  if (/(アラート|警告|障害|エラー).*(一覧|履歴|ログ|画面|見せ)|障害ログ/.test(value)) {
    return "障害履歴開いて";
  }
  if (/(機器|デバイス|受付機|受付端末|端末一覧)/.test(value)) {
    const mode = explicitMode(question);
    return `${mode === "entry" ? "入口" : mode === "exit" ? "出口" : ""}端末開いて`;
  }
  if (/(aiラボ|実験画面|実験機能|試験機能|予兆レーダー)/.test(value)) {
    return "管制ラボ開いて";
  }
  if (/(ai管制|コパイロット|ai画面)/.test(value)) {
    return "AI管制開いて";
  }
  if (/(グラフ|統計|集計|分析画面|データ画面)/.test(value)) {
    return "分析開いて";
  }
  if (/(メイン|トップ|ダッシュボード|ホーム|全体画面|運行画面)/.test(value)) {
    return "ライブ運行開いて";
  }
  return null;
}

function diagnosticCanonical(question: string): string | null {
  const value = normalize(question);
  if (
    /(ヘルスチェック|システムチェック|全体チェック|全部チェック|疎通確認|疎通チェック|接続確認|接続チェック|回線チェック|通信チェック|ネットワークチェック|ネットチェック|動作確認)/.test(value) &&
    /(して|やって|お願い|実行|確認|チェック)/.test(value)
  ) return "全部診断して";

  if (/(診断|チェック).*(やり直|もう一回|もう一度|再度|再実行)/.test(value)) {
    return "再診断して";
  }
  return null;
}

function analysisCanonical(question: string): string | null {
  const value = normalize(question);

  if (/(今日|本日).*(何人|人数|客)|客.*(何人|人数)|累計.*(何人|人数)|何人.*(来た|来てる)/.test(value)) {
    return "今日の来場者何人？";
  }
  if (/(今|現在).*(中|会場|室内).*(何人|人数)|会場内.*(何人|人数)|中に何人|今何人いる/.test(value)) {
    return "分析して";
  }
  if (/(一番|もっとも|最も).*(混ん|多かった|多い).*(時間|時|いつ)|混雑ピーク|ピークいつ|混んだのいつ/.test(value)) {
    return "ピーク何時台？";
  }
  if (/(戻ってきた|戻って来た|入り直|再び入|再度入).*(何人|何回|どれくらい)|再入場.*(数|何回|どれくらい)/.test(value)) {
    return "再入場何回？";
  }
  if (/(平均|だいたい).*(どれくらい|何分).*(いる|滞在)|回転.*(時間|どれくらい)|滞在.*(平均|何分|どれくらい)/.test(value)) {
    return "平均滞在時間は？";
  }
  if (/(最近|直近|さっき).*(入場|退場|出入り|流れ|ペース|人の動き)|入場.*(勢い|ペース)|退場.*(勢い|ペース)/.test(value)) {
    const minutes = value.match(/(\d{1,2})分/)?.[1] ?? "5";
    return `直近${minutes}分の入場ペースは？`;
  }
  if (/(チケット).*(何枚|枚数|登録数|どれくらい)/.test(value)) {
    return "チケット何枚？";
  }
  if (/(ざっくり|まとめて|全体).*(人数|状況|分析|データ)|今日どうだった|今の数字/.test(value)) {
    return "分析して";
  }

  const hours = [...value.matchAll(/(\d{1,2})時/g)].map((match) => match[1]);
  if (hours.length >= 2 && /(比べ|比較|どっち|多い|差)/.test(value)) {
    return `${hours[0]}時台と${hours[1]}時台を比較して`;
  }
  return null;
}

function predictiveCanonical(question: string): string | null {
  const value = normalize(question);

  if (/(どっち|どれ|一番).*(やば|危な|怪し|悪い)|やばい端末どれ|危ない端末どれ/.test(value)) {
    return "今一番危ない端末は？";
  }
  if (/(やばいの|怪しいの|変なの|落ちそう|不安な端末|危なそう).*(ある|いる|ない)?$/.test(value)) {
    return "異常の前兆はある？";
  }
  if (/(wifi|wi-fi|回線|ネット|firebase).*(せい|原因|っぽい|かな)|共通障害|共通っぽい|両方おかしい/.test(value)) {
    return "原因はネットワーク全体？";
  }
  if (/(前と同じ|前回と同じ|前にもあった|昔もあった|見覚え|再発っぽい|また同じ)/.test(value)) {
    return "前回と似てる？";
  }
  return null;
}

function destinationFromCanonical(question: string): Destination | null {
  const value = normalize(question);
  if (value.includes("通信診断")) return "diagnostics";
  if (value.includes("障害履歴")) return "incidents";
  if (value.includes("管制ラボ")) return "lab";
  if (value.includes("ai管制")) return "copilot";
  if (value.includes("分析") && /(開いて|表示|見せて)/.test(value)) return "analysis";
  if (value.includes("端末") && /(開いて|表示|見せて)/.test(value)) return "devices";
  if (value.includes("ライブ運行")) return "overview";
  return null;
}

function updateContext(
  question: string,
  context: ConversationContext
) {
  const mode = explicitMode(question);
  const command = inferRemoteCommand(question);
  const destination = destinationFromCanonical(question);
  if (mode !== null) context.mode = mode;
  if (command !== null) context.command = command;
  if (destination !== null) context.destination = destination;
}

function canonicalize(
  question: string,
  context: ConversationContext
): string | null {
  const value = normalize(question);

  const remote = canonicalRemote(question, context);
  if (remote !== null && normalize(remote) !== value) return remote;

  const navigation = navigationCanonical(question);
  if (navigation !== null && normalize(navigation) !== value) return navigation;

  const diagnostic = diagnosticCanonical(question);
  if (diagnostic !== null && normalize(diagnostic) !== value) return diagnostic;

  const analysis = analysisCanonical(question);
  if (analysis !== null && normalize(analysis) !== value) return analysis;

  const predictive = predictiveCanonical(question);
  if (predictive !== null && normalize(predictive) !== value) return predictive;

  if (/(そこ開いて|その画面|さっきの画面|そっち開いて)/.test(value) && context.destination !== null) {
    const labels: Record<Destination, string> = {
      overview: "ライブ運行",
      analysis: "分析",
      devices: "端末",
      incidents: "障害履歴",
      diagnostics: "通信診断",
      lab: "管制ラボ",
      copilot: "AI管制",
    };
    return `${labels[context.destination]}開いて`;
  }

  return null;
}

export default function CopilotLanguageExpansionBridge() {
  const bypassFormsRef = useRef(new WeakSet<HTMLFormElement>());
  const contextRef = useRef<ConversationContext>({
    mode: null,
    command: null,
    destination: null,
  });

  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.classList.contains("copilot-input")) return;

      if (bypassFormsRef.current.has(form)) {
        bypassFormsRef.current.delete(form);
        const input = form.querySelector<HTMLInputElement>('input[type="text"]');
        if (input !== null) updateContext(input.value, contextRef.current);
        return;
      }

      const input = form.querySelector<HTMLInputElement>('input[type="text"]');
      const question = input?.value.trim() ?? "";
      if (question === "") return;

      const canonical = canonicalize(question, contextRef.current);
      updateContext(canonical ?? question, contextRef.current);
      if (canonical === null) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (input === null) return;

      setControlledInputValue(input, canonical);
      bypassFormsRef.current.add(form);
      window.setTimeout(() => form.requestSubmit(), 0);
    };

    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, []);

  return null;
}
