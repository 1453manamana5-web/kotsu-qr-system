import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  collection,
  doc,
  onSnapshot,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import {
  saveEventMemberInFirestore,
  type EventMember,
  type MemberStatus,
} from "../../src/memberFirestore";
import { registerEventDataId } from "../../src/firestorePaths";

type CurrentEvent = {
  id: string;
  name: string;
  dataDocumentId: string;
};

type MemberAction = {
  id: string;
  qrNumber: string;
  memberName: string;
  targetStatus: MemberStatus;
};

type MemberMessage = {
  id: string;
  role: "operator" | "copilot";
  text: string;
  evidence: string[];
  action?: MemberAction;
};

type MemberState = {
  eventDataId: string;
  members: EventMember[];
};

type MatchResult = {
  matches: EventMember[];
  score: number;
};

const STATUS_ORDER: MemberStatus[] = ["未入室", "入室中", "退出済み"];

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[０-９]/g, (value) => String.fromCharCode(value.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000。、！？!?「」『』（）()・]/g, "");
}

function isMemberStatus(value: unknown): value is MemberStatus {
  return value === "未入室" || value === "入室中" || value === "退出済み";
}

function readMember(documentId: string, data: DocumentData): EventMember | null {
  if (typeof data.name !== "string" || !isMemberStatus(data.status)) return null;
  return {
    qrNumber: typeof data.qrNumber === "string" ? data.qrNumber : documentId,
    name: data.name,
    status: data.status,
  };
}

function readCurrentEvent(id: string, data: DocumentData): CurrentEvent | null {
  if (typeof data.name !== "string") return null;
  return {
    id,
    name: data.name,
    dataDocumentId:
      typeof data.dataDocumentId === "string" && data.dataDocumentId !== ""
        ? data.dataDocumentId
        : encodeURIComponent(data.name.trim() || "event-not-set"),
  };
}

function aliasesForMember(member: EventMember) {
  const raw = member.name.trim();
  if (raw === "") return [];

  const compact = normalize(raw);
  const parts = raw
    .split(/[\s\u3000]+/)
    .map((part) => normalize(part))
    .filter((part) => part.length >= 2);

  const aliases = new Set<string>([compact, ...parts]);
  if (parts.length === 0 && compact.length >= 4) {
    aliases.add(compact.slice(0, 2));
  }

  return [...aliases].filter((alias) => alias.length >= 2);
}

function qrMatches(value: string, member: EventMember) {
  const normalized = normalize(value);
  const exact = normalized.match(/st0*(\d{1,8})/i);
  const memberNumber = member.qrNumber.match(/^ST0*(\d+)$/i);
  if (exact === null || memberNumber === null) return false;
  return Number(exact[1]) === Number(memberNumber[1]);
}

function findMembersByText(text: string, members: EventMember[]): MatchResult {
  const value = normalize(text);
  const qrMatchesList = members.filter((member) => qrMatches(value, member));
  if (qrMatchesList.length > 0) return { matches: qrMatchesList, score: 1000 };

  const scored = members.flatMap((member) => {
    const aliases = aliasesForMember(member);
    if (aliases.length === 0) return [];

    const fullName = normalize(member.name);
    let best = -1;
    for (const alias of aliases) {
      if (!value.includes(alias)) continue;
      const isFullName = alias === fullName;
      best = Math.max(best, alias.length + (isFullName ? 100 : 0));
    }

    return best < 0 ? [] : [{ member, score: best }];
  });

  if (scored.length === 0) return { matches: [], score: -1 };
  const bestScore = Math.max(...scored.map((item) => item.score));
  return {
    matches: scored.filter((item) => item.score === bestScore).map((item) => item.member),
    score: bestScore,
  };
}

function inferTargetStatus(question: string): MemberStatus | null {
  const value = normalize(question);
  if (/(未入室|まだ来てない|来てない扱)/.test(value)) return "未入室";
  if (/(入室中|入室させ|中にいる扱|いることに|入れて)/.test(value)) return "入室中";
  if (/(退出済み|退室済み|退出させ|帰ったことに|出たことに)/.test(value)) return "退出済み";
  return null;
}

function requestsStatusChange(question: string) {
  const value = normalize(question);
  return /(にして|へ変更|変更して|変えて|戻して|扱いに|ことにして|させて|入れて)/.test(value);
}

