import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  QRCodeSVG,
} from "qrcode.react";

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

  /*
    Firestoreのチケット一覧を
    リアルタイムで受信します。

    入口・出口・別の管理端末で
    状態が変わると、この一覧も
   自動的に更新されます。
  */
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

  /*
    選択中のチケットは、
    最新のFirestoreデータから取得します。

    別端末で状態が変わった場合も
    QR表示画面へ反映されます。
  */
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

      if (!confirmed) {
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
        (_, index) => ({
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

      if (!confirmed) {
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

      if (!confirmed) {
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

      if (!confirmed) {
        return;
      }

      const finalConfirmed =
        window.confirm(
          "削除したチケットは元に戻せません。\n本当に削除しますか？"
        );

      if (!finalConfirmed) {
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
      <header className="tickets-header">
        <div>
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="tickets-title-row">
            <h2>
              チケット管理
            </h2>

            <div className="tickets-event-name">
              イベント名　
              {eventName ||
                "未設定"}
            </div>
          </div>
        </div>

        <div className="tickets-mode-label">
          管理モード
        </div>
      </header>

      <main className="tickets-content">
        <aside className="tickets-side-panel">
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
            <span>＋</span>
            チケットを新規作成
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
            チケットデザイン
            <br />
            ・まとめて印刷
          </button>

          <section className="tickets-summary">
            <h3>
              チケット状況
            </h3>

            <div className="tickets-summary-row">
              <span>
                発行済み
              </span>

              <strong>
                {tickets.length}
                枚
              </strong>
            </div>

            <div className="tickets-summary-row">
              <span>
                未使用
              </span>

              <strong>
                {unusedCount}
                枚
              </strong>
            </div>

            <div className="tickets-summary-row">
              <span>
                入場中
              </span>

              <strong>
                {insideCount}
                枚
              </strong>
            </div>

            <div className="tickets-summary-row">
              <span>
                使用済み
              </span>

              <strong>
                {usedCount}
                枚
              </strong>
            </div>

            <div className="tickets-summary-row">
              <span>
                無効
              </span>

              <strong>
                {invalidCount}
                枚
              </strong>
            </div>
          </section>
        </aside>

        <section className="tickets-list-area">
          <div className="tickets-list-tools">
            <div className="tickets-list-count">
              表示件数　
              {
                filteredTickets.length
              }
              件
            </div>

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
                      Firebaseからチケット情報を読み込んでいます…
                    </td>
                  </tr>
                ) : ticketsError !==
                  "" ? (
                  <tr>
                    <td
                      className="tickets-empty-message"
                      colSpan={
                        3
                      }
                    >
                      チケット情報を読み込めませんでした
                      <br />
                      {
                        ticketsError
                      }
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
                      該当するチケットがありません
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
                          {
                            ticket.qrNumber
                          }
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
        前のページに戻る
      </button>

      {showCreateWindow && (
        <div className="tickets-modal-background">
          <section className="tickets-create-window">
            <header className="tickets-create-header">
              <div>
                <h2>
                  チケットを新規作成
                </h2>

                <p>
                  複数枚のQRチケットをまとめて発行します。
                </p>
              </div>

              <button
                type="button"
                className="tickets-modal-close"
                disabled={
                  saving
                }
                onClick={() =>
                  setShowCreateWindow(
                    false
                  )
                }
              >
                ×
              </button>
            </header>

            <label className="tickets-count-input">
              発行枚数

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

              <span>
                枚
              </span>
            </label>

            <div className="tickets-create-preview">
              <h3>
                発行予定
              </h3>

              <p>
                最初の番号

                <strong>
                  TK
                  {String(
                    nextTicketNumber
                  ).padStart(
                    6,
                    "0"
                  )}
                </strong>
              </p>

              <p>
                最後の番号

                <strong>
                  TK
                  {String(
                    lastCreateNumber
                  ).padStart(
                    6,
                    "0"
                  )}
                </strong>
              </p>

              <p>
                発行枚数

                <strong>
                  {Math.max(
                    createCount,
                    0
                  )}
                  枚
                </strong>
              </p>
            </div>

            <div className="tickets-create-buttons">
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
                {saving
                  ? "発行しています…"
                  : "チケットを発行"}
              </button>

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
            </div>
          </section>
        </div>
      )}

      {selectedTicket !==
        null && (
        <div
          className="tickets-modal-background"
          onClick={() =>
            setSelectedTicketId(
              null
            )
          }
        >
          <section
            className="ticket-qr-window"
            onClick={(
              event
            ) =>
              event.stopPropagation()
            }
          >
            <button
              type="button"
              className="tickets-modal-close"
              onClick={() =>
                setSelectedTicketId(
                  null
                )
              }
            >
              ×
            </button>

            <h2>
              チケットQRコード
            </h2>

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
              {
                selectedTicket.status
              }
            </div>

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