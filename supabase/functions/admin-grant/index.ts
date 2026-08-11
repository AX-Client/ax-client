// POST /admin-grant  Authorization: Bearer <AX_ADMIN_SECRET>
// body: { xuid, tier: "free"|"premium", days?: number }
// Grants or revokes a Pro subscription. `days` is relative to now for
// premium grants; revoking (tier=free) clears the expiry.
import { json, rest, adminOk } from "../_shared/helpers.ts";

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  }
  if (!adminOk(req)) return json(401, { error: "invalid admin secret" });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let xuid: string;
  let tier: string;
  let days: number;
  try {
    const b = await req.json();
    xuid = String(b.xuid ?? "").trim();
    tier = String(b.tier ?? "free");
    days = Number(b.days ?? 30);
  } catch {
    return json(400, { error: "invalid body" });
  }
  if (!xuid) return json(400, { error: "missing xuid" });
  if (!["free", "premium"].includes(tier)) return json(400, { error: "invalid tier" });

  const expiresAt = tier === "premium"
    ? new Date(Date.now() + Math.max(1, days) * 86400_000).toISOString()
    : null;

  await rest("PATCH", `/ax_users?xuid=eq.${encodeURIComponent(xuid)}`, { tier, expires_at: expiresAt });

  return json(200, { ok: true, xuid, tier, expires_at: expiresAt });
};

if (import.meta.main) {
  Deno.serve(handler);
}
