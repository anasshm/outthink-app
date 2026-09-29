# OutThink agent guidance

Guidance for AI coding agents (and humans) changing OutThink's activities, suggestion logic, or AI context. For the product overview see [README.md](README.md); for field meanings see [CUSTOMIZING.md](CUSTOMIZING.md).

## Keep activity matching rules out of dashboard explanations

This applies whenever creating or editing activities, their text, suggestion logic, or AI context, including direct database updates.

### Mistake and solution

An agent saved activity-matching instructions in an activity's `note`. The dashboard displayed those instructions verbatim under **Why this today**, producing a long explanation about how the AI should classify messages.

The fix was to move the matching instructions into `description` and leave a short, useful reminder in `note`. The activity's XP, frequency, and recorded history were preserved.

### Field responsibilities

- `description`: what counts as the activity, aliases, and distinctions from similar activities. Put default matching behavior and exclusions here. This field reaches the AI and is also visible in the activity editor; it is not a hidden field.
- `note`: the goal the activity serves, an approved learning, or a useful reminder, written for the user. A nonempty note is the complete **Why this today** explanation; do not prepend scheduling boilerplate. Do not put routing instructions, parsing rules, or implementation details here.
- `sop`: HOW to perform the activity (steps, technique). Never why, when, or XP rules. It is excluded from routine AI context and loaded only when the user asks to read or edit it.
- `preferred_frequency`: the structured recurrence. Keep frequency configuration here rather than relying on prose alone.

For example, a reminder such as "Goal: ship version 1.0 by the end of the quarter" belongs in the `note` of a *Side Project* activity. A rule distinguishing *Strength Training* (weights or bodyweight work) from *Stretching* belongs in `description`. A checklist such as "1. Close chat and email. 2. Pick one task." belongs in the `sop` of *Deep Work*.

When the user supplies both kinds of information together, separate them by purpose. Preserve their meaning; do not invent a motivational explanation or discard the matching rule.

### Required verification

1. Before saving, trace where the fields are used. Currently `suggestions()` in `app/shared/domain.mjs` displays a nonempty `note` on its own, falling back to recurrence, goals, and XP context when the note is empty. Those structured fields still determine eligibility and rank. `routineContext()` includes the activity's `description` for the AI. Check the current implementation rather than assuming either field is hidden or rewritten.
2. After saving, read back the changed activity and verify the actual suggestion text contains only a useful user-facing explanation. Check the UI when available; otherwise verify the output of the same suggestion function used by the app.
3. Confirm that the AI context still contains the intended aliases, exclusions, and default matching behavior.
4. For a text-only correction, preserve XP, units, frequency, flags, identity, and completion history.

The current dashboard explanation is assembled by application rules. Do not describe it as an AI-written explanation unless the implementation actually changes to generate it that way.

## Other boundaries

- Every AI-proposed change is a proposal the user confirms. Do not add paths that let the model save, approve, or mark completions done on its own.
- Routine AI context (`routineContext()`) must never include journal entries, scores, raw message history, SOP text, or previous reflection results. Only an explicit reflection request reads journal data.
- Keep business rules in `app/shared/domain.mjs` and `app/server/`, not in UI components or the prompt.
- Use fictional data in tests and examples (see [demo/README.md](demo/README.md) for the bundled fictional dataset). Never commit real credentials, `.env.local`, or personal records.
