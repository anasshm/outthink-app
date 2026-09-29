import { personalDay } from "../shared/domain.mjs";
import { journal } from "./validation.mjs";

const question = "Would you like me to add this to your journal?";

// The model interprets intent. The server enforces draft -> agreement -> card.
// Only this active, displayed draft crosses turns, never historical journals.
export function journalFlow(prepared, intent, state, now = new Date()) {
  const actions = prepared.actions.filter((a) => a.type !== "journal");
  const today = personalDay(now, state.settings);
  const previous =
    state.clarification?.intent === "journal"
      ? state.clarification.draft
      : null;
  const after =
    prepared.pending || (previous ? state.clarification.after : null) || null;
  if (intent === "approve") {
    if (!previous)
      return {
        ...prepared,
        actions,
        pending: null,
        reply:
          "What would you like the journal entry to say? I’ll show you a draft first.",
      };
    // Use exactly the wording, ratings, period and date already shown.
    return {
      ...prepared,
      actions: [
        ...actions,
        { type: "journal", data: journal(previous, today) },
      ],
      pending: after,
      reply: ["Your journal entry is ready to review.", after?.question]
        .filter(Boolean)
        .join("\n\n"),
    };
  }
  if (intent === "draft") {
    const proposed = prepared.actions.find((a) => a.type === "journal")?.data;
    if (!proposed) return { ...prepared, actions };
    const draft = journal(proposed, today);
    const ratings = Object.entries(draft.scores)
      .map(
        ([name, rating]) =>
          `${name[0].toUpperCase()}${name.slice(1)}: ${rating}/10`,
      )
      .join(" · ");
    return {
      actions,
      pending: {
        intent: "journal",
        activity_name: "",
        question,
        draft,
        ...(after ? { after } : {}),
      },
      reply: [
        prepared.reply,
        `Journal draft · ${draft.day} · ${draft.period}\n\n${draft.text}`,
        ratings,
        question,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  }
  if (intent === "cancel" && after)
    return {
      ...prepared,
      actions,
      pending: after,
      reply: [prepared.reply, after.question].filter(Boolean).join("\n\n"),
    };
  // Casual feelings, cancellation or a different topic cannot queue a journal.
  return { ...prepared, actions };
}
