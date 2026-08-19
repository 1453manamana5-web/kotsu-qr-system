type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

type ShareNavigator = Navigator & {
  share?: (
    data: ShareData
  ) => Promise<void>;
  canShare?: (
    data?: ShareData
  ) => boolean;
};

const CSS_PIXELS_PER_INCH = 96;
const MILLIMETERS_PER_INCH = 25.4;
const PRINT_MARGIN_MM = 8;

function isStandaloneApp() {
  const displayModeStandalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia(
      "(display-mode: standalone)"
    ).matches;

  const iosStandalone =
    (navigator as NavigatorWithStandalone)
      .standalone === true;

  return (
    displayModeStandalone ||
    iosStandalone
  );
}

function pixelsToMillimeters(
  pixels: number
) {
  return (
    pixels /
    CSS_PIXELS_PER_INCH *
    MILLIMETERS_PER_INCH
  );
}

function createSafeFileName(
  value: string
) {
  const safeValue =
    value
      .trim()
      .replace(
        /[\\/:*?"<>|]/g,
        "_"
      );

  return safeValue === ""
    ? "QR管理システム_印刷用"
    : safeValue;
}

function getPrintFileName() {
  const heading =
    document.querySelector<HTMLElement>(
      ".ticket-manual-print-toolbar h2"
    );

  const headingText =
    heading?.textContent ??
    "QR管理システム";

  return `${createSafeFileName(
    headingText
  )}.pdf`;
}

function createStatusElement(
  toolbar: HTMLElement
) {
  const existingStatus =
    toolbar.querySelector<HTMLElement>(
      ".ticket-manual-print-status"
    );

  if (
    existingStatus !== null
  ) {
    return existingStatus;
  }

  const status =
    document.createElement(
      "div"
    );

  status.className =
    "ticket-manual-print-status";
  status.style.marginTop = "8px";
  status.style.fontSize = "16px";
  status.style.fontWeight = "700";
  status.style.lineHeight = "1.45";
  status.style.color = "#52606d";

  status.setAttribute(
    "aria-live",
    "polite"
  );

  const copyArea =
    toolbar.querySelector<HTMLElement>(
      "div"
    );

  if (
    copyArea !== null
  ) {
    copyArea.appendChild(
      status
    );
  } else {
    toolbar.appendChild(
      status
    );
  }

  return status;
}

async function createPrintPdf(
  status: HTMLElement
) {
  const printPage =
    document.querySelector<HTMLElement>(
      ".ticket-manual-print-page"
    );

  const printSheet =
    printPage?.querySelector<HTMLElement>(
      ".ticket-print-sheet"
    ) ?? null;

  const cards =
    printSheet === null
      ? []
      : Array.from(
          printSheet.querySelectorAll<HTMLElement>(
            ".ticket-print-card"
          )
        );

  if (
    printSheet === null ||
    cards.length === 0
  ) {
    throw new Error(
      "印刷対象が見つかりません。"
    );
  }

  status.textContent =
    "印刷用PDFを準備しています…";

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

  const firstCardRect =
    cards[0].getBoundingClientRect();

  const cardWidthMm =
    pixelsToMillimeters(
      firstCardRect.width
    );

  const cardHeightMm =
    pixelsToMillimeters(
      firstCardRect.height
    );

  if (
    cardWidthMm <= 0 ||
    cardHeightMm <= 0
  ) {
    throw new Error(
      "印刷サイズを取得できませんでした。"
    );
  }

  const sheetStyle =
    window.getComputedStyle(
      printSheet
    );

  const gapPixels =
    Number.parseFloat(
      sheetStyle.columnGap
    );

  const gapMm =
    Number.isFinite(
      gapPixels
    )
      ? pixelsToMillimeters(
          gapPixels
        )
      : 4;

  const getLayout = (
    pageWidthMm: number,
    pageHeightMm: number
  ) => {
    const printableWidth =
      pageWidthMm -
      PRINT_MARGIN_MM * 2;

    const printableHeight =
      pageHeightMm -
      PRINT_MARGIN_MM * 2;

    const fitScale =
      Math.min(
        1,
        printableWidth /
          cardWidthMm,
        printableHeight /
          cardHeightMm
      );

    const outputWidth =
      cardWidthMm * fitScale;

    const outputHeight =
      cardHeightMm * fitScale;

    const columns =
      Math.max(
        1,
        Math.floor(
          (
            printableWidth +
            gapMm
          ) /
          (
            outputWidth +
            gapMm
          )
        )
      );

    const rows =
      Math.max(
        1,
        Math.floor(
          (
            printableHeight +
            gapMm
          ) /
          (
            outputHeight +
            gapMm
          )
        )
      );

    return {
      pageWidthMm,
      pageHeightMm,
      outputWidth,
      outputHeight,
      columns,
      rows,
      cardsPerPage:
        columns * rows,
    };
  };

  const portraitLayout =
    getLayout(
      210,
      297
    );

  const landscapeLayout =
    getLayout(
      297,
      210
    );

  const layout =
    landscapeLayout.cardsPerPage >
      portraitLayout.cardsPerPage
      ? landscapeLayout
      : portraitLayout;

  const orientation =
    layout.pageWidthMm >
      layout.pageHeightMm
      ? "landscape"
      : "portrait";

  const pdf =
    new jsPDF({
      orientation,
      unit: "mm",
      format: "a4",
      compress: true,
    });

  for (
    let index = 0;
    index < cards.length;
    index += 1
  ) {
    if (
      index > 0 &&
      index %
        layout.cardsPerPage ===
        0
    ) {
      pdf.addPage(
        "a4",
        orientation
      );
    }

    status.textContent =
      `印刷用PDFを作成中… ${
        index + 1
      } / ${cards.length}`;

    const canvas =
      await html2canvas(
        cards[index],
        {
          scale: 2.5,
          useCORS: true,
          backgroundColor:
            "#ffffff",
          logging: false,
        }
      );

    const pageIndex =
      index %
      layout.cardsPerPage;

    const column =
      pageIndex %
      layout.columns;

    const row =
      Math.floor(
        pageIndex /
        layout.columns
      );

    const x =
      PRINT_MARGIN_MM +
      column *
        (
          layout.outputWidth +
          gapMm
        );

    const y =
      PRINT_MARGIN_MM +
      row *
        (
          layout.outputHeight +
          gapMm
        );

    const imageData =
      canvas.toDataURL(
        "image/jpeg",
        0.98
      );

    pdf.addImage(
      imageData,
      "JPEG",
      x,
      y,
      layout.outputWidth,
      layout.outputHeight,
      undefined,
      "FAST"
    );

    canvas.width = 1;
    canvas.height = 1;
  }

  status.textContent =
    "PDFを仕上げています…";

  const blob =
    pdf.output(
      "blob"
    );

  return new File(
    [blob],
    getPrintFileName(),
    {
      type:
        "application/pdf",
    }
  );
}

function downloadPdfFile(
  file: File
) {
  const objectUrl =
    URL.createObjectURL(
      file
    );

  const link =
    document.createElement(
      "a"
    );

  link.href = objectUrl;
  link.download = file.name;
  link.rel = "noopener";

  document.body.appendChild(
    link
  );

  link.click();
  link.remove();

  window.setTimeout(
    () => {
      URL.revokeObjectURL(
        objectUrl
      );
    },
    60_000
  );
}

function sharePreparedPdf(
  file: File,
  status: HTMLElement
) {
  const shareNavigator =
    navigator as ShareNavigator;

  const shareData:
    ShareData = {
    files: [file],
  };

  const canUseShare =
    typeof shareNavigator.share ===
      "function" &&
    (
      typeof shareNavigator.canShare !==
        "function" ||
      shareNavigator.canShare(
        shareData
      )
    );

  if (
    !canUseShare ||
    shareNavigator.share ===
      undefined
  ) {
    status.textContent =
      "この端末ではPDF共有を使えないため、PDFをダウンロードします。";

    downloadPdfFile(
      file
    );

    return;
  }

  status.textContent =
    "共有シートの「プリント」を選んでください。";

  void shareNavigator
    .share(
      shareData
    )
    .catch(
      (error: unknown) => {
        if (
          error instanceof DOMException &&
          error.name ===
            "AbortError"
        ) {
          status.textContent =
            "共有をキャンセルしました。もう一度「共有して印刷」を押せます。";

          return;
        }

        console.error(
          "印刷用PDFを共有できませんでした。",
          error
        );

        status.textContent =
          "共有画面を開けなかったため、PDFをダウンロードします。";

        downloadPdfFile(
          file
        );
      }
    );
}

function enhanceManualPrintToolbar() {
  const toolbar =
    document.querySelector<HTMLElement>(
      ".ticket-manual-print-toolbar"
    );

  if (
    toolbar === null ||
    toolbar.dataset.manualPrintEnhanced ===
      "true"
  ) {
    return;
  }

  /*
    ここを最初に設定しておくことで、
    この後の文言変更やボタン追加をMutationObserverが
    再検知しても同じツールバーを二重処理しません。
  */
  toolbar.dataset.manualPrintEnhanced =
    "true";

  const standalone =
    isStandaloneApp();

  const instruction =
    toolbar.querySelector<HTMLParagraphElement>(
      "p"
    );

  if (
    instruction !== null
  ) {
    instruction.textContent =
      standalone
        ? "ホーム画面アプリでは、まず「印刷用PDFを作成」を押してください。PDF作成後に「共有して印刷」を押し、共有シートから「プリント」を選択してください。"
        : "右の「印刷する」を押すか、Safariの共有ボタンから「プリント」を選択してください。";
  }

  const printButton =
    document.createElement(
      "button"
    );

  printButton.type = "button";
  printButton.className =
    "ticket-manual-print-button";
  printButton.style.background =
    "#ccebd8";
  printButton.style.borderColor =
    "#9bc9ad";

  const status =
    createStatusElement(
      toolbar
    );

  let preparedPdf:
    File |
    null = null;

  if (
    standalone
  ) {
    printButton.textContent =
      "📄 印刷用PDFを作成";

    printButton.addEventListener(
      "click",
      () => {
        if (
          preparedPdf !== null
        ) {
          sharePreparedPdf(
            preparedPdf,
            status
          );

          return;
        }

        printButton.disabled = true;
        printButton.textContent =
          "PDF作成中…";

        void createPrintPdf(
          status
        )
          .then(
            (file) => {
              preparedPdf = file;
              printButton.disabled =
                false;
              printButton.textContent =
                "⬆️ 共有して印刷";
              status.textContent =
                "PDFができました。「共有して印刷」を押し、共有シートから「プリント」を選んでください。";
            }
          )
          .catch(
            (error: unknown) => {
              console.error(
                "印刷用PDFを作成できませんでした。",
                error
              );

              printButton.disabled =
                false;
              printButton.textContent =
                "📄 印刷用PDFを作成";
              status.textContent =
                error instanceof Error
                  ? error.message
                  : "印刷用PDFを作成できませんでした。もう一度試してください。";
            }
          );
      }
    );
  } else {
    printButton.textContent =
      "🖨 印刷する";

    printButton.addEventListener(
      "click",
      () => {
        window.print();
      }
    );
  }

  const backButton =
    toolbar.querySelector<HTMLButtonElement>(
      "button"
    );

  if (
    backButton === null
  ) {
    toolbar.appendChild(
      printButton
    );

    return;
  }

  toolbar.insertBefore(
    printButton,
    backButton
  );
}

export function installManualPrintSupport() {
  enhanceManualPrintToolbar();

  const observer =
    new MutationObserver(
      () => {
        enhanceManualPrintToolbar();
      }
    );

  observer.observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
    }
  );
}
