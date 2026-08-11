// POST /auth-identify  body: { xuid }
// Creates the user (free tier on first sight) and issues a session token.
// Response: { session_token, refresh_token, expires_at } (unix seconds)
import { json, rest, sha256hex, randomToken, unixNow, isoNow, SESSION_TTL_SEC } from "../_shared/helpers.ts";

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let xuid: string;
  let playerName = "";
  let email = "";
  try {
    const b = await req.json();
    xuid = String(b.xuid ?? "").trim();
    playerName = String(b.player_name ?? "").trim().slice(0, 32);
    email = String(b.email ?? "").trim().toLowerCase().slice(0, 254);
  } catch {
    return json(400, { error: "invalid body" });
  }
  if (!xuid || xuid.length > 64) return json(400, { error: "invalid xuid" });

  // ensure the user row exists (tier stays as set by the operator)
  const user = await rest("GET", `/ax_users?xuid=eq.${encodeURIComponent(xuid)}&select=xuid`);
  if (!Array.isArray(user.data) || user.data.length === 0) {
    await rest("POST", "/ax_users", {
      xuid,
      tier: "free",
      player_name: playerName || null,
      email: email || null,
    });
  } else {
    const patch: Record<string, unknown> = { last_seen: new Date().toISOString() };
    if (playerName) patch.player_name = playerName;
    if (email) patch.email = email;
    await rest("PATCH", `/ax_users?xuid=eq.${encodeURIComponent(xuid)}`, patch);
  }

  const sessionToken = randomToken();
  const refreshToken = randomToken();
  const expiresAt = isoNow(SESSION_TTL_SEC);
  await rest("POST", "/ax_sessions", {
    token_hash: await sha256hex(sessionToken),
    refresh_token_hash: await sha256hex(refreshToken),
    xuid,
    expires_at: expiresAt,
  });

  return json(200, {
    session_token: sessionToken,
    refresh_token: refreshToken,
    expires_at: unixNow() + SESSION_TTL_SEC,
  });
};

if (import.meta.main) {
  Deno.serve(handler);
}
