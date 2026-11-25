import { describe, expect, it } from "vitest";
import {
  initialVersionCheckState,
  isRefreshBlocked,
  nextVersionCheckState,
  parseVersionResponse,
  registerRefreshBlocker,
  shouldBlockWrite,
} from "@/lib/version-check";

describe("nextVersionCheckState", () => {
  const current = "aaa";

  it("版本相同時歸零", () => {
    expect(nextVersionCheckState({ candidate: "bbb", confirmed: null }, current, "aaa")).toEqual(
      initialVersionCheckState,
    );
  });

  it("第一次看到不同版本只記為 candidate", () => {
    expect(nextVersionCheckState(initialVersionCheckState, current, "bbb")).toEqual({
      candidate: "bbb",
      confirmed: null,
    });
  });

  it("第二次仍是同一個版本才 confirmed", () => {
    const first = nextVersionCheckState(initialVersionCheckState, current, "bbb");
    expect(nextVersionCheckState(first, current, "bbb")).toEqual({ candidate: null, confirmed: "bbb" });
  });

  it("確認途中又換成另一個版本就重新計算", () => {
    const first = nextVersionCheckState(initialVersionCheckState, current, "bbb");
    expect(nextVersionCheckState(first, current, "ccc")).toEqual({ candidate: "ccc", confirmed: null });
  });

  it("請求失敗（null）不改變狀態", () => {
    const first = nextVersionCheckState(initialVersionCheckState, current, "bbb");
    expect(nextVersionCheckState(first, current, null)).toBe(first);
  });

  it("confirmed 之後不再收回", () => {
    const confirmed = { candidate: null, confirmed: "bbb" };
    expect(nextVersionCheckState(confirmed, current, "aaa")).toBe(confirmed);
  });
});

describe("parseVersionResponse", () => {
  it.each([
    [{ version: "abc" }, "abc"],
    [{ version: " abc " }, "abc"],
    [{ version: "unknown" }, null],
    [{ version: "" }, null],
    [{ version: 1 }, null],
    [{}, null],
    [null, null],
    ["abc", null],
  ])("%j → %j", (body, expected) => {
    expect(parseVersionResponse(body)).toBe(expected);
  });
});

describe("refresh blocker", () => {
  it("登記後成立、解除後不成立", () => {
    const unregister = registerRefreshBlocker(() => true);
    expect(isRefreshBlocked()).toBe(true);
    unregister();
    expect(isRefreshBlocked()).toBe(false);
  });
});

describe("shouldBlockWrite", () => {
  const origin = "https://app.example.com";
  const check = (method: string, path: string, over: Partial<{ stale: boolean; busy: boolean }> = {}) =>
    shouldBlockWrite({
      method,
      url: new URL(path, origin),
      origin,
      stale: true,
      busy: false,
      ...over,
    });

  it("擋同站 /api 寫入", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(check(method, "/api/orders")).toBe(true);
    }
  });

  it("放行 GET／HEAD", () => {
    expect(check("GET", "/api/orders")).toBe(false);
    expect(check("HEAD", "/api/orders")).toBe(false);
  });

  it("放行非 /api 路徑與版本端點", () => {
    expect(check("POST", "/orders")).toBe(false);
    expect(check("POST", "/apiary")).toBe(false);
    expect(check("POST", "/api/version")).toBe(false);
  });

  it("放行跨站請求", () => {
    expect(check("POST", "https://other.example.com/api/orders")).toBe(false);
  });

  it("尚未確認新版、或有流程在跑時放行", () => {
    expect(check("POST", "/api/orders", { stale: false })).toBe(false);
    expect(check("POST", "/api/orders", { busy: true })).toBe(false);
  });
});
