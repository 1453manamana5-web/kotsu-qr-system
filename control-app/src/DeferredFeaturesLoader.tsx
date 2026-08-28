import { lazy, Suspense, useEffect, useState } from "react";
import type { Firestore } from "firebase/firestore";

const DeferredControlFeatures = lazy(() => import("./DeferredControlFeatures"));

export default function DeferredFeaturesLoader({ database }: { database: Firestore }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 最初の画面と操作系を先に描画してから、
    // 管制ラボ・AI管制・予測・保守などの補助機能を読み込む。
    const timer = window.setTimeout(() => setReady(true), 700);
    return () => window.clearTimeout(timer);
  }, []);

  if (!ready) return null;

  return (
    <Suspense fallback={null}>
      <DeferredControlFeatures database={database} />
    </Suspense>
  );
}
