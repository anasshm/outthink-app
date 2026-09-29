import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { handle } from "../api/outthink.mjs";
import { fixture } from "./chat-fixture.mjs";

test("chat API saves failed messages and surfaces safe billing, rate and connection errors without data changes", async (t) => {
  for (const [name, value] of Object.entries({
    OPENAI_API_KEY: "test-only",
    SUPABASE_URL: "https://database.example.test",
    SUPABASE_SERVICE_KEY: "test-only",
    AI_PROVIDER: "openai",
  })) {
    const before = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (before === undefined) delete process.env[name];
      else process.env[name] = before;
    });
  }
  const s = fixture();
  let writes, failure;
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === "api.openai.com") return failure();
    assert.equal(parsed.hostname, "database.example.test");
    const table = parsed.pathname.split("/").at(-1);
    if (table === "ot_sessions")
      return Response.json([{ expires_at: "2099-01-01T00:00:00Z" }]);
    if (table === "ot_receipts") return Response.json([]);
    if (table === "ot_meta")
      return Response.json({
        revision: 0,
        settings: s.settings,
        clarification: null,
      });
    if (table === "ot_rate_limit") return Response.json(true);
    if (table === "ot_apply") {
      writes = JSON.parse(options.body).writes;
      return Response.json(true);
    }
    assert.ok(
      [
        "ot_activities",
        "ot_logs",
        "ot_messages",
        "ot_goals",
        "ot_proposals",
      ].includes(table),
    );
    return Response.json(table === "ot_activities" ? s.activities : []);
  });
  for (const [produce, expected] of [
    [
      () =>
        Response.json(
          { error: { code: "insufficient_quota", message: "PRIVATE_DETAIL" } },
          { status: 429 },
        ),
      /billing/,
    ],
    [
      () =>
        Response.json(
          { error: { code: "rate_limit_exceeded", message: "PRIVATE_DETAIL" } },
          { status: 429 },
        ),
      /Try again shortly/,
    ],
    [
      () => {
        throw new DOMException("PRIVATE_DETAIL", "TimeoutError");
      },
      /too long/,
    ],
    [
      () => {
        throw new TypeError("PRIVATE_DETAIL");
      },
      /could not be reached/,
    ],
  ]) {
    failure = produce;
    writes = undefined;
    const response = await handle(
      new Request("https://outthink.example.test/api/outthink", {
        method: "POST",
        headers: {
          origin: "https://outthink.example.test",
          "content-type": "application/json",
          cookie: `outthink_session=${"1".repeat(64)}`,
        },
        body: JSON.stringify({
          type: "chat",
          text: "What should I pack for the ridge hunt?",
          requestId: randomUUID(),
        }),
      }),
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.aiError, true);
    assert.match(result.reply, expected);
    assert.ok(!JSON.stringify(result).includes("PRIVATE_DETAIL"));
    assert.deepEqual(Object.keys(writes), ["ot_messages"]);
    assert.equal(writes.ot_messages[0].text, "What should I pack for the ridge hunt?");
  }
});
