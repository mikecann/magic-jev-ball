import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Every question asked, with Jev's answer, so we can see how much the ball gets used.
  questions: defineTable({
    question: v.string(),
    choice: v.optional(v.string()),
    answer: v.optional(v.string()),
    confidence: v.optional(v.union(v.number(), v.null())),
    probabilities: v.optional(v.record(v.string(), v.number())),
    model: v.optional(v.string()),
    ms: v.number(),
    error: v.optional(v.string()),
  }),
});
