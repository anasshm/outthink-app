import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost:5173",
});
for (const key of [
  "window",
  "document",
  "HTMLElement",
  "HTMLDialogElement",
  "HTMLInputElement",
  "MutationObserver",
  "Event",
  "MouseEvent",
  "getComputedStyle",
])
  Object.defineProperty(globalThis, key, {
    value: dom.window[key],
    configurable: true,
    writable: true,
  });
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
window.matchMedia = () =>
  ({ matches: true, addEventListener() {}, removeEventListener() {} }) as any;
let pageScrollRequests = 0;
window.HTMLElement.prototype.scrollIntoView = function () {
  pageScrollRequests++;
};
window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
const { register } = await import("node:module");
register("./css-loader.mjs", import.meta.url);
// The Node TSX loader uses the classic JSX runtime for this test entrypoint.
Object.defineProperty(globalThis, "React", {
  value: await import("react"),
  configurable: true,
});
const { render, screen, fireEvent, waitFor, cleanup, within } =
  await import("@testing-library/react");
test.afterEach(cleanup);
const { default: App } = await import("../src/App");
const { DEFAULT_SETTINGS, summary, suggestions, pendingActivities } =
  await import("../shared/domain.mjs");
const { planActions, decideProposal } = await import("../server/actions.mjs");
const { planChat } = await import("../server/chat.mjs");
const { journalFlow } = await import("../server/journaling.mjs");
let data: any,
  unlocked = false,
  lastBody: any;
