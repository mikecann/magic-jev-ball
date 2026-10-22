import { afterEach, expect, mock, test } from "bun:test";
import { TestDb, invoke } from "./support";
import {
  reserveQuestion,
  reserveLimits,
  DAY,
  dailyLimit,
} from "../convex/abuse";
import * as server from "convex/server";

mock.module("convex/server", () => ({
  ...server,
  getServiceToken: async () => "test-only-service-token",
}));
const { ask } = await import("../convex/jev");
const fetchBeforeTests = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchBeforeTests;
  delete process.env.JEV_GLOBAL_DAILY_LIMIT;
});

test("daily limits apply to all anonymous callers and reuse rows after rollover", async () => {
  process.env.JEV_GLOBAL_DAILY_LIMIT = "1";
  const db = new TestDb();
  await invoke(reserveQuestion, { db });
  await expect(invoke(reserveQuestion, { db })).rejects.toThrow("limit");
  await reserveLimits(
    { db } as any,
    [{ key: "rollover", windowMs: DAY, maximum: 1 }],
    0,
  );
  await reserveLimits(
    { db } as any,
    [{ key: "rollover", windowMs: DAY, maximum: 1 }],
    DAY,
  );
  expect(
    (await db.query("abuseLimits").collect()).filter(
      (r: any) => r.key === "rollover",
    ),
  ).toHaveLength(1);
  process.env.JEV_GLOBAL_DAILY_LIMIT = "-1";
  expect(dailyLimit("JEV_GLOBAL_DAILY_LIMIT", 100)).toBe(100);
});

test("empty, oversized and quota-denied questions never call the gateway", async () => {
  const fetchMock = mock(async () => {
    throw new Error("Unexpected network call");
  });
  globalThis.fetch = fetchMock as any;
  const runMutation = mock(async () => {
    throw new Error("Demo request limit reached");
  });
  for (const question of ["", "x".repeat(501), "Will this work?"]) {
    await expect(invoke(ask, { runMutation }, { question })).rejects.toThrow();
  }
  expect(runMutation).toHaveBeenCalledTimes(1);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("a normal anonymous question succeeds with bounded, allowlisted output", async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          model: "typesafe/jev-1.13",
          answers: {
            decision: {
              choice: "yes",
              confidence: 0.7,
              probabilities: {
                yes: 0.7,
                doubtful: 0.3,
                unknown: 1,
                certain: "invalid",
              },
            },
          },
        }),
      ),
  ) as any;
  const writes: any[] = [];
  const result = await invoke(
    ask,
    {
      runMutation: async (_ref: any, args: any) => {
        writes.push(args);
      },
    },
    { question: "Will this work?" },
  );
  expect(result.answer).toBe("Yes");
  expect(result.probabilities).toEqual({ yes: 0.7, doubtful: 0.3 });
  expect(Object.keys(result.labels)).toHaveLength(20);
  expect(writes).toHaveLength(2); // reservation first, then the real question record
});

test("gateway errors and oversized responses are sanitized before recording or returning", async () => {
  for (const response of [
    new Response("provider-detail", { status: 500 }),
    new Response("x".repeat(70_000)),
  ]) {
    globalThis.fetch = mock(async () => response) as any;
    const writes: any[] = [];
    await expect(
      invoke(
        ask,
        {
          runMutation: async (_ref: any, args: any) => {
            writes.push(args);
          },
        },
        { question: "Will this work?" },
      ),
    ).rejects.toThrow("unavailable");
    expect(writes[1].error).not.toContain("provider-detail");
    expect(writes[1].error.length).toBeLessThan(100);
  }
});
