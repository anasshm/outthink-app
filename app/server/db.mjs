import { createClient } from "@supabase/supabase-js";
let client;
export function db() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY)
    throw Error("Server storage is not configured.");
  return (client ??= createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ));
}
export function checked({ data, error }) {
  if (error) {
    const e = Error(error.message);
    e.code = error.code;
    throw e;
  }
  return data;
}
export async function rows(table, configure = (q) => q) {
  let result = [],
    offset = 0;
  while (true) {
    const chunk = checked(
      await configure(db().from(table).select("*"))
        .order("id")
        .range(offset, offset + 999),
    );
    result.push(...chunk);
    if (chunk.length < 1000) return result;
    offset += 1000;
  }
}
export async function state() {
  // Retry if another request committed while these independent reads ran.
  for (let i = 0; i < 4; i++) {
    const meta = checked(
      await db().from("ot_meta").select("*").eq("id", 1).single(),
    );
    const [activities, logs, messages, goals, proposals] = await Promise.all([
      rows("ot_activities"),
      rows("ot_logs"),
      rows("ot_messages"),
      rows("ot_goals"),
      rows("ot_proposals"),
    ]);
    const end = checked(
      await db().from("ot_meta").select("revision").eq("id", 1).single(),
    );
    if (end.revision === meta.revision)
      return {
        ...meta,
        activities,
        logs,
        messages: messages.sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        ),
        goals,
        proposals,
      };
  }
  throw Error("Another device is saving. Please try again.");
}
export async function receipt(id) {
  return checked(
    await db().from("ot_receipts").select("result").eq("id", id).maybeSingle(),
  )?.result;
}
export async function apply(s, id, writes, result) {
  return checked(
    await db().rpc("ot_apply", {
      expected_revision: s.revision,
      request_id: id,
      writes,
      response: result,
    }),
  );
}
export async function limit(bucket, max, seconds) {
  return checked(
    await db().rpc("ot_rate_limit", {
      bucket,
      max_hits: max,
      window_seconds: seconds,
    }),
  );
}
