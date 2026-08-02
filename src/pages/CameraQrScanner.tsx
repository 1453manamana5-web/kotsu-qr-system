import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
} from "html5-qrcode";

import "./CameraQrScanner.css";

type CameraQrScannerProps = {
  enabled: boolean;

  onScan: (
    qrValue: string
  ) => void;
};

type CameraState =
  | "starting"
  | "ready"
  | "error";

type ExtendedVideoConstraints =
  MediaTrackConstraints & {
    advanced?: Array<
      MediaTrackConstraintSet & {
        focusMode?:
          | string
          | string[];

        exposureMode?:
          | string
          | string[];
      }
    >;
  };

function getErrorMessage(
  error: unknown
) {
  if (
    error instanceof Error
  ) {
    return `${error.name}: ${error.message}`;
  }

  if (
    typeof error ===
    "string"
  ) {
    return error;
  }

  try {
    return JSON.stringify(
      error
    );
  } catch {
    return "原因不明のエラー";
  }
}

function stopMediaStream(
  stream:
    MediaStream |
    null
) {
  if (
    stream ===
    null
  ) {
    return;
  }

  stream
    .getTracks()
    .forEach(
      (track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn(
            "カメラの映像トラックを停止できませんでした。",
            error
          );
        }
      }
    );
}

function stopReaderVideoTracks(
  readerId: string
) {
  const readerElement =
    document.getElementById(
      readerId
    );

  if (
    readerElement ===
    null
  ) {
    return;
  }

  const videoElements =
    readerElement.querySelectorAll(
      "video"
    );

  videoElements.forEach(
    (videoElement) => {
      const stream =
        videoElement.srcObject;

      if (
        stream instanceof
        MediaStream
      ) {
        stopMediaStream(
          stream
        );

        videoElement.srcObject =
          null;
      }

      try {
        videoElement.pause();
      } catch {
        // pauseに対応していない場合は何もしません。
      }

      videoElement.removeAttribute(
        "src"
      );

      try {
        videoElement.load();
      } catch {
        // loadに対応していない場合は何もしません。
      }
    }
  );
}

async function stopScannerInstance(
  scanner:
    Html5Qrcode |
    null
) {
  if (
    scanner ===
    null
  ) {
    return;
  }

  try {
    if (
      scanner.isScanning
    ) {
      await scanner.stop();
    }
  } catch (error) {
    console.warn(
      "カメラ停止時にエラーが発生しました。",
      error
    );
  }

  try {
    scanner.clear();
  } catch (error) {
    console.warn(
      "カメラ表示の削除時にエラーが発生しました。",
      error
    );
  }
}

async function applyFastCameraSettings(
  scanner: Html5Qrcode
) {
  const fastConstraints:
    ExtendedVideoConstraints = {
      advanced: [
        {
          focusMode:
            "continuous",

          exposureMode:
            "continuous",
        },
      ],
    };

  try {
    await scanner.applyVideoConstraints(
      fastConstraints
    );

    console.log(
      "高速読み取り用のカメラ設定を適用しました。"
    );
  } catch (advancedError) {
    console.warn(
      "連続フォーカス設定には対応していないため、端末の標準設定を使用します。",
      advancedError
    );
  }
}

