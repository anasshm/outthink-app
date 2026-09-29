// Real Supabase integration, isolated test records, exact-ID cleanup.
// Run with: node --env-file=.env.local tests/integration.mjs (password on stdin).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { handle } from "../api/outthink.mjs";
import { db, checked } from "../server/db.mjs";
import { personalDay } from "../shared/domain.mjs";
const base = "http://localhost:5173/api/outthink";
const password = readFileSync(0, "utf8").trim();
const prefix = `TEST ${randomUUID().slice(0, 8)}`;
const touched = {
  ot_activities: new Set(),
  ot_logs: new Set(),
  ot_journal: new Set(),
  ot_messages: new Set(),
  ot_goals: new Set(),
  ot_proposals: new Set(),
  ot_receipts: new Set(),
};
let cookie = "",
  sessionHash = "";
const originalFetch = globalThis.fetch;
let fakePlan = null;
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://api.openai.com/v1/responses" && fakePlan) {
    const req = JSON.parse(options.body);
    assert.equal(req.store, false);
    const context = JSON.parse(req.input);
    assert.ok(!("journal" in context.context));
    return Response.json({
      status: "completed",
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(fakePlan) }] },
      ],
    });
  }
  return originalFetch(url, options);
};
async function call(
  body,
  { authenticated = true, origin = "http://localhost:5173" } = {},
) {
  const request = new Request(base, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "Content-Type": "application/json", origin } : {}),
      ...(authenticated && cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const r = await handle(request),
    data = await r.json();
  if (body?.requestId) touched.ot_receipts.add(body.requestId);
  if (data.state) {
    for (const a of data.state.activities)
      if (a.name.startsWith(prefix)) touched.ot_activities.add(a.id);
    for (const l of data.state.logs)
      if (touched.ot_activities.has(l.activity_id)) touched.ot_logs.add(l.id);
    for (const m of data.state.messages)
      if (m.text.includes(prefix) || m.id === body?.requestId)
        touched.ot_messages.add(m.id);
    for (const p of data.state.proposals)
      if (
        p.actions.some(
          (a) =>
            a.data.name?.startsWith(prefix) ||
            a.data.text?.includes(prefix) ||
            touched.ot_activities.has(a.data.activity_id) ||
            touched.ot_activities.has(a.data.id),
        )
      )
        touched.ot_proposals.add(p.id);
  }
  return { r, data };
}
try {
  assert.equal((await call(null, { authenticated: false })).r.status, 401);
  assert.equal(
    (
      await call(
        { type: "login", password },
        { origin: "https://evil.example" },
      )
    ).r.status,
    403,
  );
  const signed = await call({ type: "login", password });
  assert.equal(signed.r.status, 200);
  cookie = signed.r.headers.get("set-cookie").split(";")[0];
  assert.ok(signed.r.headers.get("set-cookie").includes("HttpOnly"));
  assert.ok(signed.r.headers.get("set-cookie").includes("SameSite=Strict"));
  const { hash } = await import("../server/auth.mjs");
  sessionHash = hash(cookie.split("=")[1]);
  let s = (await call()).data;
  const start = s;
  let id = randomUUID();
  let r = await call({
    type: "command",
    requestId: id,
    revision: s.revision,
    actions: [
      {
        type: "create_activity",
        data: {
          name: `${prefix} Guild Contracts`,
          unit: "hour",
          default_quantity: 1,
          tracks_work: true,
          xp: { work: 10 },
        },
      },
    ],
  });
  assert.equal(r.r.status, 200, JSON.stringify(r.data));
  s = r.data.state;
  const a = s.activities.find((a) => a.name === `${prefix} Guild Contracts`);
  assert.ok(a);
  const duplicate = await call({
    type: "command",
    requestId: id,
    revision: 0,
    actions: [{ type: "create_activity", data: {} }],
  });
  assert.equal(duplicate.r.status, 200);
  assert.equal(
    duplicate.data.state.activities.filter((x) => x.id === a.id).length,
    1,
  );
  r = await call({
    type: "command",
    requestId: randomUUID(),
    revision: start.revision,
    actions: [],
  });
  assert.equal(r.r.status, 400);
  fakePlan = {
    reply: `${prefix} Prepared the contract log.`,
    pending: null,
    actions: [
      {
        type: "log_activity",
        data: JSON.stringify({ activity_id: a.id, quantity: 5 }),
      },
    ],
  };
  r = await call({
    type: "chat",
    requestId: randomUUID(),
    text: `${prefix} Worked on contracts for 5 hours.`,
  });
  assert.equal(r.r.status, 200);
  assert.equal(r.data.aiError, false, JSON.stringify(r.data));
  s = r.data.state;
  assert.equal(
    s.logs.filter((l) => l.activity_id === a.id).length,
    0,
    "AI must not log without confirmation",
  );
  let proposal = s.proposals.find((p) =>
    p.actions.some((x) => x.data.activity_id === a.id),
  );
  assert.ok(proposal);
  r = await call({
    type: "proposal",
    requestId: randomUUID(),
    id: proposal.id,
    accept: true,
  });
  assert.equal(r.r.status, 200, JSON.stringify(r.data));
  s = r.data.state;
  assert.equal(s.logs.filter((l) => l.activity_id === a.id).length, 1);
  const l = s.logs.find((l) => l.activity_id === a.id);
  assert.equal(l.xp.work, 50);
  assert.ok(s.penalties.find((p) => p.day === personalDay()).xp.mental <= -10);
  assert.equal(
    (
      await call({
        type: "proposal",
        requestId: randomUUID(),
        id: proposal.id,
        accept: true,
      })
    ).r.status,
    400,
  );
  r = await call({
    type: "command",
    requestId: randomUUID(),
    revision: s.revision,
    actions: [{ type: "set_log_status", data: { id: l.id, done: false } }],
  });
  assert.equal(r.r.status, 200);
  s = r.data.state;
  assert.equal(s.logs.find((x) => x.id === l.id).done, false);
  fakePlan = {
    reply: `${prefix} Journal ready.`,
    pending: null,
    actions: [
      {
        type: "journal",
        data: JSON.stringify({
          text: "generated text should be discarded",
          scores: { day: 7 },
          period: "day",
        }),
      },
    ],
  };
  r = await call({
    type: "chat",
    requestId: randomUUID(),
    text: `${prefix} Good day on the wall. 7/10.`,
  });
  assert.equal(r.r.status, 200);
  s = r.data.state;
  proposal = s.proposals.find(
    (p) =>
      p.status === "pending" &&
      p.actions.some(
        (a) => a.type === "journal" && a.data.text.includes(prefix),
      ),
  );
  assert.ok(proposal);
  assert.equal(
    checked(
      await db().from("ot_journal").select("id").like("text", `${prefix}%`),
    ).length,
    0,
  );
  r = await call({
    type: "proposal",
    requestId: randomUUID(),
    id: proposal.id,
    accept: false,
  });
  assert.equal(r.r.status, 200);
  const out = await call({ type: "logout" });
  assert.equal(out.r.status, 200);
  assert.equal((await call()).r.status, 401);
  console.log(
    "PASS: password session, CSRF rejection, private state, actual DB persistence, idempotency, stale revision rejection, AI log confirmation, daily penalty, undo, original journal text, journal cancellation, logout.",
  );
} finally {
  globalThis.fetch = originalFetch;
  // Only UUIDs created by this script; never clear the owner's tables.
  for (const table of [
    "ot_proposals",
    "ot_logs",
    "ot_journal",
    "ot_messages",
    "ot_goals",
    "ot_activities",
    "ot_receipts",
  ]) {
    if (touched[table].size)
      checked(
        await db()
          .from(table)
          .delete()
          .in("id", [...touched[table]]),
      );
  }
  if (sessionHash)
    checked(
      await db().from("ot_sessions").delete().eq("token_hash", sessionHash),
    );
  console.log("Isolated integration records removed; owner data retained.");
}
