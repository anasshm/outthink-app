import test from "node:test";
import assert from "node:assert/strict";
import { complete } from "../server/provider.mjs";

function environment(t) {
  for (const [name, value] of Object.entries({
    OPENAI_API_KEY: "test-only",
    AI_PROVIDER: "openai",
    AI_MODEL: "gpt-6-astra",
    AI_REASONING_EFFORT: "low",
  })) {
    const before = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (before === undefined) delete process.env[name];
      else process.env[name] = before;
    });
  }
}
const args = {
  instructions: "Test",
  input: "Test",
  schema: {
    type: "object",
    properties: { reply: { type: "string" } },
    required: ["reply"],
    additionalProperties: false,
  },
};

test("Astra adapter uses low reasoning and preserves strict JSON output and non-storage", async (t) => {
  environment(t);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    const body = JSON.parse(options.body);
    assert.equal(body.model, "gpt-6-astra");
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.equal(body.store, false);
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(body.text.format.schema, args.schema);
    return Response.json({
      status: "completed",
      output: [
        { type: "reasoning" },
        {
          type: "message",
          content: [{ type: "output_text", text: '{"reply":"Ready"}' }],
        },
      ],
    });
  });
  assert.deepEqual(await complete(args), { reply: "Ready" });
});

test("exhausted credits ask for billing instead of suggesting an unhelpful short retry", async (t) => {
  environment(t);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      {
        error: {
          code: "credit_balance_exhausted",
          message: "Private provider detail",
        },
      },
      { status: 429 },
    ),
  );
  await assert.rejects(complete(args), {
    message:
      "OpenAI API credits or quota are exhausted. Check API billing to continue; manual logging still works.",
  });
});

test("temporary rate limits remain distinct from exhausted billing", async (t) => {
  environment(t);
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 }),
  );
  await assert.rejects(complete(args), /Try again shortly/);
});