function hasMemberIntent(question: string) {
  const value = normalize(question);
  return /(いる|居る|来てる|来た|帰った|帰って|状態|入室|退出|退室|未入室|部員|メンバー|どこ|st\d)/i.test(value);
}

function statusDescription(status: MemberStatus) {
  if (status === "未入室") return "まだ会場内に入っていない扱い";
  if (status === "入室中") return "現在会場内にいる扱い";
  return "すでに退出した扱い";
}

function buildReply(question: string, members: EventMember[]) {
  const result = findMembersByText(question, members);
  if (result.matches.length === 0) return null;

  if (result.matches.length > 1) {
    return {
      text: "同じ呼び方に一致する部員が複数います。名前をもう少し詳しく指定してください。",
      evidence: result.matches.slice(0, 6).map((member) => `${member.name || "名前未登録"} (${member.qrNumber}) · ${member.status}`),
    };
  }

  const member = result.matches[0];
  const targetStatus = inferTargetStatus(question);
  const wantsChange = requestsStatusChange(question);

  if (wantsChange && targetStatus === null) {
    return {
      text: `${member.name || member.qrNumber}は現在「${member.status}」です。変更先を「未入室・入室中・退出済み」のどれかで指定してください。`,
      evidence: [`QR: ${member.qrNumber}`],
    };
  }

  if (wantsChange && targetStatus !== null) {
    if (member.status === targetStatus) {
      return {
        text: `${member.name || member.qrNumber}はすでに「${targetStatus}」です。変更は必要ありません。`,
        evidence: [`QR: ${member.qrNumber}`],
      };
    }

    return {
      text: `${member.name || member.qrNumber}を「${member.status}」から「${targetStatus}」へ変更する操作を準備しました。`,
      evidence: [`QR: ${member.qrNumber}`, `現在: ${member.status}`, `変更後: ${targetStatus}`],
      action: {
        id: `member-action-${Date.now()}`,
        qrNumber: member.qrNumber,
        memberName: member.name,
        targetStatus,
      } satisfies MemberAction,
    };
  }

  const currentText = member.status === "入室中"
    ? "現在、入室中です。"
    : member.status === "未入室"
      ? "現在は未入室です。"
      : "現在は退出済みです。";

  return {
    text: `${member.name || member.qrNumber}は${currentText}`,
    evidence: [`QR: ${member.qrNumber}`, statusDescription(member.status)],
  };
}

function MemberMessages({
  messages,
  runningActionId,
  onAction,
}: {
  messages: MemberMessage[];
  runningActionId: string | null;
  onAction: (action: MemberAction) => void;
}) {
  return (
    <>
      {messages.map((message) => (
        <article key={message.id} className={`copilot-message ${message.role} member-control-message`}>
          <div className="copilot-avatar" aria-hidden="true">{message.role === "copilot" ? "AI" : "管"}</div>
          <div className="copilot-bubble">
            <small>{message.role === "copilot" ? "MEMBER CONTROL" : "OPERATOR"}</small>
            <p>{message.text}</p>
            {message.evidence.length > 0 && <ul>{message.evidence.map((item) => <li key={item}>{item}</li>)}</ul>}
            {message.action !== undefined && (
              <button
                type="button"
                className="member-ai-action-button"
                disabled={runningActionId !== null}
                onClick={() => onAction(message.action as MemberAction)}
              >
                {runningActionId === message.action.id ? "変更中…" : `${message.action.targetStatus}へ変更`}
              </button>
            )}
          </div>
        </article>
      ))}
    </>
  );
}