let chatDelay: Promise<void> | null = null;
let nextChatError: number | null = null;
let chatActions: any[] | null = null;
let chatPrepared: any = null;
let needsAnswer = false;
let failNextConfirmation = false;
let writeDelay: Promise<void> | null = null;
let writeError: "network" | "lost-response" | number | null = null;
let writeRequests: any[] = [];
let receipts = new Set<string>();
function holdWrites() {
  let release!: () => void;
  writeDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    writeDelay = null;
    release();
  };
}
function savedResponse(body: any, reply: string, sopReminders: any[] = []) {
  receipts.add(body.requestId);
  if (writeError === "lost-response") {
    writeError = null;
    throw Error("Response lost after save.");
  }
  return Response.json({ state: hydrate(), reply, sopReminders });
}
function holdChat() {
  let release!: () => void;
  chatDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    chatDelay = null;
    release();
  };
}
const now = new Date();
function hydrate() {
  return {
    ...data,
    ...summary(data),
    suggestions: suggestions(data, summary(data).day),
    pendingActivities: pendingActivities(data, summary(data).day),
    aiConfigured: true,
  };
}
function reset() {
  data = {
    revision: 0,
    settings: structuredClone(DEFAULT_SETTINGS),
    activities: [],
    logs: [],
    goals: [],
    messages: [],
    proposals: [],
    journal: [],
    clarification: null,
  };
  unlocked = false;
  lastBody = null;
  chatDelay = null;
  nextChatError = null;
  chatActions = null;
  chatPrepared = null;
  needsAnswer = false;
  failNextConfirmation = false;
  writeDelay = null;
  writeError = null;
  writeRequests = [];
  receipts = new Set();
}
globalThis.fetch = async (_url, options: any) => {
  const body = options?.body ? JSON.parse(options.body) : null;
  lastBody = body;
  if (body?.type === "login") {
    unlocked = body.password === "test";
    return Response.json({ ok: unlocked }, { status: unlocked ? 200 : 401 });
  }
  if (!unlocked)
    return Response.json(
      { locked: true, error: "Unlock OutThink to continue." },
      { status: 401 },
    );
  if (!body) return Response.json(hydrate());
  if (body.type === "command" || body.type === "proposal") {
    writeRequests.push(body);
    if (writeDelay) await writeDelay;
    if (receipts.has(body.requestId))
      return Response.json({ state: hydrate(), reply: "Saved." });
    if (writeError && writeError !== "lost-response") {
      const failure = writeError;
      writeError = null;
      if (failure === "network") throw Error("Connection interrupted.");
      return Response.json(
        {
          error: "Save rejected.",
          ...(failure === 401 ? { locked: true } : {}),
        },
        { status: failure },
      );
    }
  }
  if (body.type === "command") {
    if (body.revision !== data.revision)
      return Response.json(
        { error: "OutThink changed on another device. Refresh and try again." },
        { status: 400 },
      );
    const plan = planActions(data, body.actions, { now });
    data = plan.working;
    data.revision++;
    return savedResponse(body, plan.saved.join(" "), plan.sopReminders || []);
  }
  if (body.type === "chat") {
    if (chatDelay) await chatDelay;
    if (nextChatError) {
      const status = nextChatError;
      nextChatError = null;
      return Response.json(
        { error: "Service temporarily unavailable." },
        { status },
      );
    }
    const plan = planChat(
      data,
      chatPrepared || {
        actions: chatActions || [
          {
            type: "log_activity",
            data: { activity_id: data.activities[0].id, quantity: 30 },
          },
        ],
        reply: needsAnswer ? "Which activity?" : "Ready to check off.",
        pending: needsAnswer ? { question: "Which activity?" } : null,
      },
      { now },
    );
    data.proposals.push(...(plan.writes.ot_proposals || []));
    data.clarification = plan.writes.clarification;
    data.messages.push(
      {
        id: body.requestId,
        role: "user",
        text: body.text,
        day: summary(data).day,
        mode: "routine",
        created_at: new Date().toISOString(),
      },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: plan.reply,
        logging_context: plan.loggingContext,
        day: summary(data).day,
        mode: "routine",
        created_at: new Date(Date.now() + 1).toISOString(),
      },
    );
    data.revision++;
    return Response.json({
      state: hydrate(),
      reply: plan.reply,
      pendingActivityIds: plan.pendingActivityIds,
      handoff: plan.handoff,
    });
  }
  if (body.type === "proposal") {
    if (failNextConfirmation) {
      failNextConfirmation = false;
      throw Error("Connection interrupted.");
    }
    const plan = decideProposal(data, body.id, body.accept, { now });
    for (const [table, rows] of Object.entries(plan.writes)) {
      const key = (
        {
          ot_logs: "logs",
          ot_proposals: "proposals",
          ot_journal: "journal",
        } as any
      )[table];
      if (key)
        for (const row of rows as any[]) {
          const i = data[key].findIndex((r: any) => r.id === row.id);
          if (i < 0) data[key].push(row);
          else data[key][i] = row;
        }
    }
    data.revision++;
    return savedResponse(body, plan.saved.join(" "), plan.sopReminders || []);
  }
  throw Error("Unexpected request");
};
async function login() {
  fireEvent.change(await screen.findByLabelText("Password"), {
    target: { value: "test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Unlock OutThink" }));
  await screen.findByRole("button", { name: "Open chat" });
}
test("journal draft keeps chat open and only agreement reveals Confirm with the reviewed wording", async () => {
  reset();
  const entry = {
    text: "I like to check the guild board first thing each day.",
    scores: { mood: 8 },
    period: "moment",
    day: summary(data).day,
  };
  chatPrepared = journalFlow(
    { reply: "", actions: [{ type: "journal", data: entry }], pending: null },
    "draft",
    data,
    now,
  );
  render(<App />);
  await login();
  fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
  fireEvent.change(screen.getByLabelText("Message"), {
    target: {
      value:
        "Rephrase my guild board habit for my journal, mood is 8/10",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText(/Would you like me to add this to your journal/);
  assert.ok(screen.getByRole("dialog", { name: "OutThink" }));
  assert.equal(screen.queryByRole("button", { name: "Confirm" }), null);
  assert.equal(data.journal.length, 0);
  assert.equal(data.proposals.length, 0);

  chatPrepared = journalFlow(
    { reply: "", actions: [], pending: null },
    "approve",
    data,
    now,
  );
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Add it" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  const confirm = await screen.findByRole("button", { name: "Confirm" });
  const card = confirm.closest(".ot-proposal")!;
  assert.ok(within(card as HTMLElement).getByText(entry.text));
  assert.ok(!card.textContent?.includes("Rephrase my guild board"));
  assert.equal(data.journal.length, 0);
  fireEvent.click(confirm);
  await waitFor(() => assert.equal(data.journal.length, 1));
  assert.equal(data.journal[0].text, entry.text);
  assert.deepEqual(data.journal[0].scores, entry.scores);
  await waitFor(() =>
    assert.equal(screen.queryByRole("button", { name: "Confirm" }), null),
  );
});
test("full-page chat preserves drafts, confirms logs into the dashboard, and restores focus and scrolling", async () => {
  reset();
  render(<App />);
  await login();
  fireEvent.click(screen.getByRole("button", { name: "Add an activity" }));
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Rune Meditation" },
  });
  fireEvent.change(screen.getByLabelText("Measure in"), {
    target: { value: "minute" },
  });
  fireEvent.change(screen.getByLabelText("XP per minute"), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByLabelText("Mental"), {
    target: { value: "10" },
  });
  fireEvent.change(
    screen.getByLabelText("Default amount when you don’t specify"),
    { target: { value: "10" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save activity" }));
  await waitFor(() => assert.equal(data.activities.length, 1));
  assert.equal(data.activities[0].unit_size, 10);
  assert.equal(data.activities[0].xp.mental, 10);
  await waitFor(() =>
    assert.equal(screen.queryByRole("button", { name: "Save activity" }), null),
  );
  const fab = screen.getByRole("button", { name: "Open chat" });
  fab.focus();
  fireEvent.click(fab);
  assert.equal(
    screen.getByRole("dialog", { name: "OutThink" }).getAttribute("aria-modal"),
    "true",
  );
  assert.ok(screen.getByRole("button", { name: /Mental: today 0 percent/ }));
  assert.equal(document.body.style.overflow, "hidden");
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Meditated over the runes for 30 minutes" },
  });
  fireEvent.keyDown(screen.getByLabelText("Message"), { key: "Escape" });
  assert.equal(
    screen.queryByRole("dialog", { name: "OutThink" }) === null,
    true,
  );
  assert.equal(document.activeElement, fab);
  assert.notEqual(document.body.style.overflow, "hidden");
  fireEvent.click(fab);
  assert.equal(
    (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    "Meditated over the runes for 30 minutes",
  );
  const scrollsBeforeSending = pageScrollRequests;
  const release = holdChat();
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  assert.equal(
    (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    "",
  );
  assert.ok(screen.getByText("Meditated over the runes for 30 minutes", { exact: true }));
  assert.ok(screen.getByRole("status", { name: "OutThink is thinking" }));
  assert.equal(
    data.messages.length,
    0,
    "message is visible before the server responds",
  );
  assert.equal(data.proposals.length, 0);
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Then report the wolf tracks to the guild" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Back to dashboard" }));
  fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
  assert.ok(screen.getByRole("status", { name: "OutThink is thinking" }));
  release();
  await screen.findByRole("button", { name: /1 activity ready to check off/ });
  assert.equal(
    screen.getAllByText("Meditated over the runes for 30 minutes", { exact: true }).length,
    1,
  );
  assert.equal(
    screen.queryByRole("status", { name: "OutThink is thinking" }),
    null,
  );
  assert.equal(
    (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    "Then report the wolf tracks to the guild",
    "reply must not erase the next draft",
  );
  assert.equal(data.logs.length, 0);
  assert.equal(data.proposals.length, 1);
  assert.equal(
    pageScrollRequests,
    scrollsBeforeSending,
    "chat updates must not scroll the dashboard",
  );
  fireEvent.click(
    screen.getByRole("button", { name: /1 activity ready to check off/ }),
  );
  const scrollsAfterHandoff = pageScrollRequests;
  fireEvent.click(
    screen.getAllByRole("checkbox", { name: "Rune Meditation · 30 minutes" })[0],
  );
  await waitFor(() => assert.equal(data.logs.length, 1));
  assert.equal(data.logs[0].xp.mental, 30);
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("checkbox", {
        name: "Rune Meditation · 30 minutes",
      }) === null,
      true,
    ),
  );
  assert.equal(
    screen.queryByRole("dialog", { name: "OutThink" }) === null,
    true,
  );
  assert.ok(screen.getByRole("button", { name: /Mental: today 30 percent/ }));
  assert.equal(
    pageScrollRequests,
    scrollsAfterHandoff,
    "checking a card must not scroll the dashboard",
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Mental: today 30 percent/ }),
  );
  fireEvent.click(
    screen.getAllByRole("checkbox", {
      name: "Undo Rune Meditation · 30 minutes",
    })[0],
  );
  await waitFor(() => assert.equal(data.logs[0].done, false));
  assert.equal(
    screen.queryByRole("checkbox", { name: /Rune Meditation · 30 minutes/ }),
    null,
  );
  assert.ok(screen.getByText("Nothing recorded here yet."));
  fireEvent.click(screen.getByRole("button", { name: "Last 7 days" }));
  assert.ok(screen.getByText("Nothing recorded here yet."));
  fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
  assert.ok(screen.getByText("Nothing recorded here yet."));
  assert.ok(lastBody.requestId, "requests carry an idempotency key");
  cleanup();
});

