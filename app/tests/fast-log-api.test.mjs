import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { handle } from "../api/outthink.mjs";
import { fixture } from "./chat-fixture.mjs";
import { personalDay } from "../shared/domain.mjs";
test("HTTP fast path makes zero model calls, persists pending/context, retries safely, and sends follow-ups to AI", async (t) => {
  for (const [key, value] of Object.entries({
    OPENAI_API_KEY: "test",
    SUPABASE_URL: "https://fast.example.test",
    SUPABASE_SERVICE_KEY: "test",
    AI_PROVIDER: "openai",
  })) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    });
  }
  const s = fixture();
  let calls = 0;
  const receipts = new Map();
  const tables = {
    ot_activities: "activities",
    ot_logs: "logs",
    ot_messages: "messages",
    ot_goals: "goals",
    ot_proposals: "proposals",
  };
  t.mock.method(globalThis, "fetch", async (url, opts = {}) => {
    const u = new URL(url),
      table = u.pathname.split("/").at(-1);
    if (u.hostname === "api.openai.com") {
      calls++;
      const input = JSON.parse(JSON.parse(opts.body).input);
      assert.equal(input.message, "another one");
      assert.equal(
        input.lastLoggingExchange.entries[0].name,
        "Enchanting Workshop",
      );
      assert.equal(input.lastLoggingExchange.entries[0].quantity, 2);
      assert.ok(
        input.recentMessages.some(
          (m) => m.content === "I worked in the workshop for 2 hours today",
        ),
      );
      return Response.json({
        status: "completed",
        output: [
          {
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  reply: "Ready",
                  pending: null,
                  journal_intent: "none",
                  sop_activity_ids: [],
                  discussion_summary:
                    "Another Enchanting Workshop session, pending.",
                  proposal_edits: [],
                  actions: [
                    {
                      type: "log_activity",
                      data: JSON.stringify({
                        activity_id: s.activities[2].id,
                        quantity: 2,
                        day: personalDay(new Date(), s.settings),
                        additional: true,
                      }),
                    },
                  ],
                }),
              },
            ],
          },
        ],
      });
    }
    assert.equal(u.hostname, "fast.example.test");
    if (table === "ot_sessions")
      return Response.json([{ expires_at: "2099-01-01T00:00:00Z" }]);
    if (table === "ot_receipts") {
      const id =
        u.searchParams.get("request_id")?.replace("eq.", "") ||
        u.searchParams.get("id")?.replace("eq.", "");
      return Response.json(
        receipts.has(id) ? [{ result: receipts.get(id) }] : [],
      );
    }
    if (table === "ot_rate_limit") return Response.json(true);
    if (table === "ot_meta")
      return Response.json({
        revision: s.revision,
        settings: s.settings,
        clarification: s.clarification,
      });
    if (table === "ot_apply") {
      const { writes, request_id, response } = JSON.parse(opts.body);
      for (const [name, rows] of Object.entries(writes)) {
        if (name === "clarification") {
          s.clarification = rows;
          continue;
        }
        for (const row of rows) {
          const index = s[tables[name]].findIndex((r) => r.id === row.id);
          if (index < 0) s[tables[name]].push(row);
          else s[tables[name]][index] = row;
        }
      }
      receipts.set(request_id, response);
      s.revision++;
      return Response.json(true);
    }
    assert.ok(tables[table], "No journal access");
    return Response.json(s[tables[table]]);
  });
  async function send(text, id = randomUUID()) {
    const r = await handle(
      new Request("https://outthink.example.test/api/outthink", {
        method: "POST",
        headers: {
          origin: "https://outthink.example.test",
          "content-type": "application/json",
          cookie: "outthink_session=" + "1".repeat(64),
        },
        body: JSON.stringify({ type: "chat", text, requestId: id }),
      }),
    );
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.aiError, false);
    return body;
  }
  const id = randomUUID(),
    message = "I worked in the workshop for 2 hours today";
  const first = await send(message, id);
  assert.equal(calls, 0);
  assert.equal(first.handoff, true);
  assert.equal(s.proposals.length, 1);
  assert.equal(s.logs.length, 0);
  assert.ok(s.messages[1].discussion_context.user_message_id);
  await send(message, id);
  assert.equal(s.messages.length, 2);
  assert.equal(s.proposals.length, 1);
  assert.equal(calls, 0);
  await send(message);
  assert.equal(s.proposals.length, 1);
  assert.equal(calls, 0);
  await send("another one");
  assert.equal(calls, 1);
  assert.equal(s.proposals.length, 2);
  assert.equal(s.logs.length, 0);
});
