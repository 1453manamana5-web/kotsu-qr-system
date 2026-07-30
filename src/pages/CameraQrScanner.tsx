import {
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

function isBackCameraLabel(
  cameraLabel: string
) {
  const label =
    cameraLabel.toLowerCase();

  return (
    label.includes("back") ||
    label.includes("rear") ||
    label.includes("environment") ||
    label.includes("world") ||
    label.includes("背面") ||
    label.includes("外側")
  );
}

function stopAllVideoTracks() {
  const videoElements =
    document.querySelectorAll(
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
        stream
          .getTracks()
          .forEach(
            (track) => {
              try {
                track.stop();
              } catch (error) {
                console.warn(
                  "映像トラックを停止できませんでした。",
                  error
                );
              }
            }
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

async function applyFastCameraSettings(
  scanner: Html5Qrcode
) {
  const fastConstraints:
    ExtendedVideoConstraints = {
      width: {
        ideal: 1280,
      },

      height: {
        ideal: 720,
      },

      frameRate: {
        ideal: 30,
        min: 15,
      },

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
      "連続フォーカス設定を使用できませんでした。通常設定を試します。",
      advancedError
    );

    try {
      await scanner.applyVideoConstraints({
        width: {
          ideal: 1280,
        },

        height: {
          ideal: 720,
        },

        frameRate: {
          ideal: 30,
          min: 15,
        },
      });

      console.log(
        "基本カメラ設定を適用しました。"
      );
    } catch (basicError) {
      console.warn(
        "カメラ設定の変更には対応していません。端末の標準設定を使用します。",
        basicError
      );
    }
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
      Html5Qrcode | null
    >(null);

  const scanLockedRef =
    useRef(false);

  const lastScannedValueRef =
    useRef("");

  const lastScannedTimeRef =
    useRef(0);

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

  useEffect(() => {
    let cancelled =
      false;

    const stopCamera =
      async () => {
        const scanner =
          scannerRef.current;

        scannerRef.current =
          null;

        if (
          scanner !== null
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
              "カメラ表示の削除時にエラーが発生しました。",
              error
            );
          }
        }

        /*
          html5-qrcodeの停止だけで映像トラックが
          残る端末があるため、video要素側も明示的に停止します。
        */
        stopAllVideoTracks();
      };

    if (!enabled) {
      void stopCamera();

      setCameraState(
        "starting"
      );

      setErrorMessage("");

      return () => {
        cancelled =
          true;

        void stopCamera();
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
        try {
          /*
            前の画面で残ったカメラがあれば、
            新しく起動する前に確実に停止します。
          */
          await stopCamera();

          if (cancelled) {
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

          const scanner =
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

          const cameras =
            await Html5Qrcode.getCameras();

          if (cancelled) {
            await stopCamera();

            return;
          }

          if (
            cameras.length ===
            0
          ) {
            throw new Error(
              "使用できるカメラが見つかりませんでした。"
            );
          }

          const preferredCamera =
            cameras.find(
              (camera) =>
                isBackCameraLabel(
                  camera.label
                )
            ) ??
            cameras[
              cameras.length - 1
            ];

          if (
            preferredCamera ===
            undefined
          ) {
            throw new Error(
              "背面カメラを選択できませんでした。"
            );
          }

          console.log(
            "使用する背面カメラ:",
            preferredCamera.label ||
              preferredCamera.id
          );

          await scanner.start(
            preferredCamera.id,
            {
              fps:
                18,

              qrbox: (
                viewfinderWidth,
                viewfinderHeight
              ) => {
                const minimumSide =
                  Math.min(
                    viewfinderWidth,
                    viewfinderHeight
                  );

                const calculatedSize =
                  Math.floor(
                    minimumSide *
                      0.9
                  );

                const availableSize =
                  Math.max(
                    180,
                    minimumSide - 16
                  );

                const finalSize =
                  Math.min(
                    calculatedSize,
                    availableSize
                  );

                return {
                  width:
                    finalSize,

                  height:
                    finalSize,
                };
              },

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

              onScanRef.current(
                normalizedValue
              );
            },
            () => {
              /*
                読み取り失敗は頻繁に発生するため、
                状態更新やログ出力はしません。
              */
            }
          );

          if (cancelled) {
            await stopCamera();

            return;
          }

          await applyFastCameraSettings(
            scanner
          );

          if (cancelled) {
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

          if (!cancelled) {
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
    readerId,
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