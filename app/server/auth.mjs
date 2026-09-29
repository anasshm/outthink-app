import {
  randomBytes,
  createHash,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { db, checked, limit } from "./db.mjs";
import { UserError } from "./validation.mjs";
const scrypt = promisify(scryptCallback);
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function sessionToken(request) {
  return (
    (request.headers.get("cookie") || "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("outthink_session="))
      ?.slice(17) || ""
  );
}
export async function authenticated(request) {
  const token = sessionToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const row = checked(
    await db()
      .from("ot_sessions")
      .select("expires_at")
      .eq("token_hash", hash(token))
      .maybeSingle(),
  );
  return !!row && Date.parse(row.expires_at) > Date.now();
}
export function cookie(token, request, remove = false) {
  const secure =
    process.env.VERCEL || new URL(request.url).protocol === "https:";
  return `outthink_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${remove ? 0 : 60 * 60 * 24 * 90}${secure ? "; Secure" : ""}`;
}
export async function login(request, password) {
  const ip = process.env.VERCEL
    ? (
        request.headers.get("x-vercel-forwarded-for") ||
        request.headers.get("x-forwarded-for") ||
        "unknown"
      )
        .split(",")[0]
        .trim()
    : "local";
  if (!(await limit(`login:${hash(ip)}`, 8, 900)))
    throw new UserError("Too many attempts. Try again in 15 minutes.", 429);
  const [salt, expected] = (process.env.APP_PASSWORD_HASH || "").split(":");
  if (!salt || !expected) throw Error("Password access is not configured.");
  const candidate = await scrypt(
    typeof password === "string" && password.length < 1024 ? password : "",
    salt,
    64,
  );
  const expectedBytes = Buffer.from(expected, "hex");
  if (
    candidate.length !== expectedBytes.length ||
    !timingSafeEqual(candidate, expectedBytes)
  )
    throw new UserError("That password did not match.", 401);
  const token = randomBytes(32).toString("hex");
  checked(
    await db()
      .from("ot_sessions")
      .insert({
        token_hash: hash(token),
        expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
      }),
  );
  return cookie(token, request);
}
export async function logout(request) {
  checked(
    await db()
      .from("ot_sessions")
      .delete()
      .eq("token_hash", hash(sessionToken(request))),
  );
  return cookie("", request, true);
}
