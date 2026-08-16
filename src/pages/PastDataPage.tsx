import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  subscribeToTickets,
  type Ticket,
} from "../ticketFirestore";

import {
  subscribeToActivityLogs,
  type ActivityLog,
} from "../activityFirestore";

import "./PastDataPage.css";

type EventStatus =
  | "scheduled"
  | "active"
  | "ended";

type EventData = {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  status?: EventStatus;
  endedAt?: string;
};

type PastDataPageProps = {
  setPage: (
    page: string
  ) => void;

  events:
    EventData[];
};

type HourData = {
  label: string;
  count: number;
};

type PastEventAnalysis = {
  totalVisitors: number;

  averageStayMinutes:
    | number
    | null;

  reEntryCount: number;

  ticketCount: number;

  activityCount: number;

  remainingInside: number;

  hourData:
    HourData[];
};

function createEventDateTime(
  date: string,
  time: string
) {
  const dateTime =
    new Date(
      `${date}T${time}`
    );

  if (
    !Number.isFinite(
      dateTime.getTime()
    )
  ) {
    return null;
  }

  return dateTime;
}

function isEndedEvent(
  eventData: EventData
) {
  if (
    eventData.status ===
      "ended" ||
    typeof eventData.endedAt ===
      "string"
  ) {
    return true;
  }

  const endDate =
    createEventDateTime(
      eventData.date,
      eventData.endTime
    );

  if (
    endDate ===
    null
  ) {
    return false;
  }

  return (
    Date.now() >=
    endDate.getTime()
  );
}

function calculateAverageStayMinutes(
  logs: ActivityLog[]
) {
  const ticketLogs =
    logs.filter(
      (log) =>
        log.type ===
          "ticket-entry" ||
        log.type ===
          "ticket-exit"
    );

  const entryTimes =
    new Map<
      string,
      number
    >();

  const stayTimes:
    number[] = [];

  ticketLogs.forEach(
    (log) => {
      const logTime =
        new Date(
          log.timestamp
        ).getTime();

      if (
        !Number.isFinite(
          logTime
        )
      ) {
        return;
      }

      if (
        log.type ===
        "ticket-entry"
      ) {
        entryTimes.set(
          log.qrNumber,
          logTime
        );

        return;
      }

      const entryTime =
        entryTimes.get(
          log.qrNumber
        );

      if (
        entryTime ===
        undefined
      ) {
        return;
      }

      const stayTime =
        logTime -
        entryTime;

      if (
        stayTime >=
        0
      ) {
        stayTimes.push(
          stayTime
        );
      }

      entryTimes.delete(
        log.qrNumber
      );
    }
  );

  if (
    stayTimes.length ===
    0
  ) {
    return null;
  }

  const totalStayTime =
    stayTimes.reduce(
      (
        total,
        stayTime
      ) =>
        total +
        stayTime,
      0
    );

  return Math.round(
    totalStayTime /
      stayTimes.length /
      1000 /
      60
  );
}

function createHourData(
  logs: ActivityLog[],
  eventData: EventData
): HourData[] {
  const entryLogs =
    logs.filter(
      (log) =>
        log.type ===
        "ticket-entry"
    );

  const startDate =
    createEventDateTime(
      eventData.date,
      eventData.startTime
    );

  const endDate =
    createEventDateTime(
      eventData.date,
      eventData.endTime
    );

  if (
    startDate ===
      null ||
    endDate ===
      null
  ) {
    return [];
  }

  const firstHour =
    new Date(
      startDate
    );

  firstHour.setMinutes(
    0,
    0,
    0
  );

  const finalHour =
    new Date(
      endDate
    );

  finalHour.setMinutes(
    0,
    0,
    0
  );

  const hourData:
    HourData[] = [];

  const currentHour =
    new Date(
      firstHour
    );

  while (
    currentHour.getTime() <=
    finalHour.getTime()
  ) {
    const hourStart =
      currentHour.getTime();

    const hourEnd =
      hourStart +
      60 *
        60 *
        1000;

    const count =
      entryLogs.filter(
        (log) => {
          const logTime =
            new Date(
              log.timestamp
            ).getTime();

          return (
            logTime >=
              hourStart &&
            logTime <
              hourEnd
          );
        }
      ).length;

    hourData.push({
      label:
        `${String(
          currentHour.getHours()
        ).padStart(
          2,
          "0"
        )}:00`,

      count,
    });

    currentHour.setHours(
      currentHour.getHours() +
        1
    );
  }

  return hourData;
}

