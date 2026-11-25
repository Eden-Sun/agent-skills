---
name: stale-version-reload
description: 讓 Next.js 前端在新版部署後偵測到版本變更，等使用者手上的流程（送出、上傳、處理中）結束後，跳出不可關閉的「有更新版本」視窗強制重新整理，並在等待期間擋掉舊頁面的寫入 API。用於導入新版偵測、排查「使用者一直停在舊版」「重整迴圈」「舊頁面送出得到莫名錯誤」，或新增不能被重新整理打斷的流程時。
---

# 新版上線後強制重新整理（stale-version-reload）

## 1. 要解決什麼

使用者把分頁開著一整天，後端已經部署新版：

- 舊 JS 去拿已經不存在的 chunk → 換頁失敗、白畫面。
- 舊 JS 呼叫契約已變的 API → 送出得到看不懂的錯誤，甚至寫入錯誤資料。
- 使用者一直看到舊畫面，回報的問題其實新版已修好。

## 2. 設計重點（先讀這段）

| 決定 | 做法 | 理由 |
|---|---|---|
| 怎麼重整 | 不可關閉的視窗，只有「確定」→ `location.reload()`；**不自動倒數** | 不替使用者決定時機，按下去的當下一定是空檔 |
| 處理中的流程 | 用 **refresh blocker** 登記；有任何 blocker 成立就先不跳視窗 | 送出、上傳、簽署、付款導轉前被重整會中斷或重複送出 |
| 舊頁面寫入 | 確認有新版後攔 `window.fetch`，擋同站 `/api/*` 的寫入；**blocker 成立時放行** | 堵住「等使用者按確定」這段期間的舊版寫入，又不打斷還在跑的流程 |
| 判斷新版 | 版本字串**不同**，且**隔 30 秒再看一次仍是同一個** | rollback 回舊版也要重整；兩次確認避開切流量時新舊版本來回跳 |
| 版本來源 | CI 以 build-arg 寫入 `BUILD_VERSION`，伺服器在 render 時把它交給頁面；**不用 `NEXT_PUBLIC_*`** | 同一個 image 可部署到所有環境 |
| 頻率 | 每 5 分鐘一次，分頁從背景回到前景時立刻查一次 | 輪詢成本低，又不讓離開很久的人等滿 5 分鐘 |
| 換頁 | 設定 Next.js `deploymentId` | 換頁時版本錯位就整頁載入新版，涵蓋輪詢之間的空窗 |
| 登入失效 | 登入失效優先，版本通知讓位 | 失效時重整只會被導去登入頁且回不到原頁；重新登入後拿到的本來就是新版 |

## 3. 零件

```
CI ── build-arg BUILD_VERSION=<commit sha>, BUILD_TIME=<UTC ISO8601>
 │
 ├─ Dockerfile builder stage：ENV BUILD_VERSION → next.config 的 deploymentId
 └─ Dockerfile runtime stage：ENV BUILD_VERSION → /api/version、layout 傳給 <VersionWatcher>

瀏覽器
 <VersionWatcher currentVersion=…>
   每 5 分鐘／回到前景 → GET /api/version
   不同 → 30 秒後再確認 → confirmed
     → 安裝寫入攔截（blocker 成立時放行）
     → 等所有 refresh blocker 解除 → 不可關閉視窗 → reload()
```

參考實作（直接複製後依專案調整）：

| 檔案 | 內容 |
|---|---|
| [reference/version-check.ts](reference/version-check.ts) | 純函式：狀態機、回應解析、refresh blocker、寫入判斷、fetch 攔截 |
| [reference/version-watcher.tsx](reference/version-watcher.tsx) | React client 元件：輪詢、前景檢查、視窗 |
| [reference/version-route.ts](reference/version-route.ts) | `GET /api/version`（App Router route handler）＋ `getBuildVersion()` |
| [reference/version-check.test.ts](reference/version-check.test.ts) | 單元測試（vitest） |

## 4. 導入步驟

1. **CI**：建 image 時帶 build-arg。
   ```bash
   docker build \
     --build-arg BUILD_VERSION="$GITHUB_SHA" \
     --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" .
   ```
2. **Dockerfile**：兩個 stage 都要宣告（`ARG` 不跨 stage）。
   ```dockerfile
   FROM node:22 AS builder
   ARG BUILD_VERSION=unknown
   ENV BUILD_VERSION=$BUILD_VERSION
   RUN pnpm build                       # next.config 在這裡讀 deploymentId

   FROM node:22-slim AS runner
   ARG BUILD_VERSION=unknown
   ARG BUILD_TIME=
   ENV BUILD_VERSION=$BUILD_VERSION BUILD_TIME=$BUILD_TIME
   ```
3. **next.config.ts**：
   ```ts
   import { getBuildVersion } from "./src/lib/build-version";
   const nextConfig = {
     // 換頁時瀏覽器與伺服器版本不同就整頁重新載入；本機沒有 BUILD_VERSION 時不啟用
     deploymentId: getBuildVersion() ?? undefined,
   };
   ```
   （確認所用 Next.js 版本支援 `deploymentId`。）
