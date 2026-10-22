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
  returns: v.object({
    choice: v.string(),
    answer: v.string(),
    probabilities: v.record(v.string(), v.number()),
    confidence: v.union(v.number(), v.null()),
    model: v.string(),
    ms: v.number(),
    labels: v.record(v.string(), v.string()),
  }),
  handler: async (ctx, { question }) => {
    const trimmed = question.trim();
    if (question.length > 500)
      throw new Error("Questions must be 500 characters or fewer");
    if (!trimmed) throw new Error("Ask a question first");
    await ctx.runMutation(internal.abuse.reserveQuestion, {});
    const started = Date.now();
    try {
      // Raw call to the gateway's Decisions endpoint. The AI SDK's evaluate() rejects
      // replies where Jev's rounded probabilities don't put its own choice on top,
      // so we read the probabilities ourselves and show the most likely answer.
      const res = await fetch("https://ai-gateway.convex.dev/alpha/decisions", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
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
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error("Jev is unavailable. Please try again later.");
      }
      const body = await readGatewayResponse(res);
      const decision = body?.answers?.decision;
      if (
        !decision ||
        typeof decision.choice !== "string" ||
        !Object.hasOwn(ANSWERS, decision.choice)
      ) {
        throw new Error("Jev returned an invalid response.");
      }
      const probabilities: Record<string, number> = {};
      for (const key of Object.keys(ANSWERS)) {
        const value = decision.probabilities?.[key];
        if (
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 1
        ) {
          probabilities[key] = value;
        }
      }
      if (!Object.keys(probabilities).length)
        probabilities[decision.choice] = 1;
      const choice = Object.keys(probabilities).reduce(
        (best, key) =>
          probabilities[key] > (probabilities[best] ?? -1) ? key : best,
        decision.choice,
      ) as keyof typeof ANSWERS;
      const result = {
        choice,
        answer: ANSWERS[choice],
        probabilities,
        confidence:
          typeof decision.confidence === "number" &&
          Number.isFinite(decision.confidence) &&
          decision.confidence >= 0 &&
          decision.confidence <= 1
            ? decision.confidence
            : null,
        model:
          typeof body.model === "string"
            ? body.model.slice(0, 120)
            : "typesafe/jev-1.13",
        ms: Date.now() - started,
      };
      await ctx.runMutation(internal.jev.record, {
        question: trimmed,
        ...result,
      });
      return { ...result, labels: ANSWERS as Record<string, string> };
    } catch {
      // Provider bodies can contain request details; keep errors out of client responses/logs.
      const error = "Jev is unavailable. Please try again later.";
      await ctx.runMutation(internal.jev.record, {
        question: trimmed,
        ms: Date.now() - started,
        error,
      });
      throw new Error(error);
    }
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
  returns: v.null(),
  handler: async (ctx, row) => {
    await ctx.db.insert("questions", row);
    return null;
  },
});

async function readGatewayResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty gateway response");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 64 * 1024) throw new Error("Gateway response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