function createPastEventAnalysis(
  eventData: EventData,
  tickets: Ticket[],
  logs: ActivityLog[]
): PastEventAnalysis {
  const uniqueVisitorQrNumbers =
    new Set(
      logs
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

  const totalVisitors =
    Math.max(
      uniqueVisitorQrNumbers.size,
      visitorCountFromStatus
    );

  const remainingInside =
    tickets.filter(
      (ticket) =>
        ticket.status ===
        "入場中"
    ).length;

  const reEntryCount =
    logs.filter(
      (log) =>
        log.type ===
          "ticket-entry" &&
        log.isReEntry ===
          true
    ).length;

  return {
    totalVisitors,

    averageStayMinutes:
      calculateAverageStayMinutes(
        logs
      ),

    reEntryCount,

    ticketCount:
      tickets.length,

    activityCount:
      logs.length,

    remainingInside,

    hourData:
      createHourData(
        logs,
        eventData
      ),
  };
}

function formatEventDate(
  date: string
) {
  const dateObject =
    new Date(
      `${date}T00:00`
    );

  if (
    !Number.isFinite(
      dateObject.getTime()
    )
  ) {
    return date;
  }

  return new Intl.DateTimeFormat(
    "ja-JP",
    {
      year:
        "numeric",

      month:
        "long",

      day:
        "numeric",

      weekday:
        "short",
    }
  ).format(
    dateObject
  );
}

function formatShortDate(
  date: string
) {
  const parts =
    date.split("-");

  if (
    parts.length !==
    3
  ) {
    return date;
  }

  return `${Number(
    parts[1]
  )}/${Number(
    parts[2]
  )}`;
}

function formatEndedAt(
  eventData: EventData
) {
  if (
    typeof eventData.endedAt !==
    "string"
  ) {
    return `${eventData.date} ${eventData.endTime}`;
  }

  const endedDate =
    new Date(
      eventData.endedAt
    );

  if (
    !Number.isFinite(
      endedDate.getTime()
    )
  ) {
    return `${eventData.date} ${eventData.endTime}`;
  }

  return new Intl.DateTimeFormat(
    "ja-JP",
    {
      year:
        "numeric",

      month:
        "long",

      day:
        "numeric",

      hour:
        "2-digit",

      minute:
        "2-digit",

      hour12:
        false,
    }
  ).format(
    endedDate
  );
}

function createSafeFileName(
  eventName: string
) {
  const safeName =
    eventName
      .trim()
      .replace(
        /[\\/:*?"<>|]/g,
        "_"
      );

  return safeName ===
    ""
    ? "イベント分析データ"
    : safeName;
}

function PastDataPage({
  setPage,
  events,
}: PastDataPageProps) {
  const reportRef =
    useRef<HTMLElement | null>(
      null
    );

  const [
    tickets,
    setTickets,
  ] = useState<Ticket[]>(
    []
  );

  const [
    activityLogs,
    setActivityLogs,
  ] = useState<ActivityLog[]>(
    []
  );

  const [
    ticketsLoading,
    setTicketsLoading,
  ] = useState(
    false
  );

  const [
    activityLoading,
    setActivityLoading,
  ] = useState(
    false
  );

  const [
    loadingError,
    setLoadingError,
  ] = useState("");

  const [
    isCreatingPdf,
    setIsCreatingPdf,
  ] = useState(
    false
  );

  const endedEvents =
    useMemo(
      () =>
        events
          .filter(
            isEndedEvent
          )
          .sort(
            (
              first,
              second
            ) => {
              const firstDate =
                createEventDateTime(
                  first.date,
                  first.startTime
                )?.getTime() ??
                0;

              const secondDate =
                createEventDateTime(
                  second.date,
                  second.startTime
                )?.getTime() ??
                0;

              return (
                secondDate -
                firstDate
              );
            }
          ),
      [
        events,
      ]
    );

  const [
    selectedEventId,
    setSelectedEventId,
  ] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (
      endedEvents.length ===
      0
    ) {
      setSelectedEventId(
        null
      );

      return;
    }

    const selectedEventStillExists =
      endedEvents.some(
        (event) =>
          event.id ===
          selectedEventId
      );

    if (
      !selectedEventStillExists
    ) {
      setSelectedEventId(
        endedEvents[0].id
      );
    }
  }, [
    endedEvents,
    selectedEventId,
  ]);

  const selectedEvent =
    endedEvents.find(
      (event) =>
        event.id ===
        selectedEventId
    ) ??
    endedEvents[0] ??
    null;

  useEffect(() => {
    setTickets([]);
    setActivityLogs([]);
    setLoadingError("");

    if (
      selectedEvent ===
      null
    ) {
      setTicketsLoading(
        false
      );

      setActivityLoading(
        false
      );

      return;
    }

    setTicketsLoading(
      true
    );

    setActivityLoading(
      true
    );

    const unsubscribeTickets =
      subscribeToTickets(
        selectedEvent.name,

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
            "過去イベントのチケット情報を取得できませんでした。",
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

    const unsubscribeActivity =
      subscribeToActivityLogs(
        selectedEvent.name,

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
            "過去イベントの受付履歴を取得できませんでした。",
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

    return () => {
      unsubscribeTickets();
      unsubscribeActivity();
    };
  }, [
    selectedEvent?.id,
    selectedEvent?.name,
  ]);

  const analysis =
    useMemo(
      () =>
        selectedEvent ===
        null
          ? null
          : createPastEventAnalysis(
              selectedEvent,
              tickets,
              activityLogs
            ),
      [
        activityLogs,
        selectedEvent,
        tickets,
      ]
    );

  const maximumHourCount =
    analysis ===
    null
      ? 1
      : Math.max(
          ...analysis.hourData.map(
            (hour) =>
              hour.count
          ),
          1
        );

  const middleHourCount =
    Math.ceil(
      maximumHourCount /
        2
    );

  const loading =
    ticketsLoading ||
    activityLoading;

  const handleCreatePdf =
    async () => {
      if (
        selectedEvent ===
          null ||
        reportRef.current ===
          null ||
        isCreatingPdf ||
        loading
      ) {
        return;
      }

      try {
        setIsCreatingPdf(
          true
        );

        const [
          html2canvasModule,
          jsPdfModule,
        ] = await Promise.all([
          import("html2canvas"),
          import("jspdf"),
        ]);

        const html2canvas =
          html2canvasModule.default;

        const {
          jsPDF,
        } = jsPdfModule;

        const reportElement =
          reportRef.current;

        const canvas =
          await html2canvas(
            reportElement,
            {
              scale:
                2,

              useCORS:
                true,

              backgroundColor:
                "#ffffff",

              logging:
                false,

              width:
                reportElement.scrollWidth,

              height:
                reportElement.scrollHeight,

              windowWidth:
                reportElement.scrollWidth,

              windowHeight:
                reportElement.scrollHeight,

              scrollX:
                0,

              scrollY:
                0,

              onclone: (
                clonedDocument
              ) => {
                const clonedReport =
                  clonedDocument.querySelector(
                    ".past-data-report"
                  ) as
                    HTMLElement |
                    null;

                const clonedChart =
                  clonedDocument.querySelector(
                    ".past-data-chart"
                  ) as
                    HTMLElement |
                    null;

                const clonedChartPanel =
                  clonedDocument.querySelector(
                    ".past-data-chart-panel"
                  ) as
                    HTMLElement |
                    null;

                if (
                  clonedReport !==
                  null
                ) {
                  clonedReport.style.width =
                    `${reportElement.scrollWidth}px`;

                  clonedReport.style.maxWidth =
                    "none";

                  clonedReport.style.overflow =
                    "hidden";

                  clonedReport.style.boxShadow =
                    "none";

                  clonedReport.style.margin =
                    "0";
                }

                if (
                  clonedChartPanel !==
                  null
                ) {
                  clonedChartPanel.style.overflow =
                    "hidden";
                }

                if (
                  clonedChart !==
                  null
                ) {
                  clonedChart.style.width =
                    "100%";

                  clonedChart.style.maxWidth =
                    "100%";

                  clonedChart.style.overflow =
                    "hidden";
                }
              },
            }
          );

        const imageData =
          canvas.toDataURL(
            "image/jpeg",
            0.95
          );

        const pdf =
          new jsPDF({
            orientation:
              "landscape",

            unit:
              "mm",

            format:
              "a4",

            compress:
              true,
          });

        const pageWidth =
          pdf.internal.pageSize.getWidth();

        const pageHeight =
          pdf.internal.pageSize.getHeight();

        const margin =
          8;

        const printableWidth =
          pageWidth -
          margin *
            2;

        const printableHeight =
          pageHeight -
          margin *
            2;

        const widthScale =
          printableWidth /
          canvas.width;

        const heightScale =
          printableHeight /
          canvas.height;

        const fitScale =
          Math.min(
            widthScale,
            heightScale
          );

        const imageWidth =
          canvas.width *
          fitScale;

        const imageHeight =
          canvas.height *
          fitScale;

        const imageX =
          (
            pageWidth -
            imageWidth
          ) /
          2;

        const imageY =
          (
            pageHeight -
            imageHeight
          ) /
          2;

        pdf.addImage(
          imageData,
          "JPEG",
          imageX,
          imageY,
          imageWidth,
          imageHeight,
          undefined,
          "FAST"
        );

        const fileName =
          `${createSafeFileName(
            selectedEvent.name
          )}_分析データ.pdf`;

        pdf.save(
          fileName
        );
      } catch (error) {
        console.error(
          "PDFの作成に失敗しました。",
          error
        );

        alert(
          "PDFを作成できませんでした。もう一度試してください。"
        );
      } finally {
        setIsCreatingPdf(
          false
        );
      }
    };

  return (
    <div className="past-data-page">
      <header className="past-data-header">
        <div>
          <h1>
            交通研究部QRコード管理システム
          </h1>

          <h2>
            過去のデータ
          </h2>
        </div>

        <div className="past-data-mode-label">
          管理モード
        </div>
      </header>

      {endedEvents.length ===
      0 ? (
        <main className="past-data-empty">
          <div className="past-data-empty-icon">
            📊
          </div>

          <h3>
            終了したイベントがありません
          </h3>

          <p>
            イベントが終了すると、ここから分析結果を確認できます。
          </p>
        </main>
      ) : (
        <main className="past-data-content">
          <aside className="past-data-event-list">
            <div className="past-data-list-header">
              <h3>
                終了イベント
              </h3>

              <span>
                {
                  endedEvents.length
                }
                件
              </span>
            </div>

            <div className="past-data-list-scroll">
              {endedEvents.map(
                (event) => (
                  <button
                    type="button"
                    className={`past-data-event-button ${
                      selectedEvent?.id ===
                      event.id
                        ? "selected"
                        : ""
                    }`}
                    key={
                      event.id
                    }
                    disabled={
                      isCreatingPdf
                    }
                    onClick={() =>
                      setSelectedEventId(
                        event.id
                      )
                    }
                  >
                    <strong>
                      {
                        event.name
                      }
                    </strong>

                    <span>
                      {formatShortDate(
                        event.date
                      )}
                    </span>

                    <small>
                      終了
                    </small>
                  </button>
                )
              )}
            </div>
          </aside>

          {loading ? (
            <section className="past-data-empty">
              <div className="past-data-empty-icon">
                📡
              </div>

              <h3>
                データを読み込んでいます
              </h3>

              <p>
                Firebaseから過去イベントの記録を取得しています。
              </p>
            </section>
          ) : loadingError !==
            "" ? (
            <section className="past-data-empty">
              <div className="past-data-empty-icon">
                ⚠
              </div>

              <h3>
                データを読み込めませんでした
              </h3>

              <p>
                {
                  loadingError
                }
              </p>
            </section>
          ) : selectedEvent !==
              null &&
            analysis !==
              null ? (
            <article
              className="past-data-report"
              ref={
                reportRef
              }
            >
              <header className="past-data-report-header">
                <div>
                  <p>
                    イベント分析報告
                  </p>

                  <h3>
                    {
                      selectedEvent.name
                    }
                  </h3>
                </div>

                <div className="past-data-ended-label">
                  終了済み
                </div>
              </header>

              <section className="past-data-event-information">
                <div>
                  <span>
                    開催日
                  </span>

                  <strong>
                    {formatEventDate(
                      selectedEvent.date
                    )}
                  </strong>
                </div>

                <div>
                  <span>
                    受付時間
                  </span>

                  <strong>
                    {
                      selectedEvent.startTime
                    }
                    {" ～ "}
                    {
                      selectedEvent.endTime
                    }
                  </strong>
                </div>

                <div>
                  <span>
                    終了日時
                  </span>

                  <strong>
                    {formatEndedAt(
                      selectedEvent
                    )}
                  </strong>
                </div>
              </section>

              <section className="past-data-summary-grid">
                <div className="past-data-summary-card visitors">
                  <span>
                    合計来場者数
                  </span>

                  <strong>
                    {
                      analysis.totalVisitors
                    }
                    人
                  </strong>
                </div>

                <div className="past-data-summary-card stay">
                  <span>
                    平均滞在時間
                  </span>

                  <strong>
                    {analysis.averageStayMinutes ===
                    null
                      ? "―"
                      : `${analysis.averageStayMinutes}分`}
                  </strong>
                </div>

                <div className="past-data-summary-card reentry">
                  <span>
                    再入場数
                  </span>

                  <strong>
                    {
                      analysis.reEntryCount
                    }
                    回
                  </strong>
                </div>

                <div className="past-data-summary-card tickets">
                  <span>
                    発行チケット
                  </span>

                  <strong>
                    {
                      analysis.ticketCount
                    }
                    枚
                  </strong>
                </div>
              </section>

              <section className="past-data-chart-panel">
                <div className="past-data-chart-title">
                  <div>
                    <h4>
                      時間帯別入場者数
                    </h4>

                    <p>
                      再入場を含む受付回数
                    </p>
                  </div>

                  <span>
                    受付履歴{" "}
                    {
                      analysis.activityCount
                    }
                    件
                  </span>
                </div>

                {analysis.hourData.length ===
                0 ? (
                  <div className="past-data-no-chart">
                    入場履歴がありません
                  </div>
                ) : (
                  <div
                    className="past-data-chart"
                    role="img"
                    aria-label={`時間帯別入場者数。${analysis.hourData
                      .map(
                        (hour) =>
                          `${hour.label} ${hour.count}人`
                      )
                      .join("、")}`}
                  >
                    <div
                      className="past-data-chart-scale"
                      aria-hidden="true"
                    >
                      <strong>
                        人数
                      </strong>

                      <div>
                        <span>
                          {
                            maximumHourCount
                          }
                        </span>

                        <span>
                          {
                            middleHourCount
                          }
                        </span>

                        <span>
                          0
                        </span>
                      </div>
                    </div>

                    {analysis.hourData.map(
                      (
                        hour
                      ) => {
                        const barHeight =
                          hour.count ===
                          0
                            ? 0
                            : Math.max(
                                8,
                                (
                                  hour.count /
                                  maximumHourCount
                                ) *
                                  100
                              );

                        return (
                          <div
                            className="past-data-chart-column"
                            key={
                              hour.label
                            }
                          >
                            <strong>
                              {
                                hour.count
                              }
                            </strong>

                            <div className="past-data-chart-bar-area">
                              <div
                                className="past-data-chart-bar"
                                style={{
                                  height:
                                    `${barHeight}%`,
                                }}
                              />
                            </div>

                            <span>
                              {
                                hour.label
                              }
                            </span>
                          </div>
                        );
                      }
                    )}
                  </div>
                )}
              </section>

              {analysis.remainingInside >
                0 && (
                <div className="past-data-warning">
                  終了時点で「入場中」のままになっているチケットが
                  {
                    analysis.remainingInside
                  }
                  枚あります。
                </div>
              )}

              <footer className="past-data-report-footer">
                交通研究部QRコード管理システム
              </footer>
            </article>
          ) : null}
        </main>
      )}

      <div className="past-data-actions">
        <button
          type="button"
          className="past-data-return-button"
          disabled={
            isCreatingPdf
          }
          onClick={() =>
            setPage(
              "analysis"
            )
          }
        >
          前のページに戻る
        </button>

        <button
          type="button"
          className="past-data-print-button"
          disabled={
            selectedEvent ===
              null ||
            isCreatingPdf ||
            loading ||
            loadingError !==
              ""
          }
          onClick={() => {
            void handleCreatePdf();
          }}
        >
          {isCreatingPdf
            ? "PDFを作成中…"
            : loading
              ? "データ読込中…"
              : "PDFとして保存"}
        </button>
      </div>
    </div>
  );
}

export default PastDataPage;
