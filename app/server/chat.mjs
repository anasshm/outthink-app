import { assert } from "./validation.mjs";
import { planActions, sameReviewBase } from "./actions.mjs";
import { isPendingLog, personalDay, validDay } from "../shared/domain.mjs";

// A logging turn can be resumed without replaying raw chat or diary contents.
// Read only the latest assistant turn: a different topic or reflection ends
// the implicit "it/another one" reference instead of reviving a stale request.
export function loggingContext(state) {
  const last = (state.messages || [])
    .filter((m) => m.role === "assistant")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (last?.mode !== "routine") return null;
  const entries = last.logging_context?.entries;
  if (!Array.isArray(entries)) return null;
  const safe = entries.slice(0, 30).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const activity = state.activities.find((a) => a.id === entry.activity_id);
    if (
      !activity ||
      activity.archived ||
      !validDay(entry.day) ||
      !Number.isFinite(entry.quantity) ||
      entry.quantity <= 0 ||
      entry.quantity > 10000
    )
      return [];
    const proposal = (state.proposals || []).find(
      (p) => p.id === entry.proposal_id,
    );
    const log = state.logs.find(
      (l) =>
        l.id === (entry.log_id || proposal?.actions?.[0]?.pending_log?.log_id),
    );
    return [
      {
        activity_id: activity.id,
        name: activity.name,
        quantity: entry.quantity,
        unit: activity.unit,
        day: entry.day,
        status: log
          ? log.done
            ? "recorded"
            : "undone"
          : proposal?.status === "pending"
            ? "pending"
            : proposal?.status === "dismissed"
              ? "dismissed"
              : "unavailable",
      },
    ];
  });
  if (!safe.length) return null;
  return {
    entries: safe,
    ...(last.logging_context.follow_up === "offer_additional" &&
    safe.every((entry) => entry.status === "recorded")
      ? { follow_up: "offer_additional" }
      : {}),
  };
}

function revisedCatalogueActions(state, edits) {
  const revisions = new Map();
  for (const edit of edits || []) {
    const proposal = state.proposals.find((p) => p.id === edit.proposal_id);
    assert(
      proposal?.status === "pending",
      "That review was already handled. Use the current activity instead.",
    );
    assert(Number.isInteger(edit.action_index), "Choose an activity edit.");
    const action = proposal.actions[edit.action_index];
    assert(
      action && ["create_activity", "update_activity"].includes(action.type),
      "Only pending activity definitions can be revised here.",
    );
    const changes = edit.changes;
    const fields = [
      "name",
      "description",
      "note",
      "sop",
      "xp",
      "daily_bonus",
      "unit",
      "unit_size",
      "default_quantity",
      "preferred_frequency",
      "must_do",
      "tracks_work",
    ];
    assert(
      changes &&
        typeof changes === "object" &&
        !Array.isArray(changes) &&
        Object.keys(changes).every((k) => fields.includes(k)),
      "Use only activity fields in a revision.",
    );
    if (action.type === "update_activity")
      assert(
        sameReviewBase(
          state.activities.find((a) => a.id === action.data.id),
          action.base,
        ),
        "This activity changed since the review. Request a fresh edit.",
      );
    if (!revisions.has(proposal.id))
      revisions.set(proposal.id, {
        proposal,
        actions: structuredClone(proposal.actions),
      });
    const target = revisions.get(proposal.id).actions[edit.action_index];
    target.data = {
      ...target.data,
      ...changes,
      ...(changes.xp ? { xp: { ...target.data.xp, ...changes.xp } } : {}),
    };
  }
  return [...revisions.values()];
}

// Reuse unchecked cards only; completed entries never block a new report.
// Explicit additional sessions bypass reuse; retries still use HTTP receipts.
export function planChat(state, prepared, { now = new Date() } = {}) {
  const revisions = revisedCatalogueActions(state, prepared.proposalEdits);
  const today = personalDay(now, state.settings);
  const actions = [],
    entries = [],
    reused = [];
  for (const action of [
    ...revisions.flatMap((r) => r.actions),
    ...prepared.actions,
  ]) {
    const activity =
      action.type === "log_activity"
        ? state.activities.find(
            (a) =>
              !a.archived &&
              (a.id === action.data.activity_id ||
                (!action.data.activity_id &&
                  a.name.toLowerCase() ===
                    action.data.activity_name?.toLowerCase())),
          )
        : null;
    if (!activity) {
      actions.push(action);
      continue;
    }
    const entry = {
      activity_id: activity.id,
      quantity: action.data.quantity ?? activity.default_quantity,
      day: action.data.day ?? today,
    };
    const same = (data) =>
      data.activity_id === entry.activity_id &&
      (data.quantity ?? activity.default_quantity) === entry.quantity &&
      data.day === entry.day;
    const pending =
      action.data.additional === true
        ? null
        : (state.proposals || []).find(
            (p) =>
              p.status === "pending" &&
              isPendingLog(p) &&
              same(p.actions[0].data) &&
              sameReviewBase(p.actions[0].base?.activity, activity),
          );
    if (pending) {
      reused.push(pending.id);
      entries.push({ ...entry, proposal_id: pending.id });
    } else {
      actions.push({ ...action, data: entry });
      entries.push({ ...entry, new_card: true });
    }
  }
  const result = planActions(state, actions, { ai: true, now });
  const proposals = result.writes.ot_proposals || [];
  if (revisions.length)
    result.writes.ot_proposals = [
      ...revisions.map((r) => ({ ...r.proposal, status: "dismissed" })),
      ...proposals,
    ];
  const cards = proposals.filter(isPendingLog);
  const otherChanges = proposals.filter((p) => !isPendingLog(p));
  // Cards have the same order as the remaining log actions. Keep the exact
  // references, including duplicate quantities from genuinely separate sessions.
  let cardIndex = 0;
  for (const entry of entries) {
    if (entry.new_card) {
      const card = cards[cardIndex++];
      if (card) entry.proposal_id = card.id;
      delete entry.new_card;
    }
  }
  result.loggingContext = entries.length ? { entries } : null;
  result.pendingActivityIds = [
    ...new Set([...reused, ...cards.map((p) => p.id)]),
  ];
  result.handoff =
    result.pendingActivityIds.length > 0 &&
    !prepared.pending &&
    !otherChanges.length;
  result.reply = prepared.reply;
  if (result.handoff) {
    const count = result.pendingActivityIds.length;
    result.reply = `${count === 1 ? "Your activity is" : `Your ${count} activities are`} ready to check off on your dashboard.`;
  }
  if (otherChanges.length)
    result.reply += "\n\nReview and confirm the proposed changes below.";
  result.writes.clarification = prepared.pending;
  return result;
}
