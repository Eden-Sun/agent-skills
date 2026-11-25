"use client";

/**
 * 偵測到線上換版就跳出不可關閉的通知，只能按「確定」重新整理。
 * currentVersion 為 null（本機沒有 BUILD_VERSION）時整個不啟用。
 * 建議放在 src/components/version-watcher.tsx；視窗可換成專案的 Modal，
 * 但必須維持：沒有關閉鈕、點遮罩不關、Esc 不關。
 */
import { useEffect, useState } from "react";
import {
  initialVersionCheckState,
  installStaleWriteGuard,
  isRefreshBlocked,
  nextVersionCheckState,
  parseVersionResponse,
  REFRESH_BLOCKER_POLL_MS,
  VERSION_CHECK_INTERVAL_MS,
  VERSION_CONFIRM_DELAY_MS,
  VERSION_ENDPOINT,
} from "@/lib/version-check";

async function fetchServerVersion(): Promise<string | null> {
  try {
    const response = await fetch(`${VERSION_ENDPOINT}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return null;
    return parseVersionResponse(await response.json());
  } catch {
    return null;
  }
}

type Props = {
  currentVersion: string | null;
  /** 選填：登入失效時通知本元件讓位；回傳取消訂閱函式。 */
  subscribeSessionExpired?: (listener: () => void) => () => void;
};

export function VersionWatcher({ currentVersion, subscribeSessionExpired }: Props) {
  const [updatePending, setUpdatePending] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

  // 1. 輪詢：每 5 分鐘一次、回到前景立刻一次；不同版本隔 30 秒再確認
  useEffect(() => {
    if (!currentVersion) return;
    let state = initialVersionCheckState;
    let timer: number | undefined;
    let cancelled = false;
    let running = false;

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, ms);
    };
    async function check() {
      if (cancelled || running || state.confirmed) return;
      running = true;
      const remote = await fetchServerVersion();
      running = false;
      if (cancelled) return;
      state = nextVersionCheckState(state, currentVersion!, remote);
      if (state.confirmed) {
        window.clearTimeout(timer);
        setUpdatePending(true);
        return;
      }
      schedule(state.candidate ? VERSION_CONFIRM_DELAY_MS : VERSION_CHECK_INTERVAL_MS);
    }
    // 確認中（candidate）不提前，維持 30 秒間隔
    const onVisible = () => {
      if (document.visibilityState === "visible" && !state.candidate) void check();
    };

    schedule(VERSION_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [currentVersion]);

  // 2. 確認有新版後擋舊頁面的寫入（流程進行中放行，由 shouldBlockWrite 判斷）
  useEffect(() => (updatePending ? installStaleWriteGuard(() => true) : undefined), [updatePending]);

  // 3. 登入失效優先：重整只會被導去登入頁且回不到原頁，交給登入失效處理
  useEffect(() => {
    if (!subscribeSessionExpired) return;
    return subscribeSessionExpired(() => {
      setUpdatePending(false);
      setUpdateReady(false);
    });
  }, [subscribeSessionExpired]);

  // 4. 有流程在跑就先不跳，等全部 blocker 解除
  useEffect(() => {
    if (!updatePending) return;
    const showWhenIdle = () => {
      if (isRefreshBlocked()) return false;
      setUpdateReady(true);
      return true;
    };
    if (showWhenIdle()) return;
    const timer = window.setInterval(() => {
      if (showWhenIdle()) window.clearInterval(timer);
    }, REFRESH_BLOCKER_POLL_MS);
    return () => window.clearInterval(timer);
  }, [updatePending]);

  if (!updateReady) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="version-watcher-title"
      aria-describedby="version-watcher-desc"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        display: "grid",
        placeItems: "center",
        background: "rgba(0, 0, 0, 0.45)",
      }}
    >
      <div
        style={{
          width: "calc(100% - 32px)",
          maxWidth: 360,
          padding: 24,
          borderRadius: 8,
          background: "#fff",
          color: "#111",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)",
        }}
      >
        <h2 id="version-watcher-title" style={{ margin: "0 0 8px", fontSize: 18 }}>
          有更新版本
        </h2>
        <p id="version-watcher-desc" style={{ margin: "0 0 16px" }}>
          系統已更新，請按「確定」重新整理頁面。
        </p>
        <button type="button" autoFocus onClick={() => window.location.reload()}>
          確定
        </button>
      </div>
    </div>
  );
}
