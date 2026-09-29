import { personalDay, shiftDay } from "../shared/domain.mjs";
import { loggingContext, planChat } from "./chat.mjs";
import { catalogueReviews, discussionContext } from "./discussion.mjs";

const normalize = (value) =>
  value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

// Grammar variants of canonical names, not guesses from description/note prose.
// Arbitrary aliases and anything not completely recognized stay with the AI.
const forms = {
  work: ["worked"],
  running: ["ran", "run", "went for a run"],
  run: ["ran", "running", "went for a run"],
  cleaning: ["cleaned"],
  meditation: ["meditated"],
  reading: ["read"],
  gym: ["went to the gym", "went to gym"],
  "patrol run": ["patrolled", "went on patrol"],
  "barracks sparring": ["sparred", "went sparring"],
  "guild contracts": ["worked on contracts", "worked on guild contracts"],
  "enchanting workshop": ["enchanted", "worked in the workshop"],
  "sweep the hideout": ["swept the hideout"],
  "rune meditation": ["meditated"],
  "study spellbooks": ["studied spellbooks"],
  "browse the bazaar": ["browsed the bazaar", "went to the bazaar"],
};
const pastForms = new Set([
  "worked",
  "ran",
  "went for a run",
  "cleaned",
  "meditated",
  "read",
  "went to the gym",
  "went to gym",
  "patrolled",
  "went on patrol",
  "sparred",
  "went sparring",
  "worked on contracts",
  "worked on guild contracts",
  "enchanted",
  "worked in the workshop",
  "swept the hideout",
  "studied spellbooks",
  "browsed the bazaar",
  "went to the bazaar",
]);
const number = "(\\d+(?:\\.\\d+)?|\\.\\d+)";
const unit = "(minutes?|mins?|m|hours?|hrs?|h)";
const leadingTime = new RegExp(
  "^" + number + "\\s*" + unit + "\\s+(?:of\\s+)?(.+)$",
);
const trailingTime = new RegExp(
  "^(.+?)\\s+(?:for\\s+)?" + number + "\\s*" + unit + "$",
);

// Null means "use the full conversational AI", never an error or a request for
// special wording. This function only prepares a normal unchecked proposal.
export function fastLog(message, state, now = new Date()) {
  if (
    typeof message !== "string" ||
    message.length > 300 ||
    state.clarification
  )
    return null;
  // An open question/review can change the meaning of even an activity name.
  const last = [...(state.messages || [])]
    .filter((m) => m.role === "assistant")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (
    last?.text?.trim().endsWith("?") ||
    loggingContext(state)?.follow_up ||
    catalogueReviews(state).length
  )
    return null;

  let phrase = normalize(message).replace(/[.!]+$/, "");
  if (!phrase || /[?!;\n]/.test(phrase)) return null;
  let day = personalDay(now, state.settings);
  const date = phrase.match(/\s+(today|yesterday)$/);
  if (date) {
    if (date[1] === "yesterday") day = shiftDay(day, -1);
    phrase = phrase.slice(0, date.index);
  }
  const command = /^(?:please\s+)?(?:add|log|record)(?:\s+that)?\s+/;
  const explicit = command.test(phrase);
  phrase = phrase.replace(command, "").replace(/^i\s+/, "");
  const did = /^(?:did|completed|finished)\s+/.test(phrase);
  phrase = phrase.replace(/^(?:did|completed|finished)\s+/, "");

  let duration = null;
  const leading = phrase.match(leadingTime);
  const trailing = phrase.match(trailingTime);
  if (leading) {
    duration = { amount: Number(leading[1]), unit: leading[2] };
    phrase = leading[3];
  } else if (trailing) {
    phrase = trailing[1];
    duration = { amount: Number(trailing[2]), unit: trailing[3] };
  }
  if (!explicit && !did && !duration && !pastForms.has(phrase)) return null;
  const matches = state.activities.filter((a) => {
    const name = normalize(a.name);
    return (
      !a.archived &&
      (name === phrase ||
        (Object.hasOwn(forms, name) ? forms[name] : []).includes(phrase))
    );
  });
  if (matches.length !== 1) return null;
  const activity = matches[0];
  let quantity = activity.default_quantity;
  if (duration) {
    // Never reinterpret minutes as visits/completions or discard a stated duration.
    if (!["minute", "hour"].includes(activity.unit) || duration.amount <= 0)
      return null;
    const minutes = duration.amount * (duration.unit.startsWith("h") ? 60 : 1);
    quantity = activity.unit === "hour" ? minutes / 60 : minutes;
  }
  const prior = discussionContext(state, now)?.summary || "";
  const focus = `User reported ${activity.name}, quantity ${quantity} ${activity.unit}, for ${day}. Use lastLoggingExchange and current review state to determine whether pending or already recorded.`;
  const prepared = {
    reply: "Ready to check off.",
    actions: [
      {
        type: "log_activity",
        data: { activity_id: activity.id, quantity, day, additional: false },
      },
    ],
    pending: null,
    proposalEdits: [],
    discussionContext: {
      summary: [prior.slice(-(5900 - focus.length)), focus]
        .filter(Boolean)
        .join("\n"),
    },
  };
  try {
    planChat(state, prepared, { now }); // Same validation and dedup as the AI.
    return prepared;
  } catch {
    return null;
  }
}