function MemberControlPanel({
  members,
  onChangeStatus,
  changing,
}: {
  members: EventMember[];
  onChangeStatus: (member: EventMember, status: MemberStatus) => void;
  changing: boolean;
}) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<EventMember[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedQrNumber, setSelectedQrNumber] = useState<string | null>(null);

  const selectedMember = useMemo(
    () => members.find((member) => member.qrNumber === selectedQrNumber) ?? null,
    [members, selectedQrNumber]
  );

  const search = () => {
    const result = findMembersByText(query, members);
    setMatches(result.matches);
    setSearched(true);
    setSelectedQrNumber(result.matches.length === 1 ? result.matches[0].qrNumber : null);
  };

  return (
    <section className="member-control-panel">
      <div className="member-control-heading">
        <div><small>INDIVIDUAL MEMBER</small><h3>部員名で照会・状態変更</h3></div>
        <span>{members.length}人登録</span>
      </div>
      <div className="member-control-search">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              search();
            }
          }}
          placeholder="例: 山田 / 山田 太郎 / ST0001"
          aria-label="部員名またはQR番号"
        />
        <button type="button" onClick={search}>照会</button>
      </div>

      {searched && matches.length === 0 && <p className="member-control-empty">該当する部員が見つかりません。</p>}
      {matches.length > 1 && (
        <div className="member-candidate-list">
          <p>複数の候補があります。</p>
          {matches.map((member) => (
            <button key={member.qrNumber} type="button" onClick={() => setSelectedQrNumber(member.qrNumber)}>
              <strong>{member.name || "名前未登録"}</strong><span>{member.qrNumber} · {member.status}</span>
            </button>
          ))}
        </div>
      )}

      {selectedMember !== null && (
        <div className="member-control-result">
          <div className="member-control-current">
            <div><small>MEMBER</small><strong>{selectedMember.name || "名前未登録"}</strong><em>{selectedMember.qrNumber}</em></div>
            <span className={`member-status-chip status-${STATUS_ORDER.indexOf(selectedMember.status)}`}>{selectedMember.status}</span>
          </div>
          <p>{statusDescription(selectedMember.status)}</p>
          <div className="member-status-actions">
            {STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                disabled={changing || selectedMember.status === status}
                onClick={() => onChangeStatus(selectedMember, status)}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="member-control-note">AI管制でも「山田くん今いる？」「佐藤を入室中にして」のように名前で操作できます。</p>
    </section>
  );
}

function setControlledInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter !== undefined) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function MemberControlBridge({ database }: { database: Firestore }) {
  const [currentEvent, setCurrentEvent] = useState<CurrentEvent | null>(null);
  const [memberState, setMemberState] = useState<MemberState>({ eventDataId: "", members: [] });
  const [panelTarget, setPanelTarget] = useState<Element | null>(null);
  const [messageTarget, setMessageTarget] = useState<Element | null>(null);
  const [messages, setMessages] = useState<MemberMessage[]>([]);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const eventRef = useRef<CurrentEvent | null>(null);
  const membersRef = useRef<EventMember[]>([]);

  useEffect(() => {
    let unsubscribeEvent: (() => void) | null = null;
    const unsubscribeCurrent = onSnapshot(doc(database, "system", "current-event"), (snapshot) => {
      const eventId = snapshot.exists() && typeof snapshot.data().eventId === "string"
        ? snapshot.data().eventId as string
        : "";
      unsubscribeEvent?.();
      unsubscribeEvent = null;
      eventRef.current = null;
      membersRef.current = [];
      setCurrentEvent(null);
      if (eventId === "") return;

      unsubscribeEvent = onSnapshot(doc(database, "events", eventId), (eventSnapshot) => {
        const next = eventSnapshot.exists() ? readCurrentEvent(eventId, eventSnapshot.data()) : null;
        eventRef.current = next;
        membersRef.current = [];
        setCurrentEvent(next);
        if (next !== null) registerEventDataId(next.name, next.dataDocumentId);
      });
    });

    return () => {
      unsubscribeCurrent();
      unsubscribeEvent?.();
    };
  }, [database]);

  useEffect(() => {
    if (currentEvent === null) return undefined;
    const eventDataId = currentEvent.dataDocumentId;
    return onSnapshot(
      collection(database, "event-data", eventDataId, "members"),
      (snapshot) => {
        const next = snapshot.docs
          .map((item) => readMember(item.id, item.data()))
          .filter((member): member is EventMember => member !== null)
          .sort((a, b) => a.name.localeCompare(b.name, "ja-JP") || a.qrNumber.localeCompare(b.qrNumber, "ja-JP", { numeric: true }));
        membersRef.current = next;
        setMemberState({ eventDataId, members: next });
      }
    );
  }, [currentEvent, database]);

  const members = currentEvent !== null && memberState.eventDataId === currentEvent.dataDocumentId
    ? memberState.members
    : [];

  const appendMessage = useCallback((message: Omit<MemberMessage, "id">) => {
    setMessages((current) => [
      ...current,
      { ...message, id: `member-message-${Date.now()}-${current.length}` },
    ]);
    window.setTimeout(() => {
      document.querySelector(".copilot-messages")?.scrollTo({ top: 999999, behavior: "smooth" });
    }, 0);
  }, []);

  const changeMemberStatus = useCallback(async (
    member: EventMember,
    targetStatus: MemberStatus,
    actionId?: string
  ) => {
    const event = eventRef.current;
    if (event === null) {
      appendMessage({ role: "copilot", text: "現在イベントが設定されていないため変更できません。", evidence: [] });
      return;
    }

    const latest = membersRef.current.find((item) => item.qrNumber === member.qrNumber);
    if (latest === undefined) {
      appendMessage({ role: "copilot", text: "対象の部員が現在イベントで見つかりません。", evidence: [`QR: ${member.qrNumber}`] });
      return;
    }
    if (latest.status === targetStatus) {
      appendMessage({ role: "copilot", text: `${latest.name || latest.qrNumber}はすでに「${targetStatus}」です。`, evidence: [`QR: ${latest.qrNumber}`] });
      return;
    }

    const confirmed = window.confirm(
      `${latest.name || latest.qrNumber} (${latest.qrNumber}) を\n${latest.status} → ${targetStatus}\nへ変更しますか？`
    );
    if (!confirmed) return;

    const effectiveActionId = actionId ?? `member-panel-${Date.now()}`;
    setRunningActionId(effectiveActionId);
    try {
      await saveEventMemberInFirestore(event.name, {
        qrNumber: latest.qrNumber,
        name: latest.name,
        status: targetStatus,
      });
      appendMessage({
        role: "copilot",
        text: `${latest.name || latest.qrNumber}を「${targetStatus}」へ変更しました。`,
        evidence: [`QR: ${latest.qrNumber}`, `変更前: ${latest.status}`, `変更後: ${targetStatus}`],
      });
    } catch (error) {
      console.error("部員状態の変更に失敗しました。", error);
      appendMessage({
        role: "copilot",
        text: `${latest.name || latest.qrNumber}の状態を変更できませんでした。通信状態を確認してください。`,
        evidence: [`QR: ${latest.qrNumber}`],
      });
    } finally {
      setRunningActionId(null);
    }
  }, [appendMessage]);

  const runAction = useCallback((action: MemberAction) => {
    const member = membersRef.current.find((item) => item.qrNumber === action.qrNumber);
    if (member === undefined) {
      appendMessage({ role: "copilot", text: "操作対象の部員が見つかりません。", evidence: [`QR: ${action.qrNumber}`] });
      return;
    }
    void changeMemberStatus(member, action.targetStatus, action.id);
  }, [appendMessage, changeMemberStatus]);

  useEffect(() => {
    const handleSubmit = (event: Event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.classList.contains("copilot-input")) return;
      const input = form.querySelector<HTMLInputElement>('input[type="text"]');
      const question = input?.value.trim() ?? "";
      if (question === "") return;

      const currentMembers = membersRef.current;
      const result = findMembersByText(question, currentMembers);
      if (result.matches.length === 0) return;
      if (!hasMemberIntent(question) && result.score < 100) return;

      const reply = buildReply(question, currentMembers);
      if (reply === null) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (input !== null) setControlledInputValue(input, "");

      appendMessage({ role: "operator", text: question, evidence: [] });
      window.setTimeout(() => {
        appendMessage({
          role: "copilot",
          text: reply.text,
          evidence: reply.evidence,
          action: reply.action,
        });
      }, 180);
    };

    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, [appendMessage]);

  useEffect(() => {
    const updateTargets = () => {
      setPanelTarget((current) => {
        const next = document.querySelector(".admin-ops-panel");
        return current === next ? current : next;
      });
      setMessageTarget((current) => {
        const next = document.querySelector(".copilot-messages");
        return current === next ? current : next;
      });
    };

    const initial = window.setTimeout(updateTargets, 0);
    const observer = new MutationObserver(updateTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(initial);
      observer.disconnect();
    };
  }, []);

  return (
    <>
      {panelTarget !== null && createPortal(
        <MemberControlPanel
          members={members}
          changing={runningActionId !== null}
          onChangeStatus={(member, status) => void changeMemberStatus(member, status)}
        />,
        panelTarget
      )}
      {messageTarget !== null && createPortal(
        <MemberMessages messages={messages} runningActionId={runningActionId} onAction={runAction} />,
        messageTarget
      )}
    </>
  );
}
