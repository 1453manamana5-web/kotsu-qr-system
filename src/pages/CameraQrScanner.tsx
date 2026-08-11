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

const CAMERA_SCAN_FPS =
  15;

const CAMERA_ASPECT_RATIO =
  4 / 3;

const CAMERA_VIDEO_WIDTH =
  1920;

const CAMERA_VIDEO_HEIGHT =
  1440;

const CAMERA_VIDEO_FPS =
  30;

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

function isBackCameraLabel(
  label: string
) {
  return /back|rear|environment|背面/i.test(
    label
  );
}

async function getCameraId() {
  const cameras =
    await Html5Qrcode.getCameras();

  if (
    cameras.length ===
    0
  ) {
    throw new Error(
      "使用できるカメラが見つかりませんでした。"
    );
  }

  const backCamera =
    cameras.find(
      (camera) =>
        isBackCameraLabel(
          camera.label
        )
    );

  const selectedCamera =
    backCamera ??
    cameras[
      cameras.length -
        1
    ];

  return selectedCamera.id;
}

function stopReaderVideoTracks(
  readerId: string
) {
  const readerElement =
    document.getElementById(
      readerId
    );

  const videoElements =
    readerElement?.querySelectorAll(
      "video"
    );

  videoElements?.forEach(
    (videoElement) => {
      const stream =
        videoElement.srcObject;

      if (
        stream instanceof
          MediaStream
      ) {
        stream
          .getTracks()
          .forEach(
            (track) => {
              track.stop();
            }
          );

        videoElement.srcObject =
          null;
      }
    }
  );
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

  const stopPromiseRef =
    useRef<
      Promise<void> |
      null
    >(null);

  const scanLockedRef =
    useRef(false);

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

  const stopCamera =
    useCallback(
      async () => {
        if (
          stopPromiseRef.current !==
          null
        ) {
          await stopPromiseRef.current;
          return;
        }

        const stopPromise =
          (async () => {
            const scanner =
              scannerRef.current;

            scannerRef.current =
              null;

            if (
              scanner !==
              null
            ) {
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
                  "カメラ表示を削除できませんでした。",
                  error
                );
              }
            }

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
    const updateVisibility =
      () => {
        setPageVisible(
          document.visibilityState ===
          "visible"
        );
      };

    document.addEventListener(
      "visibilitychange",
      updateVisibility
    );

    window.addEventListener(
      "pageshow",
      updateVisibility
    );

    window.addEventListener(
      "pagehide",
      updateVisibility
    );

    return () => {
      document.removeEventListener(
        "visibilitychange",
        updateVisibility
      );

      window.removeEventListener(
        "pageshow",
        updateVisibility
      );

      window.removeEventListener(
        "pagehide",
        updateVisibility
      );
    };
  }, []);

  useEffect(() => {
    let cancelled =
      false;

    if (
      !enabled ||
      !pageVisible
    ) {
      scanLockedRef.current =
        true;

      void stopCamera();

      return () => {
        cancelled =
          true;
      };
    }

    scanLockedRef.current =
      false;

    setCameraState(
      "starting"
    );

    setErrorMessage("");

    const startCamera =
      async () => {
        try {
          await stopCamera();

          if (
            cancelled
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

          const cameraId =
            await getCameraId();

          if (
            cancelled
          ) {
            return;
          }

          const scanner =
            new Html5Qrcode(
              readerId,
              {
                formatsToSupport: [
                  Html5QrcodeSupportedFormats.QR_CODE,
                ],

                useBarCodeDetectorIfSupported:
                  false,

                verbose:
                  false,
              }
            );

          scannerRef.current =
            scanner;

          await scanner.start(
            cameraId,
            {
              fps:
                CAMERA_SCAN_FPS,

              disableFlip:
                false,

              videoConstraints: {
                deviceId: {
                  exact:
                    cameraId,
                },

                width: {
                  ideal:
                    CAMERA_VIDEO_WIDTH,
                },

                height: {
                  ideal:
                    CAMERA_VIDEO_HEIGHT,
                },

                aspectRatio: {
                  ideal:
                    CAMERA_ASPECT_RATIO,
                },

                frameRate: {
                  ideal:
                    CAMERA_VIDEO_FPS,

                  max:
                    CAMERA_VIDEO_FPS,
                },
              },
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

              const qrValue =
                decodedText.trim();

              if (
                qrValue ===
                ""
              ) {
                return;
              }

              scanLockedRef.current =
                true;

              void stopCamera();

              onScanRef.current(
                qrValue
              );
            },
            () => {
              // QRがないフレームでは何もしません。
            }
          );

          if (
            cancelled
          ) {
            await stopCamera();
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

          await stopCamera();

          if (
            !cancelled
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

      void stopCamera();
    };
  }, [
    enabled,
    pageVisible,
    readerId,
    stopCamera,
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
            カメラを起動しています
          </strong>

          <span>
            QRコードを準備してください
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
