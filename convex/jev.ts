import { getServiceToken } from "convex/server";
import { v } from "convex/values";
import { action } from "./_generated/server";

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
  handler: async (_ctx, { question }) => {
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
    if (!res.ok) throw new Error(`Jev request failed (${res.status}): ${JSON.stringify(body)}`);
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
    return {
      choice,
      answer: ANSWERS[choice],
      probabilities,
      confidence: decision.confidence ?? null,
      model: body.model as string,
      ms: Date.now() - started,
      labels: ANSWERS as Record<string, string>,
    };
  },
});
