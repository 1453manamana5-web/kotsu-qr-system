import {
  type ChangeEvent,
  type CSSProperties,
  useMemo,
  useRef,
  useState,
} from "react";

import LazyQrCode from "./LazyQrCode";

import {
  analyzeTicketBackgroundFromDataUrl,
  type PresetTicketRatio,
} from "../pinkQrMarkerDetection";

import "./TicketDesigner.css";

type TicketStatus =
  | "未使用"
  | "入場中"
  | "使用済み"
  | "無効";

type Ticket = {
  id: string;
  qrNumber: string;
  authToken: string;
  status: TicketStatus;
  createdAt: string;
};

export type CardDesignKind =
  | "ticket"
  | "member";

type TicketDesignerProps = {
  tickets: Ticket[];
  eventName: string;
  initialTicketNumber?: string;
  designKind?: CardDesignKind;
  onClose: () => void;
};

type CardRatio =
  | PresetTicketRatio
  | "custom";

type TicketDesignSettings = {
  backgroundImage: string;

  cardRatio: CardRatio;
  customWidth: number;
  customHeight: number;

  printWidthMm: number;
  cardsPerRow: number;
  printGapMm: number;

  qrX: number;
  qrY: number;
  qrSize: number;

  showTicketNumber: boolean;
  numberX: number;
  numberY: number;
  numberSize: number;
};

type PreviewTicketStyle = CSSProperties & {
  "--ticket-print-width": string;
  "--ticket-print-height": string;
  "--ticket-print-gap": string;
  "--ticket-columns": number;
};

type PrintSheetStyle = CSSProperties & {
  "--ticket-print-width": string;
  "--ticket-print-height": string;
  "--ticket-print-gap": string;
};

type QrMarkerDetectionStatus = {
  kind:
    | "idle"
    | "detecting"
    | "success"
    | "not-found"
    | "error";
  message: string;
};

const defaultSettings: TicketDesignSettings = {
  backgroundImage: "",

  cardRatio: "16:9",
  customWidth: 16,
  customHeight: 9,

  printWidthMm: 90,
  cardsPerRow: 2,
  printGapMm: 4,

  qrX: 76,
  qrY: 50,
  qrSize: 29,

  showTicketNumber: true,
  numberX: 31,
  numberY: 72,
  numberSize: 18,
};

function createQrValue(
  ticket: Ticket,
  designKind: CardDesignKind
) {
  return [
    "QRM1",
    designKind === "member"
      ? "MEMBER"
      : "TICKET",
    ticket.qrNumber,
    ticket.authToken,
  ].join(":");
}

function createDesignStorageKey(
  eventName: string,
  designKind: CardDesignKind
) {
  const safeEventName =
    eventName.trim() === ""
      ? "event-not-set"
      : encodeURIComponent(
          eventName.trim()
        );

  return `qr-management-${designKind}-design-${safeEventName}`;
}

function loadDesignSettings(
  eventName: string,
  designKind: CardDesignKind
): TicketDesignSettings {
  try {
    const savedDesign =
      localStorage.getItem(
        createDesignStorageKey(
          eventName,
          designKind
        )
      ) ??
      (designKind === "member"
        ? localStorage.getItem(
            "qr-management-member-card-design"
          )
        : null);

    if (savedDesign === null) {
      return defaultSettings;
    }

    const parsedDesign =
      JSON.parse(
        savedDesign
      ) as Partial<TicketDesignSettings>;

    return {
      ...defaultSettings,
      ...parsedDesign,
    };
  } catch (error) {
    console.error(
      `${
        designKind === "member"
          ? "部員証"
          : "チケット"
      }デザインの読み込みに失敗しました。`,
      error
    );

    return defaultSettings;
  }
}

