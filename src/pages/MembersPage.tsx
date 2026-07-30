import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  QRCodeSVG,
} from "qrcode.react";

import MemberCardDesigner from "./MemberCardDesigner";

import {
  createMemberInFirestore,
  deleteMemberFromFirestore,
  regenerateMemberQrInFirestore,
  saveEventMemberInFirestore,
  saveEventMembersInFirestore,
  subscribeToEventMembers,
  subscribeToMemberCards,
  type EventMember,
  type Member,
  type MemberCard,
  type MemberStatus,
} from "../memberFirestore";

import "./MembersPage.css";

type MembersPageProps = {
  setPage: (
    page: string
  ) => void;

  eventName: string;
};

function createSafeRandomId() {
  try {
    if (
      typeof globalThis.crypto !==
        "undefined" &&
      typeof globalThis.crypto.randomUUID ===
        "function"
    ) {
      return globalThis.crypto.randomUUID();
    }

    if (
      typeof globalThis.crypto !==
        "undefined" &&
      typeof globalThis.crypto.getRandomValues ===
        "function"
    ) {
      const randomValues =
        new Uint32Array(4);

      globalThis.crypto.getRandomValues(
        randomValues
      );

      const randomText =
        Array.from(
          randomValues
        )
          .map((value) =>
            value
              .toString(16)
              .padStart(
                8,
                "0"
              )
          )
          .join("");

      return [
        randomText.slice(
          0,
          8
        ),
        randomText.slice(
          8,
          12
        ),
        randomText.slice(
          12,
          16
        ),
        randomText.slice(
          16,
          20
        ),
        randomText.slice(
          20,
          32
        ),
      ].join("-");
    }
  } catch (error) {
    console.warn(
      "安全な乱数を生成できませんでした。",
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

function createQrValue(
  member: MemberCard
) {
  return [
    "QRM1",
    "MEMBER",
    member.qrNumber,
    member.authToken,
  ].join(":");
}

function MembersPage({
  setPage,
  eventName,
}: MembersPageProps) {
  const [
    memberCards,
    setMemberCards,
  ] = useState<MemberCard[]>(
    []
  );

  const [
    eventMembers,
    setEventMembers,
  ] = useState<EventMember[]>(
    []
  );

  const [
    cardsLoading,
    setCardsLoading,
  ] = useState(true);

  const [
    membersLoading,
    setMembersLoading,
  ] = useState(true);

  const [
    loadingError,
    setLoadingError,
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
    showAddForm,
    setShowAddForm,
  ] = useState(false);

  const [
    showBulkEdit,
    setShowBulkEdit,
  ] = useState(false);

  const [
    newQrNumber,
    setNewQrNumber,
  ] = useState("");

  const [
    newMemberName,
    setNewMemberName,
  ] = useState("");

  const [
    newAuthToken,
    setNewAuthToken,
  ] = useState("");

  const [
    bulkNames,
    setBulkNames,
  ] = useState<
    Record<
      string,
      string
    >
  >({});

  const [
    selectedMemberQrNumber,
    setSelectedMemberQrNumber,
  ] = useState<
    string | null
  >(null);

  const [
    designerMemberQrNumber,
    setDesignerMemberQrNumber,
  ] = useState<
    string | null
  >(null);

  /*
    全イベントで共通の
    部員QR台帳を同期します。
  */
  useEffect(() => {
    setCardsLoading(
      true
    );

    const unsubscribe =
      subscribeToMemberCards(
        (cards) => {
          setMemberCards(
            cards
          );

          setCardsLoading(
            false
          );

          setLoadingError(
            ""
          );
        },

        (error) => {
          setCardsLoading(
            false
          );

          setLoadingError(
            error.message
          );
        }
      );

    return () => {
      unsubscribe();
    };
  }, []);

  /*
    現在のイベントで使う
    名前と入退室状態を同期します。
  */
  useEffect(() => {
    setMembersLoading(
      true
    );

    setEventMembers(
      []
    );

    if (
      eventName.trim() ===
      ""
    ) {
      setMembersLoading(
        false
      );

      return;
    }

    const unsubscribe =
      subscribeToEventMembers(
        eventName,

        (members) => {
          setEventMembers(
            members
          );

          setMembersLoading(
            false
          );

          setLoadingError(
            ""
          );
        },

        (error) => {
          setMembersLoading(
            false
          );

          setLoadingError(
            error.message
          );
        }
      );

    return () => {
      unsubscribe();
    };
  }, [eventName]);

  const members =
    useMemo<Member[]>(
      () =>
        memberCards.map(
          (card) => {
            const eventMember =
              eventMembers.find(
                (member) =>
                  member.qrNumber ===
                  card.qrNumber
              );

            return {
              ...card,

              name:
                eventMember?.name ??
                "",

              status:
                eventMember?.status ??
                "未入室",
            };
          }
        ),
      [
        memberCards,
        eventMembers,
      ]
    );

  const selectedMember =
    selectedMemberQrNumber ===
      null
      ? null
      : members.find(
          (member) =>
            member.qrNumber ===
            selectedMemberQrNumber
        ) ?? null;

  const designerMember =
    designerMemberQrNumber ===
      null
      ? null
      : members.find(
          (member) =>
            member.qrNumber ===
            designerMemberQrNumber
        ) ?? null;

  useEffect(() => {
    if (
      selectedMemberQrNumber !==
        null &&
      selectedMember ===
        null
    ) {
      setSelectedMemberQrNumber(
        null
      );
    }
  }, [
    selectedMember,
    selectedMemberQrNumber,
  ]);

  useEffect(() => {
    if (
      designerMemberQrNumber !==
        null &&
      designerMember ===
        null
    ) {
      setDesignerMemberQrNumber(
        null
      );
    }
  }, [
    designerMember,
    designerMemberQrNumber,
  ]);

  const createNextQrNumber =
    () => {
      const usedNumbers =
        memberCards
          .map((card) => {
            const match =
              card.qrNumber.match(
                /^ST(\d+)$/
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

      const nextNumber =
        usedNumbers.length ===
          0
          ? 1
          : Math.max(
              ...usedNumbers
            ) + 1;

      return `ST${String(
        nextNumber
      ).padStart(
        4,
        "0"
      )}`;
    };

  const openAddForm =
    () => {
      if (
        eventName.trim() ===
        ""
      ) {
        alert(
          "先に現在のイベントを設定してください。"
        );

        return;
      }

      setNewQrNumber(
        createNextQrNumber()
      );

      setNewMemberName(
        ""
      );

      setNewAuthToken(
        createRandomToken()
      );

      setShowAddForm(
        true
      );
    };

  const closeAddForm =
    () => {
      if (saving) {
        return;
      }

      setShowAddForm(
        false
      );

      setNewQrNumber(
        ""
      );

      setNewMemberName(
        ""
      );

      setNewAuthToken(
        ""
      );
    };

  const addMember =
    async () => {
      const memberName =
        newMemberName.trim();

      const qrNumber =
        newQrNumber
          .trim()
          .toUpperCase();

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
        qrNumber ===
        ""
      ) {
        alert(
          "QR番号を生成できませんでした。"
        );

        return;
      }

      const qrAlreadyExists =
        memberCards.some(
          (card) =>
            card.qrNumber.toUpperCase() ===
            qrNumber
        );

      if (
        qrAlreadyExists
      ) {
        alert(
          "このQR番号はすでに使われています。"
        );

        return;
      }

      const newCard:
        MemberCard = {
        id:
          createSafeRandomId(),

        qrNumber,

        authToken:
          newAuthToken ||
          createRandomToken(),
      };

      const newEventMember:
        EventMember = {
        qrNumber,

        name:
          memberName,

        status:
          "未入室",
      };

      setSaving(
        true
      );

      try {
        await createMemberInFirestore(
          eventName,
          newCard,
          newEventMember
        );

        setSelectedMemberQrNumber(
          qrNumber
        );

        setShowAddForm(
          false
        );

        setNewQrNumber(
          ""
        );

        setNewMemberName(
          ""
        );

        setNewAuthToken(
          ""
        );
      } catch (error) {
        console.error(
          "部員QRの新規発行に失敗しました。",
          error
        );

        alert(
          "部員QRを保存できませんでした。\n通信状態を確認してください。"
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const updateMemberName =
    async (
      qrNumber: string,
      newName: string
    ) => {
      if (
        eventName.trim() ===
        ""
      ) {
        return;
      }

      const currentEventMember =
        eventMembers.find(
          (member) =>
            member.qrNumber ===
            qrNumber
        );

      const updatedMember:
        EventMember = {
        qrNumber,

        name:
          newName,

        status:
          currentEventMember?.status ??
          "未入室",
      };

      /*
        入力欄をすぐ反応させるため、
        画面上だけ先に更新します。
      */
      setEventMembers(
        (currentMembers) => {
          const exists =
            currentMembers.some(
              (member) =>
                member.qrNumber ===
                qrNumber
            );

          if (
            !exists
          ) {
            return [
              ...currentMembers,
              updatedMember,
            ];
          }

          return currentMembers.map(
            (member) =>
              member.qrNumber ===
              qrNumber
                ? updatedMember
                : member
          );
        }
      );

      try {
        await saveEventMemberInFirestore(
          eventName,
          updatedMember
        );
      } catch (error) {
        console.error(
          "部員名の保存に失敗しました。",
          error
        );

        alert(
          "部員名を保存できませんでした。\n通信状態を確認してください。"
        );
      }
    };

  const updateMemberStatus =
    async (
      qrNumber: string,
      newStatus: MemberStatus
    ) => {
      const currentMember =
        members.find(
          (member) =>
            member.qrNumber ===
            qrNumber
        );

      if (
        currentMember ===
        undefined
      ) {
        alert(
          "部員情報が見つかりません。"
        );

        return;
      }

      const updatedMember:
        EventMember = {
        qrNumber,

        name:
          currentMember.name,

        status:
          newStatus,
      };

      setSaving(
        true
      );

      try {
        await saveEventMemberInFirestore(
          eventName,
          updatedMember
        );
      } catch (error) {
        console.error(
          "部員状態の保存に失敗しました。",
          error
        );

        alert(
          "部員状態を保存できませんでした。\n通信状態を確認してください。"
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const openBulkEdit =
    () => {
      const initialNames =
        Object.fromEntries(
          members.map(
            (member) => [
              member.qrNumber,
              member.name,
            ]
          )
        );

      setBulkNames(
        initialNames
      );

      setShowBulkEdit(
        true
      );
    };

  const updateBulkName =
    (
      qrNumber: string,
      name: string
    ) => {
      setBulkNames(
        (
          currentNames
        ) => ({
          ...currentNames,

          [qrNumber]:
            name,
        })
      );
    };

  const saveBulkNames =
    async () => {
      const updatedEventMembers:
        EventMember[] =
        memberCards.map(
          (card) => {
            const currentEventMember =
              eventMembers.find(
                (member) =>
                  member.qrNumber ===
                  card.qrNumber
              );

            return {
              qrNumber:
                card.qrNumber,

              name:
                bulkNames[
                  card.qrNumber
                ]?.trim() ??
                "",

              status:
                currentEventMember?.status ??
                "未入室",
            };
          }
        );

      setSaving(
        true
      );

      try {
        await saveEventMembersInFirestore(
          eventName,
          updatedEventMembers
        );

        setShowBulkEdit(
          false
        );

        alert(
          `${
            eventName ||
            "現在のイベント"
          }の部員名を保存しました。`
        );
      } catch (error) {
        console.error(
          "部員名の一括保存に失敗しました。",
          error
        );

        alert(
          "部員名を保存できませんでした。\n通信状態を確認してください。"
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const clearBulkNames =
    () => {
      const confirmed =
        window.confirm(
          "入力中の部員名をすべて空欄にしますか？"
        );

      if (
        !confirmed
      ) {
        return;
      }

      const emptyNames =
        Object.fromEntries(
          memberCards.map(
            (card) => [
              card.qrNumber,
              "",
            ]
          )
        );

      setBulkNames(
        emptyNames
      );
    };

  const regenerateQr =
    async (
      member: Member
    ) => {
      const displayName =
        member.name.trim() ===
        ""
          ? member.qrNumber
          : member.name;

      const confirmed =
        window.confirm(
          `${displayName}の認証用QRを再発行しますか？\n以前のQRコードは使用できなくなります。`
        );

      if (
        !confirmed
      ) {
        return;
      }

      const newAuthToken =
        createRandomToken();

      setSaving(
        true
      );

      try {
        await regenerateMemberQrInFirestore(
          member,
          newAuthToken
        );
      } catch (error) {
        console.error(
          "部員QRの再発行に失敗しました。",
          error
        );

        alert(
          "部員QRを再発行できませんでした。\n通信状態を確認してください。"
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const deleteMember =
    async (
      member: Member
    ) => {
      const displayName =
        member.name.trim() ===
        ""
          ? member.qrNumber
          : member.name;

      const confirmed =
        window.confirm(
          `${displayName}のQR番号を台帳から削除しますか？\nこのQR番号は今後のイベントでも使用できなくなります。`
        );

      if (
        !confirmed
      ) {
        return;
      }

      const finalConfirmed =
        window.confirm(
          "部員QRを完全に削除します。\n本当によろしいですか？"
        );

      if (
        !finalConfirmed
      ) {
        return;
      }

      setSaving(
        true
      );

      try {
        await deleteMemberFromFirestore(
          eventName,
          member.qrNumber
        );

        setSelectedMemberQrNumber(
          null
        );

        setDesignerMemberQrNumber(
          null
        );
      } catch (error) {
        console.error(
          "部員QRの削除に失敗しました。",
          error
        );

        alert(
          "部員QRを削除できませんでした。\n通信状態を確認してください。"
        );
      } finally {
        setSaving(
          false
        );
      }
    };

  const filteredMembers =
    useMemo(() => {
      const keyword =
        searchText
          .trim()
          .toLowerCase();

      if (
        keyword ===
        ""
      ) {
        return members;
      }

      return members.filter(
        (member) =>
          member.qrNumber
            .toLowerCase()
            .includes(
              keyword
            ) ||
          member.name
            .toLowerCase()
            .includes(
              keyword
            ) ||
          member.status
            .toLowerCase()
            .includes(
              keyword
            )
      );
    }, [
      members,
      searchText,
    ]);

  const insideMemberCount =
    members.filter(
      (member) =>
        member.status ===
        "入室中"
    ).length;

  const namedMemberCount =
    members.filter(
      (member) =>
        member.name.trim() !==
        ""
    ).length;

  const newMemberPreview:
    Member | null =
    newQrNumber !== "" &&
    newAuthToken !== ""
      ? {
          id:
            "preview",

          qrNumber:
            newQrNumber,

          authToken:
            newAuthToken,

          name:
            newMemberName.trim() ||
            "名前未設定",

          status:
            "未入室",
        }
      : null;

  const loading =
    cardsLoading ||
    membersLoading;

  return (
    <div className="members-page">
      <header className="members-header">
        <div>
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="members-title-row">
            <h2>
              部員管理
            </h2>

            <div className="members-event-name">
              イベント名　
              {eventName ||
                "未設定"}
            </div>
          </div>
        </div>

        <div className="members-mode-label">
          管理モード
        </div>
      </header>

      <main className="members-content">
        <aside className="members-side-panel">
          <button
            type="button"
            className="members-add-button"
            disabled={
              loading ||
              saving ||
              eventName.trim() ===
                ""
            }
            onClick={
              openAddForm
            }
          >
            <span className="members-add-icon">
              ＋
            </span>

            QR番号を新規発行
          </button>

          <button
            type="button"
            className="members-bulk-edit-button"
            disabled={
              memberCards.length ===
                0 ||
              loading ||
              saving
            }
            onClick={
              openBulkEdit
            }
          >
            今年の部員名を
            <br />
            まとめて変更
          </button>

          <button
            type="button"
            className="members-shift-button"
            disabled
          >
            近日公開（シフト管理）
          </button>

          <section className="members-summary">
            <h3>
              登録状況
            </h3>

            <p>
              QR登録数

              <strong>
                {members.length}
                個
              </strong>
            </p>

            <p>
              名前設定済み

              <strong>
                {
                  namedMemberCount
                }
                人
              </strong>
            </p>

            <p>
              入室中

              <strong>
                {
                  insideMemberCount
                }
                人
              </strong>
            </p>
          </section>
        </aside>

        <section className="members-list-area">
          <div className="members-list-tools">
            <div className="members-list-count">
              表示件数　
              {
                filteredMembers.length
              }
              件
            </div>

            <input
              type="search"
              className="members-search"
              value={
                searchText
              }
              disabled={
                loading
              }
              onChange={(
                event
              ) =>
                setSearchText(
                  event.target.value
                )
              }
              placeholder="名前・QR番号を検索"
            />
          </div>

          <div className="members-table-wrapper">
            <table className="members-table">
              <thead>
                <tr>
                  <th>
                    QR番号
                  </th>

                  <th>
                    名前
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
                {loading ? (
                  <tr>
                    <td
                      className="members-empty-message"
                      colSpan={
                        4
                      }
                    >
                      Firebaseから部員情報を読み込んでいます…
                    </td>
                  </tr>
                ) : loadingError !==
                  "" ? (
                  <tr>
                    <td
                      className="members-empty-message"
                      colSpan={
                        4
                      }
                    >
                      部員情報を読み込めませんでした
                      <br />
                      {
                        loadingError
                      }
                    </td>
                  </tr>
                ) : filteredMembers.length ===
                  0 ? (
                  <tr>
                    <td
                      className="members-empty-message"
                      colSpan={
                        4
                      }
                    >
                      登録されているQR番号がありません
                    </td>
                  </tr>
                ) : (
                  filteredMembers.map(
                    (member) => (
                      <tr
                        key={
                          member.id
                        }
                      >
                        <td className="members-qr-number">
                          {
                            member.qrNumber
                          }
                        </td>

                        <td>
                          <input
                            type="text"
                            className="members-name-input"
                            value={
                              member.name
                            }
                            disabled={
                              saving
                            }
                            onChange={(
                              event
                            ) => {
                              void updateMemberName(
                                member.qrNumber,
                                event.target.value
                              );
                            }}
                            placeholder="このイベントの名前"
                          />
                        </td>

                        <td>
                          <select
                            className={`members-status-select status-${member.status}`}
                            value={
                              member.status
                            }
                            disabled={
                              saving
                            }
                            onChange={(
                              event
                            ) => {
                              void updateMemberStatus(
                                member.qrNumber,
                                event.target
                                  .value as MemberStatus
                              );
                            }}
                          >
                            <option value="未入室">
                              未入室
                            </option>

                            <option value="入室中">
                              入室中
                            </option>

                            <option value="退出済み">
                              退出済み
                            </option>
                          </select>
                        </td>

                        <td>
                          <div className="members-operation-buttons">
                            <button
                              type="button"
                              className="members-qr-button"
                              disabled={
                                saving
                              }
                              onClick={() =>
                                setSelectedMemberQrNumber(
                                  member.qrNumber
                                )
                              }
                            >
                              QR表示
                            </button>

                            <button
                              type="button"
                              className="members-delete-button"
                              disabled={
                                saving
                              }
                              onClick={() => {
                                void deleteMember(
                                  member
                                );
                              }}
                            >
                              QR削除
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
        className="members-return-button"
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

      {showAddForm && (
        <div
          className="members-add-modal-background"
          onClick={
            closeAddForm
          }
        >
          <section
            className="members-add-modal"
            onClick={(
              event
            ) =>
              event.stopPropagation()
            }
          >
            <header className="members-add-modal-header">
              <div>
                <h2>
                  QR番号を新規発行
                </h2>

                <p>
                  部員用のQR番号を1つ発行します
                </p>
              </div>

              <button
                type="button"
                className="members-add-modal-close"
                disabled={
                  saving
                }
                onClick={
                  closeAddForm
                }
              >
                ×
              </button>
            </header>

            <div className="members-add-modal-content">
              <label>
                部員番号

                <input
                  type="text"
                  value={
                    newQrNumber
                  }
                  readOnly
                />
              </label>

              <label>
                このイベントでの名前（任意）

                <input
                  type="text"
                  value={
                    newMemberName
                  }
                  disabled={
                    saving
                  }
                  onChange={(
                    event
                  ) =>
                    setNewMemberName(
                      event.target.value
                    )
                  }
                  placeholder="後から入力できます"
                  autoFocus
                />
              </label>

              {newMemberPreview !==
                null && (
                <div className="members-new-qr-preview">
                  <QRCodeSVG
                    value={createQrValue(
                      newMemberPreview
                    )}
                    size={
                      190
                    }
                    level="M"
                    marginSize={
                      1
                    }
                  />

                  <div>
                    <strong>
                      {
                        newQrNumber
                      }
                    </strong>

                    <span>
                      名前未設定でもQRを発行できます
                    </span>
                  </div>
                </div>
              )}
            </div>

            <footer className="members-add-modal-buttons">
              <button
                type="button"
                className="members-register-button"
                disabled={
                  saving
                }
                onClick={() => {
                  void addMember();
                }}
              >
                {saving
                  ? "保存しています…"
                  : "QRを新規発行"}
              </button>

              <button
                type="button"
                className="members-cancel-button"
                disabled={
                  saving
                }
                onClick={
                  closeAddForm
                }
              >
                キャンセル
              </button>
            </footer>
          </section>
        </div>
      )}

      {showBulkEdit && (
        <div className="members-bulk-background">
          <section className="members-bulk-window">
            <header className="members-bulk-header">
              <div>
                <h2>
                  今年の部員名をまとめて変更
                </h2>

                <p>
                  {eventName ||
                    "現在のイベント"}
                  に参加する部員名を入力してください
                </p>
              </div>

              <button
                type="button"
                className="members-bulk-close"
                disabled={
                  saving
                }
                onClick={() =>
                  setShowBulkEdit(
                    false
                  )
                }
              >
                ×
              </button>
            </header>

            <div className="members-bulk-table-wrapper">
              <table className="members-bulk-table">
                <thead>
                  <tr>
                    <th>
                      QR番号
                    </th>

                    <th>
                      このイベントでの名前
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {memberCards.map(
                    (card) => (
                      <tr
                        key={
                          card.id
                        }
                      >
                        <td>
                          {
                            card.qrNumber
                          }
                        </td>

                        <td>
                          <input
                            type="text"
                            value={
                              bulkNames[
                                card.qrNumber
                              ] ?? ""
                            }
                            disabled={
                              saving
                            }
                            onChange={(
                              event
                            ) =>
                              updateBulkName(
                                card.qrNumber,
                                event.target.value
                              )
                            }
                            placeholder="参加しない場合は空欄"
                          />
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>

            <footer className="members-bulk-buttons">
              <button
                type="button"
                className="members-bulk-save"
                disabled={
                  saving
                }
                onClick={() => {
                  void saveBulkNames();
                }}
              >
                {saving
                  ? "保存しています…"
                  : "名前をまとめて保存"}
              </button>

              <button
                type="button"
                className="members-bulk-clear"
                disabled={
                  saving
                }
                onClick={
                  clearBulkNames
                }
              >
                全員の名前を空欄にする
              </button>

              <button
                type="button"
                className="members-bulk-cancel"
                disabled={
                  saving
                }
                onClick={() =>
                  setShowBulkEdit(
                    false
                  )
                }
              >
                キャンセル
              </button>
            </footer>
          </section>
        </div>
      )}

      {selectedMember !==
        null && (
        <div
          className="member-qr-modal-background"
          onClick={() =>
            setSelectedMemberQrNumber(
              null
            )
          }
        >
          <section
            className="member-qr-modal"
            onClick={(
              event
            ) =>
              event.stopPropagation()
            }
          >
            <button
              type="button"
              className="member-qr-close-button"
              onClick={() =>
                setSelectedMemberQrNumber(
                  null
                )
              }
            >
              ×
            </button>

            <div className="member-print-area">
              <h2>
                部員QRコード
              </h2>

              <div className="member-qr-code">
                <QRCodeSVG
                  value={createQrValue(
                    selectedMember
                  )}
                  size={
                    320
                  }
                  level="M"
                  marginSize={
                    1
                  }
                />
              </div>

              <p className="member-qr-name">
                {selectedMember.name ||
                  "名前未設定"}
              </p>

              <p className="member-qr-number">
                {
                  selectedMember.qrNumber
                }
              </p>
            </div>

            <div className="member-qr-modal-buttons">
              <button
                type="button"
                className="member-qr-print-button"
                disabled={
                  saving
                }
                onClick={() => {
                  setDesignerMemberQrNumber(
                    selectedMember.qrNumber
                  );

                  setSelectedMemberQrNumber(
                    null
                  );
                }}
              >
                デザインに貼って印刷
              </button>

              <button
                type="button"
                className="member-qr-regenerate-button"
                disabled={
                  saving
                }
                onClick={() => {
                  void regenerateQr(
                    selectedMember
                  );
                }}
              >
                QRを再発行
              </button>

              <button
                type="button"
                className="member-qr-back-button"
                disabled={
                  saving
                }
                onClick={() =>
                  setSelectedMemberQrNumber(
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

      {designerMember !==
        null && (
        <MemberCardDesigner
          memberName={
            designerMember.name ||
            "名前未設定"
          }
          qrNumber={
            designerMember.qrNumber
          }
          qrValue={createQrValue(
            designerMember
          )}
          onClose={() =>
            setDesignerMemberQrNumber(
              null
            )
          }
        />
      )}
    </div>
  );
}

export default MembersPage;