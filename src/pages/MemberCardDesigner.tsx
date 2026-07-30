import {
  type CSSProperties,
  type ChangeEvent,
  useState,
} from "react";

import { QRCodeSVG } from "qrcode.react";
import "./MemberCardDesigner.css";

type MemberCardDesignerProps = {
  memberName: string;
  qrNumber: string;
  qrValue: string;
  onClose: () => void;
};

type CardRatio =
  | "16:9"
  | "4:3"
  | "3:2"
  | "card"
  | "square"
  | "9:16"
  | "custom";

type DesignSettings = {
  backgroundImage: string;

  cardRatio: CardRatio;
  customWidth: number;
  customHeight: number;
  printWidthMm: number;

  qrX: number;
  qrY: number;
  qrSize: number;

  nameX: number;
  nameY: number;
  nameSize: number;

  numberX: number;
  numberY: number;
  numberSize: number;
};

type CardStyle = CSSProperties & {
  "--print-width": string;
  "--print-height": string;
};

const DESIGN_STORAGE_KEY =
  "qr-management-member-card-design";

const defaultSettings: DesignSettings = {
  backgroundImage: "",

  cardRatio: "16:9",
  customWidth: 16,
  customHeight: 9,
  printWidthMm: 120,

  qrX: 76,
  qrY: 50,
  qrSize: 28,

  nameX: 32,
  nameY: 46,
  nameSize: 28,

  numberX: 32,
  numberY: 64,
  numberSize: 18,
};

function loadDesignSettings(): DesignSettings {
  try {
    const savedDesign = localStorage.getItem(
      DESIGN_STORAGE_KEY
    );

    if (savedDesign === null) {
      return defaultSettings;
    }

    const parsedDesign = JSON.parse(
      savedDesign
    ) as Partial<DesignSettings>;

    return {
      ...defaultSettings,
      ...parsedDesign,
    };
  } catch (error) {
    console.error(
      "部員証デザインの読み込みに失敗しました。",
      error
    );

    return defaultSettings;
  }
}

