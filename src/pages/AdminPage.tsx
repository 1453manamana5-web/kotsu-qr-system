import {
  useEffect,
  useMemo,
  useState,
} from "react";

import OnlineStatus from "./OnlineStatus";

import {
  subscribeToTickets,
  type Ticket,
} from "../ticketFirestore";

import {
  subscribeToEventMembers,
  type EventMember,
} from "../memberFirestore";

import {
  subscribeToActivityLogs,
  type ActivityLog,
} from "../activityFirestore";

import {
  subscribeToReceptionPresence,
  type ReceptionPresenceSummary,
} from "../receptionPresenceFirestore";

import "./AdminPage.css";

type AdminPageProps = {
  setPage: (
    page: string
  ) => void;

  eventConfigured:
    boolean;

  eventName:
    string;

  adminOrigin:
    | "home"
    | "entry"
    | "exit";

  onReturn:
    () => void;
};

const EMPTY_RECEPTION_SUMMARY:
  ReceptionPresenceSummary = {
  entryCount: 0,
  exitCount: 0,
  devices: [],
};

function AdminPage({
  setPage,
  eventConfigured,
  eventName,
  adminOrigin,
  onReturn,
}: AdminPageProps) {
  const [
    tickets,
    setTickets,
  ] = useState<Ticket[]>(
    []
  );

  const [
    members,
    setMembers,
  ] = useState<EventMember[]>(
    []
  );

  const [
    activityLogs,
    setActivityLogs,
  ] = useState<ActivityLog[]>(
    []
  );

  const [
    receptionPresence,
    setReceptionPresence,
  ] =
    useState<ReceptionPresenceSummary>(
      EMPTY_RECEPTION_SUMMARY
    );

  const [
    ticketsLoading,
    setTicketsLoading,
  ] = useState(false);

  const [
    membersLoading,
    setMembersLoading,
  ] = useState(false);

  const [
    activityLoading,
    setActivityLoading,
  ] = useState(false);

  const [
    presenceLoading,
    setPresenceLoading,
  ] = useState(false);

  const [
    loadingError,
    setLoadingError,
  ] = useState("");

  useEffect(() => {
    setTickets([]);
    setMembers([]);
    setActivityLogs([]);

    setReceptionPresence(
      EMPTY_RECEPTION_SUMMARY
    );

    setLoadingError("");

    if (
      !eventConfigured ||
      eventName.trim() === ""
    ) {
      setTicketsLoading(
        false
      );

      setMembersLoading(
        false
      );

      setActivityLoading(
        false
      );

      setPresenceLoading(
        false
      );

      return;
    }

    setTicketsLoading(
      true
    );

    setMembersLoading(
      true
    );

    setActivityLoading(
      true
    );

    setPresenceLoading(
      true
    );

    const unsubscribeTickets =
      subscribeToTickets(
        eventName,

        (
          updatedTickets
        ) => {
          setTickets(
            updatedTickets
          );

          setTicketsLoading(
            false
          );
        },

        (error) => {
          console.error(
            "管理画面でチケット情報を取得できませんでした。",
            error
          );

          setTicketsLoading(
            false
          );

          setLoadingError(
            "チケット情報を読み込めませんでした。"
          );
        }
      );

    const unsubscribeMembers =
      subscribeToEventMembers(
        eventName,

        (
          updatedMembers
        ) => {
          setMembers(
            updatedMembers
          );

          setMembersLoading(
            false
          );
        },

        (error) => {
          console.error(
            "管理画面で部員情報を取得できませんでした。",
            error
          );

          setMembersLoading(
            false
          );

          setLoadingError(
            "部員情報を読み込めませんでした。"
          );
        }
      );

    const unsubscribeActivity =
      subscribeToActivityLogs(
        eventName,

        (
          updatedLogs
        ) => {
          setActivityLogs(
            updatedLogs
          );

          setActivityLoading(
            false
          );
        },

        (error) => {
          console.error(
            "管理画面で受付履歴を取得できませんでした。",
            error
          );

          setActivityLoading(
            false
          );

          setLoadingError(
            "受付履歴を読み込めませんでした。"
          );
        }
      );

    const unsubscribePresence =
      subscribeToReceptionPresence(
        eventName,

        (
          updatedPresence
        ) => {
          setReceptionPresence(
            updatedPresence
          );

          setPresenceLoading(
            false
          );
        },

        (error) => {
          console.error(
            "管理画面で受付端末の稼働状況を取得できませんでした。",
            error
          );

          setPresenceLoading(
            false
          );

          setLoadingError(
            "受付端末の稼働状況を読み込めませんでした。"
          );
        }
      );

    return () => {
      unsubscribeTickets();
      unsubscribeMembers();
      unsubscribeActivity();
      unsubscribePresence();
    };
  }, [
    eventConfigured,
    eventName,
  ]);

  const statusData =
    useMemo(() => {
      if (
        !eventConfigured ||
        eventName.trim() === ""
      ) {
        return {
          visitorCount:
            0,

          insideCount:
            0,

          memberCount:
            0,

          reEntryCount:
            0,

          entryReceptionCount:
            0,

          exitReceptionCount:
            0,
        };
      }

      const firstEntryQrNumbers =
        new Set(
          activityLogs
            .filter(
              (log) =>
                log.type ===
                  "ticket-entry" &&
                log.isReEntry !==
                  true
            )
            .map(
              (log) =>
                log.qrNumber
            )
        );

      const visitorCountFromStatus =
        tickets.filter(
          (ticket) =>
            ticket.status ===
              "入場中" ||
            ticket.status ===
              "使用済み"
        ).length;

      const visitorCount =
        Math.max(
          firstEntryQrNumbers.size,
          visitorCountFromStatus
        );

      const insideCount =
        tickets.filter(
          (ticket) =>
            ticket.status ===
            "入場中"
        ).length;

      const memberCount =
        members.filter(
          (member) =>
            member.status ===
            "入室中"
        ).length;

      const reEntryCount =
        activityLogs.filter(
          (log) =>
            log.type ===
              "ticket-entry" &&
            log.isReEntry ===
              true
        ).length;

      return {
        visitorCount,
        insideCount,
        memberCount,
        reEntryCount,

        entryReceptionCount:
          receptionPresence.entryCount,

        exitReceptionCount:
          receptionPresence.exitCount,
      };
    }, [
      activityLogs,
      eventConfigured,
      eventName,
      members,
      receptionPresence,
      tickets,
    ]);

  const loading =
    ticketsLoading ||
    membersLoading ||
    activityLoading ||
    presenceLoading;

  const getReturnButtonText =
    () => {
      if (
        adminOrigin ===
        "entry"
      ) {
        return "入口受付に戻る";
      }

      if (
        adminOrigin ===
        "exit"
      ) {
        return "出口受付に戻る";
      }

      return "保存して終了";
    };

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div>
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <OnlineStatus />

          {eventConfigured ? (
            <div className="admin-event-name">
              イベント名　
              {eventName}
            </div>
          ) : (
            <div className="admin-warning">
              ⚠ イベントを設定してください
            </div>
          )}
        </div>

        <div className="admin-mode-label">
          管理モード
        </div>
      </header>

      <main className="admin-content">
        <section className="status-panel">
          <h2>
            現在の状況
          </h2>

          {loading &&
            eventConfigured && (
            <p>
              Firebaseから最新情報を読み込んでいます…
            </p>
          )}

          {loadingError !==
            "" && (
            <p>
              {loadingError}
            </p>
          )}

          <div className="status-main-list">
            <div className="status-row">
              <span className="status-name">
                来場者数
              </span>

              <strong className="status-value">
                {
                  statusData.visitorCount
                }

                <small>
                  人
                </small>
              </strong>
            </div>

            <div className="status-row">
              <span className="status-name">
                室内人数
              </span>

              <strong className="status-value">
                {
                  statusData.insideCount
                }

                <small>
                  人
                </small>
              </strong>
            </div>

            <div className="status-row">
              <span className="status-name">
                部員人数
              </span>

              <strong className="status-value">
                {
                  statusData.memberCount
                }

                <small>
                  人
                </small>
              </strong>
            </div>

            <div className="status-row">
              <span className="status-name">
                再入場数
              </span>

              <strong className="status-value">
                {
                  statusData.reEntryCount
                }

                <small>
                  回
                </small>
              </strong>
            </div>
          </div>

          <div className="status-reception-list">
            <div className="status-row reception-row">
              <span className="reception-label entry-label">
                入口受付
              </span>

              <strong className="status-value reception-value">
                {
                  statusData.entryReceptionCount
                }

                <small>
                  台
                </small>
              </strong>
            </div>

            <div className="status-row reception-row">
              <span className="reception-label exit-label">
                出口受付
              </span>

              <strong className="status-value reception-value">
                {
                  statusData.exitReceptionCount
                }

                <small>
                  台
                </small>
              </strong>
            </div>
          </div>
        </section>

        <section className="admin-menu">
          <button
            type="button"
            onClick={() =>
              setPage(
                "analysis"
              )
            }
          >
            分析 📈
          </button>

          <button
            type="button"
            disabled={
              !eventConfigured
            }
            onClick={() =>
              setPage(
                "members"
              )
            }
          >
            部員管理
          </button>

          <button
            type="button"
            disabled={
              !eventConfigured
            }
            onClick={() =>
              setPage(
                "tickets"
              )
            }
          >
            チケット管理
          </button>

          <button
            type="button"
            onClick={() =>
              setPage(
                "events"
              )
            }
          >
            イベント管理
          </button>

          <button
            type="button"
            onClick={() =>
              setPage(
                "settings"
              )
            }
          >
            設定 ⚙️
          </button>
        </section>
      </main>

      <button
        type="button"
        className="admin-return-button"
        onClick={
          onReturn
        }
      >
        {
          getReturnButtonText()
        }
      </button>
    </div>
  );
}

export default AdminPage;