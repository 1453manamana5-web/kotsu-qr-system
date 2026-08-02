import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  QRCodeSVG,
} from "qrcode.react";

import OnlineStatus from "./OnlineStatus";
import TicketDesigner from "./TicketDesigner";

import {
  createTicketsInFirestore,
  deleteTicketFromFirestore,
  subscribeToTickets,
  updateTicketStatusInFirestore,
  type Ticket,
  type TicketStatus,
} from "../ticketFirestore";

import "./TicketsPage.css";

type TicketsPageProps = {
  setPage: (
    page: string
  ) => void;

  eventName: string;
};

const MAX_CREATE_COUNT =
  1000;

function createSafeRandomId() {
  try {
    if (
      typeof globalThis.crypto !==
        "undefined" &&
      typeof globalThis.crypto
        .randomUUID ===
        "function"
    ) {
      return globalThis.crypto
        .randomUUID();
    }
  } catch (error) {
    console.warn(
      "randomUUIDを使用できませんでした。",
      error
    );
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function createRandomToken() {
  return createSafeRandomId();
}

function createTicketQrValue(
  ticket: Ticket
) {
  return [
    "QRM1",
    "TICKET",
    ticket.qrNumber,
    ticket.authToken,
  ].join(":");
}

function TicketIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M9 19C13 19 16 16 16 12H48C48 16 51 19 55 19V45C51 45 48 48 48 52H16C16 48 13 45 9 45V19Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <path
        d="M32 16V22"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M32 29V35"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M32 42V48"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M16 7V25"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M7 16H25"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M32 8C18 8 8 18 8 31C8 43 17 52 28 54C32 55 36 53 36 49C36 46 34 44 34 41C34 38 37 36 40 36H48C54 36 58 31 57 25C55 15 45 8 32 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <circle
        cx="21"
        cy="24"
        r="3"
        fill="currentColor"
      />

      <circle
        cx="32"
        cy="18"
        r="3"
        fill="currentColor"
      />

      <circle
        cx="43"
        cy="23"
        r="3"
        fill="currentColor"
      />

      <circle
        cx="19"
        cy="36"
        r="3"
        fill="currentColor"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <circle
        cx="14"
        cy="14"
        r="8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />

      <path
        d="M20 20L27 27"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M5 8H27"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M9 16H23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M13 24H19"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function QrIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <rect
        x="8"
        y="8"
        width="18"
        height="18"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <rect
        x="38"
        y="8"
        width="18"
        height="18"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <rect
        x="8"
        y="38"
        width="18"
        height="18"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M39 38H47V46H55V55H46V50H38V42"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M32 10V22"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M31 31H43"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M31 39V54"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M25 16H8"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M14 9L7 16L14 23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M9 9L23 23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M23 9L9 23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PrintIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M19 23V9H45V23"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <path
        d="M17 47H11V25H53V47H47"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <rect
        x="18"
        y="38"
        width="28"
        height="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <circle
        cx="45"
        cy="31"
        r="2.5"
        fill="currentColor"
      />
    </svg>
  );
}

