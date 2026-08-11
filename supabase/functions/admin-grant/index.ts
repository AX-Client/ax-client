// POST /admin-grant  Authorization: Bearer <AX_ADMIN_SECRET>
// body: { xuid, tier: "free"|"premium", days?: number } | { email, tier, days? }
// Grants or revokes a Pro subscription, identified by XUID or by the
// account email (emails are unique per user, player names are not).
// `days` is relative to now for premium grants; revoking (tier=free)
// clears the expiry.
import { json, rest, adminOk } from "../_shared/helpers.ts";

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }
  if (!adminOk(req)) return json(401, { error: "invalid admin secret" });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let xuid = "";
  let email = "";
  let tier = "free";
  let days = 30;
  try {
    const b = await req.json();
    xuid = String(b.xuid ?? "").trim();
    email = String(b.email ?? "").trim().toLowerCase();
    tier = String(b.tier ?? "free");
    days = Number(b.days ?? 30);
  } catch {
    return json(400, { error: "invalid body" });
  }
  if (!xuid && !email) return json(400, { error: "missing xuid or email" });
  if (!["free", "premium"].includes(tier)) return json(400, { error: "invalid tier" });

  if (!xuid) {
    const rows = await rest(
      "GET",
      `/ax_users?email=eq.${encodeURIComponent(email)}&select=xuid`,
    );
    const found = Array.isArray(rows.data) && rows.data.length > 0 ? rows.data[0] : null;
    if (!found) return json(404, { error: `no user with email ${email}` });
    xuid = String(found.xuid);
  }

  const expiresAt = tier === "premium"
    ? new Date(Date.now() + Math.max(1, days) * 86400_000).toISOString()
    : null;

  await rest("PATCH", `/ax_users?xuid=eq.${encodeURIComponent(xuid)}`, { tier, expires_at: expiresAt });

  return json(200, { ok: true, xuid, email, tier, expires_at: expiresAt });
};

if (import.meta.main) {
  Deno.serve(handler);
}
