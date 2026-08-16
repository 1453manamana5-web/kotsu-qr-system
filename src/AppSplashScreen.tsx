import {
  useEffect,
  useState,
  type ReactNode,
} from "react";

import "./AppSplashScreen.css";

type AppSplashScreenProps = {
  children: ReactNode;
};

const SPLASH_DURATION_MS =
  2150;

function AppSplashScreen({
  children,
}: AppSplashScreenProps) {
  const [
    showSplash,
    setShowSplash,
  ] = useState(true);

  useEffect(() => {
    const timerId =
      window.setTimeout(
        () => {
          setShowSplash(
            false
          );
        },
        SPLASH_DURATION_MS
      );

    return () => {
      window.clearTimeout(
        timerId
      );
    };
  }, []);

  return (
    <>
      {children}

      {showSplash && (
        <div
          className="app-splash-screen"
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
