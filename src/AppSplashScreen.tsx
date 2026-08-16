import {
  useEffect,
  useState,
  type ReactNode,
} from "react";

import "./AppSplashScreen.css";

type AppSplashScreenProps = {
  children: ReactNode;
  canFinish: boolean;
};

const MINIMUM_SPLASH_DURATION_MS =
  1750;

const SPLASH_EXIT_DURATION_MS =
  400;

function AppSplashScreen({
  children,
  canFinish,
}: AppSplashScreenProps) {
  const [
    showSplash,
    setShowSplash,
  ] = useState(true);

  const [
    isLeaving,
    setIsLeaving,
  ] = useState(false);

  const [
    minimumTimeElapsed,
    setMinimumTimeElapsed,
  ] = useState(false);

  useEffect(() => {
    const timerId =
      window.setTimeout(
        () => {
          setMinimumTimeElapsed(
            true
          );
        },
        MINIMUM_SPLASH_DURATION_MS
      );

    return () => {
      window.clearTimeout(
        timerId
      );
    };
  }, []);

  useEffect(() => {
    if (
      !canFinish ||
      !minimumTimeElapsed
    ) {
      return;
    }

    const leaveTimerId =
      window.setTimeout(
        () => {
          setIsLeaving(true);
        },
        0
      );

    const hideTimerId =
      window.setTimeout(
        () => {
          setShowSplash(false);
        },
        SPLASH_EXIT_DURATION_MS
      );

    return () => {
      window.clearTimeout(
        leaveTimerId
      );

      window.clearTimeout(
        hideTimerId
      );
    };
  }, [
    canFinish,
    minimumTimeElapsed,
  ]);

  return (
    <>
      {children}

      {showSplash && (
        <div
          className={`app-splash-screen${
            isLeaving
              ? " is-leaving"
              : ""
          }`}
          role="status"
          aria-label="アプリを起動しています"
        >
          <div className="app-splash-brand">
            <div className="app-splash-icon">
              <img
                src={`${import.meta.env.BASE_URL}pwa-512x512.png`}
                alt=""
                aria-hidden="true"
              />

              <span
                className="app-splash-scan-line"
                aria-hidden="true"
              />
            </div>

            <h1>
              交通研究部 QR受付
            </h1>
          </div>
        </div>
      )}
    </>
  );
}

export default AppSplashScreen;