function CameraQrScanner({
  enabled,
  onScan,
}: CameraQrScannerProps) {
  const reactId =
    useId();

  const readerId =
    `camera-qr-reader-${reactId}`.replace(
      /[^a-zA-Z0-9-_]/g,
      ""
    );

  const onScanRef =
    useRef(onScan);

  const scannerRef =
    useRef<
      Html5Qrcode |
      null
    >(null);

  const activeStreamRef =
    useRef<
      MediaStream |
      null
    >(null);

  const stopPromiseRef =
    useRef<
      Promise<void> |
      null
    >(null);

  const scanLockedRef =
    useRef(false);

  const lastScannedValueRef =
    useRef("");

  const lastScannedTimeRef =
    useRef(0);

  const [
    pageVisible,
    setPageVisible,
  ] = useState(
    () =>
      document.visibilityState ===
      "visible"
  );

  const [
    cameraState,
    setCameraState,
  ] = useState<CameraState>(
    "starting"
  );

  const [
    errorMessage,
    setErrorMessage,
  ] = useState("");

  useEffect(() => {
    onScanRef.current =
      onScan;
  }, [
    onScan,
  ]);

  const stopCurrentCamera =
    useCallback(
      async () => {
        const currentStopPromise =
          stopPromiseRef.current;

        if (
          currentStopPromise !==
          null
        ) {
          await currentStopPromise;
          return;
        }

        const stopPromise =
          (async () => {
            const scanner =
              scannerRef.current;

            scannerRef.current =
              null;

            await stopScannerInstance(
              scanner
            );

            stopMediaStream(
              activeStreamRef.current
            );

            activeStreamRef.current =
              null;

            /*
              html5-qrcode側に映像が残っている場合に備えて、
              この読み取り領域内のvideoだけを停止します。
            */
            stopReaderVideoTracks(
              readerId
            );
          })();

        stopPromiseRef.current =
          stopPromise;

        try {
          await stopPromise;
        } finally {
          if (
            stopPromiseRef.current ===
            stopPromise
          ) {
            stopPromiseRef.current =
              null;
          }
        }
      },
      [
        readerId,
      ]
    );

  useEffect(() => {
    const handleVisibilityChange =
      () => {
        const isVisible =
          document.visibilityState ===
          "visible";

        setPageVisible(
          isVisible
        );

        if (
          !isVisible
        ) {
          scanLockedRef.current =
            true;

          void stopCurrentCamera();
        }
      };

    const handlePageHide =
      () => {
        setPageVisible(
          false
        );

        scanLockedRef.current =
          true;

        void stopCurrentCamera();
      };

    const handlePageShow =
      () => {
        setPageVisible(
          document.visibilityState ===
          "visible"
        );
      };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );

    window.addEventListener(
      "pagehide",
      handlePageHide
    );

    window.addEventListener(
      "pageshow",
      handlePageShow
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );

      window.removeEventListener(
        "pagehide",
        handlePageHide
      );

      window.removeEventListener(
        "pageshow",
        handlePageShow
      );

      void stopCurrentCamera();
    };
  }, [
    stopCurrentCamera,
  ]);

  useEffect(() => {
    let cancelled =
      false;

    const cameraShouldRun =
      enabled &&
      pageVisible;

    if (
      !cameraShouldRun
    ) {
      scanLockedRef.current =
        true;

      void stopCurrentCamera();

      setCameraState(
        "starting"
      );

      setErrorMessage("");

      return () => {
        cancelled =
          true;

        void stopCurrentCamera();
      };
    }

    scanLockedRef.current =
      false;

    lastScannedValueRef.current =
      "";

    lastScannedTimeRef.current =
      0;

    setCameraState(
      "starting"
    );

    setErrorMessage("");

    const startCamera =
      async () => {
        let scanner:
          Html5Qrcode |
          null = null;

        try {
          /*
            前の画面や前回の読み取りで残ったカメラを、
            新しく起動する前に停止します。
          */
          await stopCurrentCamera();

          if (
            cancelled ||
            !enabled ||
            !pageVisible
          ) {
            return;
          }

          const readerElement =
            document.getElementById(
              readerId
            );

          if (
            readerElement ===
            null
          ) {
            throw new Error(
              "カメラ表示領域が見つかりません。"
            );
          }

          readerElement.innerHTML =
            "";

          scanner =
            new Html5Qrcode(
              readerId,
              {
                formatsToSupport: [
                  Html5QrcodeSupportedFormats.QR_CODE,
                ],

                useBarCodeDetectorIfSupported:
                  true,

                verbose:
                  false,
              }
            );

          scannerRef.current =
            scanner;

          await scanner.start(
            {
              facingMode: {
                ideal:
                  "environment",
              },

              width: {
                ideal:
                  1280,
              },

              height: {
                ideal:
                  720,
              },

              frameRate: {
                ideal:
                  30,

                min:
                  20,
              },
            },
            {
              fps:
                30,

              aspectRatio:
                16 / 9,

              disableFlip:
                true,
            },
            (
              decodedText
            ) => {
              if (
                cancelled ||
                scanLockedRef.current
              ) {
                return;
              }

              const normalizedValue =
                decodedText.trim();

              if (
                normalizedValue ===
                ""
              ) {
                return;
              }

              const currentTime =
                Date.now();

              const isSameRecentCode =
                normalizedValue ===
                  lastScannedValueRef.current &&
                currentTime -
                  lastScannedTimeRef.current <
                  1200;

              if (
                isSameRecentCode
              ) {
                return;
              }

              lastScannedValueRef.current =
                normalizedValue;

              lastScannedTimeRef.current =
                currentTime;

              scanLockedRef.current =
                true;

              console.log(
                "QRコードを高速読み取りしました:",
                normalizedValue
              );

              /*
                QRを読み取った瞬間にカメラを停止します。
                Firebase処理中・成功・失敗画面ではカメラを使いません。
              */
              void stopCurrentCamera();

              onScanRef.current(
                normalizedValue
              );
            },
            () => {
              /*
                QRが写っていないフレームは頻繁に発生するため、
               状態更新やログ出力はしません。
              */
            }
          );

          if (
            cancelled ||
            !enabled ||
            !pageVisible
          ) {
            if (
              scannerRef.current ===
              scanner
            ) {
              scannerRef.current =
                null;
            }

            await stopScannerInstance(
              scanner
            );

            stopReaderVideoTracks(
              readerId
            );

            return;
          }

          const currentReaderElement =
            document.getElementById(
              readerId
            );

          const videoElement =
            currentReaderElement?.querySelector(
              "video"
            );

          if (
            videoElement?.srcObject instanceof
            MediaStream
          ) {
            activeStreamRef.current =
              videoElement.srcObject;
          }

          await applyFastCameraSettings(
            scanner
          );

          if (
            cancelled ||
            !enabled ||
            !pageVisible
          ) {
            if (
              scannerRef.current ===
              scanner
            ) {
              scannerRef.current =
                null;
            }

            await stopScannerInstance(
              scanner
            );

            stopMediaStream(
              activeStreamRef.current
            );

            activeStreamRef.current =
              null;

            stopReaderVideoTracks(
              readerId
            );

            return;
          }

          setCameraState(
            "ready"
          );
        } catch (error) {
          console.error(
            "カメラを開始できませんでした。",
            error
          );

          if (
            scanner !==
              null &&
            scannerRef.current !==
              scanner
          ) {
            await stopScannerInstance(
              scanner
            );
          }

          await stopCurrentCamera();

          if (
            !cancelled &&
            enabled &&
            pageVisible
          ) {
            setCameraState(
              "error"
            );

            setErrorMessage(
              getErrorMessage(
                error
              )
            );
          }
        }
      };

    void startCamera();

    return () => {
      cancelled =
        true;

      scanLockedRef.current =
        true;

      void stopCurrentCamera();
    };
  }, [
    enabled,
    pageVisible,
    readerId,
    stopCurrentCamera,
  ]);

  return (
    <div className="camera-qr-scanner">
      <div
        id={readerId}
        className="camera-qr-reader"
      />

      {cameraState ===
        "ready" && (
        <div className="camera-qr-guide">
          <div className="camera-qr-corners" />

          <div className="camera-qr-line" />
        </div>
      )}

      {cameraState ===
        "starting" && (
        <div className="camera-qr-message">
          <strong>
            背面カメラを起動しています
          </strong>

          <span>
            高速読み取りの準備中です
          </span>
        </div>
      )}

      {cameraState ===
        "error" && (
        <div className="camera-qr-error">
          <strong>
            カメラを起動できませんでした
          </strong>

          <span>
            {errorMessage}
          </span>

          <span>
            カメラの使用が許可されているか確認してください。
          </span>

          <span>
            公開環境ではHTTPSのURLから開いてください。
          </span>
        </div>
      )}
    </div>
  );
}

export default CameraQrScanner;