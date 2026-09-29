import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { handle } from "../api/outthink.mjs";
import { fixture } from "./chat-fixture.mjs";

test("API persists activity discussion for the next turn without replaying raw history", async (t) => {
  for (const [key, value] of Object.entries({
    OPENAI_API_KEY: "test",
    SUPABASE_URL: "https://discussion.example.test",
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
  let s = fixture(),
    calls = 0;
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
      const input = JSON.parse(JSON.parse(opts.body).input);
      calls++;
      if (calls === 2) {
        assert.equal(input.recentMessages.length, 2);
        assert.equal(
          input.recentMessages[0].content,
          "Can we discuss browsing the bazaar before a hunt?",
        );
        assert.equal(input.recentMessages[1].content, "We can discuss this.");
        assert.equal(
          input.discussion.summary,
          "Browsing the bazaar before a hunt; proposed note: Good for restocking arrows before a hunt.",
        );
      }
      const output = {
        reply: "We can discuss this.",
        discussion_summary:
          "Browsing the bazaar before a hunt; proposed note: Good for restocking arrows before a hunt.",
        proposal_edits: [],
        sop_activity_ids: [],
        journal_intent: "none",
        actions: [],
        pending: null,
      };
      return Response.json({
        status: "completed",
        output: [
          { content: [{ type: "output_text", text: JSON.stringify(output) }] },
        ],
      });
    }
    assert.equal(u.hostname, "discussion.example.test");
    if (table === "ot_sessions")
      return Response.json([{ expires_at: "2099-01-01T00:00:00Z" }]);
    if (table === "ot_receipts") return Response.json([]);
    if (table === "ot_rate_limit") return Response.json(true);
    if (table === "ot_meta")
      return Response.json({
        revision: s.revision,
        settings: s.settings,
        clarification: s.clarification,
      });
    if (table === "ot_apply") {
      const { writes } = JSON.parse(opts.body);
      for (const [table, rows] of Object.entries(writes)) {
        if (table === "clarification") s.clarification = rows;
        else for (const row of rows) s[tables[table]].push(row);
      }
      s.revision++;
      return Response.json(true);
    }
    assert.ok(tables[table], "No journal table access");
    return Response.json(s[tables[table]]);
  });
  for (const message of [
    "Can we discuss browsing the bazaar before a hunt?",
    "What about that note?",
  ]) {
    const r = await handle(
      new Request("https://outthink.example.test/api/outthink", {
        method: "POST",
        headers: {
          origin: "https://outthink.example.test",
          "content-type": "application/json",
          cookie: `outthink_session=${"1".repeat(64)}`,
        },
        body: JSON.stringify({
          type: "chat",
          text: message,
          requestId: randomUUID(),
        }),
      }),
    );
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.aiError, false);
  }
  assert.equal(calls, 2);
  assert.equal(s.messages.filter((m) => m.discussion_context).length, 2);
  assert.equal(s.proposals.length, 0);
  assert.equal(s.logs.length, 0);
});
