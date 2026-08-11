// GET /premium-status  Authorization: Bearer <session_token>
// Response: { tier: "free"|"premium", expires_at?: unix seconds }
// Expired or unknown sessions return 401 (client treats anything != 2xx as free).
import { json, rest, sha256hex } from "../_shared/helpers.ts";

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json(401, { error: "missing session token" });

  const tokenHash = await sha256hex(token);
  const row = await rest(
    "GET",
    `/ax_sessions?select=xuid,expires_at&token_hash=eq.${encodeURIComponent(tokenHash)}`,
  );
  const match = Array.isArray(row.data) && row.data.length > 0 ? row.data[0] : null;
  if (!match) return json(401, { error: "unknown session" });

  const expiresAt = Date.parse(match.expires_at);
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    return json(401, { error: "session expired" });
  }

  const user = await rest(
    "GET",
    `/ax_users?select=tier,expires_at&xuid=eq.${encodeURIComponent(match.xuid)}`,
  );
  const u = Array.isArray(user.data) && user.data.length > 0 ? user.data[0] : null;
  if (!u) return json(401, { error: "unknown user" });

  const tier = u.tier === "premium" && (u.expires_at == null || Date.parse(u.expires_at) > Date.now())
    ? "premium"
    : "free";

  return json(200, {
    tier,
    expires_at: u.expires_at == null ? null : Math.floor(Date.parse(u.expires_at) / 1000),
  });
};

if (import.meta.main) {
  Deno.serve(handler);
}