function TicketDesigner({
  tickets,
  eventName,
  initialTicketNumber,
  designKind = "ticket",
  onClose,
}: TicketDesignerProps) {
  const isMemberDesign =
    designKind === "member";

  const cardLabel =
    isMemberDesign
      ? "部員証"
      : "チケット";

  const numberLabel =
    isMemberDesign
      ? "部員番号"
      : "チケット番号";

  const printableTickets =
    useMemo(
      () =>
        tickets.filter(
          (ticket) =>
            isMemberDesign ||
            ticket.status !== "無効"
        ),
      [
        isMemberDesign,
        tickets,
      ]
    );

  const foundInitialIndex =
    printableTickets.findIndex(
      (ticket) =>
        ticket.qrNumber ===
        initialTicketNumber
    );

  const initialIndex =
    foundInitialIndex >= 0
      ? foundInitialIndex
      : 0;

  const [settings, setSettings] =
    useState<TicketDesignSettings>(
      () =>
        loadDesignSettings(
          eventName,
          designKind
        )
    );

  const [
    startIndex,
    setStartIndex,
  ] = useState(initialIndex);

  const [
    endIndex,
    setEndIndex,
  ] = useState(
    initialTicketNumber ===
      undefined
      ? Math.max(
          printableTickets.length - 1,
          0
        )
      : initialIndex
  );

  const [
    manualPrintMode,
    setManualPrintMode,
  ] = useState(false);

  const [
    markerDetectionStatus,
    setMarkerDetectionStatus,
  ] = useState<QrMarkerDetectionStatus>({
    kind: "idle",
    message: "",
  });

  const markerDetectionIdRef =
    useRef(0);

  const updateSetting = <
    Key extends keyof TicketDesignSettings,
  >(
    key: Key,
    value: TicketDesignSettings[Key]
  ) => {
    setSettings(
      (currentSettings) => ({
        ...currentSettings,
        [key]: value,
      })
    );
  };

  const getRatioNumbers = () => {
    switch (settings.cardRatio) {
      case "4:3":
        return {
          width: 4,
          height: 3,
        };

      case "3:2":
        return {
          width: 3,
          height: 2,
        };

      case "card":
        return {
          width: 1.586,
          height: 1,
        };

      case "square":
        return {
          width: 1,
          height: 1,
        };

      case "9:16":
        return {
          width: 9,
          height: 16,
        };

      case "custom":
        return {
          width: Math.max(
            1,
            settings.customWidth
          ),
          height: Math.max(
            1,
            settings.customHeight
          ),
        };

      case "16:9":
      default:
        return {
          width: 16,
          height: 9,
        };
    }
  };

  const ratio = getRatioNumbers();

  const safePrintWidth =
    Math.max(
      30,
      settings.printWidthMm
    );

  const printHeightMm =
    safePrintWidth *
    (ratio.height / ratio.width);

  const selectedTickets =
    useMemo(() => {
      if (
        printableTickets.length === 0
      ) {
        return [];
      }

      const safeStart =
        Math.min(
          Math.max(
            startIndex,
            0
          ),
          printableTickets.length - 1
        );

      const safeEnd =
        Math.min(
          Math.max(
            endIndex,
            safeStart
          ),
          printableTickets.length - 1
        );

      return printableTickets.slice(
        safeStart,
        safeEnd + 1
      );
    }, [
      printableTickets,
      startIndex,
      endIndex,
    ]);

  const previewTicket =
    selectedTickets[0] ??
    printableTickets[0] ??
    null;

  const previewTicketStyle:
    PreviewTicketStyle = {
    aspectRatio:
      `${ratio.width} / ${ratio.height}`,

    backgroundImage:
      settings.backgroundImage === ""
        ? undefined
        : `url("${settings.backgroundImage}")`,

    "--ticket-print-width":
      `${safePrintWidth}mm`,

    "--ticket-print-height":
      `${printHeightMm}mm`,

    "--ticket-print-gap":
      `${Math.max(
        0,
        settings.printGapMm
      )}mm`,

    "--ticket-columns":
      Math.max(
        1,
        Math.min(
          4,
          settings.cardsPerRow
        )
      ),
  };

  const printSheetStyle:
    PrintSheetStyle = {
    "--ticket-print-width":
      `${safePrintWidth}mm`,

    "--ticket-print-height":
      `${printHeightMm}mm`,

    "--ticket-print-gap":
      `${Math.max(
        0,
        settings.printGapMm
      )}mm`,
  };

  const handleBackgroundImage = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file =
      event.target.files?.[0];

    event.target.value = "";

    if (file === undefined) {
      return;
    }

    if (
      !file.type.startsWith(
        "image/"
      )
    ) {
      alert(
        "PNGやJPEGなどの画像を選択してください。"
      );

      return;
    }

    const reader =
      new FileReader();

    reader.onload = async () => {
      if (
        typeof reader.result !==
        "string"
      ) {
        return;
      }

      const backgroundImage =
        reader.result;
      const detectionId =
        markerDetectionIdRef.current +
        1;

      markerDetectionIdRef.current =
        detectionId;
      updateSetting(
        "backgroundImage",
        backgroundImage
      );
      setMarkerDetectionStatus({
        kind: "detecting",
        message:
          "画像の縦横比とピンクのQR位置マーカーを解析しています…",
      });

      try {
        const analysis =
          await analyzeTicketBackgroundFromDataUrl(
            backgroundImage
          );
        const marker =
          analysis.marker;

        if (
          markerDetectionIdRef.current !==
          detectionId
        ) {
          return;
        }

        if (marker === null) {
          setSettings(
            (currentSettings) => ({
              ...currentSettings,
              backgroundImage,
              cardRatio:
                analysis.ratio.cardRatio,
            })
          );
          setMarkerDetectionStatus({
            kind: "not-found",
            message:
              `画像比率を${analysis.ratio.label}に自動設定しました。ピンクの正方形は見つからなかったため、QRコード欄のスライダーで手動調整できます。`,
          });

          return;
        }

        const roundPercent = (
          value: number
        ) =>
          Math.round(value * 10) /
          10;
        const clamp = (
          value: number,
          minimum: number,
          maximum: number
        ) =>
          Math.min(
            maximum,
            Math.max(minimum, value)
          );

        setSettings(
          (currentSettings) => ({
            ...currentSettings,
            backgroundImage,
            cardRatio:
              analysis.ratio.cardRatio,
            qrX: roundPercent(
              clamp(
                marker.centerXPercent,
                5,
                95
              )
            ),
            qrY: roundPercent(
              clamp(
                marker.centerYPercent,
                5,
                95
              )
            ),
            qrSize: roundPercent(
              clamp(
                marker.sizePercent *
                  1.05,
                12,
                55
              )
            ),
          })
        );
        setMarkerDetectionStatus({
          kind: "success",
          message:
            marker.candidateCount > 1
              ? `画像比率を${analysis.ratio.label}に設定しました。ピンクの正方形を複数検出したため、最も大きい候補にQRコードを配置しました。`
              : `画像比率を${analysis.ratio.label}に設定し、ピンクの正方形へQRコードを自動配置しました。`,
        });
      } catch (error) {
        console.warn(
          "QR位置マーカーを解析できませんでした。",
          error
        );

        if (
          markerDetectionIdRef.current ===
          detectionId
        ) {
          setMarkerDetectionStatus({
            kind: "error",
            message:
              "QR位置の自動検出に失敗しました。背景画像は読み込めているため、手動調整はそのまま使えます。",
          });
        }
      }
    };

    reader.onerror = () => {
      alert(
        "画像を読み込めませんでした。"
      );
    };

    reader.readAsDataURL(file);
  };

  const removeBackgroundImage = () => {
    markerDetectionIdRef.current += 1;
    updateSetting(
      "backgroundImage",
      ""
    );
    setMarkerDetectionStatus({
      kind: "idle",
      message: "",
    });
  };

  const saveDesign = () => {
    try {
      localStorage.setItem(
        createDesignStorageKey(
          eventName,
          designKind
        ),
        JSON.stringify(settings)
      );

      alert(
        `${
          eventName ||
          "現在のイベント"
        }の${cardLabel}デザインを保存しました。`
      );
    } catch (error) {
      console.error(
        `${cardLabel}デザインの保存に失敗しました。`,
        error
      );

      alert(
        "デザインを保存できませんでした。画像が大きすぎる可能性があります。"
      );
    }
  };

  const resetDesign = () => {
    const confirmed =
      window.confirm(
        "背景画像や配置を初期状態に戻しますか？"
      );

    if (!confirmed) {
      return;
    }

    setSettings({
      ...defaultSettings,
    });
    markerDetectionIdRef.current += 1;
    setMarkerDetectionStatus({
      kind: "idle",
      message: "",
    });

    try {
      localStorage.removeItem(
        createDesignStorageKey(
          eventName,
          designKind
        )
      );
    } catch (error) {
      console.error(
        "保存済みデザインの削除に失敗しました。",
        error
      );
    }
  };

  const printTickets = () => {
    if (
      selectedTickets.length === 0
    ) {
      alert(
        `印刷できる${cardLabel}がありません。`
      );

      return;
    }

    const userAgent =
      navigator.userAgent;

    const isIPhoneOrIPad =
      /iPad|iPhone|iPod/i.test(
        userAgent
      );

    const isIPadDesktopMode =
      navigator.platform ===
        "MacIntel" &&
      navigator.maxTouchPoints >
        1;

    if (
      isIPhoneOrIPad ||
      isIPadDesktopMode
    ) {
      /*
        iPad Safariではwindow.print()が
       反応しない場合があるため、
        印刷専用画面を表示します。

        その画面からSafariの共有ボタンを開き、
        「プリント」を選択します。
      */
      setManualPrintMode(
        true
      );

      return;
    }

    window.print();
  };

  const renderPrintSheet =
    () => (
      <div
        className="ticket-print-sheet"
        style={printSheetStyle}
      >
        {selectedTickets.map(
          (ticket) => (
            <div
              key={ticket.id}
              className="ticket-print-card"
              style={{
                backgroundImage:
                  settings.backgroundImage ===
                  ""
                    ? undefined
                    : `url("${settings.backgroundImage}")`,
              }}
            >
              <div
                className="ticket-design-qr"
                style={{
                  left: `${settings.qrX}%`,
                  top: `${settings.qrY}%`,
                  width: `${settings.qrSize}%`,
                }}
              >
                <LazyQrCode
                  value={createQrValue(
                    ticket,
                    designKind
                  )}
                  size={500}
                  level="M"
                  marginSize={1}
                />
              </div>

              {settings.showTicketNumber && (
                <div
                  className="ticket-design-number"
                  style={{
                    left: `${settings.numberX}%`,
                    top: `${settings.numberY}%`,
                    fontSize:
                      `${settings.numberSize}px`,
                  }}
                >
                  {ticket.qrNumber}
                </div>
              )}
            </div>
          )
        )}
      </div>
    );

  if (
    printableTickets.length === 0
  ) {
    return (
      <div className="ticket-designer-background">
        <section className="ticket-designer-empty">
          <h2>
            印刷できる{cardLabel}がありません
          </h2>

          <p>
            {isMemberDesign
              ? "部員QRを登録してください。"
              : "チケットを発行するか、無効状態を解除してください。"}
          </p>

          <button
            type="button"
            onClick={onClose}
          >
            閉じる
          </button>
        </section>
      </div>
    );
  }

  if (manualPrintMode) {
    return (
      <div className="ticket-manual-print-page">
        <header className="ticket-manual-print-toolbar">
          <div>
            <h2>
              iPad用印刷画面
            </h2>

            <p>
              Safariの共有ボタン
              （□から上向き矢印）
              を押して、
              「プリント」を選択してください。
            </p>

            <strong>
              印刷対象：
              {selectedTickets.length}
              {isMemberDesign
                ? "人分"
                : "枚"}
            </strong>
          </div>

          <button
            type="button"
            onClick={() =>
              setManualPrintMode(
                false
              )
            }
          >
            デザイン画面に戻る
          </button>
        </header>

        <main className="ticket-manual-print-content">
          {renderPrintSheet()}
        </main>
      </div>
    );
  }

  return (
    <div className="ticket-designer-background">
      <section className="ticket-designer-window">
        <header className="ticket-designer-header">
          <div>
            <h2>
              {cardLabel}デザイン・印刷
            </h2>

            <p>
              背景画像にQRコードと{numberLabel}を配置します
            </p>
          </div>

          <button
            type="button"
            className="ticket-designer-close"
            onClick={onClose}
            aria-label="デザイン画面を閉じる"
          >
            ×
          </button>
        </header>

        <main className="ticket-designer-content">
          <section className="ticket-designer-preview-section">
            <div className="ticket-preview-heading">
              <h3>
                印刷プレビュー
              </h3>

              <span>
                {safePrintWidth.toFixed(
                  1
                )}
                mm ×{" "}
                {printHeightMm.toFixed(
                  1
                )}
                mm
              </span>
            </div>

            <div className="ticket-preview-container">
              {previewTicket !==
                null && (
                <div
                  className="ticket-design-card"
                  style={
                    previewTicketStyle
                  }
                >
                  {settings.backgroundImage ===
                    "" && (
                    <div className="ticket-no-background">
                      背景画像を選択してください
                    </div>
                  )}

                  <div
                    className="ticket-design-qr"
                    style={{
                      left: `${settings.qrX}%`,
                      top: `${settings.qrY}%`,
                      width: `${settings.qrSize}%`,
                    }}
                  >
                    <LazyQrCode
                      value={createQrValue(
                        previewTicket,
                        designKind
                      )}
                      size={500}
                      level="M"
                      marginSize={1}
                    />
                  </div>

                  {settings.showTicketNumber && (
                    <div
                      className="ticket-design-number"
                      style={{
                        left: `${settings.numberX}%`,
                        top: `${settings.numberY}%`,
                        fontSize:
                          `${settings.numberSize}px`,
                      }}
                    >
                      {
                        previewTicket.qrNumber
                      }
                    </div>
                  )}
                </div>
              )}
            </div>

            <section className="ticket-print-range">
              <h3>
                印刷する範囲
              </h3>

              <div className="ticket-range-inputs">
                <label>
                  最初の{cardLabel}

                  <select
                    value={
                      startIndex
                    }
                    onChange={(
                      event
                    ) => {
                      const newStart =
                        Number(
                          event.target
                            .value
                        );

                      setStartIndex(
                        newStart
                      );

                      if (
                        endIndex <
                        newStart
                      ) {
                        setEndIndex(
                          newStart
                        );
                      }
                    }}
                  >
                    {printableTickets.map(
                      (
                        ticket,
                        index
                      ) => (
                        <option
                          key={
                            ticket.id
                          }
                          value={
                            index
                          }
                        >
                          {
                            ticket.qrNumber
                          }
                        </option>
                      )
                    )}
                  </select>
                </label>

                <span>～</span>

                <label>
                  最後の{cardLabel}

                  <select
                    value={
                      endIndex
                    }
                    onChange={(
                      event
                    ) =>
                      setEndIndex(
                        Number(
                          event.target
                            .value
                        )
                      )
                    }
                  >
                    {printableTickets.map(
                      (
                        ticket,
                        index
                      ) => (
                        <option
                          key={
                            ticket.id
                          }
                          value={
                            index
                          }
                          disabled={
                            index <
                            startIndex
                          }
                        >
                          {
                            ticket.qrNumber
                          }
                        </option>
                      )
                    )}
                  </select>
                </label>
              </div>

              <div className="ticket-range-summary">
                印刷対象：

                <strong>
                  {
                    selectedTickets.length
                  }
                  {isMemberDesign
                    ? "人分"
                    : "枚"}
                </strong>

                {!isMemberDesign && (
                  <span>
                    ※無効なチケットは除外されます
                  </span>
                )}
              </div>
            </section>
          </section>

          <section className="ticket-designer-settings">
            <h3>
              デザイン設定
            </h3>

            <div className="ticket-setting-group">
              <h4>
                {cardLabel}サイズ
              </h4>

              <label className="ticket-select-setting">
                比率

                <select
                  value={
                    settings.cardRatio
                  }
                  onChange={(
                    event
                  ) =>
                    updateSetting(
                      "cardRatio",
                      event.target
                        .value as CardRatio
                    )
                  }
                >
                  <option value="16:9">
                    16:9
                  </option>

                  <option value="4:3">
                    4:3
                  </option>

                  <option value="3:2">
                    3:2
                  </option>

                  <option value="card">
                    カード比率
                  </option>

                  <option value="square">
                    正方形
                  </option>

                  <option value="9:16">
                    9:16（縦長）
                  </option>

                  <option value="custom">
                    自由設定
                  </option>
                </select>
              </label>

              {settings.cardRatio ===
                "custom" && (
                <div className="ticket-custom-ratio">
                  <label>
                    横

                    <input
                      type="number"
                      min="1"
                      step="0.1"
                      value={
                        settings.customWidth
                      }
                      onChange={(
                        event
                      ) =>
                        updateSetting(
                          "customWidth",
                          Number(
                            event.target
                              .value
                          )
                        )
                      }
                    />
                  </label>

                  <span>：</span>

                  <label>
                    縦

                    <input
                      type="number"
                      min="1"
                      step="0.1"
                      value={
                        settings.customHeight
                      }
                      onChange={(
                        event
                      ) =>
                        updateSetting(
                          "customHeight",
                          Number(
                            event.target
                              .value
                          )
                        )
                      }
                    />
                  </label>
                </div>
              )}

              <label className="ticket-number-setting">
                印刷時の横幅

                <input
                  type="number"
                  min="30"
                  max="250"
                  step="1"
                  value={
                    settings.printWidthMm
                  }
                  onChange={(
                    event
                  ) =>
                    updateSetting(
                      "printWidthMm",
                      Math.max(
                        30,
                        Number(
                          event.target
                            .value
                        )
                      )
                    )
                  }
                />

                <span>mm</span>
              </label>
            </div>

            <div className="ticket-setting-group">
              <h4>
                背景画像
              </h4>

              <label className="ticket-background-label">
                PNG・JPEG画像

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={
                    handleBackgroundImage
                  }
                />
              </label>

              <p className="ticket-designer-help">
                KeynoteやPowerPointから書き出したPNG画像も使用できます。
              </p>

              <p className="ticket-designer-help">
                画像の縦横比は、カスタムを除く最も近い比率へ自動設定します。
              </p>

              <div className="ticket-marker-instruction">
                <span
                  className="ticket-marker-swatch"
                  aria-hidden="true"
                />

                <p>
                  QRを置きたい場所に、鮮やかなピンク（目安
                  #FF00FF）の塗りつぶし正方形を1つ置いてください。近いピンク色でも自動検出します。
                </p>
              </div>

              {markerDetectionStatus.kind !==
                "idle" && (
                <p
                  className={`ticket-marker-status ticket-marker-status-${markerDetectionStatus.kind}`}
                  aria-live="polite"
                >
                  {
                    markerDetectionStatus.message
                  }
                </p>
              )}

              {settings.backgroundImage !==
                "" && (
                <button
                  type="button"
                  className="ticket-remove-background"
                  onClick={
                    removeBackgroundImage
                  }
                >
                  背景画像を削除
                </button>
              )}
            </div>

            <div className="ticket-setting-group">
              <h4>
                QRコード
              </h4>

              <label>
                横位置

                <input
                  type="range"
                  min="5"
                  max="95"
                  step="0.1"
                  value={
                    settings.qrX
                  }
                  onChange={(
                    event
                  ) =>
                    updateSetting(
                      "qrX",
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                />

                <span>
                  {settings.qrX}%
                </span>
              </label>

              <label>
                縦位置

                <input
                  type="range"
                  min="5"
                  max="95"
                  step="0.1"
                  value={
                    settings.qrY
                  }
                  onChange={(
                    event
                  ) =>
                    updateSetting(
                      "qrY",
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                />

                <span>
                  {settings.qrY}%
                </span>
              </label>

              <label>
                大きさ

                <input
                  type="range"
                  min="12"
                  max="55"
                  step="0.1"
                  value={
                    settings.qrSize
                  }
                  onChange={(
                    event
                  ) =>
                    updateSetting(
                      "qrSize",
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                />

                <span>
                  {settings.qrSize}%
                </span>
              </label>
            </div>

            <div className="ticket-setting-group">
              <h4>
                {numberLabel}
              </h4>

              <label className="ticket-visibility-setting">
                <span>
                  {numberLabel}を印刷する
                </span>

                <input
                  type="checkbox"
                  checked={
                    settings.showTicketNumber
                  }
                  onChange={(
                    event
                  ) =>
                    updateSetting(
                      "showTicketNumber",
                      event.target.checked
                    )
                  }
                />
              </label>

              <label>
                横位置

                <input
                  type="range"
                  disabled={
                    !settings.showTicketNumber
                  }
                  min="0"
                  max="100"
                  value={
                    settings.numberX
                  }
                  onChange={(
                    event
                  ) =>
                    updateSetting(
                      "numberX",
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                />

                <span>
                  {settings.numberX}%
                </span>
              </label>

              <label>
                縦位置

                <input
                  type="range"
                  disabled={
                    !settings.showTicketNumber
                  }
                  min="0"
                  max="100"
                  value={
                    settings.numberY
                  }
                  onChange={(
                    event
                  ) =>
                    updateSetting(
                      "numberY",
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                />

                <span>
                  {settings.numberY}%
                </span>
              </label>

              <label>
                文字サイズ

                <input
                  type="range"
                  disabled={
                    !settings.showTicketNumber
                  }
                  min="10"
                  max="60"
                  value={
                    settings.numberSize
                  }
                  onChange={(
                    event
                  ) =>
                    updateSetting(
                      "numberSize",
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                />

                <span>
                  {
                    settings.numberSize
                  }
                  px
                </span>
              </label>
            </div>

            <div className="ticket-setting-group">
              <h4>
                まとめて印刷
              </h4>

              <label className="ticket-select-setting">
                1行に並べる枚数

                <select
                  value={
                    settings.cardsPerRow
                  }
                  onChange={(
                    event
                  ) =>
                    updateSetting(
                      "cardsPerRow",
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                >
                  <option value={1}>
                    1枚
                  </option>

                  <option value={2}>
                    2枚
                  </option>

                  <option value={3}>
                    3枚
                  </option>

                  <option value={4}>
                    4枚
                  </option>
                </select>
              </label>

              <label className="ticket-number-setting">
                {cardLabel}間の余白

                <input
                  type="number"
                  min="0"
                  max="20"
                  step="1"
                  value={
                    settings.printGapMm
                  }
                  onChange={(
                    event
                  ) =>
                    updateSetting(
                      "printGapMm",
                      Math.max(
                        0,
                        Number(
                          event.target
                            .value
                        )
                      )
                    )
                  }
                />

                <span>mm</span>
              </label>
            </div>
          </section>
        </main>

        <footer className="ticket-designer-buttons">
          <button
            type="button"
            className="ticket-design-save"
            onClick={saveDesign}
          >
            デザインを保存
          </button>

          <button
            type="button"
            className="ticket-design-print"
            onClick={printTickets}
          >
            選択した範囲を印刷
          </button>

          <button
            type="button"
            className="ticket-design-reset"
            onClick={resetDesign}
          >
            初期状態に戻す
          </button>

          <button
            type="button"
            className="ticket-design-cancel"
            onClick={onClose}
          >
            閉じる
          </button>
        </footer>
      </section>

      <div
        className="ticket-print-sheet"
        style={printSheetStyle}
      >
        {selectedTickets.map(
          (ticket) => (
            <div
              key={ticket.id}
              className="ticket-print-card"
              style={{
                backgroundImage:
                  settings.backgroundImage ===
                  ""
                    ? undefined
                    : `url("${settings.backgroundImage}")`,
              }}
            >
              <div
                className="ticket-design-qr"
                style={{
                  left: `${settings.qrX}%`,
                  top: `${settings.qrY}%`,
                  width: `${settings.qrSize}%`,
                }}
              >
                <LazyQrCode
                  value={createQrValue(
                    ticket,
                    designKind
                  )}
                  size={500}
                  level="M"
                  marginSize={1}
                />
              </div>

              {settings.showTicketNumber && (
                <div
                  className="ticket-design-number"
                  style={{
                    left: `${settings.numberX}%`,
                    top: `${settings.numberY}%`,
                    fontSize:
                      `${settings.numberSize}px`,
                  }}
                >
                  {ticket.qrNumber}
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default TicketDesigner;