test("failed messages stay visible and retry the same request without clearing a new draft", async () => {
  reset();
  data = planActions(
    data,
    [
      {
        type: "create_activity",
        data: {
          name: "Rune Meditation",
          unit: "minute",
          unit_size: 10,
          default_quantity: 10,
          xp: { mental: 10 },
        },
      },
    ],
    { now },
  ).working;
  render(<App />);
  await login();
  fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Meditated over the runes for 30 minutes" },
  });
  nextChatError = 503;
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  const requestId = lastBody.requestId;
  await screen.findByRole("button", { name: "Retry message" });
  assert.ok(screen.getByText("Meditated over the runes for 30 minutes", { exact: true }));
  assert.equal(
    screen.queryByRole("status", { name: "OutThink is thinking" }),
    null,
  );
  assert.equal(data.messages.length, 0);
  const release = holdChat();
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Keep this draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
  assert.equal(lastBody.requestId, requestId);
  assert.ok(screen.getByRole("status", { name: "OutThink is thinking" }));
  release();
  await screen.findByRole("button", { name: /1 activity ready to check off/ });
  assert.equal(screen.queryByRole("button", { name: "Retry message" }), null);
  assert.equal(
    screen.getAllByText("Meditated over the runes for 30 minutes", { exact: true }).length,
    1,
  );
  assert.equal(data.messages.filter((m: any) => m.role === "user").length, 1);
  assert.equal(
    data.logs.length,
    0,
    "retry still requires confirmation before awarding XP",
  );
  assert.equal(
    (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    "Keep this draft",
  );
  cleanup();
});

