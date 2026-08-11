import {
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  ReactNode,
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

type MetricCardProps = {
  className: string;
  icon: ReactNode;
  label: string;
  value: number;
  unit: string;
};

type MenuCardProps = {
  className: string;
  icon: ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
  onClick:
    () => void;
};

const EMPTY_RECEPTION_SUMMARY:
  ReceptionPresenceSummary = {
  entryCount: 0,
  exitCount: 0,
  devices: [],
};

function VisitorsIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <circle
        cx="25"
        cy="22"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M8 52C10 40 16 34 25 34C34 34 40 40 42 52"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <circle
        cx="46"
        cy="24"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M43 37C51 37 56 42 57 51"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InsideIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M11 28L32 10L53 28"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M16 25V54H48V25"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <circle
        cx="32"
        cy="35"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M23 51C24 44 27 41 32 41C37 41 40 44 41 51"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MembersIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <circle
        cx="32"
        cy="20"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M13 53C15 39 22 33 32 33C42 33 49 39 51 53"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M25 42L32 49L39 42"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReEntryIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M16 20C21 13 28 10 36 11C47 13 55 22 55 33"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M47 18L56 33L41 34"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M48 45C43 52 36 55 28 53C17 51 9 42 9 31"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M17 46L8 31L23 30"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EntryDeviceIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <rect
        x="14"
        y="7"
        width="36"
        height="50"
        rx="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M20 30H42"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M34 22L43 30L34 38"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle
        cx="32"
        cy="50"
        r="2"
        fill="currentColor"
      />
    </svg>
  );
}

function ExitDeviceIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <rect
        x="14"
        y="7"
        width="36"
        height="50"
        rx="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M22 30H44"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M30 22L21 30L30 38"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle
        cx="32"
        cy="50"
        r="2"
        fill="currentColor"
      />
    </svg>
  );
}

function AnalysisIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M11 53V11"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M11 53H55"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M18 44L28 33L37 39L52 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle
        cx="52"
        cy="20"
        r="4"
        fill="currentColor"
      />
    </svg>
  );
}

function MemberManagementIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <circle
        cx="25"
        cy="22"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M9 51C11 39 17 34 25 34C32 34 37 38 40 45"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M45 34V52"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M36 43H54"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TicketIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M10 18C15 18 18 15 18 10H54V25C49 25 46 28 46 32C46 36 49 39 54 39V54H18C18 49 15 46 10 46V18Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <path
        d="M31 15V49"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="5 7"
      />
    </svg>
  );
}

function EventIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <rect
        x="9"
        y="14"
        width="46"
        height="41"
        rx="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M9 27H55"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M21 8V20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M43 8V20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />

      <path
        d="M24 41L30 47L42 35"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <g fill="currentColor">
        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(45 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(90 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(135 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(180 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(225 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(270 32 32)"
        />

        <rect
          x="29"
          y="5"
          width="6"
          height="12"
          rx="2"
          transform="rotate(315 32 32)"
        />
      </g>

      <circle
        cx="32"
        cy="32"
        r="17"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <circle
        cx="32"
        cy="32"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />
    </svg>
  );
}

function AdminModeIcon() {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M32 7L51 15V29C51 42 43 52 32 57C21 52 13 42 13 29V15L32 7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
      />

      <circle
        cx="32"
        cy="27"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
      />

      <path
        d="M22 45C24 38 27 35 32 35C37 35 40 38 42 45"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <path
        d="M7 16H24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />

      <path
        d="M18 9L25 16L18 23"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReturnIcon() {
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

function MetricCard({
  className,
  icon,
  label,
  value,
  unit,
}: MetricCardProps) {
  return (
    <div
      className={`admin-metric-card ${className}`}
    >
      <div className="admin-metric-header">
        <span className="admin-metric-icon">
          {icon}
        </span>

        <span className="admin-metric-label">
          {label}
        </span>
      </div>

      <strong className="admin-metric-value">
        {value}

        <small>
          {unit}
        </small>
      </strong>
    </div>
  );
}

function MenuCard({
  className,
  icon,
  title,
  description,
  disabled = false,
  onClick,
}: MenuCardProps) {
  return (
    <button
      type="button"
      className={`admin-menu-card ${className}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="admin-menu-card-icon">
        {icon}
      </span>

      <span className="admin-menu-card-copy">
        <strong>
          {title}
        </strong>

        <small>
          {disabled
            ? "イベントの設定が必要です"
            : description}
        </small>
      </span>

      <span className="admin-menu-card-arrow">
        <ArrowIcon />
      </span>
    </button>
  );
}

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
      <div className="admin-background-circle admin-background-circle-one" />

      <div className="admin-background-circle admin-background-circle-two" />

      <header className="admin-header">
        <div className="admin-header-main">
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <div className="admin-header-status">
            <OnlineStatus />

            <span
              className="admin-header-divider"
              aria-hidden="true"
            />

            <div
              className={
                eventConfigured
                  ? "admin-event-pill"
                  : "admin-event-pill admin-event-pill-warning"
              }
            >
              <span>
                EVENT
              </span>

              <strong>
                {eventConfigured
                  ? eventName
                  : "イベントを設定してください"}
              </strong>
            </div>
          </div>
        </div>

        <div className="admin-mode-label">
          <span className="admin-mode-icon">
            <AdminModeIcon />
          </span>

          <span className="admin-mode-copy">
            <small>
              ADMIN
            </small>

            <strong>
              管理モード
            </strong>
          </span>
        </div>
      </header>

      <main className="admin-content">
        <section className="admin-status-panel">
          <div className="admin-panel-heading">
            <div>
              <span className="admin-panel-eyebrow">
                LIVE STATUS
              </span>

              <h2>
                現在の状況
              </h2>
            </div>

            {loadingError !==
            "" ? (
              <div className="admin-data-state admin-data-error">
                <span />

                読み込みエラー
              </div>
            ) : loading &&
              eventConfigured ? (
              <div className="admin-data-state admin-data-loading">
                <span />

                更新中
              </div>
            ) : eventConfigured ? (
              <div className="admin-data-state admin-data-live">
                <span />

                リアルタイム
              </div>
            ) : (
              <div className="admin-data-state admin-data-waiting">
                <span />

                イベント未設定
              </div>
            )}
          </div>

          {loadingError !==
            "" && (
            <p className="admin-loading-message">
              {loadingError}
            </p>
          )}

          <div className="admin-status-grid">
            <MetricCard
              className="admin-metric-visitors"
              icon={
                <VisitorsIcon />
              }
              label="来場者数"
              value={
                statusData.visitorCount
              }
              unit="人"
            />

            <MetricCard
              className="admin-metric-inside"
              icon={
                <InsideIcon />
              }
              label="室内人数"
              value={
                statusData.insideCount
              }
              unit="人"
            />

            <MetricCard
              className="admin-metric-members"
              icon={
                <MembersIcon />
              }
              label="部員人数"
              value={
                statusData.memberCount
              }
              unit="人"
            />

            <MetricCard
              className="admin-metric-reentry"
              icon={
                <ReEntryIcon />
              }
              label="再入場数"
              value={
                statusData.reEntryCount
              }
              unit="回"
            />
          </div>

          <div className="admin-reception-status">
            <div className="admin-reception-device admin-entry-device">
              <span className="admin-reception-device-icon">
                <EntryDeviceIcon />
              </span>

              <span className="admin-reception-device-copy">
                <small>
                  稼働中の端末
                </small>

                <strong>
                  入口受付
                </strong>
              </span>

              <span className="admin-reception-device-value">
                {
                  statusData.entryReceptionCount
                }

                <small>
                  台
                </small>
              </span>
            </div>

            <div className="admin-reception-device admin-exit-device">
              <span className="admin-reception-device-icon">
                <ExitDeviceIcon />
              </span>

              <span className="admin-reception-device-copy">
                <small>
                  稼働中の端末
                </small>

                <strong>
                  出口受付
                </strong>
              </span>

              <span className="admin-reception-device-value">
                {
                  statusData.exitReceptionCount
                }

                <small>
                  台
                </small>
              </span>
            </div>
          </div>
        </section>

        <section className="admin-menu-panel">
          <div className="admin-panel-heading admin-menu-heading">
            <div>
              <span className="admin-panel-eyebrow">
                MANAGEMENT
              </span>

              <h2>
                管理メニュー
              </h2>
            </div>

            <p>
              操作する項目を選択してください
            </p>
          </div>

          <div className="admin-menu-grid">
            <MenuCard
              className="admin-analysis-card"
              icon={
                <AnalysisIcon />
              }
              title="分析"
              description="来場者数や時間帯別の状況を確認"
              onClick={() =>
                setPage(
                  "analysis"
                )
              }
            />

            <MenuCard
              className="admin-events-card"
              icon={
                <EventIcon />
              }
              title="イベント管理"
              description="イベントの作成・設定・終了"
              onClick={() =>
                setPage(
                  "events"
                )
              }
            />

            <MenuCard
              className="admin-members-card"
              icon={
                <MemberManagementIcon />
              }
              title="部員管理"
              description="部員名や部員QRを管理"
              disabled={
                !eventConfigured
              }
              onClick={() =>
                setPage(
                  "members"
                )
              }
            />

            <MenuCard
              className="admin-tickets-card"
              icon={
                <TicketIcon />
              }
              title="チケット管理"
              description="チケットの発行・印刷・状態確認"
              disabled={
                !eventConfigured
              }
              onClick={() =>
                setPage(
                  "tickets"
                )
              }
            />

            <MenuCard
              className="admin-settings-card"
              icon={
                <SettingsIcon />
              }
              title="設定"
              description="システム情報や初期化などの設定"
              onClick={() =>
                setPage(
                  "settings"
                )
              }
            />
          </div>
        </section>
      </main>

      <footer className="admin-footer">
        <button
          type="button"
          className="admin-return-button"
          onClick={
            onReturn
          }
        >
          <span className="admin-return-icon">
            <ReturnIcon />
          </span>

          <span>
            {
              getReturnButtonText()
            }
          </span>
        </button>
      </footer>
    </div>
  );
}

export default AdminPage;