function TicketsPage({
  setPage,
  eventName,
}: TicketsPageProps) {
  const [
    tickets,
    setTickets,
  ] = useState<Ticket[]>(
    []
  );

  const [
    ticketsLoading,
    setTicketsLoading,
  ] = useState(true);

  const [
    ticketsError,
    setTicketsError,
  ] = useState("");

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    searchText,
    setSearchText,
  ] = useState("");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState<
    "すべて" | TicketStatus
  >("すべて");

  const [
    showCreateWindow,
    setShowCreateWindow,
  ] = useState(false);

  const [
    createCount,
    setCreateCount,
  ] = useState(10);

  const [
    selectedTicketId,
    setSelectedTicketId,
  ] = useState<
    string | null
  >(null);

  const [
    designerTicketNumber,
    setDesignerTicketNumber,
  ] = useState<
    string | null
  >(null);

  const [
    showDesigner,
    setShowDesigner,
  ] = useState(false);

  useEffect(() => {
    setTicketsLoading(true);
    setTicketsError("");
    setTickets([]);
    setSelectedTicketId(
      null
    );

    if (
      eventName.trim() === ""
    ) {
      setTicketsLoading(false);

      return;
    }

    const unsubscribe =
      subscribeToTickets(
        eventName,

        (
          receivedTickets
        ) => {
          setTickets(
            receivedTickets
          );

          setTicketsLoading(
            false
          );

          setTicketsError(
            ""
          );
        },

        (error) => {
          setTicketsLoading(
            false
          );

          setTicketsError(
            error.message
          );
        }
      );

    return () => {
      unsubscribe();
    };
  }, [eventName]);

  const selectedTicket =
    selectedTicketId ===
      null
      ? null
      : tickets.find(
          (ticket) =>
            ticket.id ===
            selectedTicketId
        ) ?? null;

  useEffect(() => {
    if (
      selectedTicketId !==
        null &&
      selectedTicket ===
        null
    ) {
      setSelectedTicketId(
        null
      );
    }
  }, [
    selectedTicket,
    selectedTicketId,
  ]);

  const getNextTicketNumber =
    () => {
      const usedNumbers =
        tickets
          .map((ticket) => {
            const match =
              ticket.qrNumber.match(
                /^TK(\d+)$/
              );

            if (
              match === null
            ) {
              return 0;
            }

            return Number(
              match[1]
            );
          })
          .filter((number) =>
            Number.isFinite(
              number
            )
          );

      return usedNumbers.length ===
        0
        ? 1
        : Math.max(
            ...usedNumbers
          ) + 1;
    };

  const createTickets =
    async () => {
      if (
        eventName.trim() ===
        ""
      ) {
        alert(
          "イベントが設定されていません。"
        );

        return;
      }

      if (
        !Number.isInteger(
          createCount
        ) ||
        createCount < 1
      ) {
        alert(
          "発行枚数は1枚以上で入力してください。"
        );

        return;
      }

      if (
        createCount >
        MAX_CREATE_COUNT
      ) {
        alert(
          `一度に発行できるのは${MAX_CREATE_COUNT}枚までです。`
        );

        return;
      }

      const confirmed =
        window.confirm(
          `${createCount}枚のチケットを新規発行しますか？`
        );

      if (
        !confirmed
      ) {
        return;
      }

      const firstNumber =
        getNextTicketNumber();

      const createdAt =
        new Date().toISOString();

      const newTickets:
        Ticket[] = Array.from(
        {
          length:
            createCount,
        },
        (
          _,
          index
        ) => ({
          id:
            createSafeRandomId(),

          qrNumber: `TK${String(
            firstNumber +
              index
          ).padStart(
            6,
            "0"
          )}`,

          authToken:
            createRandomToken(),

          status:
            "未使用",

          createdAt,
        })
      );

      setSaving(true);

      try {
        await createTicketsInFirestore(
          eventName,
          newTickets
        );

        setShowCreateWindow(
          false
        );

        alert(
          `${createCount}枚のチケットを発行しました。`
        );
      } catch (error) {
        console.error(
          "チケットの発行に失敗しました。",
          error
        );

        alert(
          "チケットを発行できませんでした。\n通信状態を確認してください。"
        );
      } finally {
        setSaving(false);
      }
    };

  const updateTicketStatus =
    async (
      ticketId: string,
      newStatus: TicketStatus
    ) => {
      const currentTicket =
        tickets.find(
          (ticket) =>
            ticket.id ===
            ticketId
        );

      if (
        currentTicket ===
        undefined
      ) {
        alert(
          "対象のチケットが見つかりません。"
        );

        return;
      }

      if (
        currentTicket.status ===
        newStatus
      ) {
        return;
      }

      setSaving(true);

      try {
        await updateTicketStatusInFirestore(
          eventName,
          currentTicket,
          newStatus
        );
      } catch (error) {
        console.error(
          "チケット状態の変更に失敗しました。",
          error
        );

        alert(
          "チケット状態を変更できませんでした。\n通信状態を確認してください。"
        );
      } finally {
        setSaving(false);
      }
    };

  const invalidateTicket =
    async (
      ticket: Ticket
    ) => {
      const confirmed =
        window.confirm(
          `${ticket.qrNumber}を無効にしますか？`
        );

      if (
        !confirmed
      ) {
        return;
      }

      await updateTicketStatus(
        ticket.id,
        "無効"
      );
    };

  const restoreTicket =
    async (
      ticket: Ticket
    ) => {
      const confirmed =
        window.confirm(
          `${ticket.qrNumber}を未使用状態へ戻しますか？`
        );

      if (
        !confirmed
      ) {
        return;
      }

      await updateTicketStatus(
        ticket.id,
        "未使用"
      );
    };

  const deleteTicket =
    async (
      ticket: Ticket
    ) => {
      const confirmed =
        window.confirm(
          `${ticket.qrNumber}を完全に削除しますか？`
        );

      if (
        !confirmed
      ) {
        return;
      }

      const finalConfirmed =
        window.confirm(
          "削除したチケットは元に戻せません。\n本当に削除しますか？"
        );

      if (
        !finalConfirmed
      ) {
        return;
      }

      setSaving(true);

      try {
        await deleteTicketFromFirestore(
          eventName,
          ticket.qrNumber
        );

        setSelectedTicketId(
          null
        );
      } catch (error) {
        console.error(
          "チケットの削除に失敗しました。",
          error
        );

        alert(
          "チケットを削除できませんでした。\n通信状態を確認してください。"
        );
      } finally {
        setSaving(false);
      }
    };

  const openAllTicketDesigner =
    () => {
      setDesignerTicketNumber(
        null
      );

      setShowDesigner(
        true
      );
    };

  const openSingleTicketDesigner =
    (
      ticket: Ticket
    ) => {
      setDesignerTicketNumber(
        ticket.qrNumber
      );

      setSelectedTicketId(
        null
      );

      setShowDesigner(
        true
      );
    };

  const filteredTickets =
    useMemo(() => {
      const keyword =
        searchText
          .trim()
          .toLowerCase();

      return tickets.filter(
        (ticket) => {
          const matchesSearch =
            keyword === "" ||
            ticket.qrNumber
              .toLowerCase()
              .includes(
                keyword
              );

          const matchesStatus =
            statusFilter ===
              "すべて" ||
            ticket.status ===
              statusFilter;

          return (
            matchesSearch &&
            matchesStatus
          );
        }
      );
    }, [
      tickets,
      searchText,
      statusFilter,
    ]);

  const unusedCount =
    tickets.filter(
      (ticket) =>
        ticket.status ===
        "未使用"
    ).length;

  const insideCount =
    tickets.filter(
      (ticket) =>
        ticket.status ===
        "入場中"
    ).length;

  const usedCount =
    tickets.filter(
      (ticket) =>
        ticket.status ===
        "使用済み"
    ).length;

  const invalidCount =
    tickets.filter(
      (ticket) =>
        ticket.status ===
        "無効"
    ).length;

  const nextTicketNumber =
    getNextTicketNumber();

  const lastCreateNumber =
    nextTicketNumber +
    Math.max(
      createCount,
      1
    ) -
    1;

  return (
    <div className="tickets-page">
      <div className="tickets-background tickets-background-one" />

      <div className="tickets-background tickets-background-two" />

      <header className="tickets-header">
        <div className="tickets-header-main">
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="tickets-header-meta">
            <OnlineStatus />

            <span
              className="tickets-header-divider"
              aria-hidden="true"
            />

            <div
              className={`tickets-event-pill ${
                eventName.trim() ===
                ""
                  ? "tickets-event-pill-warning"
                  : ""
              }`}
            >
              <span>
                EVENT
              </span>

              <strong>
                {eventName ||
                  "イベント未設定"}
              </strong>
            </div>
          </div>
        </div>

        <div className="tickets-mode-label">
          <span className="tickets-mode-icon">
            <TicketIcon />
          </span>

          <span className="tickets-mode-copy">
            <small>
              TICKET MANAGEMENT
            </small>

            <strong>
              チケット管理
            </strong>
          </span>
        </div>
      </header>

      <main className="tickets-content">
        <aside className="tickets-side-panel">
          <section className="tickets-action-panel">
            <div className="tickets-panel-heading">
              <div>
                <span className="tickets-panel-eyebrow">
                  TICKET TOOLS
                </span>

                <h2>
                  チケット操作
                </h2>
              </div>
            </div>

            <button
              type="button"
              className="tickets-create-button"
              disabled={
                saving ||
                eventName.trim() ===
                  ""
              }
              onClick={() => {
                setCreateCount(
                  10
                );

                setShowCreateWindow(
                  true
                );
              }}
            >
              <span className="tickets-action-icon">
                <PlusIcon />
              </span>

              <span className="tickets-action-copy">
                <small>
                  CREATE TICKETS
                </small>

                <strong>
                  チケットを新規発行
                </strong>
              </span>
            </button>

            <button
              type="button"
              className="tickets-design-button"
              onClick={
                openAllTicketDesigner
              }
              disabled={
                tickets.length ===
                  0 ||
                saving
              }
            >
              <span className="tickets-action-icon">
                <PaletteIcon />
              </span>

              <span className="tickets-action-copy">
                <small>
                  DESIGN & PRINT
                </small>

                <strong>
                  デザイン・まとめて印刷
                </strong>
              </span>
            </button>
          </section>

          <section className="tickets-summary-panel">
            <div className="tickets-summary-heading">
              <div>
                <span className="tickets-panel-eyebrow">
                  TICKET STATUS
                </span>

                <h2>
                  チケット状況
                </h2>
              </div>

              <strong className="tickets-total-count">
                {tickets.length}

                <small>
                  枚
                </small>
              </strong>
            </div>

            <div className="tickets-summary-grid">
              <div className="tickets-summary-card tickets-summary-unused">
                <span>
                  未使用
                </span>

                <strong>
                  {unusedCount}

                  <small>
                    枚
                  </small>
                </strong>
              </div>

              <div className="tickets-summary-card tickets-summary-inside">
                <span>
                  入場中
                </span>

                <strong>
                  {insideCount}

                  <small>
                    枚
                  </small>
                </strong>
              </div>

              <div className="tickets-summary-card tickets-summary-used">
                <span>
                  使用済み
                </span>

                <strong>
                  {usedCount}

                  <small>
                    枚
                  </small>
                </strong>
              </div>

              <div className="tickets-summary-card tickets-summary-invalid">
                <span>
                  無効
                </span>

                <strong>
                  {invalidCount}

                  <small>
                    枚
                  </small>
                </strong>
              </div>
            </div>

            <div
              className={`tickets-data-state ${
                ticketsError !== ""
                  ? "tickets-data-error"
                  : ticketsLoading
                    ? "tickets-data-loading"
                    : "tickets-data-live"
              }`}
            >
              <span />

              {ticketsError !== ""
                ? "読み込みエラー"
                : ticketsLoading
                  ? "Firebaseから読込中"
                  : "リアルタイム同期中"}
            </div>
          </section>
        </aside>

        <section className="tickets-list-area">
          <div className="tickets-list-header">
            <div>
              <span className="tickets-panel-eyebrow">
                ALL TICKETS
              </span>

              <h2>
                チケット一覧
              </h2>
            </div>

            <div className="tickets-list-count">
              <span>
                表示件数
              </span>

              <strong>
                {
                  filteredTickets.length
                }

                <small>
                  件
                </small>
              </strong>
            </div>
          </div>

          <div className="tickets-list-tools">
            <label className="tickets-search-box">
              <span>
                <SearchIcon />
              </span>

              <input
                type="search"
                className="tickets-search"
                value={
                  searchText
                }
                disabled={
                  ticketsLoading
                }
                onChange={(
                  event
                ) =>
                  setSearchText(
                    event.target
                      .value
                  )
                }
                placeholder="QR番号を検索"
              />
            </label>

            <label className="tickets-filter-box">
              <span>
                <FilterIcon />
              </span>

              <select
                className="tickets-status-filter"
                value={
                  statusFilter
                }
                disabled={
                  ticketsLoading
                }
                onChange={(
                  event
                ) =>
                  setStatusFilter(
                    event.target
                      .value as
                      | "すべて"
                      | TicketStatus
                  )
                }
              >
                <option value="すべて">
                  すべての状態
                </option>

                <option value="未使用">
                  未使用
                </option>

                <option value="入場中">
                  入場中
                </option>

                <option value="使用済み">
                  使用済み
                </option>

                <option value="無効">
                  無効
                </option>
              </select>
            </label>

            {saving && (
              <div className="tickets-saving-label">
                <span />

                保存しています
              </div>
            )}
          </div>

          <div className="tickets-table-wrapper">
            <table className="tickets-table">
              <thead>
                <tr>
                  <th>
                    QR番号
                  </th>

                  <th>
                    状態
                  </th>

                  <th>
                    操作
                  </th>
                </tr>
              </thead>

              <tbody>
                {ticketsLoading ? (
                  <tr>
                    <td
                      className="tickets-empty-message"
                      colSpan={
                        3
                      }
                    >
                      <span className="tickets-empty-icon">
                        <TicketIcon />
                      </span>

                      <strong>
                        チケット情報を読み込んでいます
                      </strong>

                      <small>
                        Firebaseと通信しています
                      </small>
                    </td>
                  </tr>
                ) : ticketsError !==
                  "" ? (
                  <tr>
                    <td
                      className="tickets-empty-message tickets-error-message"
                      colSpan={
                        3
                      }
                    >
                      <span className="tickets-empty-symbol">
                        !
                      </span>

                      <strong>
                        チケット情報を読み込めませんでした
                      </strong>

                      <small>
                        {
                          ticketsError
                        }
                      </small>
                    </td>
                  </tr>
                ) : filteredTickets.length ===
                  0 ? (
                  <tr>
                    <td
                      className="tickets-empty-message"
                      colSpan={
                        3
                      }
                    >
                      <span className="tickets-empty-icon">
                        <SearchIcon />
                      </span>

                      <strong>
                        該当するチケットがありません
                      </strong>

                      <small>
                        検索条件や状態フィルターを変更してください
                      </small>
                    </td>
                  </tr>
                ) : (
                  filteredTickets.map(
                    (
                      ticket
                    ) => (
                      <tr
                        key={
                          ticket.id
                        }
                      >
                        <td className="tickets-qr-number">
                          <span className="tickets-row-qr-icon">
                            <QrIcon />
                          </span>

                          <strong>
                            {
                              ticket.qrNumber
                            }
                          </strong>
                        </td>

                        <td>
                          <select
                            className={`tickets-status-select ticket-status-${ticket.status}`}
                            value={
                              ticket.status
                            }
                            disabled={
                              saving
                            }
                            onChange={(
                              event
                            ) => {
                              void updateTicketStatus(
                                ticket.id,
                                event
                                  .target
                                  .value as TicketStatus
                              );
                            }}
                          >
                            <option value="未使用">
                              未使用
                            </option>

                            <option value="入場中">
                              入場中
                            </option>

                            <option value="使用済み">
                              使用済み
                            </option>

                            <option value="無効">
                              無効
                            </option>
                          </select>
                        </td>

                        <td>
                          <div className="tickets-operation-buttons">
                            <button
                              type="button"
                              className="tickets-qr-button"
                              disabled={
                                saving
                              }
                              onClick={() =>
                                setSelectedTicketId(
                                  ticket.id
                                )
                              }
                            >
                              QR表示
                            </button>

                            {ticket.status ===
                            "無効" ? (
                              <button
                                type="button"
                                className="tickets-restore-button"
                                disabled={
                                  saving
                                }
                                onClick={() => {
                                  void restoreTicket(
                                    ticket
                                  );
                                }}
                              >
                                有効に戻す
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="tickets-invalid-button"
                                disabled={
                                  saving
                                }
                                onClick={() => {
                                  void invalidateTicket(
                                    ticket
                                  );
                                }}
                              >
                                無効化
                              </button>
                            )}

                            <button
                              type="button"
                              className="tickets-delete-button"
                              disabled={
                                saving
                              }
                              onClick={() => {
                                void deleteTicket(
                                  ticket
                                );
                              }}
                            >
                              削除
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="tickets-footer">
        <button
          type="button"
          className="tickets-return-button"
          disabled={
            saving
          }
          onClick={() =>
            setPage(
              "admin"
            )
          }
        >
          <span>
            <BackIcon />
          </span>

          管理モードに戻る
        </button>
      </footer>

      {showCreateWindow && (
        <div
          className="tickets-modal-background"
          role="presentation"
        >
          <section
            className="tickets-create-window"
            role="dialog"
            aria-modal="true"
            aria-label="チケットを新規作成"
          >
            <header className="tickets-create-header">
              <div className="tickets-modal-title">
                <span className="tickets-modal-title-icon">
                  <PlusIcon />
                </span>

                <div>
                  <small>
                    CREATE TICKETS
                  </small>

                  <h2>
                    チケットを新規発行
                  </h2>

                  <p>
                    複数枚のQRチケットをまとめて発行します。
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="tickets-modal-close"
                aria-label="閉じる"
                disabled={
                  saving
                }
                onClick={() =>
                  setShowCreateWindow(
                    false
                  )
                }
              >
                <CloseIcon />
              </button>
            </header>

            <label className="tickets-count-input">
              <span>
                発行枚数
              </span>

              <div>
                <input
                  type="number"
                  min="1"
                  max={
                    MAX_CREATE_COUNT
                  }
                  value={
                    createCount
                  }
                  disabled={
                    saving
                  }
                  onChange={(
                    event
                  ) =>
                    setCreateCount(
                      Number(
                        event
                          .target
                          .value
                      )
                    )
                  }
                />

                <strong>
                  枚
                </strong>
              </div>

              <small>
                一度に最大
                {MAX_CREATE_COUNT}
                枚まで発行できます
              </small>
            </label>

            <div className="tickets-create-preview">
              <div className="tickets-create-preview-heading">
                <span>
                  発行予定
                </span>

                <strong>
                  {Math.max(
                    createCount,
                    0
                  )}
                  枚
                </strong>
              </div>

              <div className="tickets-create-number-range">
                <div>
                  <small>
                    最初の番号
                  </small>

                  <strong>
                    TK
                    {String(
                      nextTicketNumber
                    ).padStart(
                      6,
                      "0"
                    )}
                  </strong>
                </div>

                <span>
                  →
                </span>

                <div>
                  <small>
                    最後の番号
                  </small>

                  <strong>
                    TK
                    {String(
                      lastCreateNumber
                    ).padStart(
                      6,
                      "0"
                    )}
                  </strong>
                </div>
              </div>
            </div>

            <div className="tickets-create-note">
              <span>
                i
              </span>

              <p>
                発行したチケットはFirebaseへ保存され、入口・出口・管理端末へリアルタイムで反映されます。
              </p>
            </div>

            <div className="tickets-create-buttons">
              <button
                type="button"
                className="tickets-create-cancel"
                disabled={
                  saving
                }
                onClick={() =>
                  setShowCreateWindow(
                    false
                  )
                }
              >
                キャンセル
              </button>

              <button
                type="button"
                className="tickets-create-confirm"
                disabled={
                  saving
                }
                onClick={() => {
                  void createTickets();
                }}
              >
                <PlusIcon />

                {saving
                  ? "発行しています…"
                  : "チケットを発行"}
              </button>
            </div>
          </section>
        </div>
      )}

      {selectedTicket !==
        null && (
        <div
          className="tickets-modal-background"
          role="presentation"
          onClick={() =>
            setSelectedTicketId(
              null
            )
          }
        >
          <section
            className="ticket-qr-window"
            role="dialog"
            aria-modal="true"
            aria-label="チケットQRコード"
            onClick={(
              event
            ) =>
              event.stopPropagation()
            }
          >
            <button
              type="button"
              className="tickets-modal-close ticket-qr-modal-close"
              aria-label="閉じる"
              onClick={() =>
                setSelectedTicketId(
                  null
                )
              }
            >
              <CloseIcon />
            </button>

            <div className="ticket-qr-heading">
              <span className="ticket-qr-heading-icon">
                <QrIcon />
              </span>

              <div>
                <small>
                  TICKET QR CODE
                </small>

                <h2>
                  チケットQRコード
                </h2>
              </div>
            </div>

            <div className="ticket-qr-code">
              <QRCodeSVG
                value={createTicketQrValue(
                  selectedTicket
                )}
                size={340}
                level="M"
                marginSize={
                  1
                }
              />
            </div>

            <p className="ticket-qr-number">
              {
                selectedTicket.qrNumber
              }
            </p>

            <div
              className={`ticket-qr-status ticket-status-${selectedTicket.status}`}
            >
              <span />

              {
                selectedTicket.status
              }
            </div>

            <p className="ticket-qr-help">
              このQRコードを入口・出口受付で読み取れます。
            </p>

            <div className="ticket-qr-action-buttons">
              <button
                type="button"
                className="ticket-design-print-button"
                onClick={() =>
                  openSingleTicketDesigner(
                    selectedTicket
                  )
                }
              >
                <PrintIcon />

                デザインに貼って印刷
              </button>

              <button
                type="button"
                className="ticket-qr-close-button"
                onClick={() =>
                  setSelectedTicketId(
                    null
                  )
                }
              >
                閉じる
              </button>
            </div>
          </section>
        </div>
      )}

      {showDesigner && (
        <TicketDesigner
          tickets={
            tickets
          }
          eventName={
            eventName
          }
          initialTicketNumber={
            designerTicketNumber ??
            undefined
          }
          onClose={() =>
            setShowDesigner(
              false
            )
          }
        />
      )}
    </div>
  );
}

export default TicketsPage;