function seedActivities() {
  data = planActions(
    data,
    [
      {
        type: "create_activity",
        data: {
          name: "Patrol Run",
          unit: "completion",
          default_quantity: 1,
          xp: { physical: 100, mental: 50, social: 25 },
        },
      },
      {
        type: "create_activity",
        data: {
          name: "Guild Contracts",
          unit: "hour",
          default_quantity: 1,
          tracks_work: true,
          xp: { work: 30 },
        },
      },
      {
        type: "create_activity",
        data: {
          name: "Study Spellbooks",
          unit: "minute",
          unit_size: 10,
          default_quantity: 10,
          xp: { mental: 10 },
        },
      },
    ],
    { now },
  ).working;
  chatActions = data.activities.map((a: any) => ({
    type: "log_activity",
    data: {
      activity_id: a.id,
      quantity: a.name === "Guild Contracts" ? 3 : a.default_quantity,
    },
  }));
}
test("chat hands off to persistent individual cards; checks, failed saves, dismiss and undo preserve totals", async () => {
  reset();
  seedActivities();
  render(<App />);
  await login();
  fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Patrolled, worked on contracts for 3 hours and studied spellbooks" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByRole("region", { name: "Pending today" });
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("dialog", { name: "OutThink" }) === null,
      true,
    ),
  );
  assert.equal(data.logs.length, 0);
  assert.equal(data.proposals.length, 3);
  assert.equal(document.activeElement?.textContent, "Pending today");
  assert.equal(screen.queryByRole("button", { name: "Confirm" }), null);
  cleanup();
  render(<App />);
  await screen.findByRole("region", { name: "Pending today" });
  assert.equal(
    within(screen.getByRole("region", { name: "Pending today" })).getAllByRole(
      "checkbox",
      { name: "Patrol Run" },
    ).length,
    1,
    "one entry per pending completion",
  );
  failNextConfirmation = true;
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Patrol Run" })[0]);
  const failedId = lastBody.requestId;
  await screen.findByRole("button", { name: "Retry save" });
  assert.equal(data.logs.length, 0);
  assert.equal(
    (screen.getAllByRole("checkbox", { name: "Patrol Run" })[0] as HTMLInputElement)
      .checked,
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => assert.equal(data.logs.length, 1));
  assert.equal(lastBody.requestId, failedId);
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("checkbox", { name: "Patrol Run" }) === null,
      true,
    ),
  );
  assert.ok(
    screen.getByRole("button", { name: /Physical: today 100 percent/ }),
  );
  fireEvent.click(
    screen.getAllByRole("checkbox", { name: "Guild Contracts · 3 hours" })[0],
  );
  await waitFor(() => assert.equal(data.logs.length, 2));
  assert.equal(data.logs[1].xp.work, 90);
  fireEvent.click(
    screen.getByRole("button", { name: "Dismiss Study Spellbooks · 10 minutes" }),
  );
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("button", { name: "Dismiss Study Spellbooks · 10 minutes" }) ===
        null,
      true,
    ),
  );
  assert.equal(data.logs.length, 2);
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("region", { name: "Pending today" }) === null,
      true,
    ),
  );
  cleanup();
  render(<App />);
  await screen.findByRole("button", { name: /Physical: today 100 percent/ });
  assert.equal(
    screen.queryByRole("region", { name: "Pending today" }),
    null,
    "saved cards must not return after refresh",
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Physical: today 100 percent/ }),
  );
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Undo Patrol Run" })[0]);
  await waitFor(() => assert.equal(data.logs[0].done, false));
  assert.equal(
    within(
      screen.getByRole("dialog", { name: "Physical activity" }),
    ).queryByRole("checkbox", { name: /Patrol Run/ }),
    null,
  );
  assert.ok(screen.getByText("Nothing recorded here yet."));
  assert.equal(data.logs.length, 2, "undo preserves the underlying records");
  cleanup();
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Physical: today 0 percent/ }),
  );
  assert.ok(screen.getByText("Nothing recorded here yet."));
  cleanup();
});

test("clarifications keep chat open and earlier dates are visibly separated", async () => {
  reset();
  seedActivities();
  needsAnswer = true;
  chatActions = [
    {
      type: "log_activity",
      data: { activity_id: data.activities[0].id, day: "2026-09-01" },
    },
  ];
  render(<App />);
  await login();
  fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Patrolled on September 1 and did that other thing" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByRole("button", { name: /1 activity ready to check off/ });
  assert.ok(screen.getByRole("dialog", { name: "OutThink" }));
  assert.ok(screen.getByRole("region", { name: "Pending earlier" }));
  assert.equal(screen.queryByRole("region", { name: "Pending today" }), null);
  assert.ok(screen.getByText("Sep 1, 2026"));
  assert.equal(data.logs.length, 0);
  cleanup();
});

test("repeating a report hands back to existing cards; an additional entry is independently checkable", async () => {
  reset();
  seedActivities();
  chatActions = [
    {
      type: "log_activity",
      data: { activity_id: data.activities[0].id, quantity: 1 },
    },
  ];
  render(<App />);
  await login();
  async function send(message: string) {
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: message },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      assert.equal(
        screen.queryByRole("dialog", { name: "OutThink" }) === null,
        true,
      ),
    );
    assert.equal(document.activeElement?.textContent, "Pending today");
  }
  await send("I patrolled today");
  const firstId = data.proposals[0].id;
  await send("Do it");
  assert.equal(data.proposals.length, 1);
  assert.equal(data.proposals[0].id, firstId);
  assert.equal(
    within(screen.getByRole("region", { name: "Pending today" })).getAllByRole(
      "checkbox",
      { name: "Patrol Run" },
    ).length,
    1,
  );
  assert.equal(data.logs.length, 0);
  chatActions[0].data.additional = true;
  await send("Add another one");
  assert.equal(data.proposals.length, 2);
  const cards = within(
    screen.getByRole("region", { name: "Pending today" }),
  ).getAllByRole("checkbox", { name: "Patrol Run" });
  assert.equal(cards.length, 2);
  fireEvent.click(cards[1]);
  await waitFor(() => assert.equal(data.logs.length, 1));
  await waitFor(() =>
    assert.equal(
      within(
        screen.getByRole("region", { name: "Pending today" }),
      ).getAllByRole("checkbox", { name: "Patrol Run" }).length,
      1,
    ),
  );
  fireEvent.click(
    within(screen.getByRole("region", { name: "Pending today" })).getAllByRole(
      "checkbox",
      { name: "Patrol Run" },
    )[0],
  );
  await waitFor(() => assert.equal(data.logs.length, 2));
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("region", { name: "Pending today" }) === null,
      true,
    ),
  );
  assert.ok(
    screen.getByRole("button", { name: /Physical: today 200 percent/ }),
  );
});

