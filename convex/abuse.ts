import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Convex supplies this global; this small frontend project has no Node type dependency.
declare const process: { env: Record<string, string | undefined> };

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export type Limit = { key: string; windowMs: number; maximum: number };

// Invalid configuration keeps the conservative default. Zero is an explicit stop.
export function dailyLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= 100_000 ? value : fallback;
}

/**
 * Call only inside a mutation, before scheduling or starting paid work.
 * Convex retries conflicting transactions, including concurrent inserts for a key.
 * Read every bucket before writing so a refusal never partially consumes quotas.
 * Keep one reusable row per scope, rather than adding a row for every request/day.
 */
export async function reserveLimits(
  ctx: Pick<MutationCtx, "db">,
  limits: Limit[],
  now = Date.now(),
): Promise<void> {
  const buckets = await Promise.all(
    limits.map(async (limit) => {
      const row = await ctx.db
        .query("abuseLimits")
        .withIndex("by_key", (q) => q.eq("key", limit.key))
        .unique();
      const windowStart = Math.floor(now / limit.windowMs) * limit.windowMs;
      const used = row?.windowStart === windowStart ? row.used : 0;
      if (used >= limit.maximum) {
        throw new Error("Demo request limit reached. Please try again later.");
      }
      return { row, key: limit.key, windowStart, used: used + 1 };
    }),
  );
  for (const { row, ...bucket } of buckets) {
    if (row) await ctx.db.patch(row._id, bucket);
    else await ctx.db.insert("abuseLimits", bucket);
  }
}

export const reserveQuestion = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await reserveLimits(ctx, [
      { key: "jev:global:minute", windowMs: MINUTE, maximum: 10 },
      {
        key: "jev:global:day",
        windowMs: DAY,
        maximum: dailyLimit("JEV_GLOBAL_DAILY_LIMIT", 100),
      },
    ]);
    return null;
  },
});