4. **API**：放 `app/api/version/route.ts`（見 reference）。公開、`force-dynamic`、`cache-control: no-store`，**不查 DB**（每個分頁都會輪詢）。若有 middleware 擋未登入請求，要放行這條路徑。
5. **掛元件**：在所有已登入外框的 layout（含後台、列印頁等獨立 layout）：
   ```tsx
   <VersionWatcher currentVersion={getBuildVersion()} subscribeSessionExpired={onSessionExpired} />
   ```
   視窗樣式換成專案的 Modal 元件即可，但必須維持：沒有關閉鈕、點遮罩不關、Esc 不關。
6. **登記 blocker**：找出所有「被重整就壞」的流程（見第 5 節）。
7. **登入失效**（若專案有統一的失效處理）：失效時登記永遠成立的 blocker，並把 `subscribeSessionExpired` 傳給 `VersionWatcher`，讓已顯示的通知收掉。
8. **測試**：複製 `version-check.test.ts`，再照第 7 節手動驗證。

## 5. Refresh blocker

```ts
import { registerRefreshBlocker } from "@/lib/version-check";

useEffect(() => {
  if (!isSubmitting) return;
  return registerRefreshBlocker(() => true); // 回傳的函式就是解除，交給 cleanup
}, [isSubmitting]);

// 或傳入會動態判斷的函式，例如上傳佇列：
useEffect(() => registerRefreshBlocker(queue.hasPending), [queue]);
```

規則：

- **必須登記**：送出中、背景處理中（輪詢結果）、檔案上傳中、電子簽署中、即將導轉到外部付款頁、長表單尚未送出（若沒有草稿保存）。
- **cleanup 一定要解除**，否則新版通知永遠不跳。
- blocker 成立時寫入攔截會放行，所以流程中的後續 API（例如輪詢處理結果、分段上傳）不會被擋。

## 6. 寫入攔截

- 只擋：同站、路徑以 `/api/` 開頭、方法為 POST／PUT／PATCH／DELETE、且沒有 blocker 成立。
- 不擋：GET／HEAD（擋了會讓畫面空白）、跨站請求、`/api/version` 本身、Next 內部資源。
- 擋下時 reject 固定訊息「系統已更新，請重新整理頁面後再操作」，畫面原本的錯誤提示會顯示它。
- 只攔 `window.fetch`：`navigator.sendBeacon`、`XMLHttpRequest` 不會被擋。若專案用 axios（XHR adapter）或 Server Actions（POST 到頁面路徑、帶 `Next-Action` header），要另外處理：axios 加 request interceptor 呼叫同一個 `shouldBlockWrite`；Server Actions 可把判斷擴充為「帶 `next-action` header 的 POST 也擋」。

## 7. 驗證

- 單元測試涵蓋：版本相同歸零、第一次不同只記 candidate、第二次相同才 confirmed、中途又變成另一個版本重新計算、請求失敗不改狀態、`unknown` 不算版本、寫入判斷的 method／路徑／跨站／blocker 組合。
- 本機（不需部署）：
  ```bash
  BUILD_VERSION=aaa pnpm build && BUILD_VERSION=aaa pnpm start   # 開頁面，停在原頁
  # 另一個終端：停掉後
  BUILD_VERSION=bbb pnpm build && BUILD_VERSION=bbb pnpm start
  ```
  回到原分頁（觸發前景檢查）→ 30 秒內出現視窗。測試時可暫時把間隔常數調小。
- 部署環境：開著舊分頁，部署新版 → 5 分 30 秒內（或切回分頁後 30 秒內）出現視窗；處理中則等結束才出現；視窗出現後在 DevTools 用 fetch 打一支寫入 API，應得到固定錯誤訊息。

## 8. 常見問題

| 現象 | 先查 |
|---|---|
| 本機 `next dev` 永遠不跳 | 沒有 `BUILD_VERSION`，設計如此 |
| 部署後一直不跳 | blocker 沒解除（cleanup 漏了）；`/api/version` 被 CDN／瀏覽器快取；layout 沒掛元件；回應的 version 是 `unknown`（runtime stage 沒宣告 ENV） |
| 跳了又像沒換版 | 新舊版本同時分流（滾動更新、canary）；拉長確認間隔，或部署平台改成一次切換 |
| rollback 也跳 | 正確行為（判斷「不同」，不是「較新」） |
| 按確定後被導去登入頁 | 登入早已失效但沒走失效處理；檢查第 4 節步驟 7 |
| 送出得到「系統已更新…」 | 正確行為；若是流程中的後續請求被擋，表示該流程沒登記 blocker |

## 9. 選配

- **長表單草稿保存**：用 `localStorage` 存未送出內容（key 帶頁面與使用者 id、版本前綴，例如 `draft:v1:<page>:<userId>`），超過一定天數丟棄，送出成功才清除；重整後讀到草稿就還原並提示。所有 storage 讀寫包 try/catch（私密視窗可能丟例外）。有草稿保存的表單可以不登記 blocker。
- **更新內容提示**：重整前把舊版 `buildTime` 寫進 `localStorage`，新頁面讀出後立刻清掉，只顯示發布時間晚於它的更新紀錄，只顯示一次。更新紀錄可由 commit trailer（例如 `Changelog: 修正｜<頁面>｜<文案>`）在 CI 收集成 JSON 放進 image；記得讓 `.dockerignore` 放行該檔。