test("Guild Contracts pending cards and instant ring feedback share the daily first-hour bonus", async () => {
  reset();
  seedActivities();
  const contracts = data.activities.find(
    (a: any) => a.name === "Guild Contracts",
  );
  contracts.xp.work = 20;
  contracts.daily_bonus = { minutes: 60, perHour: { work: 20 } };
  chatActions = [2, 1].map((quantity) => ({
    type: "log_activity",
    data: { activity_id: contracts.id, quantity },
  }));
  render(<App />);
  await login();
  fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Worked on contracts for two hours, then another hour" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  const pending = await screen.findByRole("region", { name: "Pending today" });
  const twoHours = within(pending).getByRole("checkbox", {
    name: "Guild Contracts · 2 hours",
  });
  const release = holdWrites();
  fireEvent.click(twoHours);
  assert.ok(screen.getByRole("button", { name: /Work: today 60 percent/ }));
  assert.equal(data.logs.length, 0);
  const other = within(pending).getByRole("checkbox", {
    name: "Guild Contracts · 1 hour",
  });
  assert.ok(other.closest(".pp-task")?.textContent?.includes("20"));
  release();
  await waitFor(() => assert.equal(data.logs.length, 1));
  await waitFor(() =>
    assert.equal((other as HTMLInputElement).disabled, false),
  );
  assert.equal(data.logs[0].xp.work, 60);
  const releaseNext = holdWrites();
  fireEvent.click(other);
  assert.ok(screen.getByRole("button", { name: /Work: today 80 percent/ }));
  assert.equal(data.logs.length, 1);
  releaseNext();
  await waitFor(() => assert.equal(data.logs.length, 2));
  assert.equal(summary(data).totals.work.today, 80);
});

test("checkboxes and all affected rings update before the server, with rapid taps serialized", async () => {
  reset();
  seedActivities();
  // Completing a row removes it from the server's six suggestions when the
  // catalogue is larger, but its card and explanation must still finish exiting.
  data = planActions(
    data,
    Array.from({ length: 7 }, (_, i) => ({
      type: "create_activity",
      data: {
        name: `Side Errand ${i}`,
        unit: "completion",
        default_quantity: 1,
        xp: { physical: 5 },
      },
    })),
    { now },
  ).working;
  render(<App />);
  await login();
  const why = document.querySelector(".pp-priorities .pp-why")?.textContent;
  const release = holdWrites();
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Patrol Run" })[0]);
  const run = screen.getAllByRole("checkbox", {
    name: "Patrol Run",
  })[0] as HTMLInputElement;
  assert.equal(run.checked, true);
  assert.ok(run.closest(".pp-task")?.classList.contains("is-optimistic"));
  assert.ok(run.closest(".pp-priorities"));
  assert.ok(run.closest(".ot-completion-row.is-leaving"));
  assert.equal(
    document.querySelector(".pp-priorities .pp-why")?.textContent,
    why,
  );
  assert.ok(
    screen.getByRole("button", { name: /Physical: today 100 percent/ }),
  );
  assert.ok(screen.getByRole("button", { name: /Mental: today 50 percent/ }));
  assert.ok(screen.getByRole("button", { name: /Social: today 25 percent/ }));
  assert.equal(data.logs.length, 0, "the server has not replied");
  const study = screen.getAllByRole("checkbox", {
    name: "Study Spellbooks · 10 minutes",
  })[0] as HTMLInputElement;
  assert.equal(study.disabled, false, "other cards remain checkable");
  fireEvent.click(study);
  assert.ok(screen.getByRole("button", { name: /Mental: today 60 percent/ }));
  assert.equal(writeRequests.length, 1, "only one request in flight");
  release();
  await waitFor(() => assert.equal(data.logs.length, 2));
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("checkbox", { name: "Patrol Run" }) === null,
      true,
    ),
  );
  assert.equal(writeRequests[1].revision, writeRequests[0].revision + 1);
  assert.ok(screen.getByRole("button", { name: /Mental: today 60 percent/ }));
  fireEvent.click(
    screen.getByRole("button", { name: /Physical: today 100 percent/ }),
  );
  const releaseUndo = holdWrites();
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Undo Patrol Run" })[0]);
  assert.equal(
    within(
      screen.getByRole("dialog", { name: "Physical activity" }),
    ).queryByRole("checkbox", { name: /Patrol Run/ }),
    null,
  );
  assert.ok(screen.getByText("Nothing recorded here yet."));
  assert.equal(data.logs[0].done, true, "undo is also optimistic");
  releaseUndo();
  await waitFor(() => assert.equal(data.logs[0].done, false));
});

