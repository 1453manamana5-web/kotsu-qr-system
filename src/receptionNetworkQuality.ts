const DOWNLOAD_TEST_TIMEOUT_MILLISECONDS =
  12 * 1000;

const MINIMUM_TEST_BYTES =
  128 * 1024;

export const DOWNLOAD_TEST_INTERVAL_MILLISECONDS =
  30 * 1000;

export async function measureReceptionDownloadMbps() {
  const controller =
    new AbortController();

  const timeout =
    window.setTimeout(
      () => controller.abort(),
      DOWNLOAD_TEST_TIMEOUT_MILLISECONDS
    );

  const assetUrl =
    new URL(
      `${import.meta.env.BASE_URL}speed-test.bin`,
      window.location.origin
    );

  assetUrl.searchParams.set(
    "network-test",
    `${Date.now()}`
  );

  const startedAt =
    performance.now();

  try {
    const response =
      await fetch(
        assetUrl,
        {
          cache:
            "no-store",
          signal:
            controller.signal,
        }
      );

    if (!response.ok) {
      throw new Error(
        `速度測定データを取得できませんでした（${response.status}）。`
      );
    }

    const body =
      await response.arrayBuffer();

    if (
      body.byteLength <
      MINIMUM_TEST_BYTES
    ) {
      throw new Error(
        "速度測定データの容量が不足しています。"
      );
    }

    const elapsedSeconds =
      Math.max(
        0.001,
        (
          performance.now() -
          startedAt
        ) / 1000
      );

    const megabitsPerSecond =
      body.byteLength * 8 /
      elapsedSeconds /
      1_000_000;

    return Math.round(
      megabitsPerSecond * 10
    ) / 10;
  } finally {
    window.clearTimeout(
      timeout
    );
  }
}
