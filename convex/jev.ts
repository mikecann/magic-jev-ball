import { getServiceToken } from "convex/server";
import { v } from "convex/values";
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

// The 20 classic Magic 8 Ball answers. Jev picks one and scores all of them.
const ANSWERS = {
  certain: "It is certain",
  decidedly: "It is decidedly so",
  without_doubt: "Without a doubt",
  yes_definitely: "Yes, definitely",
  rely: "You may rely on it",
  as_i_see: "As I see it, yes",
  most_likely: "Most likely",
  outlook_good: "Outlook good",
  yes: "Yes",
  signs: "Signs point to yes",
  hazy: "Reply hazy, try again",
  ask_later: "Ask again later",
  better_not: "Better not tell you now",
  cannot_predict: "Cannot predict now",
  concentrate: "Concentrate and ask again",
  dont_count: "Don't count on it",
  reply_no: "My reply is no",
  sources_no: "My sources say no",
  outlook_not: "Outlook not so good",
  doubtful: "Very doubtful",
};

export const ask = action({
  args: { question: v.string() },
  handler: async (ctx, { question }) => {
    const trimmed = question.trim().slice(0, 500);
    if (!trimmed) throw new Error("Ask a question first");
    const started = Date.now();
    // Raw call to the gateway's Decisions endpoint. The AI SDK's evaluate() rejects
    // replies where Jev's rounded probabilities don't put its own choice on top,
    // so we read the probabilities ourselves and show the most likely answer.
    const res = await fetch("https://ai-gateway.convex.dev/alpha/decisions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getServiceToken("ai-gateway")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "typesafe/jev-1.13",
        state: { question: trimmed },
        questions: {
          decision: {
            type: "choice",
            instructions:
              "You are an opinionated Magic 8 Ball. Always take a side: make your best judgment and pick a yes answer or a no answer, choosing a stronger one the more sure you are. Only pick a non-committal answer if the question is nonsense or not a question.",
            criteria: ANSWERS,
          },
        },
      }),
    });
    const body = await res.json();
    if (!res.ok) {
      const error = `Jev request failed (${res.status}): ${JSON.stringify(body)}`;
      await ctx.runMutation(internal.jev.record, { question: trimmed, ms: Date.now() - started, error });
      throw new Error(error);
    }
    const decision = body.answers.decision as {
      choice: keyof typeof ANSWERS;
      confidence?: number;
      probabilities?: Record<string, number>;
    };
    const probabilities = decision.probabilities ?? { [decision.choice]: 1 };
    const choice = Object.entries(probabilities).reduce(
      (best, [key, p]) => (p > (probabilities[best] ?? -1) ? key : best),
      decision.choice as string,
    ) as keyof typeof ANSWERS;
    const result = {
      choice,
      answer: ANSWERS[choice],
      probabilities,
      confidence: decision.confidence ?? null,
      model: body.model as string,
      ms: Date.now() - started,
    };
    await ctx.runMutation(internal.jev.record, { question: trimmed, ...result });
    return { ...result, labels: ANSWERS as Record<string, string> };
  },
});

export const record = internalMutation({
  args: {
    question: v.string(),
    choice: v.optional(v.string()),
    answer: v.optional(v.string()),
    confidence: v.optional(v.union(v.number(), v.null())),
    probabilities: v.optional(v.record(v.string(), v.number())),
    model: v.optional(v.string()),
    ms: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, row) => {
    await ctx.db.insert("questions", row);
  },
});