test("a delayed failed pending check reappears, rolls back rings, and retries its original ID", async () => {
  reset();
  seedActivities();
  const plan = planChat(
    data,
    { actions: chatActions, reply: "Ready", pending: null },
    { now },
  );
  data.proposals.push(...plan.writes.ot_proposals);
  render(<App />);
  await login();
  const release = holdWrites();
  writeError = 500;
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Patrol Run" })[0]);
  assert.ok(
    screen.getByRole("button", { name: /Physical: today 100 percent/ }),
  );
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("checkbox", { name: "Patrol Run" }) === null,
      true,
    ),
  );
  assert.equal(data.logs.length, 0);
  release();
  await screen.findByRole("button", { name: "Retry save" });
  await waitFor(() =>
    assert.equal(
      (screen.getAllByRole("checkbox", { name: "Patrol Run" })[0] as HTMLInputElement)
        .disabled,
      false,
    ),
  );
  assert.equal(
    (screen.getAllByRole("checkbox", { name: "Patrol Run" })[0] as HTMLInputElement)
      .checked,
    false,
  );
  assert.ok(screen.getByRole("button", { name: /Physical: today 0 percent/ }));
  const failedId = writeRequests[0].requestId;
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => assert.equal(data.logs.length, 1));
  assert.equal(writeRequests[1].requestId, failedId);
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("checkbox", { name: "Patrol Run" }) === null,
      true,
    ),
  );
  assert.ok(
    screen.getByRole("button", { name: /Physical: today 100 percent/ }),
  );
});

test("a lost response reconciles its committed XP and Retry save cannot duplicate it", async () => {
  reset();
  seedActivities();
  render(<App />);
  await login();
  writeError = "lost-response";
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Patrol Run" })[0]);
  await screen.findByRole("button", { name: "Retry save" });
  await waitFor(() =>
    assert.equal(
      (screen.getByRole("button", { name: "Retry save" }) as HTMLButtonElement)
        .disabled,
      false,
    ),
  );
  assert.equal(data.logs.length, 1);
  assert.ok(
    screen.getByRole("button", { name: /Physical: today 100 percent/ }),
  );
  const requestId = writeRequests[0].requestId;
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("button", { name: "Retry save" }) === null,
      true,
    ),
  );
  assert.equal(writeRequests[1].requestId, requestId);
  assert.equal(data.logs.length, 1);
  assert.ok(
    screen.getByRole("button", { name: /Physical: today 100 percent/ }),
  );
});

test("a conflicting save rolls back only its preview and preserves another device's work", async () => {
  reset();
  seedActivities();
  render(<App />);
  await login();
  const release = holdWrites();
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Patrol Run" })[0]);
  data = planActions(
    data,
    [
      {
        type: "log_activity",
        data: { activity_id: data.activities[1].id, quantity: 2 },
      },
    ],
    { now },
  ).working;
  data.revision++;
  release();
  await screen.findByText(/changed on another device/);
  await waitFor(() =>
    assert.ok(screen.getByRole("button", { name: /Work: today 60 percent/ })),
  );
  assert.ok(screen.getByRole("button", { name: /Physical: today 0 percent/ }));
  assert.equal(
    (screen.getAllByRole("checkbox", { name: "Patrol Run" })[0] as HTMLInputElement)
      .checked,
    false,
  );
  assert.equal(data.logs.length, 1);
});

