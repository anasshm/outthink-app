// Activity discussion context. Only eligible activity exchanges are replayed.
import { text } from "./validation.mjs";

export function discussionContext(state, now = new Date()) {
  const last = (state.messages || [])
    .filter((m) => m.role === "assistant")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (
    last?.mode !== "routine" ||
    !last.discussion_context?.summary ||
    now.getTime() - Date.parse(last.created_at) > 24 * 60 * 60 * 1000
  )
    return null;
  return {
    summary: text(last.discussion_context.summary, "discussion context", 6000),
  };
}

export function discussionMemory(
  summary,
  { journalIntent, pending, actions, requestedSops, resetDiscussion },
) {
  if (resetDiscussion === true) return { reset: true };
  // Sensitive modes end the active discussion rather than leaking into the next topic.
  if (
    journalIntent !== "none" ||
    pending?.intent === "journal" ||
    actions.some((a) => a.type === "journal" || "sop" in a.data) ||
    requestedSops.length ||
    !summary?.trim()
  )
    return null;
  return { summary: text(summary, "discussion summary", 6000) };
}

export function catalogueReviews(state) {
  return (state.proposals || [])
    .filter((p) => p.status === "pending")
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(-15)
    .flatMap((p) => {
      const actions = p.actions.flatMap((a, index) => {
        if (!["create_activity", "update_activity"].includes(a.type)) return [];
        const { sop: _sop, ...data } = a.data;
        return [{ index, type: a.type, data, has_sop_change: "sop" in a.data }];
      });
      return actions.length
        ? [{ proposal_id: p.id, status: p.status, actions }]
        : [];
    });
}

// Keep the user's wording paired with the actual reply, not reconstructed from
// a summary. Existing discussion metadata marks eligible activity exchanges;
// unmarked legacy messages and private journal/reflection/SOP exchanges stay out.
export function recentMessages(state) {
  const messages = [...(state.messages || [])].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  const exchanges = [];
  for (let index = 0; index < messages.length; index++) {
    const reply = messages[index];
    if (reply.role !== "assistant") continue;
    if (reply.discussion_context?.reset) {
      exchanges.length = 0;
      continue;
    }
    if (reply.mode !== "routine" || !reply.discussion_context?.summary)
      continue;
    const user = reply.discussion_context.user_message_id
      ? messages.find((m) => m.id === reply.discussion_context.user_message_id)
      : messages[index - 1];
    if (
      user?.role !== "user" ||
      user.mode !== "routine" ||
      typeof user.text !== "string" ||
      typeof reply.text !== "string"
    )
      continue;
    exchanges.push([
      { role: "user", content: user.text },
      { role: "assistant", content: reply.text },
    ]);
  }
  return exchanges.slice(-10).flat();
}
