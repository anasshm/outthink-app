// Provider contract: JSON-schema input and parsed JSON output. No DB access,
// activity rules, password logic, or model-specific conversation IDs leak out.
import { UserError } from "./validation.mjs";

const providers = {
  openai: async ({ instructions, input, schema, timeoutMs = 45000 }) => {
    if (!process.env.OPENAI_API_KEY)
      throw new UserError(
        "The AI connection is not configured. Your activities can still be logged manually.",
      );
    const model = process.env.AI_MODEL || "gpt-6-astra";
    const effort =
      process.env.AI_REASONING_EFFORT ||
      (model === "gpt-6-astra" ? "low" : undefined);
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          ...(effort ? { reasoning: { effort } } : {}),
          store: false,
          instructions,
          input,
          text: {
            format: {
              type: "json_schema",
              name: "outthink_response",
              strict: true,
              schema,
            },
          },
          max_output_tokens: 6000,
        }),
      });
    } catch (error) {
      throw new UserError(
        ["TimeoutError", "AbortError"].includes(error.name)
          ? "The AI took too long to reply. Please send your message again; manual logging still works."
          : "The AI connection could not be reached. Please try again; manual logging still works.",
      );
    }
    if (!response.ok) {
      // Read only the error code; never expose a provider body or raw message.
      const code = await response
        .json()
        .then((body) => body.error?.code)
        .catch(() => undefined);
      if (code === "credit_balance_exhausted" || code === "insufficient_quota")
        throw new UserError(
          "OpenAI API credits or quota are exhausted. Check API billing to continue; manual logging still works.",
        );
      throw new UserError(
        response.status === 429
          ? "The AI is at its usage limit. Try again shortly; manual logging still works."
          : `The AI connection returned ${response.status}. Please try again.`,
      );
    }
    const body = await response.json();
    if (body.status !== "completed")
      throw new UserError(
        "The AI response was incomplete. Please try a shorter message.",
      );
    const output = body.output
      ?.flatMap((m) => m.content || [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("");
    if (!output) throw new UserError("The AI could not answer that request.");
    try {
      return JSON.parse(output);
    } catch {
      throw new UserError(
        "The AI response could not be read. Nothing was changed.",
      );
    }
  },
};
export async function complete(args) {
  const provider = providers[process.env.AI_PROVIDER || "openai"];
  if (!provider) throw new UserError("This AI provider is not configured.");
  return provider(args);
}