test("queued projections preserve penalties and older dates; acknowledgements and stale refreshes never add a second reward", async () => {
  reset();
  seedActivities();
  const { CompletionQueue } = await import("../src/lib/completions");
  data = planActions(
    data,
    [
      {
        type: "log_activity",
        data: { activity_id: data.activities[1].id, quantity: 4 },
      },
    ],
    { now },
  ).working;
  const initial = hydrate();
  const requests: { body: any; resolve: (result: any) => void }[] = [];
  let rewards = 0;
  const q = new CompletionQueue({
    request: async (body) =>
      new Promise((resolve) => requests.push({ body, resolve })),
    changed() {},
    busy() {},
    reward() {
      rewards++;
    },
    rollback() {},
    error(error) {
      throw error;
    },
    saved() {},
  });
  q.replace(initial);
  q.enqueue("contracts", {
    type: "command",
    actions: [
      {
        type: "log_activity",
        data: {
          activity_id: data.activities[1].id,
          quantity: 1,
          day: initial.day,
        },
      },
    ],
  });
  assert.equal(q.view!.totals.work.today, 150);
  assert.equal(q.view!.totals.mental.today, -10);
  assert.equal(q.view!.totals.social.today, -10);
  const yesterday = new Date(`${initial.day}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  q.enqueue("patrol", {
    type: "command",
    actions: [
      {
        type: "log_activity",
        data: {
          activity_id: data.activities[0].id,
          day: yesterday.toISOString().slice(0, 10),
        },
      },
    ],
  });
  assert.equal(q.view!.totals.physical.today, 0);
  assert.equal(q.view!.totals.physical.seven, 100);
  assert.equal(q.view!.totals.mental.seven, 40);
  assert.equal(requests.length, 1);
  data = planActions(data, requests[0].body.actions, { now }).working;
  data.revision++;
  q.replace(hydrate()); // GET sees the committed write before its POST returns.
  assert.equal(
    q.view!.totals.work.today,
    150,
    "don't double count a committed write still awaiting its response",
  );
  requests[0].resolve({ state: hydrate() });
  await waitFor(() => assert.equal(requests.length, 2));
  assert.equal(
    q.view!.totals.physical.seven,
    100,
    "first response preserves the next queued preview",
  );
  assert.equal(requests[1].body.revision, data.revision);
  data = planActions(data, requests[1].body.actions, { now }).working;
  data.revision++;
  requests[1].resolve({ state: hydrate() });
  await waitFor(() => assert.equal(q.active, false));
  q.replace(initial);
  assert.equal(
    q.view!.totals.physical.seven,
    100,
    "late stale GET cannot erase saves",
  );
  assert.equal(q.view!.totals.work.today, 150);
  assert.equal(
    rewards,
    2,
    "one reward callback per tap, never again on acknowledgement",
  );
});

test("retrying a failed checkbox after another queued save keeps its ID and uses the current revision", async () => {
  reset();
  seedActivities();
  render(<App />);
  await login();
  const release = holdWrites();
  writeError = 500;
  fireEvent.click(screen.getAllByRole("checkbox", { name: "Patrol Run" })[0]);
  fireEvent.click(
    screen.getAllByRole("checkbox", { name: "Study Spellbooks · 10 minutes" })[0],
  );
  release();
  await waitFor(() => assert.equal(data.logs.length, 1));
  await waitFor(() =>
    assert.equal(
      (screen.getByRole("button", { name: "Retry save" }) as HTMLButtonElement)
        .disabled,
      false,
    ),
  );
  assert.ok(screen.getByRole("button", { name: /Mental: today 10 percent/ }));
  assert.ok(screen.getByRole("button", { name: /Physical: today 0 percent/ }));
  const failedId = writeRequests[0].requestId;
  const revision = data.revision;
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => assert.equal(data.logs.length, 2));
  assert.equal(writeRequests[2].requestId, failedId);
  assert.equal(writeRequests[2].revision, revision);
  await waitFor(() =>
    assert.equal(
      screen.queryByRole("button", { name: "Retry save" }) === null,
      true,
    ),
  );
  assert.ok(screen.getByRole("button", { name: /Mental: today 60 percent/ }));
});

test("All activities is last, includes the full active catalogue, and restores a failed check", async () => {
  reset();
  seedActivities();
  data = planActions(
    data,
    Array.from({ length: 9 }, (_, i) => ({
      type: "create_activity",
      data: {
        name: `Forest Walk ${i}`,
        unit: "completion",
        default_quantity: 1,
        xp: { physical: 5 },
      },
    })),
    { now },
  ).working;
  data.activities[3].archived = true;
  const monthly = data.activities.at(-1);
  monthly.name = "Monthly Gear Check";
  monthly.preferred_frequency = { kind: "interval", days: 30 };
  const yesterday = new Date(`${summary(data).day}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  data = planActions(
    data,
    [
      {
        type: "log_activity",
        data: {
          activity_id: monthly.id,
          day: yesterday.toISOString().slice(0, 10),
        },
      },
    ],
    { now },
  ).working;
  assert.equal(
    suggestions(data, summary(data).day).some((a: any) => a.id === monthly.id),
    false,
  );
  render(<App />);
  await login();
  const all = screen.getByRole("region", { name: "All activities" });
  assert.equal(
    all,
    document.querySelector(".pp-main-content")?.lastElementChild,
  );
  assert.equal(within(all).getAllByRole("checkbox").length, 11);
  assert.equal(within(all).queryByRole("checkbox", { name: "Forest Walk 0" }), null);
  const names = within(all)
    .getAllByRole("checkbox")
    .map((el) => el.getAttribute("aria-label")!);
  assert.deepEqual(
    names,
    [...names].sort((a, b) => a.localeCompare(b)),
  );
  const release = holdWrites();
  writeError = 500;
  fireEvent.click(within(all).getByRole("checkbox", { name: "Monthly Gear Check" }));
  const checked = within(all).getByRole("checkbox", {
    name: "Monthly Gear Check",
  }) as HTMLInputElement;
  assert.equal(checked.checked, true);
  assert.ok(checked.closest(".is-leaving"));
  assert.ok(screen.getByRole("button", { name: /Physical: today 5 percent/ }));
  await waitFor(() =>
    assert.equal(
      within(all).queryByRole("checkbox", { name: "Monthly Gear Check" }) === null,
      true,
    ),
  );
  release();
  await screen.findByRole("button", { name: "Retry save" });
  const restored = (await within(all).findByRole("checkbox", {
    name: "Monthly Gear Check",
  })) as HTMLInputElement;
  assert.equal(restored.checked, false);
  assert.ok(screen.getByRole("button", { name: /Physical: today 0 percent/ }));
  fireEvent.click(screen.getByRole("button", { name: "Retry save" }));
  await waitFor(() => assert.equal(data.logs.length, 2));
  await waitFor(() =>
    assert.equal(
      within(all).queryByRole("checkbox", { name: "Monthly Gear Check" }) === null,
      true,
    ),
  );
  assert.equal(writeRequests[0].requestId, writeRequests[1].requestId);
  cleanup();
  render(<App />);
  const reloaded = await screen.findByRole("region", {
    name: "All activities",
  });
  assert.equal(
    within(reloaded).queryByRole("checkbox", { name: "Monthly Gear Check" }),
    null,
  );
});

test("All activities confirms the matching Pending entry and synchronizes duplicate cards", async () => {
  reset();
  seedActivities();
  const contracts = data.activities[1];
  const plan = planChat(
    data,
    {
      actions: [
        { type: "log_activity", data: { activity_id: contracts.id, quantity: 3 } },
      ],
      reply: "Ready",
      pending: null,
    },
    { now },
  );
  data.proposals.push(...plan.writes.ot_proposals);
  render(<App />);
  await login();
  const all = within(screen.getByRole("region", { name: "All activities" }));
  const release = holdWrites();
  fireEvent.click(all.getByRole("checkbox", { name: "Guild Contracts · 3 hours" }));
  const copies = screen.getAllByRole("checkbox", { name: "Guild Contracts · 3 hours" });
  assert.equal(copies.length, 2);
  assert.ok(copies.every((el) => (el as HTMLInputElement).checked));
  assert.equal(writeRequests.length, 1);
  assert.equal(writeRequests[0].type, "proposal");
  assert.equal(writeRequests[0].id, data.proposals[0].id);
  assert.ok(screen.getByRole("button", { name: /Work: today 90 percent/ }));
  release();
  await waitFor(() => assert.equal(data.logs.length, 1));
  assert.equal(data.logs[0].quantity, 3);
  await waitFor(() =>
    assert.equal(
      screen.queryAllByRole("checkbox", { name: "Guild Contracts · 3 hours" }).length,
      0,
    ),
  );
  fireEvent.click(all.getByRole("checkbox", { name: "Patrol Run" }));
  const runs = screen.getAllByRole("checkbox", { name: "Patrol Run" });
  assert.equal(runs.length, 2);
  assert.ok(runs.every((el) => (el as HTMLInputElement).checked));
  await waitFor(() => assert.equal(data.logs.length, 2));
  await waitFor(() =>
    assert.equal(screen.queryAllByRole("checkbox", { name: "Patrol Run" }).length, 0),
  );
});

test("a saved completion offers the SOP reminder with a working read-only view", async () => {
  reset();
  data = planActions(
    data,
    [
      {
        type: "create_activity",
        data: {
          name: "Guild Contracts",
          unit: "hour",
          unit_size: 1,
          default_quantity: 1,
          xp: { work: 20 },
          tracks_work: true,
          sop: "Check the guild board for new postings.\nSign each contract with the guild seal.",
        },
      },
    ],
    { now },
  ).working;
  render(<App />);
  await login();
  fireEvent.click(
    screen.getAllByRole("checkbox", { name: "Guild Contracts · 1 hour" })[0],
  );
  await screen.findByText("Reminder: review your Guild Contracts SOP.");
  assert.ok(data.logs[0].sop_reminded_at);
  fireEvent.click(screen.getByRole("button", { name: "View SOP" }));
  const dialog = screen.getByRole("dialog", { name: "Guild Contracts · SOP" });
  assert.ok(within(dialog).getByText(/Check the guild board/));
  assert.equal(
    data.activities[0].sop,
    "Check the guild board for new postings.\nSign each contract with the guild seal.",
  );
});

test("negative activity previews in red, preserves earned XP, and undo restores all pillars", async () => {
  reset();
  data = planActions(
    data,
    [
      {
        type: "create_activity",
        data: {
          name: "Crystal Ball Doomscroll",
          description: "Time lost staring into the crystal ball. One completion = one session.",
          xp: { mental: -10, physical: -10, work: -10, social: -10 },
          unit: "completion",
          unit_size: 1,
          default_quantity: 1,
          preferred_frequency: null,
          daily_bonus: null,
          must_do: false,
          tracks_work: false,
        },
      },
    ],
    { now },
  ).working;
  data.logs.push({
    id: crypto.randomUUID(),
    label: "Earlier activities",
    day: summary(data).day,
    done: true,
    xp: { mental: 600, physical: 600, work: 600, social: 600 },
  });
  chatActions = [
    {
      type: "log_activity",
      data: { activity_id: data.activities[0].id, quantity: 10 },
    },
  ];
  render(<App />);
  await login();
  fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "I did 10 crystal ball doomscroll sessions" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  const pending = await screen.findByRole("region", { name: "Pending today" });
  const box = within(pending).getByRole("checkbox", {
    name: "Crystal Ball Doomscroll · 10 times",
  });
  assert.doesNotMatch(box.closest("label")!.textContent!, /\+-/);
  const release = holdWrites();
  fireEvent.click(box);
  assert.equal(data.logs.length, 1);
  assert.equal(document.querySelectorAll(".pp-pillar .pp-cost-arc").length, 8);
  assert.equal(screen.queryByText("500 net"), null);
  assert.equal(screen.queryByText("7 days · 600 earned"), null);
  release();
  await waitFor(() => assert.equal(data.logs.length, 2));
  fireEvent.click(
    screen.getByRole("button", { name: /Mental: today 500 percent/ }),
  );
  const breakdown = screen.getByLabelText("XP breakdown");
  assert.match(breakdown.textContent!, /600.*earned.*−100.*deducted.*500.*net/);
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Undo Crystal Ball Doomscroll · 10 times" }),
  );
  await waitFor(() => assert.equal(summary(data).totals.mental.today, 600));
  assert.equal(document.querySelectorAll(".pp-pillar .pp-cost-arc").length, 0);
});

test("cost ring segments remain bounded with negative and overflowing totals", async () => {
  const { ringSegments } = await import("../src/ui/progress-utils");
  assert.deepEqual(ringSegments(50, 10), { net: 50, deducted: 10 });
  assert.deepEqual(ringSegments(-20, 30), { net: 0, deducted: 30 });
  const over = ringSegments(150, 50);
  assert.deepEqual(over, { net: 75, deducted: 25 });
});
