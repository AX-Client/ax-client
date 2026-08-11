// POST /auth-refresh  body: { xuid, refresh_token }
// Rotates the session: the old session row is deleted, a new token pair is
// issued. Response: { session_token, refresh_token, expires_at } (unix seconds)
import { json, rest, sha256hex, randomToken, unixNow, isoNow, SESSION_TTL_SEC } from "../_shared/helpers.ts";

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let xuid: string;
  let refreshToken: string;
  try {
    const b = await req.json();
    xuid = String(b.xuid ?? "").trim();
    refreshToken = String(b.refresh_token ?? "");
  } catch {
    return json(400, { error: "invalid body" });
  }
  if (!xuid || !refreshToken) return json(400, { error: "missing xuid or refresh_token" });

  const refreshHash = await sha256hex(refreshToken);
  const row = await rest(
    "GET",
    `/ax_sessions?refresh_token_hash=eq.${encodeURIComponent(refreshHash)}&xuid=eq.${encodeURIComponent(xuid)}&select=xuid,token_hash`,
  );
  const match = Array.isArray(row.data) && row.data.length > 0 ? row.data[0] : null;
  if (!match) return json(401, { error: "invalid refresh_token" });

  // rotate: drop the old session, issue a new pair
  await rest("DELETE", `/ax_sessions?token_hash=eq.${encodeURIComponent(match.token_hash)}`);

  const sessionToken = randomToken();
  const newRefresh = randomToken();
  await rest("POST", "/ax_sessions", {
    token_hash: await sha256hex(sessionToken),
    refresh_token_hash: await sha256hex(newRefresh),
    xuid,
    expires_at: isoNow(SESSION_TTL_SEC),
  });

  return json(200, {
    session_token: sessionToken,
    refresh_token: newRefresh,
    expires_at: unixNow() + SESSION_TTL_SEC,
  });
};

if (import.meta.main) {
  Deno.serve(handler);
}
