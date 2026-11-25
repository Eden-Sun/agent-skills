// ===== src/lib/build-version.ts =====
// next.config.ts（build 期）、layout 與 /api/version（執行期）共用。
// 不要用 NEXT_PUBLIC_*：會讓 image 綁定環境，各環境無法共用同一個 image。

type Env = { [key: string]: string | undefined };

/** 本版版本字串（建議用 commit sha）；未注入或為 Dockerfile 預設的 "unknown" 時回 null。 */
export function getBuildVersion(env: Env = process.env): string | null {
  const value = env.BUILD_VERSION?.trim();
  return value && value !== "unknown" ? value : null;
}

/** 建置時間（CI 寫入的 UTC ISO8601）；未注入或無法解析時回 null。只供查問題，不參與新版判斷。 */
export function getBuildTime(env: Env = process.env): string | null {
  const value = env.BUILD_TIME?.trim();
  return value && Number.isFinite(Date.parse(value)) ? value : null;
}

// ===== src/app/api/version/route.ts =====
// import { getBuildTime, getBuildVersion } from "@/lib/build-version";

export const runtime = "nodejs";
// 不可在 build 期預算成靜態：要回的是「當下接到這個請求的那一版」。
export const dynamic = "force-dynamic";

/**
 * 公開端點，給瀏覽器偵測新版本用。刻意不查 DB，避免每個分頁定期輪詢時對 DB 施壓。
 * 只回不敏感的資訊；新版判斷只看 version。
 */
export function GET() {
  return Response.json(
    { version: getBuildVersion() ?? "unknown", buildTime: getBuildTime(), serverTime: Date.now() },
    { headers: { "cache-control": "no-store" } },
  );
}