function MemberCardDesigner({
  memberName,
  qrNumber,
  qrValue,
  onClose,
}: MemberCardDesignerProps) {
  const [settings, setSettings] =
    useState<DesignSettings>(
      loadDesignSettings
    );

  const updateSetting = (
    key: keyof DesignSettings,
    value: string | number
  ) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      [key]: value,
    }));
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

  const printHeightMm =
    settings.printWidthMm *
    (ratio.height / ratio.width);

  const cardStyle: CardStyle = {
    aspectRatio: `${ratio.width} / ${ratio.height}`,

    backgroundImage:
      settings.backgroundImage === ""
        ? undefined
        : `url("${settings.backgroundImage}")`,

    "--print-width": `${settings.printWidthMm}mm`,
    "--print-height": `${printHeightMm}mm`,
  };

  const handleBackgroundImage = (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (file === undefined) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert(
        "PNGやJPEGなどの画像ファイルを選んでください。"
      );
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result !== "string") {
        return;
      }

      updateSetting(
        "backgroundImage",
        reader.result
      );
    };

    reader.onerror = () => {
      alert("画像を読み込めませんでした。");
    };

    reader.readAsDataURL(file);
  };

  const removeBackgroundImage = () => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      backgroundImage: "",
    }));
  };

  const saveDesign = () => {
    try {
      localStorage.setItem(
        DESIGN_STORAGE_KEY,
        JSON.stringify(settings)
      );

      alert("部員証デザインを保存しました。");
    } catch (error) {
      console.error(
        "部員証デザインの保存に失敗しました。",
        error
      );

      alert(
        "デザインを保存できませんでした。画像サイズが大きすぎる可能性があります。"
      );
    }
  };

  const resetDesign = () => {
    const confirmed = window.confirm(
      "背景画像や配置を初期状態に戻しますか？"
    );

    if (!confirmed) {
      return;
    }

    setSettings(defaultSettings);

    try {
      localStorage.removeItem(
        DESIGN_STORAGE_KEY
      );
    } catch (error) {
      console.error(
        "保存済みデザインの削除に失敗しました。",
        error
      );
    }
  };

  const printDesign = () => {
    if (settings.backgroundImage === "") {
      const confirmed = window.confirm(
        "背景画像が設定されていません。このまま印刷しますか？"
      );

      if (!confirmed) {
        return;
      }
    }

    window.print();
  };

  return (
    <div className="member-designer-background">
      <section className="member-designer-window">
        <header className="member-designer-header">
          <div>
            <h2>部員証デザイン・印刷</h2>

            <p>
              背景画像の上にQRコード・名前・部員番号を配置します
            </p>
          </div>

          <button
            type="button"
            className="member-designer-close"
            onClick={onClose}
            aria-label="デザイン画面を閉じる"
          >
            ×
          </button>
        </header>

        <main className="member-designer-content">
          <section className="member-designer-preview-section">
            <div className="member-preview-heading">
              <h3>印刷プレビュー</h3>

              <span>
                印刷サイズ：
                {settings.printWidthMm.toFixed(
                  1
                )}
                mm ×{" "}
                {printHeightMm.toFixed(1)}
                mm
              </span>
            </div>

            <div className="member-card-preview-container">
              <div
                className="member-card-print-area"
                style={cardStyle}
              >
                {settings.backgroundImage ===
                  "" && (
                  <div className="member-card-no-background">
                    背景画像を選択してください
                  </div>
                )}

                <div
                  className="member-card-qr"
                  style={{
                    left: `${settings.qrX}%`,
                    top: `${settings.qrY}%`,
                    width: `${settings.qrSize}%`,
                  }}
                >
                  <QRCodeSVG
                    value={qrValue}
                    size={500}
                    level="M"
                    marginSize={1}
                  />
                </div>

                <div
                  className="member-card-name"
                  style={{
                    left: `${settings.nameX}%`,
                    top: `${settings.nameY}%`,
                    fontSize: `${settings.nameSize}px`,
                  }}
                >
                  {memberName}
                </div>

                <div
                  className="member-card-number"
                  style={{
                    left: `${settings.numberX}%`,
                    top: `${settings.numberY}%`,
                    fontSize: `${settings.numberSize}px`,
                  }}
                >
                  {qrNumber}
                </div>
              </div>
            </div>
          </section>

          <section className="member-designer-settings">
            <h3>デザイン設定</h3>

            <div className="member-setting-group">
              <h4>カードサイズ</h4>

              <label className="member-select-setting">
                比率

                <select
                  value={settings.cardRatio}
                  onChange={(event) =>
                    updateSetting(
                      "cardRatio",
                      event.target
                        .value as CardRatio
                    )
                  }
                >
                  <option value="16:9">
                    16:9（Keynote・PowerPoint）
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
                <div className="member-custom-ratio">
                  <label>
                    横の比率

                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="0.1"
                      value={
                        settings.customWidth
                      }
                      onChange={(event) =>
                        updateSetting(
                          "customWidth",
                          Number(
                            event.target.value
                          )
                        )
                      }
                    />
                  </label>

                  <span>：</span>

                  <label>
                    縦の比率

                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="0.1"
                      value={
                        settings.customHeight
                      }
                      onChange={(event) =>
                        updateSetting(
                          "customHeight",
                          Number(
                            event.target.value
                          )
                        )
                      }
                    />
                  </label>
                </div>
              )}

              <label className="member-number-setting">
                印刷時の横幅

                <input
                  type="number"
                  min="30"
                  max="300"
                  step="1"
                  value={
                    settings.printWidthMm
                  }
                  onChange={(event) =>
                    updateSetting(
                      "printWidthMm",
                      Math.max(
                        30,
                        Number(
                          event.target.value
                        )
                      )
                    )
                  }
                />

                <span>mm</span>
              </label>

              <p className="member-designer-help">
                縦の長さは選択した比率から自動計算されます。
              </p>
            </div>

            <div className="member-setting-group">
              <h4>背景画像</h4>

              <label className="member-background-label">
                PNG・JPEG画像を選択

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={
                    handleBackgroundImage
                  }
                />
              </label>

              <p className="member-designer-help">
                KeynoteやPowerPointからPNGで書き出した画像も使用できます。
              </p>

              {settings.backgroundImage !==
                "" && (
                <button
                  type="button"
                  className="member-remove-background-button"
                  onClick={
                    removeBackgroundImage
                  }
                >
                  背景画像を削除
                </button>
              )}
            </div>

            <div className="member-setting-group">
              <h4>QRコード</h4>

              <label>
                横位置

                <input
                  type="range"
                  min="5"
                  max="95"
                  value={settings.qrX}
                  onChange={(event) =>
                    updateSetting(
                      "qrX",
                      Number(
                        event.target.value
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
                  value={settings.qrY}
                  onChange={(event) =>
                    updateSetting(
                      "qrY",
                      Number(
                        event.target.value
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
                  value={settings.qrSize}
                  onChange={(event) =>
                    updateSetting(
                      "qrSize",
                      Number(
                        event.target.value
                      )
                    )
                  }
                />

                <span>
                  {settings.qrSize}%
                </span>
              </label>
            </div>

            <div className="member-setting-group">
              <h4>部員名</h4>

              <label>
                横位置

                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.nameX}
                  onChange={(event) =>
                    updateSetting(
                      "nameX",
                      Number(
                        event.target.value
                      )
                    )
                  }
                />

                <span>
                  {settings.nameX}%
                </span>
              </label>

              <label>
                縦位置

                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.nameY}
                  onChange={(event) =>
                    updateSetting(
                      "nameY",
                      Number(
                        event.target.value
                      )
                    )
                  }
                />

                <span>
                  {settings.nameY}%
                </span>
              </label>

              <label>
                文字サイズ

                <input
                  type="range"
                  min="10"
                  max="64"
                  value={settings.nameSize}
                  onChange={(event) =>
                    updateSetting(
                      "nameSize",
                      Number(
                        event.target.value
                      )
                    )
                  }
                />

                <span>
                  {settings.nameSize}px
                </span>
              </label>
            </div>

            <div className="member-setting-group">
              <h4>部員番号</h4>

              <label>
                横位置

                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.numberX}
                  onChange={(event) =>
                    updateSetting(
                      "numberX",
                      Number(
                        event.target.value
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
                  min="0"
                  max="100"
                  value={settings.numberY}
                  onChange={(event) =>
                    updateSetting(
                      "numberY",
                      Number(
                        event.target.value
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
                  min="10"
                  max="50"
                  value={settings.numberSize}
                  onChange={(event) =>
                    updateSetting(
                      "numberSize",
                      Number(
                        event.target.value
                      )
                    )
                  }
                />

                <span>
                  {settings.numberSize}px
                </span>
              </label>
            </div>
          </section>
        </main>

        <footer className="member-designer-buttons">
          <button
            type="button"
            className="member-design-save-button"
            onClick={saveDesign}
          >
            デザインを保存
          </button>

          <button
            type="button"
            className="member-design-print-button"
            onClick={printDesign}
          >
            このデザインで印刷
          </button>

          <button
            type="button"
            className="member-design-reset-button"
            onClick={resetDesign}
          >
            初期状態に戻す
          </button>

          <button
            type="button"
            className="member-design-cancel-button"
            onClick={onClose}
          >
            閉じる
          </button>
        </footer>
      </section>
    </div>
  );
}

export default MemberCardDesigner;