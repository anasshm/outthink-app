import { randomUUID } from "node:crypto";
import * as store from "../server/db.mjs";
import * as auth from "../server/auth.mjs";
import { UserError, assert, uuid, text } from "../server/validation.mjs";
import { planActions, decideProposal } from "../server/actions.mjs";
import { planChat } from "../server/chat.mjs";
import { fastLog } from "../server/fast-log.mjs";
import {
  interpret,
  reflect,
  reflectionRange,
  checkRange,
} from "../server/ai.mjs";
import {
  summary,
  suggestions,
  pendingActivities,
  activityContext,
} from "../shared/domain.mjs";
const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
};
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, ...extra },
  });
async function view(s) {
  const rollup = summary(s);
  return {
    ...s,
    ...rollup,
    suggestions: suggestions(s, rollup.day),
    pendingActivities: pendingActivities(s, rollup.day),
    aiConfigured: !!process.env.OPENAI_API_KEY,
  };
}
function messageRow(id, day, role, text, mode, now) {
  return { id, day, role, text, mode, created_at: now, suggestions: [] };
}
export async function handle(request) {
  try {
    if (!["GET", "POST"].includes(request.method))
      return json({ error: "Method not allowed." }, 405);
    if (request.method === "POST") {
      const origin = request.headers.get("origin");
      const allowed = [
        new URL(request.url).origin,
        process.env.APP_ORIGIN,
      ].filter(Boolean);
      if (!origin || !allowed.includes(origin))
        return json({ error: "Open OutThink directly to make changes." }, 403);
      if (!request.headers.get("content-type")?.includes("application/json"))
        return json({ error: "JSON required." }, 415);
    }
    const raw = request.method === "POST" ? await request.text() : "{}";
    if (Buffer.byteLength(raw) > 40000)
      return json({ error: "Please split this into shorter messages." }, 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    if (body.type === "login")
      return json({ ok: true }, 200, {
        "Set-Cookie": await auth.login(request, body.password),
      });
    if (!(await auth.authenticated(request)))
      return json({ error: "Unlock OutThink to continue.", locked: true }, 401);
    if (request.method === "GET") return json(await view(await store.state()));
    if (body.type === "logout")
      return json({ ok: true }, 200, {
        "Set-Cookie": await auth.logout(request),
      });
    if (body.type === "journal_history") {
      const s = await store.state(),
        day = summary(s).day;
      const range = checkRange(body.range, day);
      return json({
        entries: await store.rows("ot_journal", (q) =>
          q.gte("day", range.from).lte("day", range.to),
        ),
      });
    }
    assert(uuid(body.requestId), "A request ID is required.");
    const prior = await store.receipt(body.requestId);
    if (prior)
      return json({ ...prior, state: await view(await store.state()) });
    let s = await store.state(),
      result,
      prepared,
      mode = "routine";
    const now = new Date().toISOString(),
      today = summary(s).day;
    if (body.type === "chat" || body.type === "reflect") {
      if (
        !(await store.limit(
          `ai:${auth.hash(auth.sessionToken(request))}`,
          60,
          3600,
        ))
      )
        throw new UserError(
          "Please wait a little before sending more AI requests.",
          429,
        );
      const message = text(body.text, "a message", 20000, false);
      const range =
        body.type === "reflect"
          ? checkRange(body.range, today)
          : reflectionRange(message, today);
      mode = range ? "reflection" : "routine";
      try {
        if (range) {
          const journal = await store.rows("ot_journal", (q) =>
            q.gte("day", range.from).lte("day", range.to),
          );
          const completions = s.logs.filter(
            (l) => l.day >= range.from && l.day <= range.to,
          );
          const answer = await reflect(message, {
            range,
            journal,
            completions,
            activities: s.activities.map(activityContext),
          });
          prepared = {
            reply: answer.reply,
            actions: [],
            pending: s.clarification,
            notes: (answer.notes || [])
              .filter(
                (n) =>
                  s.activities.some((a) => a.id === n.activity_id) &&
                  typeof n.note === "string" &&
                  n.note.length <= 10000,
              )
              .slice(0, 3),
          };
        } else prepared = fastLog(message, s) || (await interpret(message, s));
        result =
          mode === "routine"
            ? planChat(s, prepared)
            : { writes: {}, reply: prepared.reply };
      } catch (error) {
        // Save the original check-in even if AI processing fails. No partial XP
        // writes, guessed actions, or fake success. Retrying the SAME request is safe.
        result = {
          writes: {},
          reply: `Your message is saved, but I couldn’t process it. ${error instanceof UserError ? error.message : "Please try again, or use Activities to log directly."}`,
          aiError: true,
        };
      }
      result.writes.ot_messages = [
        messageRow(body.requestId, today, "user", message, mode, now),
        messageRow(
          randomUUID(),
          today,
          "assistant",
          result.reply,
          mode,
          new Date(Date.now() + 1).toISOString(),
        ),
      ];
      if (mode === "reflection" && prepared?.notes)
        result.writes.ot_messages[1].suggestions = prepared.notes;
      if (mode === "routine" && prepared?.discussionContext && !result.aiError)
        result.writes.ot_messages[1].discussion_context = {
          ...prepared.discussionContext,
          user_message_id: body.requestId,
        };
      if (mode === "routine" && result.loggingContext)
        result.writes.ot_messages[1].logging_context = result.loggingContext;
    } else if (body.type === "command") {
      assert(
        body.revision === s.revision,
        "OutThink changed on another device. Refresh and try again.",
      );
      result = planActions(s, body.actions);
      result.reply = result.saved.join("\n");
    } else if (body.type === "proposal") {
      assert(typeof body.accept === "boolean", "Choose confirm or dismiss.");
      result = decideProposal(s, body.id, body.accept);
      result.reply = result.saved.join("\n");
    } else if (body.type === "retry_chat") {
      throw new UserError("Send the message again to retry AI processing.");
    } else throw new UserError("Unknown request.");
    const response = {
      reply: result.reply,
      aiError: !!result.aiError,
      pendingActivityIds: result.pendingActivityIds || [],
      handoff: !!result.handoff,
      sopReminders: result.sopReminders || [],
    };
    // Conflict is explicit rather than overwriting another device's work.
    try {
      await store.apply(s, body.requestId, result.writes, response);
    } catch (e) {
      if (e.code === "40001")
        throw new UserError(
          "OutThink changed on another device. Refresh and try again. Nothing from this request was saved.",
          409,
        );
      throw e;
    }
    return json({ ...response, state: await view(await store.state()) });
  } catch (error) {
    if (!(error instanceof UserError))
      console.error("OutThink request failed:", error.code || error.name); // no user text or secrets
    return json(
      {
        error:
          error instanceof UserError
            ? error.message
            : "OutThink couldn’t save this. Please try again.",
        ...(error.status === 401 ? { locked: true } : {}),
      },
      error.status || 500,
    );
  }
}
export default { fetch: handle };
