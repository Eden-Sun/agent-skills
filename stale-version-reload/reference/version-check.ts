/**
 * 新版偵測的純函式與共用狀態。不碰 React、不讀 process.env，方便單元測試。
 * 建議放在 src/lib/version-check.ts。
 */

/** 每隔這麼久向 /api/version 檢查一次線上版本。 */
export const VERSION_CHECK_INTERVAL_MS = 5 * 60_000;
/** 第一次看到不同版本後，隔這麼久再確認一次，避免切流量時新舊版本來回跳。 */
export const VERSION_CONFIRM_DELAY_MS = 30_000;
/** 已確認有新版、但頁面仍有流程在跑時，隔這麼久再看一次能不能跳通知。 */
export const REFRESH_BLOCKER_POLL_MS = 2_000;
/** 舊頁面的寫入被擋下時給使用者看的訊息。 */
export const STALE_WRITE_MESSAGE = "系統已更新，請重新整理頁面後再操作";
/** 版本查詢端點；寫入攔截不會擋它。 */
export const VERSION_ENDPOINT = "/api/version";

export type VersionCheckState = {
  /** 第一次看到、尚待確認的版本 */
  candidate: string | null;
  /** 已連續兩次確認的版本；一旦有值就不再收回 */
  confirmed: string | null;
};

export const initialVersionCheckState: VersionCheckState = { candidate: null, confirmed: null };

/**
 * 依伺服器回報的版本推進狀態。判斷用「不同」而非「較新」：rollback 回舊版同樣要重新整理。
 * remote 為 null（請求失敗或伺服器沒有版本）時不改變狀態。
 */
export function nextVersionCheckState(
  state: VersionCheckState,
  current: string,
  remote: string | null,
): VersionCheckState {
  if (state.confirmed || !remote) return state;
  if (remote === current) return initialVersionCheckState;
  if (state.candidate === remote) return { candidate: null, confirmed: remote };
  return { candidate: remote, confirmed: null };
}

/** 解析 /api/version 的回應；格式不對或為 "unknown" 時回 null（呼叫端略過，不判新版）。 */
export function parseVersionResponse(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("version" in body)) return null;
  const { version } = body as { version: unknown };
  if (typeof version !== "string") return null;
  const trimmed = version.trim();
  return trimmed && trimmed !== "unknown" ? trimmed : null;
}

// ---- refresh blocker：處理中的流程登記在這裡，有任何一個成立就先不跳通知 ----

const refreshBlockers = new Set<() => boolean>();

/** 登記一個「目前不能重新整理」的判斷；回傳解除函式，請在 effect cleanup 呼叫。 */
export function registerRefreshBlocker(isBlocking: () => boolean): () => void {
  refreshBlockers.add(isBlocking);
  return () => {
    refreshBlockers.delete(isBlocking);
  };
}

export function isRefreshBlocked(): boolean {
  for (const isBlocking of refreshBlockers) {
    if (isBlocking()) return true;
  }
  return false;
}

// ---- 舊頁面寫入攔截 ----

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type WriteCheck = {
  method: string;
  url: URL;
  origin: string;
  /** 是否已確認有新版 */
  stale: boolean;
  /** 是否有 refresh blocker 成立（流程進行中就放行） */
  busy: boolean;
};

/** 只擋：已確認新版、沒有流程在跑、同站、/api/ 開頭、寫入方法；版本端點本身不擋。 */
export function shouldBlockWrite({ method, url, origin, stale, busy }: WriteCheck): boolean {
  if (!stale || busy) return false;
  if (!WRITE_METHODS.has(method.toUpperCase())) return false;
  if (url.origin !== origin) return false;
  if (!url.pathname.startsWith("/api/")) return false;
  return url.pathname !== VERSION_ENDPOINT;
}

/**
 * 包住 window.fetch，舊頁面要寫入時直接 reject。回傳還原函式。
 * 只涵蓋 fetch；XHR／sendBeacon 不經過這裡。
 */
export function installStaleWriteGuard(isStale: () => boolean): () => void {
  const original = window.fetch;
  const guarded: typeof window.fetch = (input, init) => {
    const request = input instanceof Request ? input : null;
    const method = init?.method ?? request?.method ?? "GET";
    const raw = request ? request.url : input instanceof URL ? input.href : String(input);
    let url: URL;
    try {
      url = new URL(raw, window.location.href);
    } catch {
      return original(input, init);
    }
    const blocked = shouldBlockWrite({
      method,
      url,
      origin: window.location.origin,
      stale: isStale(),
      busy: isRefreshBlocked(),
    });
    return blocked ? Promise.reject(new Error(STALE_WRITE_MESSAGE)) : original(input, init);
  };
  window.fetch = guarded;
  return () => {
    // 若之後有別人又包了一層，就不硬還原，避免把對方的包裝拆掉
    if (window.fetch === guarded) window.fetch = original;
  };
}
