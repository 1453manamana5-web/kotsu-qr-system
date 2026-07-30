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
    if (!enabled) {
      return;
    }

    let cancelled =
      false;

    let scanner:
      | Html5Qrcode
      | null = null;

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

          const cameras =
            await Html5Qrcode.getCameras();

          if (cancelled) {
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
              /*
                毎秒18回解析します。

                高すぎるfpsはiPad側の負荷が増えるため、
                速度と安定性のバランスを取っています。
              */
              fps: 18,

              /*
                白いガイドより少し広い範囲を解析します。

                QRが枠の端に寄っても、
                解析範囲から外れにくくなります。
              */
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

              /*
                背面カメラは通常反転しないため、
                反転QRの追加解析を停止して負荷を減らします。
              */
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

              /*
                読み取った瞬間にロックして、
                同じQRの連続処理を防ぎます。
              */
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
                読み取り失敗は毎秒何度も発生するため、
                ログや状態更新を行いません。
              */
            }
          );

          if (cancelled) {
            if (
              scanner.isScanning
            ) {
              await scanner.stop();
            }

            scanner.clear();

            return;
          }

          /*
            カメラ起動後に、
            対応端末だけ高画質・連続フォーカスを適用します。
          */
          await applyFastCameraSettings(
            scanner
          );

          if (cancelled) {
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

      const stopCamera =
        async () => {
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
        };

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